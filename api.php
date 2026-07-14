<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Master-Key');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function respond(bool $success, mixed $data = null, string $message = 'Success', int $status = 200): never {
    http_response_code($status);
    echo json_encode(['success' => $success, 'message' => $message, 'data' => $data], JSON_UNESCAPED_SLASHES);
    exit;
}

function envValues(string $path): array {
    if (!is_file($path)) return [];
    $values = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) continue;
        [$key, $value] = explode('=', $line, 2);
        $values[trim($key)] = trim($value, " \t\n\r\0\x0B\"");
    }
    return $values;
}

function db(): mysqli {
    $env = envValues(__DIR__ . '/.env');
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    $connection = new mysqli($env['Hostname'] ?? 'localhost', $env['Username'] ?? 'root', $env['Password'] ?? '', $env['Database'] ?? '');
    $connection->set_charset('utf8mb4');
    return $connection;
}

function input(): array {
  $decoded = json_decode(file_get_contents('php://input'), true);
  if ($decoded === null && json_last_error() !== JSON_ERROR_NONE) respond(false, null, 'Invalid JSON payload.', 400);
  return is_array($decoded) ? $decoded : [];
}

function requestData(): array {
    if (!empty($_POST)) return $_POST;
    return input();
}

function requireMasterAccess(): void {
    $env = envValues(__DIR__ . '/.env');
    $expected = $env['MasterPassword'] ?? 'fisto@2025';
    $provided = $_SERVER['HTTP_X_MASTER_KEY'] ?? '';
    if (!hash_equals($expected, $provided)) respond(false, null, 'Master access is required.', 401);
}

function idFromResource(string $resource, string $name): ?int {
    if (!preg_match('#^' . preg_quote($name, '#') . '/(\d+)$#', $resource, $matches)) return null;
    return (int) $matches[1];
}

function categories(mysqli $db): array {
    $result = $db->query('SELECT c.id, c.name, COUNT(p.id) AS project_count FROM application_categories c LEFT JOIN application_projects p ON p.category_id = c.id GROUP BY c.id, c.name ORDER BY c.name');
    return $result->fetch_all(MYSQLI_ASSOC);
}

function credentials(mysqli $db, int $projectId): array {
    $stmt = $db->prepare('SELECT id, role, username, password, remarks FROM application_project_credentials WHERE project_id = ? ORDER BY id');
    $stmt->bind_param('i', $projectId); $stmt->execute();
    return $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
}

function deleteUploadedImage(?string $path): void {
    if (!$path) return;
    $normalized = str_replace('\\', '/', $path);
    if (!str_starts_with($normalized, 'uploads/')) return;
    $absolute = __DIR__ . '/' . $normalized;
    if (is_file($absolute)) @unlink($absolute);
}

function storeUploadedImage(array $file): string {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) respond(false, null, 'Image upload failed.', 400);
    if (($file['size'] ?? 0) > 1024 * 1024) respond(false, null, 'Image must be less than 1 MB.', 422);
    $mime = mime_content_type($file['tmp_name'] ?? '');
    $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!$mime || !isset($allowed[$mime])) respond(false, null, 'Allowed image formats are JPEG, PNG, and WEBP.', 422);
    $uploadDir = __DIR__ . '/uploads';
    if (!is_dir($uploadDir) && !mkdir($uploadDir, 0775, true) && !is_dir($uploadDir)) respond(false, null, 'Unable to create upload directory.', 500);
    $name = 'project_' . bin2hex(random_bytes(8)) . '.' . $allowed[$mime];
    $target = $uploadDir . '/' . $name;
    if (!move_uploaded_file($file['tmp_name'], $target)) respond(false, null, 'Unable to save uploaded image.', 500);
    return 'uploads/' . $name;
}

function project(mysqli $db, int $id): ?array {
    $stmt = $db->prepare('SELECT p.*, c.name AS category_name FROM application_projects p JOIN application_categories c ON c.id = p.category_id WHERE p.id = ?');
    $stmt->bind_param('i', $id); $stmt->execute(); $row = $stmt->get_result()->fetch_assoc();
    if (!$row) return null;
    $row['credentials'] = credentials($db, $id);
    return $row;
}

function projectPayload(array $data): array {
    $required = ['category_id', 'project_name', 'company_name'];
    foreach ($required as $field) if (!isset($data[$field]) || trim((string)$data[$field]) === '') respond(false, null, "$field is required.", 422);
    $credentials = $data['credentials'] ?? [];
    if (is_string($credentials)) {
        $decoded = json_decode($credentials, true);
        if ($decoded === null && json_last_error() !== JSON_ERROR_NONE) respond(false, null, 'Credentials must be valid JSON.', 422);
        $credentials = is_array($decoded) ? $decoded : [];
    }
    if (!is_array($credentials)) respond(false, null, 'Credentials must be an array.', 422);
    foreach ($credentials as $credential) {
        if (!is_array($credential) || trim((string)($credential['role'] ?? '')) === '') respond(false, null, 'Each credential needs a role.', 422);
    }
    return $credentials;
}

function saveCredentials(mysqli $db, int $projectId, array $items): void {
    $delete = $db->prepare('DELETE FROM application_project_credentials WHERE project_id = ?');
    $delete->bind_param('i', $projectId); $delete->execute();
    $insert = $db->prepare('INSERT INTO application_project_credentials (project_id, role, username, password, remarks) VALUES (?, ?, ?, ?, ?)');
    foreach ($items as $item) {
        $role = trim((string)$item['role']); $username = trim((string)($item['username'] ?? '')) ?: null; $password = trim((string)($item['password'] ?? '')) ?: null; $remarks = trim((string)($item['remarks'] ?? '')) ?: null;
        $insert->bind_param('issss', $projectId, $role, $username, $password, $remarks); $insert->execute();
    }
}

try {
    $db = db(); $method = $_SERVER['REQUEST_METHOD'];
    $resource = trim((string)($_GET['resource'] ?? ''), '/');
    $body = in_array($method, ['POST', 'PUT'], true) ? requestData() : [];
    if (in_array($method, ['POST', 'PUT', 'DELETE'], true)) requireMasterAccess();

    if ($resource === 'projects' && $method === 'GET') {
        $rows = $db->query('SELECT p.*, c.name AS category_name FROM application_projects p JOIN application_categories c ON c.id = p.category_id ORDER BY p.created_at DESC, p.id DESC')->fetch_all(MYSQLI_ASSOC);
        foreach ($rows as &$row) $row['credentials'] = credentials($db, (int)$row['id']);
        respond(true, $rows);
    }
    if ($resource === 'projects' && $method === 'POST') {
        $items = projectPayload($body);
        $categoryId = (int)$body['category_id'];
        $name = trim((string)$body['project_name']);
        $description = trim((string)($body['description'] ?? '')) ?: null;
        $company = trim((string)$body['company_name']);
        $url = trim((string)($body['project_url'] ?? '')) ?: null;
        $projectId = isset($body['project_id']) ? (int)$body['project_id'] : null;
        $removeImage = filter_var($body['remove_image'] ?? false, FILTER_VALIDATE_BOOL);
        $existingImage = trim((string)($body['existing_image'] ?? '')) ?: null;
        $uploadedImage = isset($_FILES['image_file']) && is_array($_FILES['image_file']) ? storeUploadedImage($_FILES['image_file']) : null;
        $image = $uploadedImage ?? ($removeImage ? null : $existingImage);

        if ($projectId) {
            $existing = project($db, $projectId);
            if (!$existing) respond(false, null, 'Project not found.', 404);
            $db->begin_transaction();
            $stmt = $db->prepare('UPDATE application_projects SET category_id = ?, project_name = ?, description = ?, company_name = ?, image = ?, project_url = ? WHERE id = ?');
            $stmt->bind_param('isssssi', $categoryId, $name, $description, $company, $image, $url, $projectId);
            $stmt->execute();
            saveCredentials($db, $projectId, $items);
            $db->commit();
            if ($uploadedImage && !empty($existing['image']) && $existing['image'] !== $uploadedImage) deleteUploadedImage((string)$existing['image']);
            if ($removeImage && !empty($existing['image'])) deleteUploadedImage((string)$existing['image']);
            respond(true, project($db, $projectId), 'Project updated.');
        }

        $db->begin_transaction();
        $stmt = $db->prepare('INSERT INTO application_projects (category_id, project_name, description, company_name, image, project_url) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->bind_param('isssss', $categoryId, $name, $description, $company, $image, $url);
        $stmt->execute();
        $newId = $db->insert_id;
        saveCredentials($db, $newId, $items);
        $db->commit();
        respond(true, project($db, $newId), 'Project created.', 201);
    }
    if (($id = idFromResource($resource, 'projects')) !== null && $method === 'GET') {
        $item = project($db, $id); if (!$item) respond(false, null, 'Project not found.', 404); respond(true, $item);
    }
    if (($id = idFromResource($resource, 'projects')) !== null && $method === 'PUT') {
        $items = projectPayload($body); if (!project($db, $id)) respond(false, null, 'Project not found.', 404);
        $categoryId = (int)$body['category_id']; $name = trim((string)$body['project_name']); $description = trim((string)($body['description'] ?? '')) ?: null; $company = trim((string)$body['company_name']); $image = trim((string)($body['image'] ?? '')) ?: null; $url = trim((string)($body['project_url'] ?? '')) ?: null;
        $db->begin_transaction(); $stmt = $db->prepare('UPDATE application_projects SET category_id = ?, project_name = ?, description = ?, company_name = ?, image = ?, project_url = ? WHERE id = ?'); $stmt->bind_param('isssssi', $categoryId, $name, $description, $company, $image, $url, $id); $stmt->execute(); saveCredentials($db, $id, $items); $db->commit(); respond(true, project($db, $id), 'Project updated.');
    }
    if (($id = idFromResource($resource, 'projects')) !== null && $method === 'DELETE') {
        $existing = project($db, $id);
        $stmt = $db->prepare('DELETE FROM application_projects WHERE id = ?'); $stmt->bind_param('i', $id); $stmt->execute(); if ($stmt->affected_rows === 0) respond(false, null, 'Project not found.', 404); if (!empty($existing['image'])) deleteUploadedImage((string)$existing['image']); respond(true, null, 'Project deleted.');
    }
    if ($resource === 'categories' && $method === 'GET') respond(true, categories($db));
    if ($resource === 'categories' && $method === 'POST') {
        $name = trim((string)($body['name'] ?? '')); if ($name === '') respond(false, null, 'Category name is required.', 422); $stmt = $db->prepare('INSERT INTO application_categories (name) VALUES (?)'); $stmt->bind_param('s', $name); $stmt->execute(); respond(true, ['id' => $db->insert_id, 'name' => $name], 'Category created.', 201);
    }
    if (($id = idFromResource($resource, 'categories')) !== null && $method === 'PUT') {
        $name = trim((string)($body['name'] ?? '')); if ($name === '') respond(false, null, 'Category name is required.', 422); $stmt = $db->prepare('UPDATE application_categories SET name = ? WHERE id = ?'); $stmt->bind_param('si', $name, $id); $stmt->execute(); if ($stmt->affected_rows === 0) respond(false, null, 'Category not found or unchanged.', 404); respond(true, ['id' => $id, 'name' => $name], 'Category updated.');
    }
    if (($id = idFromResource($resource, 'categories')) !== null && $method === 'DELETE') {
        $stmt = $db->prepare('DELETE FROM application_categories WHERE id = ?'); $stmt->bind_param('i', $id); $stmt->execute(); if ($stmt->affected_rows === 0) respond(false, null, 'Category could not be deleted.', 409); respond(true, null, 'Category deleted.');
    }
    respond(false, null, 'Endpoint not found.', 404);
} catch (mysqli_sql_exception $exception) {
    if (isset($db)) $db->rollback();
    respond(false, null, $exception->getCode() === 1062 ? 'That value already exists.' : 'Database operation failed.', 500);
} catch (Throwable $exception) {
    if (isset($db)) $db->rollback(); respond(false, null, 'Server error.', 500);
}

const MASTER_PASSWORD = 'fisto@2026';
const BASE_URL = 'https://www.fist-o.com/demo_workspace/applications/';
const API_URL = 'https://www.fist-o.com/demo_workspace/applications/api.php';
const FALLBACK_CATEGORIES = ['All', 'Pattern App', 'Event App', 'Customised Applications'];

let cards = [];
let categories = [...FALLBACK_CATEGORIES];
let activeFilter = 'All';
let searchQuery = '';
let editingId = null;
let deletingId = null;
let isMasterLoggedIn = false;
let usingApi = false;
let categoryFocusIndex = -1;
let openCredentialCardId = null;

const defaultCards = () => [
    { id: 'demo-1', title: 'Weave Pattern Studio', description: 'Interactive textile pattern visualisation for bulk-order planning.', company: 'Lakshmi Textiles', category: 'Pattern App', image: 'fisto-logo.png', url: '', credentials: [{ role: 'Administrator', username: 'demo@lakshmi.in', password: 'weave123', remarks: 'Full access' }] },
    { id: 'demo-2', title: 'EventSphere', description: 'Registration, ticketing and attendee management in one workspace.', company: 'Coimbatore Events Pvt', category: 'Event App', image: 'fisto-logo.png', url: '', credentials: [{ role: 'Administrator', username: 'admin@cbevents.in', password: 'event@demo', remarks: '' }, { role: 'Staff', username: 'staff@cbevents.in', password: 'staff@demo', remarks: 'Check-in access' }] }
];

function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function resolveAssetPath(path) {
    if (!path) return 'fisto-logo.png';
    if (/^(https?:|data:|blob:|\/)/i.test(path)) return path;
    return new URL(path, "https://fist-o.com/demo_workspace/applications/").href;
}

async function request(resource, options = {}) {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers = {
        ...(options.method && options.method !== 'GET' ? { 'X-Master-Key': MASTER_PASSWORD } : {}),
        ...(options.headers || {})
    };
    if (!isFormData) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${API_URL}?resource=${encodeURIComponent(resource)}`, {
        ...options,
        headers
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.message || 'Request failed');
    return payload.data;
}

function mapProject(project) {
    return {
        id: String(project.id),
        title: project.project_name,
        description: project.description || '',
        company: project.company_name,
        category: project.category_name,
        categoryId: Number(project.category_id),
        image: project.image || 'fisto-logo.png',
        url: project.project_url || '',
        credentials: project.credentials || []
    };
}

async function loadWorkspace() {
    try {
        const [projects, categoryRows] = await Promise.all([request('projects'), request('categories')]);
        cards = projects.map(mapProject);
        categories = ['All', ...categoryRows.map(category => category.name)];
        usingApi = true;
    } catch (error) {
        cards = defaultCards();
        categories = [...FALLBACK_CATEGORIES];
        console.warn('API unavailable; showing sample data.', error);
    }
}

function getFilteredCards() {
    const query = searchQuery.toLowerCase();
    return cards.filter(card => (activeFilter === 'All' || card.category === activeFilter) && (!query || [card.title, card.company, card.description, card.category].some(value => value.toLowerCase().includes(query))));
}

function renderFilters() {
    const list = document.getElementById('filterList');
    if (!list) return;
    list.innerHTML = categories.map(category => {
        const count = category === 'All' ? cards.length : cards.filter(card => card.category === category).length;
        return `<button class="filter-btn ${activeFilter === category ? 'active' : ''}" data-category-index="${categories.indexOf(category)}"><span>${escapeHtml(category)}</span><span class="count">${count}</span></button>`;
    }).join('');
    list.querySelectorAll('[data-category-index]').forEach(button => {
        button.addEventListener('click', () => setFilter(categories[Number(button.dataset.categoryIndex)]));
    });
}

function renderCards() {
    const filtered = getFilteredCards();
    document.getElementById('workspaceCount').textContent = `${filtered.length} of ${cards.length} application${cards.length === 1 ? '' : 's'}`;
    const grid = document.getElementById('cardsGrid');
    grid.innerHTML = filtered.length ? filtered.map((card, index) => `
    <article class="app-card">
      <div class="app-card-image"><img src="${escapeHtml(resolveAssetPath(card.image))}" alt="${escapeHtml(card.title)}" onerror="this.src='fisto-logo.png'" /></div>
      <div class="app-card-content"><div class="app-card-topline"><span class="app-card-tag">${escapeHtml(card.category)}</span></div><div class="app-card-company">${escapeHtml(card.company)}</div><h3 class="app-card-title">${escapeHtml(card.title)}</h3><p class="app-card-desc">${escapeHtml(card.description)}</p>
      <div class="app-card-actions"><button type="button" class="card-btn card-btn-primary" data-view-card="${index}">View App</button><button type="button" class="card-btn card-btn-secondary ${openCredentialCardId === card.id ? 'is-open' : ''}" data-credentials-card="${index}" aria-expanded="${openCredentialCardId === card.id}" aria-label="${openCredentialCardId === card.id ? 'Close credentials' : 'Open credentials'}">Credentials <svg class="credentials-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="${openCredentialCardId === card.id ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg></button></div>
      <div class="credentials-accordion ${openCredentialCardId === card.id ? 'is-open' : ''}">${buildCardCredentials(card.credentials)}</div></div>
    </article>`).join('') : '<div class="empty-state"><h3>No projects found</h3><p>Try a different search or category.</p></div>';
    grid.querySelectorAll('[data-view-card]').forEach(button => button.addEventListener('click', () => viewApp(filtered[Number(button.dataset.viewCard)].id)));
    grid.querySelectorAll('[data-credentials-card]').forEach(button => button.addEventListener('click', () => toggleCardCredentials(filtered[Number(button.dataset.credentialsCard)].id)));
    grid.querySelectorAll('[data-copy-value]').forEach(button => button.addEventListener('click', () => copyToClipboard(decodeURIComponent(button.dataset.copyValue), button)));
}

function buildCardCredentials(credentials) {
    if (!credentials.length) return '<p class="credentials-empty">No credentials have been added for this application.</p>';
    return credentials.map((credential, index) => `
    <section class="card-credential-role">
      <h4>${escapeHtml(credential.role || `Role ${index + 1}`)}</h4>
      <label>Username <span class="credential-copy-field"><input type="text" value="${escapeHtml(credential.username || '')}" readonly><button type="button" data-copy-value="${encodeURIComponent(credential.username || '')}" aria-label="Copy username" title="Copy username">Copy</button></span></label>
      <label>Password <span class="credential-copy-field"><input type="text" value="${escapeHtml(credential.password || '')}" readonly><button type="button" data-copy-value="${encodeURIComponent(credential.password || '')}" aria-label="Copy password" title="Copy password">Copy</button></span></label>
      ${credential.remarks ? `<p>${escapeHtml(credential.remarks)}</p>` : ''}
    </section>`).join('');
}

function toggleCardCredentials(cardId) { openCredentialCardId = openCredentialCardId === cardId ? null : cardId; renderCards(); }

function setFilter(category) {
  activeFilter = category;
  document.getElementById('categoryInput').value = category;
  closeCategoryDropdown();
  renderFilters(); renderCards();
}

function renderAutocomplete() {
  const dropdown = document.getElementById('autocompleteDropdown');
  dropdown.innerHTML = categories.map((category, index) => `<button type="button" class="autocomplete-option ${index === categoryFocusIndex ? 'is-focused' : ''}" role="option" aria-selected="${index === categoryFocusIndex}" data-category-index="${index}">${escapeHtml(category)}</button>`).join('');
  dropdown.querySelectorAll('[data-category-index]').forEach(button => {
    button.addEventListener('click', () => setFilter(categories[Number(button.dataset.categoryIndex)]));
  });
}

function openCategoryDropdown() {
  categoryFocusIndex = categories.indexOf(activeFilter);
  renderAutocomplete();
  document.getElementById('autocompleteDropdown').classList.add('active');
}
function closeCategoryDropdown() { document.getElementById('autocompleteDropdown').classList.remove('active'); categoryFocusIndex = -1; }

function setupAutocomplete() {
  const input = document.getElementById('categoryInput');
  input.value = activeFilter;
  input.addEventListener('click', () => document.getElementById('autocompleteDropdown').classList.contains('active') ? closeCategoryDropdown() : openCategoryDropdown());
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (!document.getElementById('autocompleteDropdown').classList.contains('active')) openCategoryDropdown();
      categoryFocusIndex = (categoryFocusIndex + (event.key === 'ArrowDown' ? 1 : -1) + categories.length) % categories.length; renderAutocomplete();
      document.querySelector('.autocomplete-option.is-focused')?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && categoryFocusIndex >= 0) { event.preventDefault(); setFilter(categories[categoryFocusIndex]); }
    else if (event.key === 'Escape') closeCategoryDropdown();
  });
  document.addEventListener('click', event => { if (!event.target.closest('.autocomplete-wrap')) closeCategoryDropdown(); });
}

function setupSearch() {
  const input = document.getElementById('searchInput'); const clear = document.getElementById('searchClear');
  input.addEventListener('input', event => { searchQuery = event.target.value; clear.style.display = searchQuery ? 'flex' : 'none'; renderCards(); });
  clear.addEventListener('click', () => { input.value = ''; searchQuery = ''; clear.style.display = 'none'; renderCards(); input.focus(); });
}

function openMasterLoginModal() { openModal('masterLoginModal'); setTimeout(() => document.getElementById('masterPwInput').focus(), 50); }
function closeMasterLoginModal() { closeModal('masterLoginModal'); document.getElementById('masterPwInput').value = ''; document.getElementById('masterPwInput').type = 'password'; document.getElementById('masterPasswordToggle').classList.remove('is-visible'); document.getElementById('masterPasswordToggle').setAttribute('aria-label', 'Show master password'); document.getElementById('masterPasswordToggle').title = 'Show password'; document.getElementById('pwError').textContent = ''; }
function toggleMasterPasswordVisibility() {
  const input = document.getElementById('masterPwInput');
  const toggle = document.getElementById('masterPasswordToggle');
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  toggle.classList.toggle('is-visible', visible);
  toggle.setAttribute('aria-label', visible ? 'Hide master password' : 'Show master password');
  toggle.title = visible ? 'Hide password' : 'Show password';
}
function loginMaster() {
  const input = document.getElementById('masterPwInput');
  if (input.value !== MASTER_PASSWORD) { document.getElementById('pwError').textContent = 'Incorrect password. Try again.'; input.select(); return; }
  isMasterLoggedIn = true; closeMasterLoginModal(); document.getElementById('loginBtn').style.display = 'none'; document.getElementById('manageProjectsBtn').style.display = 'inline-flex'; document.getElementById('logoutBtn').style.display = 'inline-flex'; openManageProjects();
}
function logoutMaster() { isMasterLoggedIn = false; document.getElementById('loginBtn').style.display = 'inline-flex'; document.getElementById('manageProjectsBtn').style.display = 'none'; document.getElementById('logoutBtn').style.display = 'none'; closeModal('manageProjectsModal'); }
function openManageProjects() { if (!isMasterLoggedIn) return openMasterLoginModal(); openModal('manageProjectsModal'); renderManageProjects(); }
function closeManageProjects() { closeModal('manageProjectsModal'); }
function switchManageTab(tabName) {
  document.querySelectorAll('.manage-tab').forEach(tab => tab.classList.toggle('active', tab.textContent.toLowerCase().includes(tabName === 'projects' ? 'projects' : 'categories')));
  document.getElementById('projectsTabContent').classList.toggle('active', tabName === 'projects'); document.getElementById('categoriesTabContent').classList.toggle('active', tabName === 'categories');
  tabName === 'projects' ? renderManageProjects() : renderManageCategories();
}
function renderManageProjects() { document.getElementById('manageProjectsGrid').innerHTML = cards.map(card => `<div class="manage-card"><div class="manage-card-title">${escapeHtml(card.title)}</div><div class="manage-card-info"><strong>${escapeHtml(card.company)}</strong><div>${escapeHtml(card.category)} · ${card.credentials.length} role${card.credentials.length === 1 ? '' : 's'}</div></div><div class="manage-card-actions"><button class="btn-edit" onclick="editCard('${card.id}')">Edit</button><button class="btn-delete" onclick="prepareDeleteCard('${card.id}')">Delete</button></div></div>`).join(''); }
function renderManageCategories() { document.getElementById('categoriesList').innerHTML = categories.filter(category => category !== 'All').map(category => `<div class="category-item"><div><div class="category-name">${escapeHtml(category)}</div><div class="category-count">${cards.filter(card => card.category === category).length} projects</div></div><div class="category-item-actions"><button class="btn-edit-cat" onclick="editCategory(${JSON.stringify(category)})">Edit</button><button class="btn-delete-cat" onclick="deleteCategory(${JSON.stringify(category)})">Delete</button></div></div>`).join(''); }

function companySuggestions() { return [...new Set(cards.map(card => card.company).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function renderCredentialRows(credentials = []) { return credentials.map((credential, index) => `<div class="credential-row"><div class="credential-row-header"><strong>Credential ${index + 1}</strong><button type="button" class="credential-remove" onclick="removeCredentialRow(this)" aria-label="Remove credential">×</button></div><div class="credential-fields"><input class="credential-role" value="${escapeHtml(credential.role || '')}" placeholder="Role (e.g. Administrator)" required><input class="credential-username" value="${escapeHtml(credential.username || '')}" placeholder="Username"><input class="credential-password" type="text" value="${escapeHtml(credential.password || '')}" placeholder="Password"><input class="credential-remarks" value="${escapeHtml(credential.remarks || '')}" placeholder="Remarks (optional)"></div></div>`).join(''); }
function addCredentialRow(credential = {}) { document.getElementById('credentialRows').insertAdjacentHTML('beforeend', renderCredentialRows([credential])); }
function removeCredentialRow(button) { button.closest('.credential-row').remove(); }

function openCardForm(cardId = null) { editingId = cardId; const card = cardId ? cards.find(item => item.id === cardId) : null; document.getElementById('cardFormTitle').textContent = card ? 'Edit Project' : 'Add New Project'; renderCardForm(card); openModal('cardFormModal'); }
function renderCardForm(card) {
  const options = categories.filter(category => category !== 'All').map(category => `<option value="${escapeHtml(category)}" ${card?.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('');
  const currentImage = card?.image && card.image !== 'fisto-logo.png' ? card.image : '';
  const imagePreview = currentImage ? `<img src="${escapeHtml(resolveAssetPath(currentImage))}" alt="Current project image" onerror="this.src='fisto-logo.png'">` : `<div class="image-preview-empty">No image selected</div>`;
  const grid = document.getElementById('cardFormGrid');
  grid.innerHTML = `<div class="form-group"><label>Project Title <span>*</span></label><input id="cardTitle" value="${escapeHtml(card?.title || '')}" required></div><div class="form-group company-field"><label>Company <span>*</span></label><input id="cardCompany" list="companySuggestions" value="${escapeHtml(card?.company || '')}" placeholder="Select or enter a company" required><datalist id="companySuggestions">${companySuggestions().map(company => `<option value="${escapeHtml(company)}">`).join('')}</datalist></div><div class="form-group"><label>Description</label><textarea id="cardDescription">${escapeHtml(card?.description || '')}</textarea></div><div class="form-group"><label>Category <span>*</span></label><select id="cardCategory" required><option value="">Select a category</option>${options}</select></div><div class="form-group image-upload-group"><label>Project Image</label><input id="cardImageFile" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"><input type="hidden" id="cardExistingImage" value="${escapeHtml(currentImage)}"><input type="hidden" id="cardRemoveImage" value="0"><p class="form-help">PNG, JPG, or WEBP only. Max 1 MB.</p><div class="image-preview" id="cardImagePreview">${imagePreview}</div><div class="image-actions"><button type="button" class="image-action-btn" id="clearImageBtn" onclick="clearProjectImage()">Remove image</button></div></div><div class="form-group"><label>Application URL</label><input id="cardUrl" value="${escapeHtml(card?.url || '')}" placeholder="https://example.com/app"></div><section class="credentials-editor"><div class="credentials-editor-heading"><div><h4>Access Credentials</h4><p>Add one record for each role.</p></div><button type="button" class="btn-add-credential" onclick="addCredentialRow()">Add role</button></div><div id="credentialRows">${renderCredentialRows(card?.credentials || [])}</div></section><div class="form-actions"><button type="button" class="btn-cancel" onclick="closeModal('cardFormModal')">Cancel</button><button type="button" class="btn-save" onclick="saveCardForm()">${card ? 'Update' : 'Add'} Project</button></div>`;
  const fileInput = document.getElementById('cardImageFile');
  const preview = document.getElementById('cardImagePreview');
  const existingImageField = document.getElementById('cardExistingImage');
  const removeImageField = document.getElementById('cardRemoveImage');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    removeImageField.value = '0';
    if (!file) {
      preview.innerHTML = existingImageField.value ? `<img src="${escapeHtml(resolveAssetPath(existingImageField.value))}" alt="Current project image" onerror="this.src='fisto-logo.png'">` : '<div class="image-preview-empty">No image selected</div>';
      return;
    }
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${url}" alt="Selected project image">`;
  });
}
function collectCredentials() { return [...document.querySelectorAll('.credential-row')].map(row => ({ role: row.querySelector('.credential-role').value.trim(), username: row.querySelector('.credential-username').value.trim(), password: row.querySelector('.credential-password').value.trim(), remarks: row.querySelector('.credential-remarks').value.trim() })).filter(credential => credential.role || credential.username || credential.password || credential.remarks); }
async function saveCardForm() {
  const title = document.getElementById('cardTitle').value.trim(); const company = document.getElementById('cardCompany').value.trim(); const category = document.getElementById('cardCategory').value; const credentials = collectCredentials();
  if (!title || !company || !category) return showToast('Project title, company, and category are required.', 'error');
  if (credentials.some(credential => !credential.role)) return showToast('Every credential needs a role.', 'error');
  const fileInput = document.getElementById('cardImageFile');
  const file = fileInput.files?.[0];
  if (file && file.size > 1024 * 1024) return showToast('Image must be less than 1 MB.', 'error');
  if (file && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return showToast('Allowed image formats are JPEG, PNG, and WEBP.', 'error');
  try {
    if (!usingApi) throw new Error('The API is not available.');
    const categoryRows = await request('categories'); const currentCategory = categoryRows.find(item => item.name === category);
    const formData = new FormData();
    formData.append('category_id', String(currentCategory.id));
    formData.append('project_name', title);
    formData.append('company_name', company);
    formData.append('description', document.getElementById('cardDescription').value.trim());
    formData.append('project_url', document.getElementById('cardUrl').value.trim());
    formData.append('credentials', JSON.stringify(credentials));
    formData.append('remove_image', document.getElementById('cardRemoveImage').value);
    formData.append('existing_image', document.getElementById('cardExistingImage').value);
    if (editingId) formData.append('project_id', editingId);
    if (file) formData.append('image_file', file);
    await request('projects', { method: 'POST', body: formData });
    await loadWorkspace(); closeModal('cardFormModal'); renderAll(); renderManageProjects(); showToast(editingId ? 'Project updated.' : 'Project added.', 'success'); editingId = null;
  } catch (error) { showToast(error.message, 'error'); }
}
function clearProjectImage() {
  const fileInput = document.getElementById('cardImageFile');
  const existingImageField = document.getElementById('cardExistingImage');
  const removeImageField = document.getElementById('cardRemoveImage');
  const preview = document.getElementById('cardImagePreview');
  fileInput.value = '';
  existingImageField.value = '';
  removeImageField.value = '1';
  preview.innerHTML = '<div class="image-preview-empty">Image removed</div>';
}
function editCard(id) { openCardForm(id); }
function prepareDeleteCard(id) { deletingId = id; openModal('deleteModal'); }
async function deleteCard() { try { if (!usingApi) throw new Error('The API is not available.'); await request(`projects/${deletingId}`, { method: 'DELETE' }); await loadWorkspace(); closeModal('deleteModal'); renderAll(); renderManageProjects(); showToast('Project deleted.', 'success'); } catch (error) { showToast(error.message, 'error'); } }

function showCredentials(id) { const card = cards.find(item => item.id === id); if (!card) return; document.getElementById('credsModalTitle').textContent = card.title; document.getElementById('credsModalBody').innerHTML = `<div class="credential-display-list">${card.credentials.map((credential, index) => `<section class="credential-display"><h4>${escapeHtml(credential.role || `Role ${index + 1}`)}</h4>${credential.username ? `<div><span>Username</span><code>${escapeHtml(credential.username)}</code></div>` : ''}${credential.password ? `<div><span>Password</span><div class="credential-secret"><code data-password>${escapeHtml(credential.password)}</code><button onclick="copyToClipboard(${JSON.stringify(credential.password)})">Copy</button></div></div>` : ''}${credential.remarks ? `<p>${escapeHtml(credential.remarks)}</p>` : ''}</section>`).join('')}</div>`; openModal('credsModal'); }
function copyToClipboard(value, button) {
  navigator.clipboard.writeText(value).then(() => {
    if (!button) return;
    const originalLabel = button.dataset.originalLabel || button.textContent || 'Copy';
    button.dataset.originalLabel = originalLabel;
    button.textContent = 'Copied';
    button.classList.add('is-copied');
    window.setTimeout(() => {
      button.textContent = button.dataset.originalLabel || originalLabel;
      button.classList.remove('is-copied');
    }, 1500);
  }).catch(() => {
    if (!button) return;
    const originalLabel = button.dataset.originalLabel || button.textContent || 'Copy';
    button.dataset.originalLabel = originalLabel;
    button.textContent = 'Failed';
    window.setTimeout(() => {
      button.textContent = button.dataset.originalLabel || originalLabel;
      button.classList.remove('is-copied');
    }, 1500);
  });
}
function viewApp(id) { const card = cards.find(item => item.id === id); if (card?.url) window.open(card.url, '_blank', 'noopener'); else showToast('No application URL has been added yet.', 'error'); }

async function addNewCategory() { const name = document.getElementById('newCatInput').value.trim(); if (!name) return; try { if (!usingApi) throw new Error('The API is not available.'); await request('categories', { method: 'POST', body: JSON.stringify({ name }) }); await loadWorkspace(); closeModal('addCatModal'); renderAll(); renderManageCategories(); } catch (error) { document.getElementById('catError').textContent = error.message; } }
function openAddCategoryModal() { document.getElementById('newCatInput').value = ''; document.getElementById('catError').textContent = ''; openModal('addCatModal'); }
async function editCategory(name) { const updated = prompt('Edit category name:', name)?.trim(); if (!updated || updated === name) return; try { const rows = await request('categories'); const category = rows.find(item => item.name === name); await request(`categories/${category.id}`, { method: 'PUT', body: JSON.stringify({ name: updated }) }); await loadWorkspace(); renderAll(); renderManageCategories(); } catch (error) { showToast(error.message, 'error'); } }
async function deleteCategory(name) { try { const rows = await request('categories'); const category = rows.find(item => item.name === name); await request(`categories/${category.id}`, { method: 'DELETE' }); await loadWorkspace(); renderAll(); renderManageCategories(); } catch (error) { showToast(error.message, 'error'); } }

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function showToast(message, type = 'info') { const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.textContent = message; document.getElementById('toast-container').appendChild(toast); setTimeout(() => toast.remove(), 3500); }
function renderAll() { renderFilters(); renderCards(); document.getElementById('categoryInput').value = activeFilter; }

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.modal-overlay').forEach(overlay => overlay.addEventListener('click', event => { if (event.target === overlay) closeModal(overlay.id); }));
  document.getElementById('confirmDeleteBtn').addEventListener('click', deleteCard);
  document.getElementById('masterPwInput').addEventListener('keydown', event => { if (event.key === 'Enter') loginMaster(); });
  setupSearch(); setupAutocomplete(); await loadWorkspace(); renderAll();
  document.getElementById('page-loader')?.classList.add('hidden');
});

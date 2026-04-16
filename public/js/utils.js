// ==================== Utility Functions ====================

// Escape HTML special characters to prevent XSS
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// XSS-safe: create element with textContent (no innerHTML)
function createTextElement(tag, text, className) {
    var el = document.createElement(tag);
    el.textContent = text || '';
    if (className) el.className = className;
    return el;
}

// XSS-safe: set text on element
function safeSetText(el, text) {
    el.textContent = text || '';
}

// Create JIRA link for bug IDs (safe)
function createJiraLink(bugId) {
    if (bugId && bugId.match(/^[A-Z0-9a-z\-]+-\d+$/)) {
        var a = document.createElement('a');
        a.href = App.jiraBaseUrl + bugId;
        a.target = '_blank';
        a.className = 'jira-link';
        a.textContent = bugId;
        return a;
    }
    var span = document.createElement('span');
    span.textContent = bugId || '';
    return span;
}

// Show sync status message
function showSyncStatus(message, type) {
    type = type || 'info';
    var statusEl = document.getElementById('sync-status');
    statusEl.textContent = message;
    statusEl.className = 'sync-status sync-' + type;
    statusEl.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(function() {
            statusEl.style.display = 'none';
        }, 3000);
    }
}

// Hide sync status
function hideSyncStatus() {
    document.getElementById('sync-status').style.display = 'none';
}

// ==================== Modal Helpers ====================

function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// ==================== Data Persistence Helpers ====================

async function persistData() {
    saveToLocalStorage(App.data);
    await saveDataToAPI();
}

function saveAndRefresh(modalId, renderFn, dataKey, cleanupFn) {
    closeModal(modalId);
    if (cleanupFn) cleanupFn();
    renderFn(App.data[dataKey]);
    persistData();
}

// ==================== Permission Helpers ====================

function adminVisibleClass() {
    return isAdmin() ? 'visible' : '';
}

function userVisibleClass() {
    return isLoggedIn() ? 'visible' : '';
}

// ==================== Table Helpers ====================

function emptyTableRow(colspan, message) {
    var row = document.createElement('tr');
    var td = document.createElement('td');
    td.setAttribute('colspan', colspan);
    td.style.textAlign = 'center';
    td.style.fontStyle = 'italic';
    td.textContent = message;
    row.appendChild(td);
    return row;
}

function getTableBody(bodyId) {
    var tbody = document.getElementById(bodyId);
    tbody.innerHTML = '';
    return tbody;
}

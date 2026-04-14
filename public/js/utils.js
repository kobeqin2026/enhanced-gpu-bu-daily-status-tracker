// ==================== Utility Functions ====================

// Escape HTML special characters to prevent XSS
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Create JIRA link for bug IDs
function createJiraLink(bugId) {
    if (bugId && bugId.match(/^[A-Z0-9]+-\d+$/)) {
        return `<a href="${jiraBaseUrl}${escapeHtml(bugId)}" target="_blank" class="jira-link">${escapeHtml(bugId)}</a>`;
    }
    return escapeHtml(bugId);
}

// Show sync status message
function showSyncStatus(message, type = 'info') {
    const statusEl = document.getElementById('sync-status');
    statusEl.textContent = message;
    statusEl.className = `sync-status sync-${type}`;
    statusEl.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 3000);
    }
}

// Hide sync status
function hideSyncStatus() {
    document.getElementById('sync-status').style.display = 'none';
}

// ==================== Modal Helpers ====================

// Open a modal by ID
function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

// Close a modal by ID
function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// ==================== Data Persistence Helpers ====================

// Standard save pattern: save to localStorage, then API
function persistData() {
    saveToLocalStorage(currentData);
    saveDataToAPI();
}

// Standard edit save pattern: close modal, re-render, persist
// cleanupFn: optional callback to reset state (e.g., () => { currentEditId = null })
function saveAndRefresh(modalId, renderFn, dataKey, cleanupFn) {
    closeModal(modalId);
    if (cleanupFn) cleanupFn();
    renderFn(currentData[dataKey]);
    persistData();
}

// ==================== Permission Helpers ====================

// Get CSS class for admin-only visibility
function adminVisibleClass() {
    return isAdmin() ? 'visible' : '';
}

// Get CSS class for logged-in user visibility
function userVisibleClass() {
    return isLoggedIn() ? 'visible' : '';
}

// ==================== Table Helpers ====================

// Create empty table row with message
function emptyTableRow(colspan, message) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="${colspan}" style="text-align: center; font-style: italic;">${message}</td>`;
    return row;
}

// Clear and return a tbody element
function getTableBody(bodyId) {
    const tbody = document.getElementById(bodyId);
    tbody.innerHTML = '';
    return tbody;
}

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
    // 状态一致性: 准出标准全部pass的Domain自动置为已完成并记录BU准出时间(有变化才重渲染)
    if (typeof reconcileDomainCompletion === 'function') {
        var changed = reconcileDomainCompletion();
        if (changed && typeof renderDomains === 'function') renderDomains(App.data.domains);
    }
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

function CHANGE_MEVisibleClass() {
    return isAdmin() ? 'visible' : '';
}

function userVisibleClass() {
    return isLoggedIn() ? 'visible' : '';
}

// ==================== Domain Owner 权限辅助 ====================
// domain_owner 只能编辑自己的 domain; CHANGE_ME 可编辑全部; 普通用户只读。
// hardware 库 owner 登录名 → domain 名规范化键 (与 CRITERIA_DOMAIN_MAP 同思路)
var DOMAIN_OWNER_USER_KEY = {
    'board': 'board', 'firmware': 'fw', 'diag': 'diag', 'jtag': 'jtag', 'ethernet': 'eth',
    'pcie': 'pcie', 'hbm': 'hbm', 'ucie': 'ucie', 'slt': 'slt', 'ppo': 'ppo',
    'swci': 'ci', 'swmodel': 'swmodel', 'swtool': 'tools', 'kmd': 'kmd', 'umd': 'umd', 'video': 'video'
};

function domainNormKey(s) {
    return String(s || '').trim().toLowerCase().replace(/[\s\-/]/g, '');
}

// 返回当前用户可编辑的 domain 名数组; CHANGE_ME → null(全部); 普通用户 → []
function ownedDomainNames() {
    if (!App) return [];
    if (App.userRole === 'CHANGE_ME') return null;
    if (App.userRole !== 'domain_owner') return [];
    var uname = String(App.currentUserUsername || '').toLowerCase();
    if (!uname) return [];
    var key = DOMAIN_OWNER_USER_KEY[uname] || uname;
    var out = [];
    (App.data.domains || []).forEach(function(d) {
        if (domainNormKey(d.name) === key) out.push(d.name);
    });
    return out;
}

// 当前用户能否编辑指定 domain (CHANGE_ME 恒可编辑); 支持别名归一: Firmware→FW, PCIe→PCIE 等 (与 CRITERIA_DOMAIN_MAP 一致)
function canEditDomain(domainName) {
    var owned = ownedDomainNames();
    if (owned === null) return true;
    var k = domainNormKey(domainName);
    if (typeof CRITERIA_DOMAIN_MAP !== 'undefined' && CRITERIA_DOMAIN_MAP) {
        var alias = CRITERIA_DOMAIN_MAP[k];
        if (alias) k = domainNormKey(alias);
    }
    return owned.some(function(n) { return domainNormKey(n) === k; });
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

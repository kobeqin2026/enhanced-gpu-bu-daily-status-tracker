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

// ---------- 图片查看器 (lightbox, 当前页放大) ----------
window.__ivOpen = false;
function showImageViewer(url, name) {
    var existing = document.getElementById('iv-overlay');
    if (existing) existing.parentNode.removeChild(existing);
    var ov = document.createElement('div');
    ov.id = 'iv-overlay';
    var title = document.createElement('div');
    title.className = 'iv-title';
    title.textContent = name || '图片预览';
    title.onclick = function(e) { e.stopPropagation(); };
    var img = document.createElement('img');
    img.className = 'iv-img';
    img.onload = function() { img.classList.add('iv-loaded'); };
    img.src = url;
    img.alt = name || 'preview';
    img.onclick = function(e) { e.stopPropagation(); };
    img.ondblclick = function() { img.classList.toggle('iv-actual'); };
    // 缓存命中时 onload 可能已错过 → complete 兜底 (否则 .iv-loaded 不加, 图片 opacity:0 不可见)
    if (img.complete) img.classList.add('iv-loaded');
    ov.appendChild(title);
    ov.appendChild(img);
    ov.onclick = function() { closeImageViewer(); };
    // 全屏(会议模式)时挂到 fullscreen 元素内, 否则 body —— body 在全屏层之外, 挂了也看不见 (2026-09-09 用户实测)
    var host = document.fullscreenElement || document.body;
    host.appendChild(ov);
    window.__ivOpen = true;
}
function closeImageViewer() {
    var ov = document.getElementById('iv-overlay');
    if (ov) ov.parentNode.removeChild(ov);
    window.__ivOpen = false;
}
// Esc 关闭 (capture + stopImmediatePropagation, 优先于会议模式翻页/退出键)
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && window.__ivOpen) {
        e.stopImmediatePropagation();
        closeImageViewer();
    }
}, true);

// Create JIRA link for bug IDs (safe)
function createJiraLink(bugId, jiraUrl) {
    if (bugId && bugId.match(/^[A-Z0-9a-z\-]+\-\d+$/)) {
        var a = document.createElement('a');
        // 优先用完整 jiraUrl(JIRA导入生成, 含内网域名), 无则回退 App.jiraBaseUrl + bugId
        a.href = jiraUrl || (App.jiraBaseUrl + bugId);
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

function adminVisibleClass() {
    return isAdmin() ? 'visible' : '';
}

function userVisibleClass() {
    return isLoggedIn() ? 'visible' : '';
}

// ==================== Domain Owner 权限辅助 ====================
// domain_owner 只能编辑自己的 domain; admin 可编辑全部; 普通用户只读。
// hardware 库 owner 登录名 → domain 名规范化键 (与 CRITERIA_DOMAIN_MAP 同思路)
var DOMAIN_OWNER_USER_KEY = {
    'board': 'board', 'firmware': 'fw', 'diag': 'diag', 'jtag': 'jtag', 'ethernet': 'eth',
    'pcie': 'pcie', 'hbm': 'hbm', 'ucie': 'ucie', 'slt': 'slt', 'ppo': 'ppo',
    'swci': 'ci', 'swmodel': 'swmodel', 'swtool': 'tools', 'kmd': 'kmd', 'umd': 'umd', 'video': 'video',
    'dft': 'dft', 'computelib': 'computelib', 'npival': 'security'
};

function domainNormKey(s) {
    return String(s || '').trim().toLowerCase().replace(/[\s\-/]/g, '');
}

// 返回当前用户可编辑的 domain 名数组; admin → null(全部); 普通用户 → []
function ownedDomainNames() {
    if (!App) return [];
    if (App.userRole === 'admin') return null;
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

// 当前用户能否编辑指定 domain (admin 恒可编辑); 支持别名归一: Firmware→FW, PCIe→PCIE 等 (与 CRITERIA_DOMAIN_MAP 一致)
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

// 2026-10-01: Domain Overview / BU Exit Criteria 的"操作"列是否对当前用户可见。
// admin(owned=null)→恒可见; domain_owner 且当前项目存在其可编辑域→可见; 普通用户/未登录→隐藏。
function canSeeDomainActions() {
    var owned = ownedDomainNames();
    if (owned === null) return true;              // admin: 全部可编辑
    if (!owned || owned.length === 0) return false; // 普通用户 / 无授权域
    // domain_owner: 仅当前项目中有其可编辑 domain 才显示操作列
    return (App.data.domains || []).some(function(d) { return canEditDomain(d.name); });
}

// 按当前角色切换两个域表"操作"列的 th 显示/隐藏 (登录/切角色/重渲染时调用)
function updateDomainActionThVisibility() {
    var show = canSeeDomainActions() && isLoggedIn();
    var ids = ['domain-actions-th', 'bu-exit-actions-th'];
    for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (el) el.style.display = show ? '' : 'none';
    }
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

// 阻塞墙/每日进度 多行文本格式化 (2026-09-30):
// 所有 domain 统一 (含 UCIE, 无例外): 在编号项 "N./N，/N、/N," 前补换行, 让 1,2,3 按编号各占一行
function fmtBlockText(text, isDebug, domain) {
    if (text == null) return text;
    var s = String(text);
    // 在 "编号+分隔符" (1. / 1，/ 1、/ 1,) 之前插入换行
    var out = '';
    var re = /(\d{1,2}[.、，,])(?![0-9])/g;
    var last = 0, m;
    while ((m = re.exec(s)) !== null) {
        var pre = s.charAt(m.index - 1);
        // 前面紧跟 数字/字母/汉字/换行/斜杠/横杠/等号/冒号 的不算编号项 (如 "BU1"/"为1，"/"48/50，"/"1.2" 版本号) → 不拆
        var isWord = /[0-9A-Za-z\u4e00-\u9fa5\r\n\/\-\=:]/.test(pre);
        if (!isWord) {
            out += s.slice(last, m.index) + '\n' + m[0];
            last = m.index + m[0].length;
        }
    }
    out += s.slice(last);
    out = out.replace(/^\n+/, '');
    return out;
}

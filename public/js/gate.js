// gate.js — index.html 统一登录门 (独立实现)
// 背景: 曾复用 jira-dashboard.js 的 gate 函数, 但其 renderProjectSelect/enterDashboard 等
// 与 index.html 主界面 (projects.js/data.js/app.js) 同名函数冲突, 导致主界面初始化崩溃。
// 故拆分为独立 gate.js, 只做登录门 + 用户状态, 不触碰 dashboard 数据。
// 依赖: App (globals.js), auth.js 的 updateUIBasedOnRole, data.js 的 loadDataFromAPI

function showGateLogin() {
    document.body.classList.add('gated');
    var gate = document.getElementById('gate-login');
    if (gate) gate.style.display = 'flex';
    var err = document.getElementById('gate-login-err');
    if (err) err.textContent = '';
    var u = document.getElementById('gate-username');
    if (u) u.value = '';
    var p = document.getElementById('gate-password');
    if (p) p.value = '';
    if (u) u.focus();
}

// 同步用户到 App (index.html 权限控制依赖 App.currentUser/App.userRole)
function gateSetUser(user, token) {
    var displayName = (user && (user.name || user.username)) || '';
    var role = (user && user.role) || 'user';
    var username = (user && user.username) || '';
    if (typeof App !== 'undefined' && App) {
        App.currentUser = displayName;
        App.userRole = role;
        App.currentUserUsername = username;
        App.authToken = token || App.authToken;
    }
    localStorage.setItem('currentUser', displayName);
    localStorage.setItem('userRole', role);
    localStorage.setItem('currentUserUsername', username);
}

// 进门: 移除登录门 + 刷新主界面数据/权限 UI
function enterDashboard() {
    document.body.classList.remove('gated');
    var gate = document.getElementById('gate-login');
    if (gate) gate.style.display = 'none';
    var gateProj = document.getElementById('gate-project');
    if (gateProj) gateProj.style.display = 'none';
    // 权限相关 UI (admin-only / user-only)
    if (typeof updateUIBasedOnRole === 'function') updateUIBasedOnRole();
    refreshMainData();
}

// URL 已指定项目 -> 直接进入; 否则走"选择项目"第二步门
function enterOrSelectProject() {
    if (typeof getProjectIdFromURL === 'function' && getProjectIdFromURL()) {
        enterDashboard();
    } else {
        showGateProject();
    }
}

// 第二步门: 选择项目
async function showGateProject() {
    var gateLogin = document.getElementById('gate-login');
    if (gateLogin) gateLogin.style.display = 'none';
    var gateProj = document.getElementById('gate-project');
    if (!gateProj) { enterDashboard(); return; }
    // 确保项目列表已加载 (登录时刻 loadProjects 可能尚未返回, 否则项目下拉为空)
    if (!(typeof App !== 'undefined' && App && App.projectsList && App.projectsList.length)) {
        try {
            if (typeof loadProjects === 'function') await loadProjects();
        } catch (e) {
            console.error('[gate] showGateProject loadProjects error:', e);
        }
    }
    // 填充项目列表
    var select = document.getElementById('gate-project-select');
    if (select) {
        select.innerHTML = '';
        var list = (typeof App !== 'undefined' && App && App.projectsList) ? App.projectsList : [];
        list.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name + (p.startDate ? ' (' + p.startDate + ' ~ ' + (p.endDate || '-') + ')' : '');
            select.appendChild(opt);
        });
        var saved = localStorage.getItem('currentProject');
        if (saved) select.value = saved;
    }
    // 仅管理员显示"新建项目"入口
    var link = document.getElementById('gate-new-project-link');
    if (link) {
        var isAdmin = (typeof App !== 'undefined' && App && App.userRole === 'admin');
        link.style.display = isAdmin ? 'block' : 'none';
    }
    gateProj.style.display = 'flex';
}

function gateEnterProject() {
    var select = document.getElementById('gate-project-select');
    var projectId = select ? select.value : '';
    if (!projectId) { alert('请先选择项目'); return; }
    localStorage.setItem('currentProject', projectId);
    window.location.href = '/' + encodeURIComponent(projectId);
}

function gateLogout() { logout(); }

// 新建项目门 (仅管理员)
function showGateNewProject() {
    var modal = document.getElementById('gate-new-project-modal');
    if (!modal) return;
    document.getElementById('gate-new-project-name').value = '';
    var err = document.getElementById('gate-new-project-err');
    if (err) err.textContent = '';
    var blank = document.querySelector('input[name="gate-new-mode"][value="blank"]');
    if (blank) blank.checked = true;
    gateNewModeChanged();
    modal.style.display = 'flex';
}

function closeGateNewProject() {
    var modal = document.getElementById('gate-new-project-modal');
    if (modal) modal.style.display = 'none';
}

function gateNewModeChanged() {
    var mode = '';
    var radios = document.querySelectorAll('input[name="gate-new-mode"]');
    for (var i = 0; i < radios.length; i++) {
        if (radios[i].checked) { mode = radios[i].value; break; }
    }
    var wrap = document.getElementById('gate-copy-source-wrap');
    var copySel = document.getElementById('gate-copy-source');
    if (wrap) wrap.style.display = mode === 'copy' ? 'block' : 'none';
    if (mode === 'copy' && copySel) {
        copySel.innerHTML = '';
        var list = (typeof App !== 'undefined' && App && App.projectsList) ? App.projectsList : [];
        list.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            copySel.appendChild(opt);
        });
    }
}

async function gateCreateProject() {
    var name = document.getElementById('gate-new-project-name').value.trim();
    var mode = '';
    var radios = document.querySelectorAll('input[name="gate-new-mode"]');
    for (var i = 0; i < radios.length; i++) {
        if (radios[i].checked) { mode = radios[i].value; break; }
    }
    var errEl = document.getElementById('gate-new-project-err');
    if (!errEl) return;
    errEl.textContent = '';
    if (!name) { errEl.textContent = '请输入项目名称'; return; }
    if (mode === 'copy') { errEl.textContent = '复制创建暂未开放，请先使用空白创建'; return; }

    try {
        var resp = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ name: name, description: '' })
        });
        var data = await resp.json();
        if (data.success && data.project) {
            localStorage.setItem('currentProject', data.project.id);
            window.location.href = '/' + encodeURIComponent(data.project.id);
        } else {
            errEl.textContent = data.message || '创建失败';
        }
    } catch (e) {
        errEl.textContent = '创建失败，请重试';
    }
}

// 主界面数据兜底刷新: DOMContentLoaded 时 app.js 已初始化过; 若失败(如初始化早于登录),
// 这里补一次完整加载。若已有数据则仅重渲染。
function refreshMainData() {
    if (typeof App === 'undefined' || !App) return;
    try {
        var needFetch = false;
        if (App.currentProject && typeof loadDataFromAPI === 'function') {
            // 数据为空或来自 localStorage 缓存且从未成功加载过 -> 补拉 API
            needFetch = !App.data || !App.data.lastUpdated || (App.data.bugs && App.data.bugs.length === 0 && (App.data.domains && App.data.domains.length === 0));
            if (needFetch) {
                loadDataFromAPI().catch(function(e) { console.error('[gate] refresh data failed:', e); });
            }
        }
        if (typeof App.renderAll === 'function') {
            // 稍后渲染, 等待 loadDataFromAPI 落地 (若触发)
            setTimeout(function() { App.renderAll(); }, needFetch ? 800 : 0);
        }
    } catch (e) {
        console.error('[gate] refreshMainData error:', e);
    }
}

// 固定右上角用户栏 (任何页面可见): 登录显示 用户名+角色徽章, 未登录隐藏
function updateTopUserBar() {
    var bar = document.getElementById('top-user-bar');
    var nameEl = document.getElementById('top-user-name');
    if (!bar || !nameEl) return;
    var u = (typeof App !== 'undefined' && App) ? (App.currentUserUsername || App.currentUser) : null;
    var role = (typeof App !== 'undefined' && App) ? App.userRole : '';
    if (u) {
        // hardware 回退 owner 非域负责人 (不在 DOMAIN_OWNER_USER_KEY) = 普通用户
        var isRealOwner = (role === 'domain_owner' && typeof isRealDomainOwner === 'function' && isRealDomainOwner());
        var roleText = role === 'admin' ? '管理员' : (isRealOwner ? 'Domain Owner' : '普通用户');
        var roleColor = role === 'admin' ? '#e74c3c' : (isRealOwner ? '#e67e22' : '#27ae60');
        nameEl.innerHTML = '👤 ' + escapeHtml(u) + ' <span style="display:inline-block; margin-left:8px; padding:2px 8px; border-radius:6px; font-size:12px; color:#fff; background:' + roleColor + ';">' + escapeHtml(roleText) + '</span>';
        bar.style.display = 'flex';
    } else {
        bar.style.display = 'none';
    }
}

function updateLoginUI() {
    var loginBtn = document.getElementById('login-btn');
    var logoutBtn = document.getElementById('logout-btn');
    var loginStatus = document.getElementById('login-status');
    if (!loginBtn || !logoutBtn) return;

    var u = (typeof App !== 'undefined' && App) ? App.currentUser : null;
    if (u) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        var role = (typeof App !== 'undefined' && App) ? App.userRole : '';
        var uname = (typeof App !== 'undefined' && App) ? (App.currentUserUsername || App.currentUser) : u;
        var isRealOwner = (role === 'domain_owner' && typeof isRealDomainOwner === 'function' && isRealDomainOwner());
        var roleText = role === 'admin' ? '管理员' : (isRealOwner ? 'Domain Owner' : '普通用户');
        if (loginStatus) loginStatus.textContent = '欢迎, ' + uname + ' (' + roleText + ')';
    } else {
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        if (loginStatus) loginStatus.textContent = '';
    }
    // 固定右上角用户栏同步 (登录显示/退出隐藏)
    updateTopUserBar();
}

async function verifyAuth() {
    try {
        var resp = await fetch('/api/auth/verify', { credentials: 'same-origin', cache: 'no-store' });
        var data = await resp.json();
        if (data.success && data.user && data.user.username) {
            gateSetUser(data.user, data.token);
            updateLoginUI();
            enterOrSelectProject();
            return true;
        }
    } catch (e) {
        console.error('[gate] verifyAuth error:', e);
    }
    return false;
}

async function gateLoginSubmit() {
    var username = document.getElementById('gate-username').value.trim();
    var password = document.getElementById('gate-password').value;
    var errEl = document.getElementById('gate-login-err');
    if (!errEl) return;
    errEl.textContent = '';
    if (!username || !password) {
        errEl.textContent = '请输入用户名和密码';
        return;
    }
    try {
        var resp = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password }),
            cache: 'no-store'
        });
        var data = await resp.json();
        if (data.success) {
            gateSetUser(data.user, data.token);
            updateLoginUI();
            enterOrSelectProject();
        } else {
            errEl.textContent = data.message || '用户名或密码错误';
        }
    } catch (err) {
        errEl.textContent = '登录失败，请稍后重试';
    }
}

// 覆盖 auth.js 的 logout: 登出后回到登录门
async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) {}
    if (typeof App !== 'undefined' && App) {
        App.currentUser = null;
        App.userRole = null;
        App.currentUserUsername = null;
        App.authToken = null;
    }
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userRole');
    localStorage.removeItem('currentUserUsername');
    updateLoginUI();
    if (typeof updateUIBasedOnRole === 'function') updateUIBasedOnRole();
    showGateLogin();
}

// Enter 键提交登录
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        var gate = document.getElementById('gate-login');
        if (gate && gate.style.display === 'flex') {
            gateLoginSubmit();
        }
    }
});

// 初始化: 有会话直接进入, 否则显示登录门
document.addEventListener('DOMContentLoaded', function() {
    verifyAuth().then(function(loggedIn) {
        if (!loggedIn) showGateLogin();
    });
});
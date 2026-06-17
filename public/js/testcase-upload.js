// JIRA Test Case Management — Frontend Logic
// Step 1: Select project → Step 2: Select Task/Test Plan → Step 3: KPI + Detail

var authToken = localStorage.getItem('testcaseAuthToken') || '';
var parsedData = [];
var headers = [];
var uploadResults = [];
var currentPlans = [];
var selectedPlanKey = '';

// ============ Auth ============

function checkAuth() {
    if (!authToken) {
        document.getElementById('login-overlay').style.display = 'flex';
        return;
    }
    fetch('/api/auth/verify', {
        credentials: 'same-origin',
        headers: { 'Authorization': 'Bearer ' + authToken }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('btn-logout').style.display = 'inline-block';
            loadProjects();
        } else {
            authToken = '';
            localStorage.removeItem('testcaseAuthToken');
            document.getElementById('login-overlay').style.display = 'flex';
            document.getElementById('btn-logout').style.display = 'none';
        }
    })
    .catch(function() {
        document.getElementById('login-overlay').style.display = 'flex';
    });
}

function doLogin() {
    var user = document.getElementById('login-user').value.trim();
    var pass = document.getElementById('login-pass').value;
    if (!user || !pass) { showLoginError('请输入用户名和密码'); return; }
    var loginBtn = document.querySelector('.login-box button');
    if (loginBtn) loginBtn.textContent = '登录中...';

    fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username: user, password: pass })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (loginBtn) loginBtn.textContent = '登录';
        if (data.success && data.token) {
            authToken = data.token;
            localStorage.setItem('testcaseAuthToken', authToken);
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('btn-logout').style.display = 'inline-block';
            loadProjects();
        } else {
            showLoginError(data.message || data.error || '登录失败');
        }
    })
    .catch(function(e) {
        if (loginBtn) loginBtn.textContent = '登录';
        showLoginError('网络错误: ' + e.message);
    });
}

function showLoginError(msg) {
    var el = document.getElementById('login-error');
    el.textContent = msg;
    el.style.display = 'block';
}

function doLogout() {
    authToken = '';
    localStorage.removeItem('testcaseAuthToken');
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('btn-logout').style.display = 'none';
}

document.getElementById('login-pass').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
});

// ============ Tab Switching ============

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(function(btn, i) {
        btn.classList.toggle('active', (tab === 'browse' && i === 0) || (tab === 'upload' && i === 1));
    });
    document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
    document.getElementById('tab-' + tab).classList.add('active');
}

// ============ Projects ============

function loadProjects() {
    fetch('/api/testcase/projects', {
        credentials: 'same-origin',
        headers: authToken ? { 'Authorization': 'Bearer ' + authToken } : {}
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success && data.data) {
            ['browse-project', 'tc-project'].forEach(function(id) {
                var sel = document.getElementById(id);
                sel.innerHTML = '<option value="">-- 选择项目 --</option>';
                data.data.forEach(function(p) {
                    var opt = document.createElement('option');
                    opt.value = p.key;
                    opt.textContent = p.key + ' — ' + p.name;
                    sel.appendChild(opt);
                });
            });
        }
    })
    .catch(function(e) {
        console.error('Load projects failed:', e);
    });
}

// ============ Step 1-2: Load Parents (Task + Test Plan) ============

var allParents = [];

function onProjectChange() {
    var project = document.getElementById('browse-project').value;
    document.getElementById('parent-section').style.display = 'none';
    document.getElementById('detail-section').style.display = 'none';
    if (project) loadParents();
}

function loadParents() {
    var project = document.getElementById('browse-project').value;
    if (!project) return;

    document.getElementById('parent-section').style.display = 'block';
    document.getElementById('parent-grid').innerHTML = '<div class="loading">加载中...</div>';

    // Fetch both Task and Test Plan
    fetch('/api/testcase/search?project=' + encodeURIComponent(project) + '&issuetype=Task,Test+Plan&maxResults=100', {
        credentials: 'same-origin',
        headers: authToken ? { 'Authorization': 'Bearer ' + authToken } : {}
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success && data.data) {
            allParents = data.data.issues || [];
            document.getElementById('parent-count').textContent = allParents.length + ' 个';
            renderParentGrid(allParents);
        }
    })
    .catch(function(e) {
        document.getElementById('parent-grid').innerHTML = '<div class="empty-state"><p>加载失败: ' + e.message + '</p></div>';
    });
}

function renderParentGrid(parents) {
    var grid = document.getElementById('parent-grid');
    if (parents.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>没有找到 Task 或 Test Plan</p></div>';
        return;
    }

    var html = '';
    parents.forEach(function(p) {
        var typeClass = p.issuetype === 'Test Plan' ? 'pc-type-testplan' : 'pc-type-task';
        html += '<div class="parent-card" data-key="' + p.key + '" onclick="selectParent(\'' + p.key + '\')">';
        html += '<div class="pc-header">';
        html += '<span class="pc-key"><a href="' + p.url + '" target="_blank" onclick="event.stopPropagation()">' + p.key + '</a></span>';
        html += '<span class="pc-type ' + typeClass + '">' + p.issuetype + '</span>';
        html += getStatusBadge(p.status);
        html += '</div>';
        html += '<div class="pc-title">' + escapeHtml(p.summary) + '</div>';
        html += '<div class="pc-meta">' + (p.assignee || '未分配') + ' · ' + formatDate(p.created) + '</div>';
        html += '</div>';
    });
    grid.innerHTML = html;
}

function filterParents() {
    var q = document.getElementById('parent-search').value.toLowerCase();
    if (!q) { renderParentGrid(allParents); return; }
    var filtered = allParents.filter(function(p) {
        return p.key.toLowerCase().indexOf(q) >= 0 || p.summary.toLowerCase().indexOf(q) >= 0;
    });
    renderParentGrid(filtered);
}

// ============ Step 3: Select Parent → Load KPI + Detail ============

var selectedParent = null;
var subtasks = [];
var linkedPlans = [];

function selectParent(key) {
    document.querySelectorAll('.parent-card').forEach(function(c) {
        c.classList.toggle('selected', c.getAttribute('data-key') === key);
    });

    selectedParent = allParents.find(function(p) { return p.key === key; });
    if (!selectedParent) return;

    document.getElementById('detail-section').style.display = 'block';
    document.getElementById('detail-thead').innerHTML = '<tr><th>加载中...</th></tr>';
    document.getElementById('detail-tbody').innerHTML = '';
    document.getElementById('kpi-total').textContent = '...';
    document.getElementById('dist-row').innerHTML = '';
    linkedPlans = [];

    // Step 1: Fetch issue details (links)
    fetch('/api/testcase/issue/' + key, {
        credentials: 'same-origin',
        headers: authToken ? { 'Authorization': 'Bearer ' + authToken } : {}
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (!data.success || !data.data) throw new Error(data.error || '加载失败');
        var issue = data.data;

        // Find linked Test Plans
        linkedPlans = (issue.links || []).filter(function(l) {
            return l.issuetype === 'Test Plan' || l.issuetype === 'Task';
        });

        // Step 2: Fetch direct sub-tasks
        var project = document.getElementById('browse-project').value;
        return fetch('/api/testcase/search?project=' + encodeURIComponent(project) + '&issuetype=Sub-task&parent=' + key + '&maxResults=200', {
            credentials: 'same-origin',
            headers: authToken ? { 'Authorization': 'Bearer ' + authToken } : {}
        });
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        subtasks = (data.success && data.data) ? (data.data.issues || []) : [];

        // Step 3: Fetch sub-tasks for each linked plan
        var fetches = linkedPlans.map(function(lp) {
            var project = document.getElementById('browse-project').value;
            return fetch('/api/testcase/search?project=' + encodeURIComponent(project) + '&issuetype=Sub-task&parent=' + lp.key + '&maxResults=200', {
                credentials: 'same-origin',
                headers: authToken ? { 'Authorization': 'Bearer ' + authToken } : {}
            })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                lp.subtasks = (d.success && d.data) ? (d.data.issues || []) : [];
            });
        });

        return Promise.all(fetches);
    })
    .then(function() {
        // Merge all sub-tasks
        var allSubtasks = subtasks.slice();
        linkedPlans.forEach(function(lp) {
            lp.subtasks.forEach(function(st) { allSubtasks.push(st); });
        });

        renderLinkedPlans(linkedPlans);
        renderKPI(allSubtasks);
        renderDistributions(allSubtasks);
        renderDetailTable(allSubtasks);
    })
    .catch(function(e) {
        document.getElementById('detail-section').innerHTML = '<div class="empty-state"><p>加载失败: ' + e.message + '</p></div>';
    });
}

function renderLinkedPlans(plans) {
    // Remove old linked plans section if exists
    var oldSection = document.getElementById('linked-plans-section');
    if (oldSection) oldSection.remove();
    if (plans.length === 0) return;
    var html = '<div class="card" style="margin-bottom:16px; padding:14px; background:#f8f9fa;">';
    html += '<div style="font-size:13px; color:#555; font-weight:600; margin-bottom:8px;">📎 关联的 Sub-Test Plans</div>';
    plans.forEach(function(lp) {
        var typeClass = lp.issuetype === 'Test Plan' ? 'pc-type-testplan' : 'pc-type-task';
        html += '<div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #eee;">';
        html += '<a href="https://jira01.birentech.com/browse/' + lp.key + '" target="_blank" style="font-weight:600; color:#3498db; text-decoration:none;">' + lp.key + '</a>';
        html += '<span class="pc-type ' + typeClass + '" style="font-size:10px;">' + lp.issuetype + '</span>';
        html += '<span style="font-size:13px; color:#333; flex:1;">' + escapeHtml(lp.summary) + '</span>';
        html += '<span style="font-size:12px; color:#666;">' + lp.status + '</span>';
        html += '<span style="font-size:12px; color:#27ae60; font-weight:600;">' + (lp.subtasks ? lp.subtasks.length : 0) + ' cases</span>';
        html += '</div>';
    });
    html += '</div>';
    var wrapper = document.createElement('div'); wrapper.id = 'linked-plans-section'; wrapper.innerHTML = html.substring(html.indexOf('<div'));
    document.getElementById('detail-section').insertAdjacentElement('afterbegin', wrapper);
}

// ============ KPI Rendering ============

function renderKPI(issues) {
    var total = issues.length;
    var statusCount = {};
    var priorityCount = {};
    issues.forEach(function(i) {
        var s = normalizeStatus(i.status);
        statusCount[s] = (statusCount[s] || 0) + 1;
        var p = i.priority || 'Unknown';
        priorityCount[p] = (priorityCount[p] || 0) + 1;
    });

    var done = (statusCount['done'] || 0) + (statusCount['closed'] || 0);
    var inProgress = statusCount['inprogress'] || 0;
    var todo = (statusCount['todo'] || 0) + (statusCount['open'] || 0);
    var blocked = statusCount['blocked'] || 0;
    var completionRate = total > 0 ? Math.round(done / total * 100) : 0;
    var highPriority = (priorityCount['Highest'] || 0) + (priorityCount['High'] || 0);

    animateNumber('kpi-total', total);
    animateNumber('kpi-done', completionRate, '%');
    animateNumber('kpi-progress', inProgress);
    animateNumber('kpi-todo', todo);
    animateNumber('kpi-high', highPriority);
    animateNumber('kpi-blocked', blocked);
}

function animateNumber(elementId, target, suffix) {
    suffix = suffix || '';
    var el = document.getElementById(elementId);
    if (!el) return;
    var current = 0;
    var step = Math.max(1, Math.floor(target / 20));
    var interval = setInterval(function() {
        current += step;
        if (current >= target) {
            current = target;
            clearInterval(interval);
        }
        el.textContent = current + suffix;
    }, 30);
}

function normalizeStatus(status) {
    if (!status) return 'other';
    var s = status.toLowerCase();
    if (s === 'to do' || s === 'open' || s === 'new' || s === 'opened') return 'todo';
    if (s === 'in progress' || s === 'in review' || s === 'reopened') return 'inprogress';
    if (s === 'done' || s === 'resolved') return 'done';
    if (s === 'closed' || s === 'rejected') return 'closed';
    if (s === 'blocked') return 'blocked';
    return 'other';
}

// ============ Distribution Charts ============

function renderDistributions(issues) {
    var statusCount = {};
    var priorityCount = {};

    issues.forEach(function(i) {
        var s = i.status || 'Unknown';
        statusCount[s] = (statusCount[s] || 0) + 1;

        var p = i.priority || 'Unknown';
        priorityCount[p] = (priorityCount[p] || 0) + 1;
    });

    var html = '';

    // 1. Status Pie Chart
    html += '<div class="chart-card">';
    html += '<h3>📊 状态分布</h3>';
    html += renderPieChart(statusCount, { 'todo': '#f39c12', 'inprogress': '#3498db', 'done': '#27ae60', 'closed': '#95a5a6', 'blocked': '#e74c3c', 'other': '#9b59b6' });
    html += '</div>';

    // 2. Priority Bar Chart
    html += '<div class="chart-card">';
    html += '<h3>🎯 优先级分布</h3>';
    html += '<div class="bar-chart">';
    var pSorted = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
    pSorted.forEach(function(p) {
        var count = priorityCount[p] || 0;
        if (count === 0) return;
        var pct = issues.length > 0 ? Math.round(count / issues.length * 100) : 0;
        var cls = 'status-other';
        if (p === 'Highest' || p === 'High') cls = 'status-todo';
        else if (p === 'Medium') cls = 'status-progress';
        else cls = 'status-done';
        html += '<div class="bar-item">';
        html += '<span class="bar-label">' + p + '</span>';
        html += '<div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + pct + '%"><span>' + count + ' (' + pct + '%)</span></div></div>';
        html += '</div>';
    });
    html += '</div></div>';

    document.getElementById('dist-row').innerHTML = html;

    // Owner distribution: vertical stacked bar chart by status
    var ownerStatusMap = {};
    issues.forEach(function(i) {
        var owner = i.assignee || '未分配';
        var s = i.status || 'Unknown';
        if (!ownerStatusMap[owner]) ownerStatusMap[owner] = {};
        ownerStatusMap[owner][s] = (ownerStatusMap[owner][s] || 0) + 1;
    });
    var statusColors = { 'todo': '#f39c12', 'inprogress': '#3498db', 'done': '#27ae60', 'closed': '#95a5a6', 'blocked': '#e74c3c', 'other': '#9b59b6' };
    var sortedOwners = Object.keys(ownerStatusMap).sort(function(a, b) {
        var totalA = 0, totalB = 0;
        Object.keys(ownerStatusMap[a]).forEach(function(k) { totalA += ownerStatusMap[a][k]; });
        Object.keys(ownerStatusMap[b]).forEach(function(k) { totalB += ownerStatusMap[b][k]; });
        return totalB - totalA;
    }).slice(0, 10);

    var maxOwnerCount = 0;
    sortedOwners.forEach(function(o) {
        var total = 0;
        Object.keys(ownerStatusMap[o]).forEach(function(k) { total += ownerStatusMap[o][k]; });
        if (total > maxOwnerCount) maxOwnerCount = total;
    });

    // Collect all unique normalized statuses for legend
    var allNormStatuses = {};
    sortedOwners.forEach(function(o) {
        Object.keys(ownerStatusMap[o]).forEach(function(k) {
            var ns = normalizeStatus(k);
            allNormStatuses[ns] = k;
        });
    });

    var ownerHtml = '<div class="chart-card chart-wide" style="margin-top:4px;">';
    ownerHtml += '<h3>👤 负责人分布</h3>';
    ownerHtml += '<div class="vbar-chart">';
    sortedOwners.forEach(function(o) {
        var statusMap = ownerStatusMap[o];
        var total = 0;
        Object.keys(statusMap).forEach(function(k) { total += statusMap[k]; });
        var barHeight = maxOwnerCount > 0 ? (total / maxOwnerCount * 100) : 0;
        ownerHtml += '<div class="vbar-col">';
        ownerHtml += '<div class="vbar-count">' + total + '</div>';
        ownerHtml += '<div class="vbar-stack" style="height:' + barHeight + '%;">';
        var statusOrder = ['done', 'closed', 'inprogress', 'todo', 'blocked', 'other'];
        statusOrder.forEach(function(ns) {
            var origKey = null;
            Object.keys(statusMap).forEach(function(k) { if (normalizeStatus(k) === ns) origKey = k; });
            if (!origKey) return;
            var count = statusMap[origKey];
            var pct = total > 0 ? (count / total * 100) : 0;
            var color = statusColors[ns] || '#95a5a6';
            ownerHtml += '<div class="vbar-segment" style="height:' + pct + '%; background:' + color + ';" title="' + o + ': ' + origKey + ' = ' + count + '"></div>';
        });
        ownerHtml += '</div>';
        ownerHtml += '<div class="vbar-label" title="' + o + '">' + o + '</div>';
        ownerHtml += '</div>';
    });
    ownerHtml += '</div>';
    // Legend
    ownerHtml += '<div class="vbar-legend">';
    var legendOrder = ['done', 'closed', 'inprogress', 'todo', 'blocked', 'other'];
    legendOrder.forEach(function(ns) {
        if (!allNormStatuses[ns]) return;
        var color = statusColors[ns] || '#95a5a6';
        ownerHtml += '<div class="vbar-legend-item"><span class="vbar-legend-dot" style="background:' + color + ';"></span>' + allNormStatuses[ns] + '</div>';
    });
    ownerHtml += '</div></div>';
    document.getElementById('owner-row').innerHTML = ownerHtml;
}

function inferCategory(summary) {
    var s = summary.toLowerCase();
    if (/性能|throughput|latency|bandwidth|吞吐|延迟/.test(s)) return '性能测试';
    if (/压力|stress|soak|长时间|稳定性/.test(s)) return '压力测试';
    if (/信号|signal|eye|jitter|眼图|抖动|serdes/.test(s)) return '信号测试';
    if (/功耗|power|voltage|电流|电压|热|thermal/.test(s)) return '功耗测试';
    if (/接口|register|mmio|config|配置空间|寄存器|link|lane/.test(s)) return '接口测试';
    if (/功能|feature|enable|支持|disable|reset|link/.test(s)) return '功能测试';
    return '其他';
}

function renderPieChart(countMap, colorMap) {
    var total = 0;
    var items = [];
    Object.keys(countMap).forEach(function(k) {
        total += countMap[k];
        items.push({ key: k, count: countMap[k] });
    });
    items.sort(function(a, b) { return b.count - a.count; });

    if (total === 0) return '<div style="text-align:center; color:#999; padding:20px;">无数据</div>';

    // Build conic-gradient
    var gradientParts = [];
    var angle = 0;
    items.forEach(function(item) {
        var pct = item.count / total * 360;
        var color = colorMap[item.key] || '#95a5a6';
        gradientParts.push(color + ' ' + angle + 'deg ' + (angle + pct) + 'deg');
        angle += pct;
    });

    var html = '<div style="display:flex; align-items:center; gap:24px; padding:16px 0;">';
    html += '<div style="width:160px; height:160px; border-radius:50%; background:conic-gradient(' + gradientParts.join(', ') + '); flex-shrink:0;"></div>';
    html += '<div style="flex:1;">';
    items.forEach(function(item) {
        var pct = total > 0 ? Math.round(item.count / total * 100) : 0;
        var color = colorMap[item.key] || '#95a5a6';
        html += '<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">';
        html += '<span style="width:12px; height:12px; border-radius:2px; background:' + color + '; flex-shrink:0;"></span>';
        html += '<span style="font-size:13px; color:#555; flex:1;">' + item.key + '</span>';
        html += '<span style="font-size:13px; color:#333; font-weight:600;">' + item.count + ' (' + pct + '%)</span>';
        html += '</div>';
    });
    html += '</div></div>';
    return html;
}

// ============ Detail Table ============

function renderDetailTable(issues) {
    document.getElementById('detail-count').textContent = issues.length + ' 条';

    var thead = document.getElementById('detail-thead');
    thead.innerHTML = '<tr><th style="width:120px;">Key</th><th>标题</th><th style="width:100px;">状态</th><th style="width:100px;">负责人</th><th style="width:80px;">优先级</th><th style="width:140px;">创建时间</th></tr>';

    var tbody = document.getElementById('detail-tbody');
    tbody.innerHTML = '';

    if (issues.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">暂无 Sub-task</td></tr>';
        return;
    }

    var fragment = document.createDocumentFragment();
    issues.forEach(function(issue) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td><a href="' + issue.url + '" target="_blank">' + issue.key + '</a></td>' +
            '<td>' + escapeHtml(issue.summary || '') + '</td>' +
            '<td>' + getStatusBadge(issue.status) + '</td>' +
            '<td>' + escapeHtml(issue.assignee || '-') + '</td>' +
            '<td>' + getPriorityHtml(issue.priority) + '</td>' +
            '<td>' + formatDate(issue.created) + '</td>';
        fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);
}

// ============ Utility Functions ============

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getStatusBadge(status) {
    if (!status) return '<span class="badge-status badge-default">未知</span>';
    var ns = normalizeStatus(status);
    var cls = 'badge-default';
    if (ns === 'todo') cls = 'badge-todo';
    else if (ns === 'inprogress') cls = 'badge-inprogress';
    else if (ns === 'done') cls = 'badge-done';
    else if (ns === 'closed') cls = 'badge-closed';
    return '<span class="badge-status ' + cls + '">' + status + '</span>';
}

function getPriorityHtml(priority) {
    if (!priority) return '-';
    var p = priority.toLowerCase();
    var cls = '';
    if (p === 'highest') cls = 'priority-highest';
    else if (p === 'high') cls = 'priority-high';
    else if (p === 'medium') cls = 'priority-medium';
    else if (p === 'low' || p === 'lowest') cls = 'priority-low';
    return '<span class="' + cls + '">' + priority + '</span>';
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        var d = new Date(dateStr);
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    } catch (e) { return dateStr; }
}

// ============ Tab 2: Upload ============

function onUploadProjectChange() {
    var project = document.getElementById('tc-project').value;
    if (project) loadUploadParents();
    else document.getElementById('upload-parent-list').innerHTML = '<div class="empty-state"><p>请选择项目</p></div>';
}

function loadUploadParents() {
    var project = document.getElementById('tc-project').value;
    if (!project) return;
    document.getElementById('upload-parent-list').innerHTML = '<div class="loading">加载中...</div>';

    fetch('/api/testcase/search?project=' + encodeURIComponent(project) + '&issuetype=Task,Test+Plan&maxResults=100', {
        credentials: 'same-origin',
        headers: authToken ? { 'Authorization': 'Bearer ' + authToken } : {}
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success && data.data) {
            currentPlans = data.data.issues || [];
            renderUploadParentList();
        }
    });
}

function renderUploadParentList() {
    var container = document.getElementById('upload-parent-list');
    if (currentPlans.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>暂无 Task / Test Plan</p></div>';
        return;
    }
    var html = '<div class="parent-grid">';
    html += '<div class="parent-card' + (selectedPlanKey === '' ? ' selected' : '') + '" onclick="selectUploadPlan(\'\')">';
    html += '<div class="pc-header"><span class="pc-key" style="color:#999;">不关联</span></div>';
    html += '<div class="pc-title" style="color:#999; font-size:13px;">直接创建独立 Issue</div></div>';

    currentPlans.forEach(function(p) {
        var sel = selectedPlanKey === p.key ? ' selected' : '';
        var typeClass = p.issuetype === 'Test Plan' ? 'pc-type-testplan' : 'pc-type-task';
        html += '<div class="parent-card' + sel + '" onclick="selectUploadPlan(\'' + p.key + '\')">';
        html += '<div class="pc-header">';
        html += '<span class="pc-key"><a href="' + p.url + '" target="_blank" onclick="event.stopPropagation()">' + p.key + '</a></span>';
        html += '<span class="pc-type ' + typeClass + '">' + p.issuetype + '</span>';
        html += getStatusBadge(p.status);
        html += '</div>';
        html += '<div class="pc-title">' + escapeHtml(p.summary) + '</div>';
        html += '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
}

function selectUploadPlan(key) {
    selectedPlanKey = key;
    renderUploadParentList();
}

function toggleCreatePlan() {
    var form = document.getElementById('create-plan-form');
    form.style.display = form.style.display === 'none' || !form.style.display ? 'block' : 'none';
}

function createTestPlan() {
    var project = document.getElementById('tc-project').value;
    var name = document.getElementById('new-plan-name').value.trim();
    var desc = document.getElementById('new-plan-desc').value.trim();
    if (!project) { alert('请先选择项目'); return; }
    if (!name) { alert('请输入名称'); return; }

    fetch('/api/testcase/testplan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { 'Authorization': 'Bearer ' + authToken } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify({ project: project, summary: name, description: desc })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success && data.data) {
            alert('✅ 创建成功: ' + data.data.key);
            selectedPlanKey = data.data.key;
            document.getElementById('new-plan-name').value = '';
            document.getElementById('new-plan-desc').value = '';
            toggleCreatePlan();
            loadUploadParents();
        } else {
            alert('❌ 创建失败: ' + (data.error || '未知错误'));
        }
    });
}

// ============ File Upload & Parse ============

var uploadArea = document.getElementById('upload-area');
var fileInput = document.getElementById('tc-file');

uploadArea.addEventListener('click', function() { fileInput.click(); });
uploadArea.addEventListener('dragover', function(e) { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', function() { uploadArea.classList.remove('dragover'); });
uploadArea.addEventListener('drop', function(e) { e.preventDefault(); uploadArea.classList.remove('dragover'); if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', function() { if (fileInput.files.length > 0) handleFile(fileInput.files[0]); });

function handleFile(file) {
    var reader = new FileReader();
    reader.onload = function(e) { parseCSVData(e.target.result, file.name); };
    reader.readAsText(file, 'UTF-8');
}

function parseCSVData(text, filename) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
    var rows = [], currentRow = [], currentField = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (inQuotes) {
            if (ch === '"') { if (i + 1 < text.length && text[i + 1] === '"') { currentField += '"'; i++; } else { inQuotes = false; } }
            else { currentField += ch; }
        } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',' || ch === '\t') { currentRow.push(currentField.trim()); currentField = ''; }
            else if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') { currentRow.push(currentField.trim()); currentField = ''; if (currentRow.length > 0 && currentRow.some(function(c) { return c !== ''; })) rows.push(currentRow); currentRow = []; i++; }
            else if (ch === '\n' || ch === '\r') { currentRow.push(currentField.trim()); currentField = ''; if (currentRow.length > 0 && currentRow.some(function(c) { return c !== ''; })) rows.push(currentRow); currentRow = []; }
            else { currentField += ch; }
        }
    }
    if (currentField) currentRow.push(currentField.trim());
    if (currentRow.length > 0 && currentRow.some(function(c) { return c !== ''; })) rows.push(currentRow);
    if (rows.length < 2) { alert('CSV文件为空或格式不正确'); return; }
    headers = rows[0];
    parsedData = rows.slice(1).map(function(row) { var obj = {}; headers.forEach(function(h, idx) { obj[h] = (row[idx] || '').trim(); }); return obj; });
    uploadArea.innerHTML = '<div class="icon">✅</div><p>已加载 <strong>' + parsedData.length + '</strong> 条记录</p><p class="hint">' + (filename || 'file') + ' (' + headers.length + ' 列)</p>';
    renderPreview();
}

// ============ Preview ============

function renderPreview() {
    if (parsedData.length === 0) return;
    document.getElementById('preview-section').style.display = 'block';
    document.getElementById('preview-count').textContent = parsedData.length + ' 条记录';
    var thead = document.getElementById('preview-thead');
    thead.innerHTML = '';
    var headRow = document.createElement('tr');
    var thNum = document.createElement('th'); thNum.textContent = '#'; thNum.style.width = '40px'; headRow.appendChild(thNum);
    headers.forEach(function(h) { var th = document.createElement('th'); th.textContent = h; headRow.appendChild(th); });
    var thStatus = document.createElement('th'); thStatus.textContent = '状态'; thStatus.style.width = '100px'; headRow.appendChild(thStatus);
    thead.appendChild(headRow);
    var tbody = document.getElementById('preview-tbody');
    tbody.innerHTML = '';
    parsedData.forEach(function(row, idx) {
        var tr = document.createElement('tr');
        var tdNum = document.createElement('td'); tdNum.className = 'row-num'; tdNum.textContent = idx + 1; tr.appendChild(tdNum);
        headers.forEach(function(h) { var td = document.createElement('td'); td.textContent = row[h] || ''; td.title = row[h] || ''; td.className = 'editable-cell'; td.setAttribute('data-header', h); td.setAttribute('data-row', idx); td.addEventListener('dblclick', startEditCell); tr.appendChild(td); });
        var tdStatus = document.createElement('td'); tdStatus.className = 'status-pending'; tdStatus.textContent = '待上传'; tdStatus.id = 'status-' + idx; tr.appendChild(tdStatus);
        tbody.appendChild(tr);
    });
    document.getElementById('btn-start-upload').disabled = false;
}

function startEditCell(e) {
    var td = e.target; if (td.querySelector('input')) return;
    var header = td.getAttribute('data-header'), rowIdx = parseInt(td.getAttribute('data-row'));
    var oldValue = parsedData[rowIdx][header] || '';
    var input = document.createElement('input'); input.type = 'text'; input.className = 'cell-edit-input'; input.value = oldValue;
    input.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') finishEdit(td, input, rowIdx, header); else if (ev.key === 'Escape') td.removeChild(input); });
    input.addEventListener('blur', function() { finishEdit(td, input, rowIdx, header); });
    td.appendChild(input); input.focus(); input.select();
}

function finishEdit(td, input, rowIdx, header) {
    var newValue = input.value.trim(); parsedData[rowIdx][header] = newValue; td.textContent = newValue; td.title = newValue;
}

// ============ Batch Upload ============

function startBatchUpload() {
    var project = document.getElementById('tc-project').value;
    if (!project) { alert('请先选择目标项目'); return; }
    if (parsedData.length === 0) { alert('没有可上传的数据'); return; }
    var issues = parsedData.map(function(row) {
        var issue = { summary: row['标题'] || row['summary'] || row['名称'] || '', description: row['描述'] || row['description'] || '', issuetype: row['Issue类型'] || row['类型'] || row['issuetype'] || document.getElementById('tc-issuetype').value, priority: row['优先级'] || row['priority'] || document.getElementById('tc-priority').value, labels: row['标签'] || row['labels'] || '', assignee: row['负责人'] || row['assignee'] || document.getElementById('tc-assignee').value, parentKey: row['父任务Key'] || row['parent'] || row['父任务'] || '' };
        if (selectedPlanKey && !issue.parentKey) { issue.parentKey = selectedPlanKey; if (!row['Issue类型'] && !row['类型'] && !row['issuetype']) issue.issuetype = 'Sub-task'; }
        return issue;
    });
    var validIssues = issues.filter(function(iss) { return iss.summary; });
    if (validIssues.length === 0) { alert('所有记录都缺少标题'); return; }

    document.getElementById('progress-section').style.display = 'block';
    document.getElementById('summary-section').style.display = 'none';
    document.getElementById('btn-start-upload').disabled = true;
    uploadResults = [];
    var total = validIssues.length, completed = 0, successCount = 0, failCount = 0;
    var logEl = document.getElementById('progress-log'); logEl.innerHTML = '';
    var batchSize = 10, batches = [];
    for (var i = 0; i < validIssues.length; i += batchSize) batches.push(validIssues.slice(i, i + batchSize));
    var batchIdx = 0;

    function processNextBatch() {
        if (batchIdx >= batches.length) { updateProgress(total, total, successCount, failCount); showSummary(total, successCount, failCount); document.getElementById('btn-start-upload').disabled = false; return; }
        var batch = batches[batchIdx++];
        fetch('/api/testcase/batch-create', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authToken ? { 'Authorization': 'Bearer ' + authToken } : {}) }, credentials: 'same-origin', body: JSON.stringify({ project: project, issues: batch }) })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success && data.data) {
                data.data.results.forEach(function(r) { completed++; successCount++; uploadResults.push(r); updateStatusCell(r.row - 1, 'created', r.key, r.url); addLog('✅ Row ' + r.row + ': ' + r.key + ' — ' + r.summary, 'ok'); });
                data.data.errors.forEach(function(err) { completed++; failCount++; updateStatusCell(err.row - 1, 'failed'); addLog('❌ Row ' + err.row + ': ' + err.summary + ' — ' + err.error, 'err'); });
            } else { batch.forEach(function() { completed++; failCount++; }); }
            updateProgress(total, completed, successCount, failCount);
            processNextBatch();
        })
        .catch(function(e) { batch.forEach(function() { completed++; failCount++; addLog('❌ 网络错误: ' + e.message, 'err'); }); updateProgress(total, completed, successCount, failCount); processNextBatch(); });
    }
    addLog('🚀 开始上传 ' + total + ' 条到 ' + project, 'ok');
    processNextBatch();
}

function updateProgress(total, completed) {
    var pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    document.getElementById('progress-bar').style.width = pct + '%';
    document.getElementById('progress-current').textContent = completed + ' / ' + total;
    document.getElementById('progress-percent').textContent = pct + '%';
}

function updateStatusCell(rowIdx, status, key, url) {
    var cell = document.getElementById('status-' + rowIdx); if (!cell) return;
    if (status === 'created') { cell.className = 'status-created'; cell.innerHTML = '<a href="' + url + '" target="_blank">' + key + '</a>'; }
    else { cell.className = 'status-failed'; cell.textContent = '❌'; }
}

function addLog(text, type) {
    var logEl = document.getElementById('progress-log'); var line = document.createElement('div'); line.className = type === 'ok' ? 'log-ok' : 'log-err'; line.textContent = text; logEl.appendChild(line); logEl.scrollTop = logEl.scrollHeight;
}

function showSummary(total, success, fail) {
    document.getElementById('summary-section').style.display = 'block';
    document.getElementById('sum-total').textContent = total;
    document.getElementById('sum-success').textContent = success;
    document.getElementById('sum-fail').textContent = fail;
}

function downloadTemplate() { window.location.href = '/api/testcase/template'; }

// ============ Init ============
checkAuth();

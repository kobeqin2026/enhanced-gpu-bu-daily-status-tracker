// JIRA Bug Dashboard - Frontend Logic
// Chart.js via CDN: https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js

// ============ State ============
var Dashboard = {
    allBugs: [],
    filteredBugs: [],
    projects: [],
    selectedProjects: [],
    authToken: null,
    currentUser: null,
    userRole: null,
    charts: {},
    autoRefreshTimer: null,
    sortField: null,
    sortDirection: 'asc'
};

// ============ Auth ============

function showLoginModal() {
    document.getElementById('login-modal').style.display = 'flex';
    document.getElementById('login-username').focus();
}

function closeLoginModal() {
    document.getElementById('login-modal').style.display = 'none';
}

async function doLogin() {
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    if (!username || !password) {
        alert('请输入用户名和密码');
        return;
    }

    try {
        var resp = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        });
        var data = await resp.json();
        if (data.success) {
            Dashboard.authToken = data.token;
            Dashboard.currentUser = data.user.username;
            Dashboard.userRole = data.user.role;
            closeLoginModal();
            updateLoginUI();
            document.getElementById('control-bar').style.display = 'flex';
            loadJiraProjects();
        } else {
            alert('登录失败: ' + (data.message || '未知错误'));
        }
    } catch (err) {
        alert('登录请求失败: ' + err.message);
    }
}

async function doLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    Dashboard.authToken = null;
    Dashboard.currentUser = null;
    Dashboard.userRole = null;
    updateLoginUI();
    document.getElementById('control-bar').style.display = 'none';
    hideAllData();
}

function updateLoginUI() {
    var loginBtn = document.getElementById('login-btn');
    var logoutBtn = document.getElementById('logout-btn');
    var loginStatus = document.getElementById('login-status');

    if (Dashboard.authToken) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        loginStatus.textContent = '欢迎, ' + Dashboard.currentUser + ' (' + (Dashboard.userRole === 'admin' ? '管理员' : '用户') + ')';
    } else {
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        loginStatus.textContent = '';
    }
}

async function verifyAuth() {
    try {
        var resp = await fetch('/api/auth/verify', { credentials: 'same-origin' });
        var data = await resp.json();
        if (data.success && data.authenticated) {
            Dashboard.authToken = data.token || Dashboard.authToken;
            Dashboard.currentUser = data.user ? data.user.username : null;
            Dashboard.userRole = data.user ? data.user.role : null;
            updateLoginUI();
            document.getElementById('control-bar').style.display = 'flex';
            loadJiraProjects();
            return true;
        }
    } catch (e) {}
    return false;
}

// ============ Project Loading ============

async function loadJiraProjects() {
    try {
        var resp = await fetch('/api/data/jira-projects', { credentials: 'same-origin' });
        var data = await resp.json();
        if (data.success) {
            Dashboard.projects = data.projects;
            renderProjectSelect(data.projects);
        } else {
            showError('加载项目列表失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        showError('请求项目列表失败: ' + err.message);
    }
}

function renderProjectSelect(projects) {
    var select = document.getElementById('project-select');
    select.innerHTML = '<option value="">-- 全部项目 --</option>';
    projects.forEach(function(p) {
        var opt = document.createElement('option');
        opt.value = p.key;
        opt.textContent = p.key + ' - ' + p.name;
        select.appendChild(opt);
    });
}

function onProjectChange() {
    var val = document.getElementById('project-select').value;
    if (document.getElementById('multi-project-mode').checked) {
        if (val && Dashboard.selectedProjects.indexOf(val) === -1) {
            Dashboard.selectedProjects.push(val);
            renderProjectChips();
        }
    }
}

function toggleMultiSelect() {
    var checked = document.getElementById('multi-project-mode').checked;
    if (!checked) {
        Dashboard.selectedProjects = [];
        renderProjectChips();
        document.getElementById('project-select').value = '';
    }
}

function addSelectedProject() {
    var val = document.getElementById('project-select').value;
    if (val && Dashboard.selectedProjects.indexOf(val) === -1) {
        Dashboard.selectedProjects.push(val);
        renderProjectChips();
    }
}

function removeProjectChip(projectKey) {
    Dashboard.selectedProjects = Dashboard.selectedProjects.filter(function(p) { return p !== projectKey; });
    renderProjectChips();
}

function renderProjectChips() {
    var container = document.getElementById('multi-project-chips');
    container.innerHTML = '';
    Dashboard.selectedProjects.forEach(function(p) {
        var chip = document.createElement('span');
        chip.className = 'project-chip';
        chip.innerHTML = p + ' <span class="chip-remove" onclick="removeProjectChip(\'' + p + '\')">&times;</span>';
        container.appendChild(chip);
    });
}

// ============ Dashboard Data Fetch ============

async function fetchDashboardData() {
    showLoading(true);
    hideError();

    var singleProject = document.getElementById('project-select').value;
    var multiProjects = Dashboard.selectedProjects;
    var includeClosed = document.getElementById('include-closed').checked;
    var timeRange = document.getElementById('time-range').value;

    var body = {
        includeClosed: includeClosed,
        maxResults: 500
    };

    if (multiProjects.length > 0) {
        body.projects = multiProjects;
    } else if (singleProject) {
        body.project = singleProject;
    }

    try {
        var resp = await fetch('/api/data/jira-dashboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body)
        });

        // Debug: check response status
        if (!resp.ok) {
            showError('请求失败: HTTP ' + resp.status);
            showLoading(false);
            return;
        }

        var data = await resp.json();
        console.log('[Dashboard] API response:', JSON.stringify(data).substring(0, 500));

        if (data.success) {
            Dashboard.allBugs = data.bugs || [];

            // Apply time range filter
            if (timeRange !== 'all') {
                var daysAgo = new Date(Date.now() - parseInt(timeRange) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                Dashboard.allBugs = Dashboard.allBugs.filter(function(b) {
                    return b.reportDate >= daysAgo;
                });
            }

            renderKPI(data.stats);
            renderCharts(data.charts);
            renderBugTable(Dashboard.allBugs);

            // Try to load historical trend
            if (singleProject) {
                loadHistoryTrend(singleProject);
            }

            document.getElementById('kpi-grid').style.display = 'grid';
            document.getElementById('charts-grid').style.display = 'grid';
            document.getElementById('bug-table-section').style.display = 'block';
            document.getElementById('trend-history').style.display = 'none';
            document.getElementById('last-updated').style.display = 'block';
            document.getElementById('last-updated-text').textContent = '最后更新: ' + new Date().toLocaleString('zh-CN');
        } else {
            var errMsg = data.error || data.message || '未知错误';
            showError('获取数据失败: ' + errMsg);
        }
    } catch (err) {
        showError('请求失败: ' + err.message);
    }

    showLoading(false);
}

// ============ KPI Rendering ============

function renderKPI(stats) {
    if (!stats) return;
    animateNumber('kpi-total', stats.total || 0);
    animateNumber('kpi-open', stats.open || 0);
    animateNumber('kpi-closed', stats.closed || 0);
    animateNumber('kpi-today', stats.todayNew || 0);
    animateNumber('kpi-week', stats.weekClosed || 0);
    animateNumber('kpi-avg', stats.avgResolutionDays || 0);
    animateNumber('kpi-overdue', stats.overdue || 0);
}

function animateNumber(elementId, target) {
    var el = document.getElementById(elementId);
    var current = 0;
    var step = Math.max(1, Math.floor(target / 20));
    var interval = setInterval(function() {
        current += step;
        if (current >= target) {
            current = target;
            clearInterval(interval);
        }
        el.textContent = current;
    }, 30);
}

// ============ Chart Rendering ============

var CHART_COLORS = {
    status: {
        open: '#f39c12',
        triage: '#3498db',
        implement: '#27ae60',
        closed: '#95a5a6',
        rejected: '#e74c3c'
    },
    severity: {
        highest: '#e74c3c',
        high: '#f39c12',
        medium: '#3498db',
        low: '#95a5a6',
        lowest: '#bdc3c7'
    },
    domain: [
        '#e74c3c', '#3498db', '#27ae60', '#f39c12', '#9b59b6',
        '#1abc9c', '#e67e22', '#34495e', '#2ecc71', '#e91e63',
        '#00bcd4', '#ff5722', '#8bc34a', '#673ab7', '#ffc107'
    ]
};

function renderCharts(charts) {
    if (!charts) return;

    // Destroy existing charts
    Object.keys(Dashboard.charts).forEach(function(key) {
        if (Dashboard.charts[key]) {
            Dashboard.charts[key].destroy();
            Dashboard.charts[key] = null;
        }
    });

    renderStatusChart(charts.statusCount);
    renderSeverityChart(charts.severityCount);
    renderTrendChart(charts.dailyTrend);
    renderOwnerChart(charts.ownerCount);
    renderDomainChart(charts.domainCount);
    renderAgeChart(charts.ageBuckets);
}

function renderStatusChart(statusCount) {
    var ctx = document.getElementById('chart-status').getContext('2d');
    var labels = [];
    var data = [];
    var colors = [];

    var statusMap = {
        open: 'Open',
        triage: 'Triage',
        implement: 'Implement',
        closed: 'Closed',
        rejected: 'Rejected'
    };

    Object.keys(statusCount).forEach(function(key) {
        if (statusCount[key] > 0) {
            labels.push(statusMap[key] || key);
            data.push(statusCount[key]);
            colors.push(CHART_COLORS.status[key] || '#999');
        }
    });

    Dashboard.charts.status = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 } } }
            }
        }
    });
}

function renderSeverityChart(severityCount) {
    var ctx = document.getElementById('chart-severity').getContext('2d');
    var labels = [];
    var data = [];
    var colors = [];

    var severityMap = {
        highest: 'Highest',
        high: 'High',
        medium: 'Medium',
        low: 'Low',
        lowest: 'Lowest'
    };

    Object.keys(severityCount).forEach(function(key) {
        if (severityCount[key] > 0) {
            labels.push(severityMap[key] || key);
            data.push(severityCount[key]);
            colors.push(CHART_COLORS.severity[key] || '#999');
        }
    });

    Dashboard.charts.severity = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Bug 数量',
                data: data,
                backgroundColor: colors,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        }
    });
}

function renderTrendChart(dailyTrend) {
    var ctx = document.getElementById('chart-trend').getContext('2d');

    // Only show last 60 days
    var recentTrend = dailyTrend.slice(-60);

    var labels = recentTrend.map(function(d) { return d.date; });
    var newData = recentTrend.map(function(d) { return d.new; });
    var closedData = recentTrend.map(function(d) { return d.closed; });

    Dashboard.charts.trend = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '每日新增',
                    data: newData,
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231,76,60,0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2
                },
                {
                    label: '每日关闭',
                    data: closedData,
                    borderColor: '#27ae60',
                    backgroundColor: 'rgba(39,174,96,0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' }
            },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } },
                x: {
                    ticks: {
                        maxTicksLimit: 15,
                        font: { size: 10 }
                    }
                }
            }
        }
    });
}

function renderOwnerChart(ownerCount) {
    var ctx = document.getElementById('chart-owner').getContext('2d');

    // Top 10 owners
    var top = ownerCount.slice(0, 10);
    var labels = top.map(function(o) { return o.owner; });
    var data = top.map(function(o) { return o.count; });

    var colors = generateBarColors(top.length);

    Dashboard.charts.owner = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Bug 数量',
                data: data,
                backgroundColor: colors,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        }
    });
}

function renderDomainChart(domainCount) {
    var ctx = document.getElementById('chart-domain').getContext('2d');

    // Top 10 domains
    var top = domainCount.slice(0, 10);
    var labels = top.map(function(d) { return d.domain; });
    var data = top.map(function(d) { return d.count; });
    var colors = CHART_COLORS.domain.slice(0, top.length);

    Dashboard.charts.domain = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { padding: 8, font: { size: 10 } } }
            }
        }
    });
}

function renderAgeChart(ageBuckets) {
    var ctx = document.getElementById('chart-age').getContext('2d');

    var labels = Object.keys(ageBuckets);
    var data = Object.values(ageBuckets);
    var colors = ['#27ae60', '#f1c40f', '#e67e22', '#e74c3c', '#8e44ad'];

    Dashboard.charts.age = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Bug 数量',
                data: data,
                backgroundColor: colors,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        }
    });
}

function generateBarColors(count) {
    var base = [
        '#3498db', '#e74c3c', '#27ae60', '#f39c12', '#9b59b6',
        '#1abc9c', '#e67e22', '#34495e', '#2ecc71', '#e91e63'
    ];
    var colors = [];
    for (var i = 0; i < count; i++) {
        colors.push(base[i % base.length]);
    }
    return colors;
}

// ============ History Trend ============

async function loadHistoryTrend(project) {
    try {
        var resp = await fetch('/api/data/jira-dashboard-history/' + project, { credentials: 'same-origin' });
        var data = await resp.json();

        if (data.success && data.trendData && data.trendData.length >= 2) {
            renderHistoryChart(data.trendData);
            document.getElementById('trend-history').style.display = 'block';
        }
    } catch (e) {
        // Silently fail - history is optional
    }
}

function renderHistoryChart(trendData) {
    var ctx = document.getElementById('chart-history-trend').getContext('2d');

    var labels = trendData.map(function(d) { return d.date; });
    var openData = trendData.map(function(d) { return d.open; });
    var closedData = trendData.map(function(d) { return d.closed; });

    if (Dashboard.charts.history) {
        Dashboard.charts.history.destroy();
    }

    Dashboard.charts.history = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '未关闭',
                    data: openData,
                    borderColor: '#e67e22',
                    backgroundColor: 'rgba(230,126,34,0.1)',
                    fill: true,
                    tension: 0.3
                },
                {
                    label: '累计关闭',
                    data: closedData,
                    borderColor: '#27ae60',
                    backgroundColor: 'rgba(39,174,96,0.1)',
                    fill: true,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' }
            },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        }
    });
}

// ============ Bug Table ============

function renderBugTable(bugs) {
    Dashboard.filteredBugs = bugs.slice();
    applyTableFilters();
}

function applyTableFilters() {
    var keyFilter = document.getElementById('filter-key').value.toLowerCase();
    var summaryFilter = document.getElementById('filter-summary').value.toLowerCase();
    var statusFilter = document.getElementById('filter-status').value;
    var severityFilter = document.getElementById('filter-severity').value;
    var ownerFilter = document.getElementById('filter-owner').value.toLowerCase();
    var showClosed = document.getElementById('show-closed').checked;

    var filtered = Dashboard.filteredBugs.filter(function(bug) {
        // Hide closed/rejected by default unless checkbox is checked or status filter targets them
        var isClosedStatus = (bug.status === 'closed' || bug.status === 'rejected');
        var isFilteringForClosed = (statusFilter === 'closed' || statusFilter === 'rejected');
        if (!showClosed && !isFilteringForClosed && isClosedStatus) return false;

        if (keyFilter && bug.bugId.toLowerCase().indexOf(keyFilter) === -1) return false;
        if (summaryFilter && bug.description.toLowerCase().indexOf(summaryFilter) === -1) return false;
        if (statusFilter && bug.status !== statusFilter) return false;
        if (severityFilter && bug.severity !== severityFilter) return false;
        if (ownerFilter && bug.owner.toLowerCase().indexOf(ownerFilter) === -1) return false;
        return true;
    });

    // Apply sort
    if (Dashboard.sortField) {
        var severityPriority = { highest: 0, high: 1, medium: 2, low: 3, lowest: 4 };
        filtered.sort(function(a, b) {
            var valA, valB;
            if (Dashboard.sortField === 'severity') {
                valA = severityPriority[a.severity] !== undefined ? severityPriority[a.severity] : 999;
                valB = severityPriority[b.severity] !== undefined ? severityPriority[b.severity] : 999;
            } else if (Dashboard.sortField === 'ageDays') {
                valA = a.ageDays || 0;
                valB = b.ageDays || 0;
            } else if (Dashboard.sortField === 'reportDate') {
                valA = a.reportDate || '';
                valB = b.reportDate || '';
            } else {
                valA = (a[Dashboard.sortField] || '').toString().toLowerCase();
                valB = (b[Dashboard.sortField] || '').toString().toLowerCase();
            }
            var cmp = valA > valB ? 1 : valA < valB ? -1 : 0;
            return Dashboard.sortDirection === 'asc' ? cmp : -cmp;
        });
    }

    renderBugRows(filtered);
}

function renderBugRows(bugs) {
    var tbody = document.getElementById('bug-table-body');
    tbody.innerHTML = '';

    var maxRows = 200; // limit rendering
    var displayBugs = bugs.slice(0, maxRows);

    displayBugs.forEach(function(bug) {
        var tr = document.createElement('tr');

        // Highlight overdue open bugs
        if ((bug.status === 'open' || bug.status === 'triage') && bug.ageDays > 14) {
            tr.classList.add('row-overdue');
        }

        // Key
        var tdKey = document.createElement('td');
        var keyLink = document.createElement('a');
        keyLink.href = bug.jiraUrl || ('https://jira01.birentech.com/browse/' + bug.bugId);
        keyLink.target = '_blank';
        keyLink.className = 'jira-key-link';
        keyLink.textContent = bug.bugId;
        tdKey.appendChild(keyLink);
        tr.appendChild(tdKey);

        // Description
        var tdDesc = document.createElement('td');
        tdDesc.textContent = bug.description;
        tdDesc.title = bug.description;
        tdDesc.style.maxWidth = '300px';
        tdDesc.style.overflow = 'hidden';
        tdDesc.style.textOverflow = 'ellipsis';
        tdDesc.style.whiteSpace = 'nowrap';
        tr.appendChild(tdDesc);

        // Status
        var tdStatus = document.createElement('td');
        var statusBadge = document.createElement('span');
        statusBadge.className = 'status-badge status-' + bug.status;
        statusBadge.textContent = bug.status.charAt(0).toUpperCase() + bug.status.slice(1);
        tdStatus.appendChild(statusBadge);
        tr.appendChild(tdStatus);

        // Severity
        var tdSeverity = document.createElement('td');
        var severityBadge = document.createElement('span');
        severityBadge.className = 'severity-badge severity-' + bug.severity;
        severityBadge.textContent = bug.severity.charAt(0).toUpperCase() + bug.severity.slice(1);
        tdSeverity.appendChild(severityBadge);
        tr.appendChild(tdSeverity);

        // Owner
        var tdOwner = document.createElement('td');
        tdOwner.textContent = bug.owner;
        tr.appendChild(tdOwner);

        // Domain
        var tdDomain = document.createElement('td');
        tdDomain.textContent = bug.domain;
        tr.appendChild(tdDomain);

        // Report Date
        var tdDate = document.createElement('td');
        tdDate.textContent = bug.reportDate;
        tr.appendChild(tdDate);

        // Age
        var tdAge = document.createElement('td');
        if (bug.ageDays !== undefined) {
            tdAge.textContent = bug.ageDays;
            if (bug.ageDays > 14 && bug.status !== 'closed' && bug.status !== 'rejected') {
                tdAge.className = 'age-overdue';
            } else if (bug.ageDays > 7) {
                tdAge.className = 'age-warning';
            }
        }
        tr.appendChild(tdAge);

        tbody.appendChild(tr);
    });

    // Update count
    document.getElementById('bug-count').textContent = '显示 ' + displayBugs.length + ' / ' + bugs.length + ' 条';
}

function filterBugs() {
    applyTableFilters();
}

function sortBugs(field) {
    if (Dashboard.sortField === field) {
        Dashboard.sortDirection = Dashboard.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        Dashboard.sortField = field;
        Dashboard.sortDirection = 'asc';
    }

    // Update sort indicators
    document.querySelectorAll('.dashboard-bug-table th').forEach(function(th) {
        th.classList.remove('sort-asc', 'sort-desc');
    });
    var th = document.querySelector('.dashboard-bug-table th[data-sort="' + field + '"]');
    if (th) {
        th.classList.add(Dashboard.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    applyTableFilters();
}

// ============ Auto Refresh ============

function toggleAutoRefresh() {
    var interval = parseInt(document.getElementById('auto-refresh').value);

    if (Dashboard.autoRefreshTimer) {
        clearInterval(Dashboard.autoRefreshTimer);
        Dashboard.autoRefreshTimer = null;
    }

    if (interval > 0) {
        Dashboard.autoRefreshTimer = setInterval(function() {
            fetchDashboardData();
        }, interval);
    }
}

// ============ UI Helpers ============

function showLoading(show) {
    document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

function showError(msg) {
    var el = document.getElementById('error-message');
    el.textContent = msg;
    el.style.display = 'block';
}

function hideError() {
    document.getElementById('error-message').style.display = 'none';
}

function hideAllData() {
    document.getElementById('kpi-grid').style.display = 'none';
    document.getElementById('charts-grid').style.display = 'none';
    document.getElementById('bug-table-section').style.display = 'none';
    document.getElementById('trend-history').style.display = 'none';
    document.getElementById('last-updated').style.display = 'none';
}

function onFilterChange() {
    // Debounce: wait 500ms before fetching
    if (Dashboard.filterTimeout) clearTimeout(Dashboard.filterTimeout);
    Dashboard.filterTimeout = setTimeout(function() {
        fetchDashboardData();
    }, 500);
}

// ============ Keyboard shortcuts ============

document.addEventListener('keydown', function(e) {
    // Enter on login fields
    if (e.key === 'Enter' && document.getElementById('login-modal').style.display === 'flex') {
        doLogin();
    }
});

// ============ Init ============

document.addEventListener('DOMContentLoaded', function() {
    // Try to verify existing session
    verifyAuth().then(function(loggedIn) {
        if (!loggedIn) {
            // Show login prompt
            document.getElementById('login-status').textContent = '请先登录后查看 Dashboard';
        }
    });
});

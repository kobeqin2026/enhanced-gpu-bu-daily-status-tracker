// JIRA Bug Dashboard - Frontend Logic
// Chart.js via CDN: https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js

// ============ Chart.js Plugin: Labels on Pie/Doughnut (status inside, percentage outside) ============

var pieLabelPlugin = {
    id: 'pieLabel',
    afterDatasetsDraw: function(chart) {
        if (chart.config.type !== 'pie' && chart.config.type !== 'doughnut') return;

        var ctx = chart.ctx;
        var dataset = chart.data.datasets[0];
        var labels = chart.data.labels;
        var meta = chart.getDatasetMeta(0);
        var total = dataset.data.reduce(function(a, b) { return a + b; }, 0);

        if (total === 0) return;

        var centerX = meta.data[0].x;
        var centerY = meta.data[0].y;
        var outerRadius = meta.data[0].outerRadius;
        var innerRadius = meta.data[0].innerRadius || 0;

        ctx.save();

        meta.data.forEach(function(arc, i) {
            var value = dataset.data[i];
            var pct = Math.round((value / total) * 100);
            if (pct < 1) return;

            var label = labels[i] || '';
            var color = dataset.backgroundColor[i];
            var textColor = isLightColor(color) ? '#333' : '#fff';
            var angle = arc.startAngle + (arc.endAngle - arc.startAngle) / 2;

            var ringWidth = outerRadius - innerRadius;
            var labelR = innerRadius + ringWidth * 0.5;
            var labelX = centerX + Math.cos(angle) * labelR;
            var labelY = centerY + Math.sin(angle) * labelR;

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Status name on top
            var nameSize = Math.max(9, Math.min(12, ringWidth * 0.22));
            ctx.font = 'bold ' + nameSize + 'px sans-serif';
            ctx.fillStyle = textColor;
            ctx.fillText(label, labelX, labelY - nameSize * 0.55);

            // Percentage below
            var pctSize = Math.max(9, Math.min(11, ringWidth * 0.20));
            ctx.font = 'bold ' + pctSize + 'px sans-serif';
            ctx.fillText(pct + '%', labelX, labelY + pctSize * 0.6);
        });

        ctx.restore();
    }
};

function isLightColor(color) {
    var r = 0, g = 0, b = 0;
    if (color.startsWith('#')) {
        var hex = color.slice(1);
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
    }
    var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6;
}

// ============ Chart.js Plugin: Data Labels on Line Charts ============

var lineDataLabelPlugin = {
    id: 'lineDataLabel',
    afterDatasetsDraw: function(chart) {
        if (chart.config.type !== 'line') return;

        var ctx = chart.ctx;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = '10px sans-serif';

        chart.data.datasets.forEach(function(dataset, di) {
            var meta = chart.getDatasetMeta(di);
            if (meta.hidden) return;

            meta.data.forEach(function(point, i) {
                var value = dataset.data[i];
                if (value === 0 || value === null || value === undefined) return;

                ctx.fillStyle = dataset.borderColor || '#333';
                ctx.fillText(value, point.x, point.y - 6);
            });
        });

        ctx.restore();
    }
};

// ============ Chart.js Plugin: Data Labels on Bar Charts (vertical + horizontal) ============

var barDataLabelPlugin = {
    id: 'barDataLabel',
    afterDatasetsDraw: function(chart) {
        if (chart.config.type !== 'bar') return;

        var ctx = chart.ctx;
        ctx.save();
        ctx.textBaseline = 'middle';

        var isHorizontal = (chart.options.indexAxis === 'y');

        chart.data.datasets.forEach(function(dataset, di) {
            var meta = chart.getDatasetMeta(di);
            if (meta.hidden) return;

            meta.data.forEach(function(bar, i) {
                var value = dataset.data[i];
                if (value === 0 || value === null || value === undefined) return;

                ctx.fillStyle = '#333';
                ctx.font = 'bold 10px sans-serif';

                if (isHorizontal) {
                    ctx.textAlign = 'left';
                    ctx.fillText(value, bar.x + 4, bar.y);
                } else {
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(value, bar.x, bar.y - 5);
                }
            });
        });

        ctx.restore();
    }
};

// Register plugins with Chart.js
if (typeof Chart !== 'undefined' && Chart.register) {
    Chart.register(pieLabelPlugin);
    Chart.register(lineDataLabelPlugin);
    Chart.register(barDataLabelPlugin);
}

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
            document.getElementById('quick-actions-section').style.display = 'flex';
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
    document.getElementById('quick-actions-section').style.display = 'none';
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
            document.getElementById('quick-actions-section').style.display = 'flex';
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

function clearDashboard() {
    if (!confirm('确定要清空所有已加载的 JIRA 数据吗？\n（清空后需重新同步才能查看数据）')) return;

    // Clear data
    Dashboard.allBugs = [];
    Dashboard.selectedProjects = [];

    // Reset UI - hide all data sections
    document.getElementById('kpi-grid').style.display = 'none';
    document.getElementById('charts-grid').style.display = 'none';
    var bugTable = document.getElementById('bug-table-section');
    if (bugTable) bugTable.style.display = 'none';
    var trendSection = document.getElementById('trend-section');
    if (trendSection) trendSection.style.display = 'none';

    // Clear KPI values
    ['kpi-total', 'kpi-open', 'kpi-closed', 'kpi-today', 'kpi-week', 'kpi-avg', 'kpi-overdue'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.textContent = '0';
    });

    // Clear chart canvases
    ['chart-status', 'chart-severity', 'chart-owner', 'chart-domain', 'chart-age', 'chart-trend'].forEach(function(id) {
        var canvas = document.getElementById(id);
        if (canvas) {
            var ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    });

    // Clear bug table body
    var bugTbody = document.getElementById('bug-table-body');
    if (bugTbody) bugTbody.innerHTML = '';

    // Clear search results
    var searchResults = document.getElementById('quick-search-results');
    if (searchResults) {
        searchResults.style.display = 'none';
        searchResults.innerHTML = '';
    }

    // Clear search input
    var searchInput = document.getElementById('quick-search-keyword');
    if (searchInput) searchInput.value = '';

    // Reset project selectors
    document.getElementById('project-select').value = '';
    document.getElementById('multi-project-chips').innerHTML = '';

    // Reset auto-refresh
    document.getElementById('auto-refresh').value = '0';
    if (Dashboard._autoRefreshTimer) {
        clearInterval(Dashboard._autoRefreshTimer);
        Dashboard._autoRefreshTimer = null;
    }

    showSyncStatus('✓ 数据已清空', 'success');
}

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

            // Try to load historical trend (disabled - section removed)

            document.getElementById('kpi-grid').style.display = 'grid';
            document.getElementById('charts-grid').style.display = 'grid';
            document.getElementById('bug-table-section').style.display = 'block';
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
                pieLabel: {},
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
            layout: { padding: { top: 18 } },
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
                lineDataLabel: {},
                legend: { position: 'top' },
                zoom: {
                    zoom: {
                        wheel: { enabled: true },
                        pinch: { enabled: true },
                        mode: 'x',
                    },
                    pan: {
                        enabled: true,
                        mode: 'x',
                    }
                }
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
            layout: { padding: { right: 20 } },
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
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#fff'
            }],
        },
        options: {
            cutout: '45%',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                pieLabel: {},
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
            layout: { padding: { top: 18 } },
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        }
    });
}

// ============ Trend Zoom Control ============

function resetTrendZoom() {
    if (Dashboard.charts.trend) {
        Dashboard.charts.trend.resetZoom();
    }
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
// Removed - trend history section no longer displayed on the page.

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

        // Diagnosis button
        var tdDiag = document.createElement('td');
        var diagBtn = document.createElement('button');
        diagBtn.className = 'diag-btn';
        diagBtn.textContent = '🔍';
        diagBtn.title = '智能诊断';
        diagBtn.onclick = (function(key) {
            return function() { diagnoseBug(key); };
        })(bug.bugId);
        tdDiag.appendChild(diagBtn);
        tr.appendChild(tdDiag);

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

// ============ Bug Diagnosis ============

function diagnoseBug(bugKey) {
    var bug = Dashboard.allBugs.find(function(b) { return b.bugId === bugKey; });
    if (!bug) {
        alert('找不到 Bug: ' + bugKey);
        return;
    }

    var diagKey = document.getElementById('diag-bug-key');
    var diagLoading = document.getElementById('diag-loading');
    var diagResult = document.getElementById('diag-result');
    var diagModal = document.getElementById('diag-modal');

    if (diagKey) diagKey.textContent = bugKey;
    if (diagLoading) diagLoading.style.display = 'block';
    if (diagResult) diagResult.style.display = 'none';
    if (diagModal) diagModal.style.display = 'flex';

    fetch('/api/data/diagnose-bug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
            key: bugKey,
            summary: bug.description,
            status: bug.status,
            severity: bug.severity,
            projectKey: bug.projectKey || '',
            description: bug.jiraDescription || '',
            comments: bug.jiraComments || [],
            logContent: '',
            components: bug.components || [],
            rootCause: bug.rootCause || '',
            labels: bug.labels || []
        })
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        if (data.success) {
            showDiagnoseResult(data.data, bug.status);
        } else {
            if (diagLoading) diagLoading.style.display = 'none';
            alert('诊断失败: ' + (data.error || '未知错误'));
        }
    })
    .catch(function(err) {
        if (diagLoading) diagLoading.style.display = 'none';
        alert('诊断请求失败: ' + err.message);
    });
}

// Quick diagnosis: diagnose by bug key only (backend auto-fetches from JIRA)
function diagnoseByKey() {
    console.log('[DiagByKey] Function called');

    var input = document.getElementById('quick-diag-key');
    if (!input) { alert('找不到输入框'); return; }
    var bugKey = input.value.trim();
    console.log('[DiagByKey] Bug key:', bugKey);
    if (!bugKey) {
        alert('请输入 Bug Key');
        return;
    }

    var diagKey = document.getElementById('diag-bug-key');
    var diagLoading = document.getElementById('diag-loading');
    var diagResult = document.getElementById('diag-result');
    var diagModal = document.getElementById('diag-modal');

    console.log('[DiagByKey] Elements:', diagKey ? 'OK' : 'NULL', diagLoading ? 'OK' : 'NULL', diagModal ? 'OK' : 'NULL');

    if (diagKey) diagKey.textContent = bugKey;
    if (diagLoading) diagLoading.style.display = 'block';
    if (diagResult) diagResult.style.display = 'none';
    if (diagModal) diagModal.style.display = 'flex';
    console.log('[DiagByKey] Modal display set to flex');

    // Only send key — backend auto-fetches comments, attachments, metadata from JIRA
    fetch('/api/data/diagnose-bug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ key: bugKey })
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        console.log('[DiagByKey] Response:', JSON.stringify(data).substring(0, 300));
        if (data.success) {
            var bugStatus = data.data.bug_status || '';
            showDiagnoseResult(data.data, bugStatus);
        } else {
            if (diagLoading) diagLoading.style.display = 'none';
            var errMsg = data.error || data.message || '未知错误';
            alert('诊断失败: ' + errMsg);
        }
    })
    .catch(function(err) {
        if (diagLoading) diagLoading.style.display = 'none';
        alert('诊断请求失败: ' + err.message);
    });
}

function showDiagnoseResult(data, bugStatus) {
    var diagLoading = document.getElementById('diag-loading');
    var diagResult = document.getElementById('diag-result');
    if (diagLoading) diagLoading.style.display = 'none';
    if (diagResult) diagResult.style.display = 'block';

    var summaryEl = document.getElementById('diag-summary');
    if (summaryEl) summaryEl.textContent = data.summary || '无';

    // Confidence
    var confEl = document.getElementById('diag-confidence');
    if (confEl) {
        var conf = data.confidence || 0;
        var confColor = conf >= 70 ? '#27ae60' : (conf >= 40 ? '#f39c12' : '#e74c3c');
        confEl.innerHTML = '置信度: <strong style="color:' + confColor + '">' + conf + '%</strong>';
    }

    // Causes
    var causesEl = document.getElementById('diag-causes');
    if (causesEl) {
        causesEl.innerHTML = '';
        (data.possible_causes || []).forEach(function(c) {
            var li = document.createElement('li');
            li.textContent = c;
            causesEl.appendChild(li);
        });
    }

    // Check if bug is closed or rejected
    var isClosed = (bugStatus === 'closed' || bugStatus === 'rejected');

    // For closed/rejected bugs: show conclusion, hide actions and data
    var actionsSection = document.getElementById('diag-actions-section');
    var dataSection = document.getElementById('diag-data-section');
    var conclusionSection = document.getElementById('diag-conclusion-section');
    var conclusionEl = document.getElementById('diag-conclusion');

    if (isClosed) {
        if (actionsSection) actionsSection.style.display = 'none';
        if (dataSection) dataSection.style.display = 'none';
        if (conclusionSection) conclusionSection.style.display = 'block';
        if (conclusionEl) conclusionEl.textContent = data.conclusion || '该Bug已解决，无进一步建议。';
    } else {
        if (actionsSection) actionsSection.style.display = 'block';
        if (dataSection) dataSection.style.display = 'block';
        if (conclusionSection) conclusionSection.style.display = 'none';

        var actionsEl = document.getElementById('diag-actions');
        if (actionsEl) {
            actionsEl.innerHTML = '';
            (data.suggested_actions || []).forEach(function(a) {
                var li = document.createElement('li');
                li.textContent = a;
                actionsEl.appendChild(li);
            });
        }

        var dataEl = document.getElementById('diag-data');
        if (dataEl) {
            dataEl.innerHTML = '';
            (data.needed_data || []).forEach(function(d) {
                var li = document.createElement('li');
                li.textContent = d;
                dataEl.appendChild(li);
            });
        }
    }

    // Related bugs (cross-project) — score | key | summary
    var relatedSection = document.getElementById('diag-related-section');
    var relatedEl = document.getElementById('diag-related-bugs');

    if (relatedEl) relatedEl.innerHTML = '';

    if (data.related_bugs && data.related_bugs.length > 0) {
        if (relatedSection) relatedSection.style.display = 'block';
        data.related_bugs.forEach(function(b) {
            var row = document.createElement('div');
            row.className = 'related-bug-item';

            // Score
            var scoreSpan = document.createElement('span');
            scoreSpan.className = 'related-bug-score';
            var score = b.relevance_score || 0;
            scoreSpan.textContent = score;
            if (score >= 80) {
                scoreSpan.style.color = '#27ae60';
            } else if (score >= 60) {
                scoreSpan.style.color = '#f39c12';
            } else {
                scoreSpan.style.color = '#e74c3c';
            }
            row.appendChild(scoreSpan);

            // Bug key (clickable link)
            var keyLink = document.createElement('a');
            keyLink.href = b.url || '#';
            keyLink.target = '_blank';
            keyLink.className = 'related-bug-key';
            keyLink.textContent = b.key || '';
            row.appendChild(keyLink);

            // Summary
            var summarySpan = document.createElement('span');
            summarySpan.className = 'related-bug-summary';
            summarySpan.textContent = b.summary || '';
            summarySpan.title = b.summary || '';
            row.appendChild(summarySpan);

            relatedEl.appendChild(row);
        });
    } else {
        if (relatedSection) relatedSection.style.display = 'none';
    }

    // ===== Screenshot Analysis Section =====
    var screenshotSection = document.getElementById('diag-screenshot-section');
    var screenshotContent = document.getElementById('diag-screenshot-content');
    if (screenshotContent) screenshotContent.innerHTML = '';

    var hasAnyScreenshots = false;

    // Check for source bug screenshots
    var sourceImages = data.source_image_summaries || [];
    var sourcePending = data.source_unanalyzed_images || [];

    // Check for related bug screenshots
    var relatedBugImages = [];
    if (data.related_bugs) {
        data.related_bugs.forEach(function(rb) {
            var imgs = rb.image_summaries || [];
            var pend = rb.unanalyzed_images || [];
            if (imgs.length > 0 || pend.length > 0) {
                relatedBugImages.push({
                    key: rb.key,
                    url: rb.url,
                    images: imgs,
                    pending: pend
                });
            }
        });
    }

    if (sourceImages.length > 0 || sourcePending.length > 0 || relatedBugImages.length > 0) {
        hasAnyScreenshots = true;

        // Source bug accordion group
        if (sourceImages.length > 0 || sourcePending.length > 0) {
            var sourceGroup = document.createElement('div');
            sourceGroup.className = 'screenshot-section-group';

            var analyzedCount = sourceImages.length;
            var pendingCount = sourcePending.length;
            var badgeHtml = '<span class="screenshot-badge badge-source">已分析' + analyzedCount + '张</span>';
            if (pendingCount > 0) {
                badgeHtml += '<span class="screenshot-pending">待分析' + pendingCount + '张</span>';
            }

            var headerHtml = '<span class="accordion-icon">&#9654;</span> 源Bug截图 ' + badgeHtml;
            var headerEl = createAccordionHeader(headerHtml);
            sourceGroup.appendChild(headerEl);

            var contentEl = document.createElement('div');
            contentEl.className = 'screenshot-group-content';
            var gridEl = document.createElement('div');
            gridEl.className = 'screenshot-grid';

            // Render analyzed screenshots
            sourceImages.forEach(function(img) {
                gridEl.appendChild(createScreenshotCard(img, false));
            });

            // Render pending screenshots
            sourcePending.forEach(function(img) {
                gridEl.appendChild(createPendingCard(img));
            });

            contentEl.appendChild(gridEl);
            sourceGroup.appendChild(contentEl);

            // Toggle handler
            headerEl.addEventListener('click', function() {
                var isExpanded = headerEl.classList.contains('expanded');
                if (isExpanded) {
                    headerEl.classList.remove('expanded');
                    contentEl.classList.remove('expanded');
                } else {
                    headerEl.classList.add('expanded');
                    contentEl.classList.add('expanded');
                }
            });

            screenshotContent.appendChild(sourceGroup);
        }

        // Related bug accordion groups
        relatedBugImages.forEach(function(rb) {
            var group = document.createElement('div');
            group.className = 'screenshot-section-group';

            var rAnalyzed = rb.images.length;
            var rPending = rb.pending.length;
            var rBadgeHtml = '<span class="screenshot-badge badge-related">' + rb.key + ' - 已分析' + rAnalyzed + '张</span>';
            if (rPending > 0) {
                rBadgeHtml += '<span class="screenshot-pending">待分析' + rPending + '张</span>';
            }

            var rHeaderHtml = '<span class="accordion-icon">&#9654;</span> 相关Bug ' + rb.key + ' 截图 ' + rBadgeHtml;
            var rHeaderEl = createAccordionHeader(rHeaderHtml);
            group.appendChild(rHeaderEl);

            var rContentEl = document.createElement('div');
            rContentEl.className = 'screenshot-group-content';
            var rGridEl = document.createElement('div');
            rGridEl.className = 'screenshot-grid';

            rb.images.forEach(function(img) {
                rGridEl.appendChild(createScreenshotCard(img, false));
            });
            rb.pending.forEach(function(img) {
                rGridEl.appendChild(createPendingCard(img));
            });

            rContentEl.appendChild(rGridEl);
            group.appendChild(rContentEl);

            rHeaderEl.addEventListener('click', function() {
                var isExpanded = rHeaderEl.classList.contains('expanded');
                if (isExpanded) {
                    rHeaderEl.classList.remove('expanded');
                    rContentEl.classList.remove('expanded');
                } else {
                    rHeaderEl.classList.add('expanded');
                    rContentEl.classList.add('expanded');
                }
            });

            screenshotContent.appendChild(group);
        });
    }

    if (hasAnyScreenshots && screenshotSection) {
        screenshotSection.style.display = 'block';
    } else if (screenshotSection) {
        screenshotSection.style.display = 'none';
    }
}

// Helper: create accordion header element
function createAccordionHeader(html) {
    var el = document.createElement('div');
    el.className = 'screenshot-group-header';
    el.innerHTML = html;
    return el;
}

// Helper: create a screenshot card from structured data
function createScreenshotCard(imgData) {
    var card = document.createElement('div');
    card.className = 'screenshot-card';

    // Handle both structured objects and legacy strings
    var summary, imgType, keyData, keywords;
    if (typeof imgData === 'string') {
        summary = imgData;
        imgType = 'other';
        keyData = [];
        keywords = [];
    } else {
        summary = imgData.summary || '';
        imgType = imgData.type || 'other';
        keyData = imgData.key_data || [];
        keywords = imgData.keywords || [];
    }

    // Type badge
    var typeEl = document.createElement('div');
    typeEl.className = 'screenshot-card-type type-' + imgType;
    typeEl.textContent = imgType.replace(/_/g, ' ');
    card.appendChild(typeEl);

    // Summary
    if (summary) {
        var summaryEl = document.createElement('div');
        summaryEl.className = 'screenshot-card-summary';
        summaryEl.textContent = summary;
        card.appendChild(summaryEl);
    }

    // Key data
    if (keyData && keyData.length > 0) {
        var kdEl = document.createElement('div');
        kdEl.className = 'screenshot-card-key-data';
        var kdTitle = document.createElement('strong');
        kdTitle.textContent = '关键数据:';
        kdEl.appendChild(kdTitle);
        var kdUl = document.createElement('ul');
        keyData.forEach(function(kd) {
            var li = document.createElement('li');
            li.textContent = kd;
            kdUl.appendChild(li);
        });
        kdEl.appendChild(kdUl);
        card.appendChild(kdEl);
    }

    // Keywords
    if (keywords && keywords.length > 0) {
        var kwEl = document.createElement('div');
        kwEl.className = 'screenshot-card-keywords';
        keywords.slice(0, 8).forEach(function(kw) {
            var tag = document.createElement('span');
            tag.className = 'screenshot-keyword-tag';
            tag.textContent = kw;
            kwEl.appendChild(tag);
        });
        card.appendChild(kwEl);
    }

    return card;
}

// Helper: create a pending screenshot card
function createPendingCard(imgData) {
    var card = document.createElement('div');
    card.className = 'screenshot-card screenshot-card-pending';

    var typeEl = document.createElement('div');
    typeEl.className = 'screenshot-card-type';
    typeEl.textContent = '待分析';
    card.appendChild(typeEl);

    var summaryEl = document.createElement('div');
    summaryEl.className = 'screenshot-card-summary';
    summaryEl.textContent = imgData.filename || imgData.url || '未知截图';
    summaryEl.title = imgData.url || '';
    card.appendChild(summaryEl);

    if (imgData.url) {
        var linkEl = document.createElement('a');
        linkEl.href = imgData.url;
        linkEl.target = '_blank';
        linkEl.style.fontSize = '11px';
        linkEl.style.color = '#e65100';
        linkEl.textContent = '查看原图 →';
        card.appendChild(linkEl);
    }

    return card;
}

// ============ Quick Keyword Search ============

var searchDebounceTimer = null;

function onSearchInput() {
    // Debounce: wait 300ms before searching
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(function() {
        searchBugsByKey();
    }, 300);
}

function searchBugsByKey() {
    var keyword = document.getElementById('quick-search-keyword').value.trim().toLowerCase();
    var resultsContainer = document.getElementById('quick-search-results');

    console.log('[Search] keyword:', keyword, 'allBugs.length:', Dashboard.allBugs.length);
    if (Dashboard.allBugs.length > 0) {
        console.log('[Search] Sample bug keys:', Dashboard.allBugs.slice(0, 3).map(function(b) { return b.bugId; }));
        console.log('[Search] Sample bug fields:', Object.keys(Dashboard.allBugs[0]));
    }

    if (!keyword) {
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = '';
        return;
    }

    // Auto-sync if data hasn't been loaded yet
    if (Dashboard.allBugs.length === 0) {
        resultsContainer.innerHTML = '<div class="search-no-results">正在加载 JIRA 数据，请稍候...</div>';
        resultsContainer.style.display = 'block';

        fetchDashboardData().then(function() {
            setTimeout(function() {
                console.log('[Search] Auto-sync complete, allBugs.length:', Dashboard.allBugs.length);
                if (Dashboard.allBugs.length === 0) {
                    resultsContainer.innerHTML = '<div class="search-no-results">数据加载失败，请手动点击 <strong>同步JIRA数据</strong> 后重试</div>';
                    return;
                }
                searchBugsByKey();
            }, 500);
        }).catch(function() {
            resultsContainer.innerHTML = '<div class="search-no-results">数据同步失败，请手动点击 <strong>同步JIRA数据</strong> 后重试</div>';
        });
        return;
    }

    // Debug: log first bug's field names and values
    if (Dashboard.allBugs.length > 0) {
        var sampleBug = Dashboard.allBugs[0];
        var sampleFields = {};
        for (var key in sampleBug) {
            sampleFields[key] = sampleBug[key];
        }
        console.log('[Search] First bug fields:', JSON.stringify(sampleFields, null, 2));

        // Also check if keyword matches a known bug
        var testBug = Dashboard.allBugs[0];
        console.log('[Search] Test - bugId:', testBug.bugId, '| desc:', (testBug.description || '').substring(0, 50), '| domain:', testBug.domain, '| owner:', testBug.owner);
    }

    // Search across all bugs (include summary & rootCause for full coverage)
    var searchFields = ['bugId', 'description', 'summary', 'domain', 'owner', 'status', 'severity', 'rootCause'];
    var matchCount = 0;
    var results = Dashboard.allBugs.filter(function(bug) {
        for (var i = 0; i < searchFields.length; i++) {
            var field = searchFields[i];
            var value = bug[field] || '';
            if (value.toLowerCase().indexOf(keyword) !== -1) {
                if (matchCount < 3) {
                    console.log('[Search] Match on field "' + field + '":', value.substring(0, 80));
                }
                matchCount++;
                return true;
            }
        }
        // Also search components and labels arrays
        if (bug.components && Array.isArray(bug.components)) {
            for (var j = 0; j < bug.components.length; j++) {
                if (bug.components[j].toLowerCase().indexOf(keyword) !== -1) {
                    return true;
                }
            }
        }
        if (bug.labels && Array.isArray(bug.labels)) {
            for (var k = 0; k < bug.labels.length; k++) {
                if (bug.labels[k].toLowerCase().indexOf(keyword) !== -1) {
                    return true;
                }
            }
        }
        return false;
    });

    console.log('[Search] Found', results.length, 'matches out of', Dashboard.allBugs.length);

    // Sort by relevance: exact key match first, then description contains, then others
    results.sort(function(a, b) {
        var aExact = a.bugId.toLowerCase() === keyword ? 1 : 0;
        var bExact = b.bugId.toLowerCase() === keyword ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;

        var aKeyStart = a.bugId.toLowerCase().indexOf(keyword) === 0 ? 1 : 0;
        var bKeyStart = b.bugId.toLowerCase().indexOf(keyword) === 0 ? 1 : 0;
        if (aKeyStart !== bKeyStart) return bKeyStart - aKeyStart;

        // Prefer open bugs over closed
        var aOpen = (a.status !== 'closed' && a.status !== 'rejected') ? 1 : 0;
        var bOpen = (b.status !== 'closed' && b.status !== 'rejected') ? 1 : 0;
        if (aOpen !== bOpen) return bOpen - aOpen;

        return 0;
    });

    // Limit to 50 results
    var maxResults = 50;
    var displayResults = results.slice(0, maxResults);

    renderSearchResults(displayResults, results.length, keyword);
}

function renderSearchResults(bugs, totalCount, keyword) {
    var container = document.getElementById('quick-search-results');
    container.innerHTML = '';
    container.style.display = 'block';

    if (bugs.length === 0) {
        container.innerHTML = '<div class="search-no-results">未找到匹配 "<strong>' + escapeHtml(keyword) + '</strong>" 的 Bug</div>';
        return;
    }

    var header = document.createElement('div');
    header.className = 'search-results-header';
    header.textContent = '找到 ' + bugs.length + (totalCount > bugs.length ? '+' : '') + ' 条结果（共 ' + totalCount + ' 条）';
    container.appendChild(header);

    var list = document.createElement('div');
    list.className = 'search-results-list';

    bugs.forEach(function(bug) {
        var item = document.createElement('div');
        item.className = 'search-result-item';

        // Row 1: Key + Status + Severity
        var row1 = document.createElement('div');
        row1.className = 'search-result-row1';

        var keyLink = document.createElement('a');
        keyLink.href = bug.jiraUrl || ('https://jira01.birentech.com/browse/' + bug.bugId);
        keyLink.target = '_blank';
        keyLink.className = 'search-result-key';
        keyLink.innerHTML = highlightText(bug.bugId, keyword);
        row1.appendChild(keyLink);

        var statusBadge = document.createElement('span');
        statusBadge.className = 'status-badge status-' + bug.status;
        statusBadge.textContent = bug.status.charAt(0).toUpperCase() + bug.status.slice(1);
        row1.appendChild(statusBadge);

        var severityBadge = document.createElement('span');
        severityBadge.className = 'severity-badge severity-' + bug.severity;
        severityBadge.textContent = bug.severity.charAt(0).toUpperCase() + bug.severity.slice(1);
        row1.appendChild(severityBadge);

        item.appendChild(row1);

        // Row 2: Description
        var row2 = document.createElement('div');
        row2.className = 'search-result-desc';
        row2.innerHTML = highlightText(bug.description, keyword);
        row2.title = bug.description;
        item.appendChild(row2);

        // Row 3: Owner + Domain + Date
        var row3 = document.createElement('div');
        row3.className = 'search-result-meta';
        row3.innerHTML = '<span>负责人: ' + highlightText(bug.owner, keyword) + '</span>' +
                         '<span>Domain: ' + highlightText(bug.domain, keyword) + '</span>' +
                         '<span>' + bug.reportDate + '</span>';
        item.appendChild(row3);

        // Row 4: Action buttons
        var row4 = document.createElement('div');
        row4.className = 'search-result-actions';

        var diagBtn = document.createElement('button');
        diagBtn.className = 'search-result-diag-btn';
        diagBtn.textContent = '🔍 诊断';
        diagBtn.onclick = (function(key) {
            return function() { diagnoseBug(key); };
        })(bug.bugId);
        row4.appendChild(diagBtn);

        item.appendChild(row4);

        list.appendChild(item);
    });

    container.appendChild(list);
}

function highlightText(text, keyword) {
    if (!keyword || !text) return escapeHtml(text || '');
    var escaped = escapeHtml(text);
    var regex = new RegExp('(' + escapeRegex(keyword) + ')', 'gi');
    return escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function closeDiagModal() {
    var modal = document.getElementById('diag-modal');
    if (modal) modal.style.display = 'none';
}

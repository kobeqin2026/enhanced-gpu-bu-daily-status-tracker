// JIRA Test Case Management — Frontend Logic
// Tab 1: Browse/Search test cases from JIRA project
// Tab 2: Upload test cases (with Test Plan support)

var authToken = localStorage.getItem('authToken') || '';
var parsedData = []; // Parsed CSV rows
var headers = [];    // CSV column headers
var uploadResults = []; // Results from batch upload
var currentPlans = []; // Current loaded test plans
var selectedPlanKey = ''; // Selected test plan key
var browsePage = { startAt: 0, total: 0, maxResults: 20 };

// ============ Auth ============

function checkAuth() {
    if (!authToken) {
        document.getElementById('login-overlay').style.display = 'flex';
        return false;
    }
    document.getElementById('login-overlay').style.display = 'none';
    loadProjects();
    return true;
}

function doLogin() {
    var user = document.getElementById('login-user').value.trim();
    var pass = document.getElementById('login-pass').value;
    if (!user || !pass) {
        showLoginError('请输入用户名和密码');
        return;
    }
    fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success && data.token) {
            authToken = data.token;
            localStorage.setItem('authToken', authToken);
            document.getElementById('login-overlay').style.display = 'none';
            loadProjects();
        } else {
            showLoginError(data.error || '登录失败');
        }
    })
    .catch(function(e) { showLoginError('网络错误: ' + e.message); });
}

function showLoginError(msg) {
    var el = document.getElementById('login-error');
    el.textContent = msg;
    el.style.display = 'block';
}

document.getElementById('login-pass').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
});

// ============ Tab Switching ============

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(function(btn, i) {
        btn.classList.toggle('active', (tab === 'browse' && i === 0) || (tab === 'upload' && i === 1));
    });
    document.querySelectorAll('.tab-content').forEach(function(el) {
        el.classList.remove('active');
    });
    document.getElementById('tab-' + tab).classList.add('active');
}

// ============ Projects ============

function loadProjects() {
    fetch('/api/testcase/projects', {
        headers: { 'Authorization': 'Bearer ' + authToken }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success && data.data) {
            var projects = data.data;
            // Populate both project dropdowns
            ['browse-project', 'tc-project'].forEach(function(id) {
                var sel = document.getElementById(id);
                sel.innerHTML = '<option value="">-- 选择项目 --</option>';
                projects.forEach(function(p) {
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
        var fallback = ['BR166', 'BR188', 'BR200', 'BRHW110', 'GPU1', 'MPW2'];
        ['browse-project', 'tc-project'].forEach(function(id) {
            var sel = document.getElementById(id);
            sel.innerHTML = '<option value="">-- 选择项目 --</option>';
            fallback.forEach(function(k) {
                var opt = document.createElement('option');
                opt.value = k;
                opt.textContent = k;
                sel.appendChild(opt);
            });
        });
    });
}

// ============ Tab 1: Browse Test Cases ============

function onBrowseProjectChange() {
    var project = document.getElementById('browse-project').value;
    if (project) {
        searchIssues();
    } else {
        document.getElementById('browse-results').innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>选择项目后点击搜索，查看所有 Test Cases</p></div>';
        document.getElementById('browse-total').style.display = 'none';
    }
}

function searchIssues(startAt) {
    startAt = startAt || 0;
    var project = document.getElementById('browse-project').value;
    if (!project) {
        alert('请先选择项目');
        return;
    }

    var query = document.getElementById('browse-search').value.trim();
    var issuetype = document.getElementById('browse-type').value;
    var status = document.getElementById('browse-status').value;

    var params = new URLSearchParams({
        project: project,
        startAt: startAt,
        maxResults: browsePage.maxResults
    });
    if (query) params.set('query', query);
    if (issuetype) params.set('issuetype', issuetype);
    if (status) params.set('status', status);

    var container = document.getElementById('browse-results');
    container.innerHTML = '<div class="loading">加载中...</div>';

    fetch('/api/testcase/search?' + params.toString(), {
        headers: { 'Authorization': 'Bearer ' + authToken }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success && data.data) {
            browsePage.startAt = data.data.startAt;
            browsePage.total = data.data.total;
            renderBrowseResults(data.data.issues, data.data.total, data.data.startAt);
        } else {
            container.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>' + (data.error || '加载失败') + '</p></div>';
        }
    })
    .catch(function(e) {
        container.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>网络错误: ' + e.message + '</p></div>';
    });
}

function renderBrowseResults(issues, total, startAt) {
    var container = document.getElementById('browse-results');
    var totalBadge = document.getElementById('browse-total');

    if (total > 0) {
        totalBadge.textContent = '共 ' + total + ' 条';
        totalBadge.style.display = 'inline';
    } else {
        totalBadge.style.display = 'none';
    }

    if (issues.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>没有找到匹配的 Test Cases</p></div>';
        return;
    }

    var html = '<div class="table-wrap"><table class="data-table"><thead><tr>';
    html += '<th style="width:120px;">Key</th>';
    html += '<th>标题</th>';
    html += '<th style="width:90px;">类型</th>';
    html += '<th style="width:100px;">状态</th>';
    html += '<th style="width:100px;">负责人</th>';
    html += '<th style="width:80px;">优先级</th>';
    html += '<th style="width:80px;">标签</th>';
    html += '<th style="width:140px;">创建时间</th>';
    html += '</tr></thead><tbody>';

    issues.forEach(function(issue) {
        html += '<tr>';
        html += '<td><a href="' + issue.url + '" target="_blank">' + issue.key + '</a></td>';

        // Summary with tooltip
        var summary = escapeHtml(issue.summary || '');
        var desc = escapeHtml(issue.description || '').substring(0, 500);
        if (desc) {
            html += '<td class="desc-tooltip">' + summary;
            html += '<div class="tooltip-content">' + desc + '</div>';
            html += '</td>';
        } else {
            html += '<td>' + summary + '</td>';
        }

        html += '<td>' + escapeHtml(issue.issuetype) + '</td>';
        html += '<td>' + getStatusBadge(issue.status) + '</td>';
        html += '<td>' + escapeHtml(issue.assignee || '-') + '</td>';
        html += '<td>' + getPriorityHtml(issue.priority) + '</td>';
        html += '<td>' + (issue.labels.length > 0 ? '<span style="color:#3498db;">' + issue.labels.length + '个</span>' : '-') + '</td>';
        html += '<td>' + formatDate(issue.created) + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';

    // Pagination
    var endAt = Math.min(startAt + issues.length, total);
    html += '<div class="pagination">';
    html += '<span class="page-info">显示 ' + (startAt + 1) + '–' + endAt + '，共 ' + total + ' 条</span>';
    html += '<div class="page-btns">';
    if (startAt > 0) {
        html += '<button class="page-btn" onclick="searchIssues(' + (startAt - browsePage.maxResults) + ')">← 上一页</button>';
    }
    var currentPage = Math.floor(startAt / browsePage.maxResults) + 1;
    var totalPages = Math.ceil(total / browsePage.maxResults);
    for (var i = 1; i <= totalPages && i <= 7; i++) {
        var pageStart = (i - 1) * browsePage.maxResults;
        html += '<button class="page-btn' + (i === currentPage ? ' active' : '') + '" onclick="searchIssues(' + pageStart + ')">' + i + '</button>';
    }
    if (totalPages > 7) {
        html += '<button class="page-btn" disabled>...</button>';
    }
    if (endAt < total) {
        html += '<button class="page-btn" onclick="searchIssues(' + (startAt + browsePage.maxResults) + ')">下一页 →</button>';
    }
    html += '</div></div>';

    container.innerHTML = html;
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getStatusBadge(status) {
    if (!status) return '<span class="badge-status badge-default">未知</span>';
    var s = status.toLowerCase();
    if (s === 'to do' || s === 'open' || s === 'new') {
        return '<span class="badge-status badge-todo">' + status + '</span>';
    } else if (s === 'in progress' || s === 'in review' || s === 'reopened') {
        return '<span class="badge-status badge-inprogress">' + status + '</span>';
    } else if (s === 'done' || s === 'closed' || s === 'resolved' || s === 'rejected') {
        return '<span class="badge-status badge-done">' + status + '</span>';
    } else if (s === 'blocked') {
        return '<span class="badge-status badge-blocked">' + status + '</span>';
    }
    return '<span class="badge-status badge-default">' + status + '</span>';
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
        var y = d.getFullYear();
        var m = ('0' + (d.getMonth() + 1)).slice(-2);
        var day = ('0' + d.getDate()).slice(-2);
        var h = ('0' + d.getHours()).slice(-2);
        var min = ('0' + d.getMinutes()).slice(-2);
        return y + '-' + m + '-' + day + ' ' + h + ':' + min;
    } catch (e) {
        return dateStr;
    }
}

// ============ Tab 2: Test Plans ============

function onUploadProjectChange() {
    var project = document.getElementById('tc-project').value;
    if (project) {
        loadTestPlans();
    } else {
        document.getElementById('plan-list-container').innerHTML = '<div class="empty-state"><p>请选择项目以加载 Test Plans</p></div>';
    }
}

function loadTestPlans() {
    var project = document.getElementById('tc-project').value;
    if (!project) return;

    var container = document.getElementById('plan-list-container');
    container.innerHTML = '<div class="loading">加载 Test Plans...</div>';

    fetch('/api/testcase/testplans?project=' + encodeURIComponent(project), {
        headers: { 'Authorization': 'Bearer ' + authToken }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success && data.data) {
            currentPlans = data.data.plans || [];
            renderPlanList();
        } else {
            container.innerHTML = '<div class="empty-state"><p>加载失败: ' + (data.error || '未知错误') + '</p></div>';
        }
    })
    .catch(function(e) {
        container.innerHTML = '<div class="empty-state"><p>网络错误: ' + e.message + '</p></div>';
    });
}

function renderPlanList() {
    var container = document.getElementById('plan-list-container');

    if (currentPlans.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>该项目暂无 Test Plan (Epic)，点击上方"新建"创建一个</p></div>';
        return;
    }

    var html = '<div class="plan-list">';

    // Option: no plan selected
    html += '<div class="plan-card' + (selectedPlanKey === '' ? ' selected' : '') + '" onclick="selectPlan(\'\')">';
    html += '<div class="plan-key" style="color:#999;">不关联 Test Plan</div>';
    html += '<div class="plan-title" style="color:#999; font-size:13px;">直接创建独立 Issue</div>';
    html += '</div>';

    currentPlans.forEach(function(plan) {
        var sel = selectedPlanKey === plan.key ? ' selected' : '';
        html += '<div class="plan-card' + sel + '" onclick="selectPlan(\'' + plan.key + '\')">';
        html += '<div class="plan-key"><a href="' + plan.url + '" target="_blank" onclick="event.stopPropagation()">' + plan.key + '</a></div>';
        html += '<div class="plan-title">' + escapeHtml(plan.summary) + '</div>';
        html += '<div class="plan-meta">';
        html += '<span>' + getStatusBadge(plan.status) + '</span>';
        if (plan.assignee) html += ' · ' + escapeHtml(plan.assignee);
        html += ' · ' + formatDate(plan.created);
        html += '</div>';
        html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

function selectPlan(key) {
    selectedPlanKey = key;
    renderPlanList();
}

function toggleCreatePlan() {
    var form = document.getElementById('create-plan-form');
    form.style.display = form.style.display === 'none' || !form.style.display ? 'block' : 'none';
}

function createTestPlan() {
    var project = document.getElementById('tc-project').value;
    var name = document.getElementById('new-plan-name').value.trim();
    var desc = document.getElementById('new-plan-desc').value.trim();

    if (!project) {
        alert('请先选择项目');
        return;
    }
    if (!name) {
        alert('请输入 Plan 名称');
        return;
    }

    fetch('/api/testcase/testplan', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authToken
        },
        body: JSON.stringify({ project: project, summary: name, description: desc })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success && data.data) {
            alert('✅ Test Plan 创建成功: ' + data.data.key);
            selectedPlanKey = data.data.key;
            document.getElementById('new-plan-name').value = '';
            document.getElementById('new-plan-desc').value = '';
            toggleCreatePlan();
            loadTestPlans();
        } else {
            alert('❌ 创建失败: ' + (data.error || '未知错误'));
        }
    })
    .catch(function(e) {
        alert('❌ 网络错误: ' + e.message);
    });
}

// ============ File Upload & Parse ============

var uploadArea = document.getElementById('upload-area');
var fileInput = document.getElementById('tc-file');

uploadArea.addEventListener('click', function() { fileInput.click(); });

uploadArea.addEventListener('dragover', function(e) {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});
uploadArea.addEventListener('dragleave', function() {
    uploadArea.classList.remove('dragover');
});
uploadArea.addEventListener('drop', function(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', function() {
    if (fileInput.files.length > 0) {
        handleFile(fileInput.files[0]);
    }
});

function handleFile(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
        var text = e.target.result;
        parseCSVData(text, file.name);
    };
    reader.readAsText(file, 'UTF-8');
}

// CSV Parser — handles quoted fields, escapes, BOM
function parseCSVData(text, filename) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);

    var rows = [];
    var currentRow = [];
    var currentField = '';
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') {
                    currentField += '"'; i++;
                } else { inQuotes = false; }
            } else { currentField += ch; }
        } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',' || ch === '\t') {
                currentRow.push(currentField.trim());
                currentField = '';
            } else if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
                currentRow.push(currentField.trim());
                currentField = '';
                if (currentRow.length > 0 && currentRow.some(function(c) { return c !== ''; })) rows.push(currentRow);
                currentRow = [];
                i++;
            } else if (ch === '\n' || ch === '\r') {
                currentRow.push(currentField.trim());
                currentField = '';
                if (currentRow.length > 0 && currentRow.some(function(c) { return c !== ''; })) rows.push(currentRow);
                currentRow = [];
            } else { currentField += ch; }
        }
    }
    if (currentField) currentRow.push(currentField.trim());
    if (currentRow.length > 0 && currentRow.some(function(c) { return c !== ''; })) rows.push(currentRow);

    if (rows.length < 2) {
        alert('CSV文件为空或格式不正确');
        return;
    }

    headers = rows[0];
    parsedData = rows.slice(1).map(function(row) {
        var obj = {};
        headers.forEach(function(h, idx) {
            obj[h] = (row[idx] || '').trim();
        });
        return obj;
    });

    uploadArea.innerHTML = '<div class="icon">✅</div><p>已加载 <strong>' + parsedData.length + '</strong> 条记录</p><p class="hint">' + (filename || 'file') + ' (' + headers.length + ' 列)</p>';

    renderPreview();
}

// ============ Preview Table ============

var COLUMN_MAP = {
    '项目key': 'project', '项目': 'project', 'project': 'project',
    'issuetype': 'issuetype', 'issue类型': 'issuetype', '类型': 'issuetype',
    '标题': 'summary', 'summary': 'summary', '名称': 'summary',
    '描述': 'description', 'description': 'description',
    '优先级': 'priority', 'priority': 'priority',
    '标签': 'labels', 'labels': 'labels',
    '负责人': 'assignee', 'assignee': 'assignee',
    '父任务key': 'parentkey', 'parent': 'parentkey', '父任务': 'parentkey',
    'parentkey': 'parentkey'
};

function mapField(csvHeader) {
    var key = csvHeader.toLowerCase().trim();
    return COLUMN_MAP[key] || COLUMN_MAP[csvHeader] || key;
}

function renderPreview() {
    if (parsedData.length === 0) return;

    var section = document.getElementById('preview-section');
    section.style.display = 'block';

    document.getElementById('preview-count').textContent = parsedData.length + ' 条记录';

    var thead = document.getElementById('preview-thead');
    thead.innerHTML = '';
    var headRow = document.createElement('tr');
    var thNum = document.createElement('th');
    thNum.textContent = '#';
    thNum.style.width = '40px';
    headRow.appendChild(thNum);
    headers.forEach(function(h) {
        var th = document.createElement('th');
        th.textContent = h;
        headRow.appendChild(th);
    });
    var thStatus = document.createElement('th');
    thStatus.textContent = '状态';
    thStatus.style.width = '100px';
    headRow.appendChild(thStatus);
    thead.appendChild(headRow);

    var tbody = document.getElementById('preview-tbody');
    tbody.innerHTML = '';
    var fragment = document.createDocumentFragment();
    parsedData.forEach(function(row, idx) {
        var tr = document.createElement('tr');
        tr.setAttribute('data-row', idx);

        var tdNum = document.createElement('td');
        tdNum.className = 'row-num';
        tdNum.textContent = idx + 1;
        tr.appendChild(tdNum);

        headers.forEach(function(h) {
            var td = document.createElement('td');
            td.textContent = row[h] || '';
            td.title = row[h] || '';
            td.className = 'editable-cell';
            td.setAttribute('data-header', h);
            td.setAttribute('data-row', idx);
            td.addEventListener('dblclick', startEditCell);
            tr.appendChild(td);
        });

        var tdStatus = document.createElement('td');
        tdStatus.className = 'status-pending';
        tdStatus.textContent = '待上传';
        tdStatus.id = 'status-' + idx;
        tr.appendChild(tdStatus);

        fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);

    document.getElementById('btn-start-upload').disabled = false;
}

// ============ Inline Edit ============

function startEditCell(e) {
    var td = e.target;
    if (td.querySelector('input')) return;

    var header = td.getAttribute('data-header');
    var rowIdx = parseInt(td.getAttribute('data-row'));
    var oldValue = parsedData[rowIdx][header] || '';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'cell-edit-input';
    input.value = oldValue;

    input.addEventListener('keydown', function(ev) {
        if (ev.key === 'Enter') {
            finishEdit(td, input, rowIdx, header);
        } else if (ev.key === 'Escape') {
            td.removeChild(input);
        }
    });
    input.addEventListener('blur', function() {
        finishEdit(td, input, rowIdx, header);
    });

    td.appendChild(input);
    input.focus();
    input.select();
}

function finishEdit(td, input, rowIdx, header) {
    var newValue = input.value.trim();
    parsedData[rowIdx][header] = newValue;
    td.textContent = newValue;
    td.title = newValue;
}

// ============ Batch Upload ============

function startBatchUpload() {
    var project = document.getElementById('tc-project').value;
    if (!project) {
        alert('请先选择目标项目');
        return;
    }

    if (parsedData.length === 0) {
        alert('没有可上传的数据');
        return;
    }

    var issues = parsedData.map(function(row) {
        var issue = {
            summary: row['标题'] || row['summary'] || row['名称'] || '',
            description: row['描述'] || row['description'] || '',
            issuetype: row['Issue类型'] || row['类型'] || row['issuetype'] || document.getElementById('tc-issuetype').value,
            priority: row['优先级'] || row['priority'] || document.getElementById('tc-priority').value,
            labels: row['标签'] || row['labels'] || '',
            assignee: row['负责人'] || row['assignee'] || document.getElementById('tc-assignee').value,
            parentKey: row['父任务Key'] || row['parent'] || row['父任务'] || ''
        };

        // If a test plan is selected and no explicit parent, use the test plan as parent
        if (selectedPlanKey && !issue.parentKey) {
            issue.parentKey = selectedPlanKey;
            // Force Sub-task type if no type specified and we have a parent
            if (!row['Issue类型'] && !row['类型'] && !row['issuetype']) {
                issue.issuetype = 'Sub-task';
            }
        }

        return issue;
    });

    var validIssues = issues.filter(function(iss) { return iss.summary; });
    if (validIssues.length === 0) {
        alert('所有记录都缺少标题，无法上传');
        return;
    }

    document.getElementById('progress-section').style.display = 'block';
    document.getElementById('summary-section').style.display = 'none';
    document.getElementById('btn-start-upload').disabled = true;

    uploadResults = [];
    var total = validIssues.length;
    var completed = 0;
    var successCount = 0;
    var failCount = 0;
    var logEl = document.getElementById('progress-log');
    logEl.innerHTML = '';

    var batchSize = 10;
    var batches = [];
    for (var i = 0; i < validIssues.length; i += batchSize) {
        batches.push(validIssues.slice(i, i + batchSize));
    }

    var batchIdx = 0;
    function processNextBatch() {
        if (batchIdx >= batches.length) {
            updateProgress(total, total, successCount, failCount);
            showSummary(total, successCount, failCount);
            document.getElementById('btn-start-upload').disabled = false;
            return;
        }

        var batch = batches[batchIdx];
        batchIdx++;

        fetch('/api/testcase/batch-create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ project: project, issues: batch })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success && data.data) {
                data.data.results.forEach(function(r) {
                    completed++;
                    successCount++;
                    uploadResults.push(r);
                    updateStatusCell(r.row - 1, 'created', r.key, r.url);
                    addLog('✅ Row ' + r.row + ': ' + r.key + ' — ' + r.summary, 'ok');
                });
                data.data.errors.forEach(function(err) {
                    completed++;
                    failCount++;
                    updateStatusCell(err.row - 1, 'failed', null, null, err.error);
                    addLog('❌ Row ' + err.row + ': ' + err.summary + ' — ' + err.error, 'err');
                });
            } else {
                batch.forEach(function(iss, i) {
                    completed++;
                    failCount++;
                    addLog('❌ ' + iss.summary + ' — ' + (data.error || '请求失败'), 'err');
                });
            }
            updateProgress(total, completed, successCount, failCount);
            processNextBatch();
        })
        .catch(function(e) {
            batch.forEach(function(iss) {
                completed++;
                failCount++;
                addLog('❌ ' + iss.summary + ' — 网络错误: ' + e.message, 'err');
            });
            updateProgress(total, completed, successCount, failCount);
            processNextBatch();
        });
    }

    var planInfo = selectedPlanKey ? ' (Plan: ' + selectedPlanKey + ')' : '';
    addLog('🚀 开始上传 ' + total + ' 条 Issue 到 ' + project + planInfo, 'ok');
    processNextBatch();
}

function updateProgress(total, completed, success, fail) {
    var pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    document.getElementById('progress-bar').style.width = pct + '%';
    document.getElementById('progress-current').textContent = completed + ' / ' + total;
    document.getElementById('progress-percent').textContent = pct + '%';
}

function updateStatusCell(rowIdx, status, key, url, errorMsg) {
    var cell = document.getElementById('status-' + rowIdx);
    if (!cell) return;

    if (status === 'created') {
        cell.className = 'status-created';
        cell.innerHTML = '<a href="' + url + '" target="_blank">' + key + '</a>';
    } else if (status === 'failed') {
        cell.className = 'status-failed';
        cell.textContent = '❌ 失败';
        cell.title = errorMsg || '';
    }
}

function addLog(text, type) {
    var logEl = document.getElementById('progress-log');
    var line = document.createElement('div');
    line.className = type === 'ok' ? 'log-ok' : 'log-err';
    line.textContent = text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
}

function showSummary(total, success, fail) {
    var section = document.getElementById('summary-section');
    section.style.display = 'block';
    document.getElementById('sum-total').textContent = total;
    document.getElementById('sum-success').textContent = success;
    document.getElementById('sum-fail').textContent = fail;

    addLog('📊 上传完成: ' + success + ' 成功 / ' + fail + ' 失败 / ' + total + ' 总计', success > 0 ? 'ok' : 'err');
}

// ============ Template Download ============

function downloadTemplate() {
    window.location.href = '/api/testcase/template';
}

// ============ Init ============
checkAuth();

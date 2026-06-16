// Test Case Upload to JIRA — Frontend Logic

var authToken = localStorage.getItem('authToken') || '';
var parsedData = []; // Parsed CSV rows
var headers = [];    // CSV column headers
var uploadResults = []; // Results from batch upload

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

// Enter key login
document.getElementById('login-pass').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
});

// ============ Projects ============

function loadProjects() {
    fetch('/api/testcase/projects', {
        headers: { 'Authorization': 'Bearer ' + authToken }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success && data.data) {
            var sel = document.getElementById('tc-project');
            sel.innerHTML = '<option value="">-- 选择项目 --</option>';
            data.data.forEach(function(p) {
                var opt = document.createElement('option');
                opt.value = p.key;
                opt.textContent = p.key + ' — ' + p.name;
                sel.appendChild(opt);
            });
        }
    })
    .catch(function(e) {
        console.error('Load projects failed:', e);
        // Add common project options as fallback
        var sel = document.getElementById('tc-project');
        ['BR166', 'BR188', 'BR200', 'BRHW110', 'GPU1', 'MPW2'].forEach(function(k) {
            var opt = document.createElement('option');
            opt.value = k;
            opt.textContent = k;
            sel.appendChild(opt);
        });
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
        parseCSVData(text);
    };
    reader.readAsText(file, 'UTF-8');
}

// CSV Parser — handles quoted fields, escapes, BOM
function parseCSVData(text) {
    // Strip BOM
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
    // Last field/row
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

    uploadArea.innerHTML = '<div class="icon">✅</div><p>已加载 <strong>' + parsedData.length + '</strong> 条记录</p><p class="hint">' + file.name + ' (' + headers.length + ' 列)</p>';

    renderPreview();
}

// ============ Preview Table ============

// Column mapping: CSV header → JIRA field
var COLUMN_MAP = {
    '项目Key': 'project',
    '项目': 'project',
    'project': 'project',
    'Issue类型': 'issuetype',
    '类型': 'issuetype',
    'issuetype': 'issuetype',
    '标题': 'summary',
    'summary': 'summary',
    '名称': 'summary',
    '描述': 'description',
    'description': 'description',
    '优先级': 'priority',
    'priority': 'priority',
    '标签': 'labels',
    'labels': 'labels',
    '负责人': 'assignee',
    'assignee': 'assignee',
    '父任务Key': 'parentKey',
    'parent': 'parentKey',
    '父任务': 'parentKey'
};

function mapField(csvHeader) {
    var key = csvHeader.toLowerCase().trim();
    return COLUMN_MAP[key] || COLUMN_MAP[csvHeader] || key;
}

function renderPreview() {
    if (parsedData.length === 0) return;

    var section = document.getElementById('preview-section');
    section.style.display = 'block';

    // Count
    document.getElementById('preview-count').textContent = parsedData.length + ' 条记录';

    // Thead
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

    // Tbody
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

    // Enable upload button
    document.getElementById('btn-start-upload').disabled = false;
}

// ============ Inline Edit ============

function startEditCell(e) {
    var td = e.target;
    if (td.querySelector('input')) return; // Already editing

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

    // Build issues array
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
        return issue;
    });

    // Validate
    var validIssues = issues.filter(function(iss) { return iss.summary; });
    if (validIssues.length === 0) {
        alert('所有记录都缺少标题，无法上传');
        return;
    }

    // Show progress
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

    // Send in batches of 10
    var batchSize = 10;
    var batches = [];
    for (var i = 0; i < validIssues.length; i += batchSize) {
        batches.push(validIssues.slice(i, i + batchSize));
    }

    var batchIdx = 0;
    function processNextBatch() {
        if (batchIdx >= batches.length) {
            // Done
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
                // Batch failed entirely
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

    addLog('🚀 开始上传 ' + total + ' 条 Issue 到 ' + project, 'ok');
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

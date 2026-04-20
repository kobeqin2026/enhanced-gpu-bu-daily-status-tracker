// CSV Import Module - handles bulk upload for Domains and BU Exit Criteria

// ============ CSV Parser (handles quoted fields, escapes, BOM) ============

function parseCSV(text) {
    var rows = [];
    var currentRow = [];
    var currentField = '';
    var inQuotes = false;
    var i = 0;
    
    // Strip BOM if present
    if (text.charCodeAt(0) === 0xFEFF) {
        text = text.substring(1);
    }
    
    while (i < text.length) {
        var ch = text[i];
        
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') {
                    currentField += '"';
                    i += 2;
                } else {
                    inQuotes = false;
                    i++;
                }
            } else {
                currentField += ch;
                i++;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
                i++;
            } else if (ch === ',') {
                currentRow.push(currentField.trim());
                currentField = '';
                i++;
            } else if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
                currentRow.push(currentField.trim());
                currentField = '';
                rows.push(currentRow);
                currentRow = [];
                i += 2;
            } else if (ch === '\n' || ch === '\r') {
                currentRow.push(currentField.trim());
                currentField = '';
                rows.push(currentRow);
                currentRow = [];
                i++;
            } else {
                currentField += ch;
                i++;
            }
        }
    }
    
    // Handle last field/row
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
    }
    
    // Remove empty trailing rows
    while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
        rows.pop();
    }
    
    return rows;
}

// ============ File Reading with Encoding ============

function readFileAsText(file, encoding) {
    return new Promise(function(resolve, reject) {
        if (encoding === 'UTF-8') {
            var reader = new FileReader();
            reader.onload = function(e) {
                resolve(e.target.result);
            };
            reader.onerror = function() {
                reject(new Error('文件读取失败'));
            };
            reader.readAsText(file, 'UTF-8');
        } else {
            // GBK / GB2312 using TextDecoder API
            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    var decoder = new TextDecoder(encoding);
                    var text = decoder.decode(e.target.result);
                    resolve(text);
                } catch (err) {
                    // Fallback: try UTF-8
                    var fallbackReader = new FileReader();
                    fallbackReader.onload = function(e2) {
                        resolve(e2.target.result);
                    };
                    fallbackReader.readAsText(file, 'UTF-8');
                }
            };
            reader.onerror = function() {
                reject(new Error('文件读取失败'));
            };
            reader.readAsArrayBuffer(file);
        }
    });
}

// ============ Template Downloads ============

function downloadDomainTemplate() {
    var csv = '\uFEFF' + 'Domain名称,负责人\n';
    csv += '硅验证 (Silicon Validation),张三\n';
    csv += '电源管理 (Power Management),李四\n';
    csv += '内存子系统 (Memory Subsystem),王五\n';
    downloadCSV(csv, 'domain_import_template.csv');
}

function downloadBUTemplate() {
    var csv = '\uFEFF' + 'Domain,准出标准内容\n';
    csv += '硅验证 (Silicon Validation),所有基本功能测试通过，无critical bug\n';
    csv += '电源管理 (Power Management),功耗测试符合规格要求，温度控制正常\n';
    csv += 'PCIe接口 (PCIe Interface),PCIe链路稳定性测试通过，带宽达标\n';
    downloadCSV(csv, 'bu_exit_criteria_import_template.csv');
}

function downloadCSV(csvContent, filename) {
    var blob;
    // Check if we need to handle BOM
    if (csvContent.charCodeAt(0) === 0xFEFF) {
        blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    } else {
        blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
    }
    
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============ Preview & Validation ============

function showPreview(containerId, rows, headers) {
    var container = document.getElementById(containerId);
    if (rows.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    var html = '<table style="width:100%; border-collapse:collapse; font-size:12px;">';
    
    // Header
    html += '<tr style="background:#3498db; color:white;">';
    for (var h = 0; h < headers.length; h++) {
        html += '<th style="padding:6px; text-align:left;">' + escapeHtml(headers[h]) + '</th>';
    }
    html += '</tr>';
    
    // Rows (show max 10)
    var maxRows = Math.min(rows.length, 10);
    for (var i = 0; i < maxRows; i++) {
        html += '<tr style="border-bottom:1px solid #eee;">';
        for (var j = 0; j < headers.length; j++) {
            var val = rows[i][j] || '';
            html += '<td style="padding:6px;">' + escapeHtml(val) + '</td>';
        }
        html += '</tr>';
    }
    
    if (rows.length > 10) {
        html += '<tr><td colspan="' + headers.length + '" style="padding:6px; color:#999; text-align:center;">... 还有 ' + (rows.length - 10) + ' 条记录</td></tr>';
    }
    
    html += '</table>';
    container.innerHTML = html;
}

// ============ Domain Import ============

function showDomainImportModal() {
    document.getElementById('domain-import-file').value = '';
    document.getElementById('domain-import-clear').checked = false;
    document.getElementById('domain-import-encoding').value = 'UTF-8';
    document.getElementById('domain-import-preview').style.display = 'none';
    document.getElementById('domain-import-preview').innerHTML = '';
    openModal('domain-import-modal');
}

function closeDomainImportModal() {
    closeModal('domain-import-modal');
    document.getElementById('domain-import-file').value = '';
    document.getElementById('domain-import-preview').style.display = 'none';
}

async function previewDomainFile() {
    var fileInput = document.getElementById('domain-import-file');
    var file = fileInput.files[0];
    if (!file) return;
    
    try {
        var encoding = document.getElementById('domain-import-encoding').value;
        var text = await readFileAsText(file, encoding);
        var rows = parseCSV(text);
        
        if (rows.length === 0) {
            alert('CSV文件为空');
            return;
        }
        
        // Check if first row is header
        var dataRows = rows;
        var hasHeader = false;
        var firstRow = rows[0];
        if (firstRow.length > 0) {
            var firstCell = firstRow[0].toLowerCase();
            if (firstCell.indexOf('domain') !== -1 || firstCell.indexOf('名称') !== -1 || firstCell.indexOf('名') !== -1) {
                hasHeader = true;
                dataRows = rows.slice(1);
            }
        }
        
        // Validate: each row needs at least Domain name
        var validRows = [];
        var errors = [];
        dataRows.forEach(function(row, idx) {
            var rowNum = hasHeader ? idx + 2 : idx + 1;
            if (row.length >= 1 && row[0]) {
                validRows.push(row);
            } else {
                errors.push('第 ' + rowNum + ' 行缺少Domain名称');
            }
        });
        
        if (validRows.length === 0) {
            alert('没有有效的数据行\n' + errors.join('\n'));
            return;
        }
        
        // Show preview
        showPreview('domain-import-preview', validRows, ['Domain名称', '负责人']);
        
        // Store parsed data for import
        window._domainImportData = validRows;
        
        if (errors.length > 0) {
            showSyncStatus('检测到 ' + validRows.length + ' 条有效数据，' + errors.length + ' 条跳过', 'warning');
        } else {
            showSyncStatus('检测到 ' + validRows.length + ' 条有效数据', 'success');
        }
    } catch (error) {
        alert('读取文件失败: ' + error.message);
    }
}

async function importDomainsFromCSV() {
    var data = window._domainImportData;
    if (!data || data.length === 0) {
        alert('请先选择CSV文件并预览');
        return;
    }
    
    var clearExisting = document.getElementById('domain-import-clear').checked;
    
    if (clearExisting && App.data.domains.length > 0) {
        if (!confirm('确定要清除现有的 ' + App.data.domains.length + ' 条Domain数据吗？')) {
            return;
        }
    }
    
    var added = 0;
    var skipped = 0;
    
    if (clearExisting) {
        App.data.domains = [];
    }
    
    // Track existing names to avoid duplicates
    var existingNames = {};
    App.data.domains.forEach(function(d) {
        existingNames[d.name.toLowerCase()] = true;
    });
    
    data.forEach(function(row) {
        var name = (row[0] || '').trim();
        var owner = (row[1] || 'TBD').trim();
        
        if (!name) {
            skipped++;
            return;
        }
        
        if (existingNames[name.toLowerCase()]) {
            skipped++;
            return;
        }
        
        var newDomain = {
            id: 'domain-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
            name: name,
            owner: owner || 'TBD',
            status: 'not-started',
            notes: ''
        };
        
        App.data.domains.push(newDomain);
        existingNames[name.toLowerCase()] = true;
        added++;
    });
    
    renderDomains(App.data.domains);
    persistData();
    closeDomainImportModal();
    
    var message = '成功导入 ' + added + ' 条Domain';
    if (skipped > 0) {
        message += '，跳过 ' + skipped + ' 条（重复或无效）';
    }
    alert(message);
}

// ============ BU Exit Criteria Import ============

function showBUImportModal() {
    document.getElementById('bu-import-file').value = '';
    document.getElementById('bu-import-clear').checked = false;
    document.getElementById('bu-import-encoding').value = 'UTF-8';
    document.getElementById('bu-import-preview').style.display = 'none';
    document.getElementById('bu-import-preview').innerHTML = '';
    openModal('bu-import-modal');
}

function closeBUImportModal() {
    closeModal('bu-import-modal');
    document.getElementById('bu-import-file').value = '';
    document.getElementById('bu-import-preview').style.display = 'none';
}

async function previewBUFile() {
    var fileInput = document.getElementById('bu-import-file');
    var file = fileInput.files[0];
    if (!file) return;
    
    try {
        var encoding = document.getElementById('bu-import-encoding').value;
        var text = await readFileAsText(file, encoding);
        var rows = parseCSV(text);
        
        if (rows.length === 0) {
            alert('CSV文件为空');
            return;
        }
        
        // Check if first row is header
        var dataRows = rows;
        var hasHeader = false;
        var firstRow = rows[0];
        if (firstRow.length > 0) {
            var firstCell = firstRow[0].toLowerCase();
            if (firstCell.indexOf('domain') !== -1 || firstCell.indexOf('域') !== -1 || firstCell.indexOf('标准') !== -1) {
                hasHeader = true;
                dataRows = rows.slice(1);
            }
        }
        
        // Validate: each row needs Domain + criteria content
        var validRows = [];
        var errors = [];
        dataRows.forEach(function(row, idx) {
            var rowNum = hasHeader ? idx + 2 : idx + 1;
            if (row.length >= 2 && row[0] && row[1]) {
                validRows.push(row);
            } else {
                errors.push('第 ' + rowNum + ' 行缺少Domain或准出标准内容');
            }
        });
        
        if (validRows.length === 0) {
            alert('没有有效的数据行\n' + errors.join('\n'));
            return;
        }
        
        // Show preview
        showPreview('bu-import-preview', validRows, ['Domain', '准出标准内容']);
        
        window._buImportData = validRows;
        
        if (errors.length > 0) {
            showSyncStatus('检测到 ' + validRows.length + ' 条有效数据，' + errors.length + ' 条跳过', 'warning');
        } else {
            showSyncStatus('检测到 ' + validRows.length + ' 条有效数据', 'success');
        }
    } catch (error) {
        alert('读取文件失败: ' + error.message);
    }
}

async function importBUFromCSV() {
    var data = window._buImportData;
    if (!data || data.length === 0) {
        alert('请先选择CSV文件并预览');
        return;
    }
    
    var clearExisting = document.getElementById('bu-import-clear').checked;
    
    if (clearExisting && App.data.buExitCriteria.length > 0) {
        if (!confirm('确定要清除现有的 ' + App.data.buExitCriteria.length + ' 条准出标准数据吗？')) {
            return;
        }
    }
    
    var added = 0;
    var skipped = 0;
    
    if (clearExisting) {
        App.data.buExitCriteria = [];
    }
    
    var startIndex = App.data.buExitCriteria.length + 1;
    
    data.forEach(function(row, idx) {
        var domain = (row[0] || '').trim();
        var criteria = (row[1] || '').trim();
        
        if (!domain || !criteria) {
            skipped++;
            return;
        }
        
        // Auto-find owner from domains table
        var owner = '';
        var matchedDomain = App.data.domains.find(function(d) {
            return d.name === domain || d.name.indexOf(domain) !== -1 || domain.indexOf(d.name) !== -1;
        });
        if (matchedDomain) {
            owner = matchedDomain.owner || '';
        }
        
        var newCriteria = {
            id: 'criteria-' + Date.now() + '-' + idx,
            index: startIndex + added,
            domain: domain,
            criteria: criteria,
            owner: owner,
            status: 'not-ready'
        };
        
        App.data.buExitCriteria.push(newCriteria);
        added++;
    });
    
    // Re-index
    App.data.buExitCriteria.forEach(function(c, i) {
        c.index = i + 1;
    });
    
    renderBUExitCriteria(App.data.buExitCriteria);
    persistData();
    closeBUImportModal();
    
    var message = '成功导入 ' + added + ' 条准出标准';
    if (skipped > 0) {
        message += '，跳过 ' + skipped + ' 条（无效数据）';
    }
    alert(message);
}

// ============ Bug Import ============

function downloadBugTemplate() {
    var csv = '\uFEFF' + 'Bug ID,Domain,描述,严重性,状态,报告日期,负责人\n';
    csv += 'MPW2-77,PCIe接口 (PCIe Interface),PCIe链路训练失败，卡在Gen1,High,open,2026-04-15,Ge Qiang\n';
    csv += 'MPW2-78,HBM,HBM初始化报错ECC failure,Highest,open,2026-04-16,Xiaoming\n';
    csv += 'MPW2-79,FW,Bootrom启动超时,Medium,open,,Haiping\n';
    downloadCSV(csv, 'bug_import_template.csv');
}

function showBugImportModal() {
    document.getElementById('bug-import-file').value = '';
    document.getElementById('bug-import-clear').checked = false;
    document.getElementById('bug-import-encoding').value = 'UTF-8';
    document.getElementById('bug-import-preview').style.display = 'none';
    document.getElementById('bug-import-preview').innerHTML = '';
    openModal('bug-import-modal');
}

function closeBugImportModal() {
    closeModal('bug-import-modal');
    document.getElementById('bug-import-file').value = '';
    document.getElementById('bug-import-preview').style.display = 'none';
}

async function previewBugFile() {
    var fileInput = document.getElementById('bug-import-file');
    var file = fileInput.files[0];
    if (!file) return;

    try {
        var encoding = document.getElementById('bug-import-encoding').value;
        var text = await readFileAsText(file, encoding);
        var rows = parseCSV(text);

        if (rows.length === 0) {
            alert('CSV文件为空');
            return;
        }

        // Check if first row is header
        var dataRows = rows;
        var hasHeader = false;
        var firstRow = rows[0];
        if (firstRow.length > 0) {
            var firstCell = firstRow[0].toLowerCase();
            if (firstCell.indexOf('bug') !== -1 || firstCell.indexOf('id') !== -1 || firstCell.indexOf('bug id') !== -1) {
                hasHeader = true;
                dataRows = rows.slice(1);
            }
        }

        // Validate: each row needs at least Bug ID + Domain + Description
        var validRows = [];
        var errors = [];
        dataRows.forEach(function(row, idx) {
            var rowNum = hasHeader ? idx + 2 : idx + 1;
            if (row.length >= 3 && row[0] && row[1] && row[2]) {
                validRows.push(row);
            } else {
                errors.push('第 ' + rowNum + ' 行缺少Bug ID/Domain/描述');
            }
        });

        if (validRows.length === 0) {
            alert('没有有效的数据行\n' + errors.join('\n'));
            return;
        }

        // Show preview
        showPreview('bug-import-preview', validRows, ['Bug ID', 'Domain', '描述', '严重性', '状态', '报告日期', '负责人']);

        window._bugImportData = validRows;

        if (errors.length > 0) {
            showSyncStatus('检测到 ' + validRows.length + ' 条有效数据，' + errors.length + ' 条跳过', 'warning');
        } else {
            showSyncStatus('检测到 ' + validRows.length + ' 条有效数据', 'success');
        }
    } catch (error) {
        alert('读取文件失败: ' + error.message);
    }
}

async function importBugsFromCSV() {
    var data = window._bugImportData;
    if (!data || data.length === 0) {
        alert('请先选择CSV文件并预览');
        return;
    }

    var clearExisting = document.getElementById('bug-import-clear').checked;

    if (clearExisting && App.data.bugs.length > 0) {
        if (!confirm('确定要清除现有的 ' + App.data.bugs.length + ' 条Bug数据吗？')) {
            return;
        }
    }

    var added = 0;
    var updated = 0;
    var skipped = 0;

    if (clearExisting) {
        App.data.bugs = [];
    }

    var today = new Date().toISOString().split('T')[0];

    // Helper to map status values
    function mapStatus(s) {
        s = (s || '').toLowerCase().trim();
        if (['open', 'opened'].includes(s)) return 'open';
        if (['triage', 'triaged'].includes(s)) return 'triage';
        if (['implement', 'implemented', '开发中'].includes(s)) return 'implement';
        if (['closed'].includes(s)) return 'closed';
        if (['rejected'].includes(s)) return 'rejected';
        return 'open'; // Default
    }

    // Helper to map severity values
    function mapSeverity(s) {
        s = (s || '').toLowerCase().trim();
        if (['highest', 'high', 'medium', 'low', 'lowest'].includes(s)) return s;
        return 'medium'; // Default
    }

    data.forEach(function(row, idx) {
        var bugId = (row[0] || '').trim();
        var domain = (row[1] || '').trim();
        var description = (row[2] || '').trim();
        var severity = mapSeverity(row[3]);
        var status = mapStatus(row[4]);
        var reportDate = (row[5] || '').trim();
        var owner = (row[6] || '').trim();

        if (!bugId || !domain || !description) {
            skipped++;
            return;
        }

        // Default owner
        if (!owner) {
            // Try to find owner from domains table
            var matchedDomain = App.data.domains.find(function(d) {
                return d.name === domain || d.name.indexOf(domain) !== -1 || domain.indexOf(d.name) !== -1;
            });
            owner = matchedDomain ? (matchedDomain.owner || 'TBD') : 'TBD';
        }

        // Default reportDate to today if empty or invalid
        if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
            reportDate = today;
        }

        // Check if bug with same ID already exists
        var existingBug = App.data.bugs.find(function(b) {
            return b.bugId === bugId;
        });

        if (existingBug) {
            // Update existing bug fields
            existingBug.domain = domain;
            existingBug.description = description;
            existingBug.severity = severity;
            existingBug.status = status;
            existingBug.reportDate = reportDate;
            existingBug.owner = owner;
            updated++;
        } else {
            // Create new bug
            var newBug = {
                id: 'bug-' + Date.now() + '-' + idx,
                bugId: bugId,
                domain: domain,
                description: description,
                severity: severity,
                status: status,
                reportDate: reportDate,
                owner: owner
            };
            App.data.bugs.push(newBug);
            added++;
        }
    });

    renderBugs(App.data.bugs);
    persistData();
    closeBugImportModal();

    var message = '成功导入 ' + added + ' 条新Bug';
    if (updated > 0) {
        message += '，更新 ' + updated + ' 条已有Bug';
    }
    if (skipped > 0) {
        message += '，跳过 ' + skipped + ' 条（无效数据）';
    }
    alert(message);
}

// ============ JIRA Import ============

var jiraProjectsCache = [];

function showJiraProjectModal() {
    if (!isLoggedIn()) {
        alert('请先登录');
        return;
    }
    document.getElementById('jira-project-modal').style.display = 'block';
    document.getElementById('jira-project-loading').style.display = 'block';
    document.getElementById('jira-project-error').style.display = 'none';
    document.getElementById('jira-project-list').style.display = 'none';
    document.getElementById('jira-project-search').value = '';
    loadJiraProjects();
}

function closeJiraProjectModal() {
    document.getElementById('jira-project-modal').style.display = 'none';
}

async function loadJiraProjects() {
    try {
        var token = localStorage.getItem('token');
        var response = await fetch('/api/data/jira-projects', {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            }
        });
        var result = await response.json();

        if (!result.success) {
            throw new Error(result.error || '获取项目列表失败');
        }

        jiraProjectsCache = result.projects || [];
        document.getElementById('jira-project-loading').style.display = 'none';
        document.getElementById('jira-project-list').style.display = 'block';
        renderJiraProjectItems(jiraProjectsCache);
    } catch (error) {
        document.getElementById('jira-project-loading').style.display = 'none';
        var errorDiv = document.getElementById('jira-project-error');
        errorDiv.style.display = 'block';
        errorDiv.textContent = '获取JIRA项目失败: ' + error.message;
    }
}

function renderJiraProjectItems(projects) {
    var container = document.getElementById('jira-project-items');
    if (projects.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">没有找到匹配的项目</div>';
        return;
    }

    container.innerHTML = '';
    projects.forEach(function(p) {
        var item = document.createElement('div');
        item.className = 'jira-project-item';
        item.style.cssText = 'padding: 10px 12px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; align-items: center;';
        item.addEventListener('mouseover', function() { item.style.background = '#f0f7ff'; });
        item.addEventListener('mouseout', function() { item.style.background = ''; });
        item.addEventListener('click', function() { selectJiraProject(p.key, p.name); });

        var infoDiv = document.createElement('div');
        var keySpan = document.createElement('strong');
        keySpan.style.color = '#27ae60';
        keySpan.textContent = p.key;
        infoDiv.appendChild(keySpan);

        var nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'color:#333; margin-left: 8px;';
        nameSpan.textContent = p.name;
        infoDiv.appendChild(nameSpan);

        if (p.lead) {
            var leadSpan = document.createElement('span');
            leadSpan.style.cssText = 'color:#999; font-size: 12px;';
            leadSpan.textContent = ' (' + p.lead + ')';
            infoDiv.appendChild(leadSpan);
        }

        item.appendChild(infoDiv);

        var arrowSpan = document.createElement('span');
        arrowSpan.style.cssText = 'color:#27ae60; font-weight: bold; font-size: 14px;';
        arrowSpan.textContent = '导入 >';
        item.appendChild(arrowSpan);

        container.appendChild(item);
    });
}

function filterJiraProjects() {
    var query = document.getElementById('jira-project-search').value.toLowerCase();
    var filtered = jiraProjectsCache.filter(function(p) {
        return p.key.toLowerCase().indexOf(query) !== -1 ||
               p.name.toLowerCase().indexOf(query) !== -1 ||
               (p.lead && p.lead.toLowerCase().indexOf(query) !== -1);
    });
    renderJiraProjectItems(filtered);
}

function selectJiraProject(projectKey, projectName) {
    var includeClosed = document.getElementById('jira-include-closed').checked;
    closeJiraProjectModal();
    importBugsFromJIRA(projectKey, projectName, includeClosed);
}

async function importBugsFromJIRA(projectKey, projectName, includeClosed) {
    var btn = event ? event.target : null;
    var originalText = btn ? btn.textContent : '';
    if (btn) {
        btn.textContent = '正在导入...';
        btn.disabled = true;
    }

    try {
        var token = localStorage.getItem('token');
        var response = await fetch('/api/data/import-jira', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ project: projectKey, includeClosed: includeClosed })
        });

        var result = await response.json();

        if (!result.success) {
            alert('JIRA导入失败: ' + (result.error || '未知错误'));
            return;
        }

        var jiraBugs = result.bugs || [];
        if (jiraBugs.length === 0) {
            alert(projectName + ' 项目中没有找到匹配的Bug');
            return;
        }

        // Show preview dialog
        var previewMsg = '从JIRA项目 [' + projectName + '] 获取到 ' + jiraBugs.length + ' 条Bug（JIRA总计: ' + (result.total || jiraBugs.length) + '）\n\n';
        previewMsg += '前5条预览:\n';
        for (var i = 0; i < Math.min(5, jiraBugs.length); i++) {
            var b = jiraBugs[i];
            previewMsg += '  ' + b.bugId + ' | ' + b.description.substring(0, 50) + ' | ' + b.owner + '\n';
        }
        if (jiraBugs.length > 5) {
            previewMsg += '  ... 还有 ' + (jiraBugs.length - 5) + ' 条\n';
        }
        previewMsg += '\n是否导入到当前项目？\n（已有Bug会根据Bug ID自动更新）';

        if (!confirm(previewMsg)) {
            return;
        }

        // Merge bugs
        var added = 0;
        var updated = 0;
        var skipped = 0;

        jiraBugs.forEach(function(jiraBug) {
            var existingBug = App.data.bugs.find(function(b) {
                return b.bugId === jiraBug.bugId;
            });

            if (existingBug) {
                // Update existing bug
                existingBug.domain = jiraBug.domain;
                existingBug.description = jiraBug.description;
                existingBug.severity = jiraBug.severity;
                existingBug.status = jiraBug.status;
                existingBug.reportDate = jiraBug.reportDate;
                existingBug.owner = jiraBug.owner;
                updated++;
            } else {
                // Add new bug
                App.data.bugs.push(jiraBug);
                added++;
            }
        });

        renderBugs(App.data.bugs);
        persistData();

        var message = '成功从 [' + projectName + '] 导入 ' + added + ' 条新Bug';
        if (updated > 0) {
            message += '，更新 ' + updated + ' 条已有Bug';
        }
        if (skipped > 0) {
            message += '，跳过 ' + skipped + ' 条';
        }
        alert(message);

    } catch (error) {
        console.error('JIRA import error:', error);
        alert('JIRA导入出错: ' + error.message);
    } finally {
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
}

// ============ Sync JIRA Bug Status ============

async function syncJiraStatus() {
    if (!isLoggedIn()) {
        alert('请先登录');
        return;
    }

    // Collect all JIRA bug keys
    var jiraBugs = App.data.bugs.filter(function(b) { return b.jiraKey; });
    if (jiraBugs.length === 0) {
        alert('当前没有从JIRA导入的Bug，无需同步');
        return;
    }

    if (!confirm('将同步 ' + jiraBugs.length + ' 条JIRA Bug的状态和负责人，是否继续？')) {
        return;
    }

    var jiraKeys = jiraBugs.map(function(b) { return b.jiraKey; });

    try {
        var token = localStorage.getItem('token');
        var response = await fetch('/api/data/sync-jira-status', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ jiraKeys: jiraKeys })
        });

        var result = await response.json();

        if (!result.success) {
            alert('同步失败: ' + (result.error || '未知错误'));
            return;
        }

        var statusMap = result.bugs || {};
        var synced = 0;
        var changed = 0;
        var notFound = 0;

        App.data.bugs.forEach(function(bug) {
            if (!bug.jiraKey) return;
            var info = statusMap[bug.jiraKey];
            if (!info) {
                notFound++;
                return;
            }

            synced++;
            var oldStatus = bug.status;
            var oldOwner = bug.owner;

            // Update status and owner from JIRA
            bug.status = info.status;
            bug.jiraStatus = info.jiraStatus;
            if (info.owner) {
                bug.owner = info.owner;
            }

            if (oldStatus !== bug.status || oldOwner !== bug.owner) {
                changed++;
            }
        });

        renderBugs(App.data.bugs);
        await persistData();

        var message = '同步完成！共 ' + synced + ' 条，更新 ' + changed + ' 条';
        if (notFound > 0) {
            message += '，JIRA中未找到 ' + notFound + ' 条';
        }
        alert(message);

    } catch (error) {
        console.error('JIRA sync error:', error);
        alert('同步出错: ' + error.message);
    }
}

// ============ Clear All Bugs ============

async function clearAllBugs() {
    if (!isLoggedIn()) {
        alert('请先登录');
        return;
    }

    if (!confirm('确定要清空所有Bug数据吗？此操作不可恢复！')) {
        return;
    }

    if (!confirm('再次确认：真的要清空所有 ' + App.data.bugs.length + ' 条Bug吗？')) {
        return;
    }

    App.data.bugs = [];
    renderBugs(App.data.bugs);
    await persistData();

    alert('已清空所有Bug数据');
}

// ============ Backward compatibility for old function names ============
// These are kept for any remaining references to the old modal names

function showBulkUploadBUModal() {
    showBUImportModal();
}

function closeBulkUploadBUModal() {
    closeBUImportModal();
}

function processBulkUploadBU() {
    importBUFromCSV();
}

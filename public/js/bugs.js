// Bug rendering, filtering, sorting

// ====== BU 时间轴过滤 (依据项目 BU执行时间 startDate~endDate) ======
// Bug 表只显示 BU 执行时间范围内的 bug (reportDate), 与一键总结统计口径一致

function getCurrentBuPeriod() {
    var project = (App.projectsList || []).find(function(p) { return p.id === App.currentProject; });
    if (project && project.startDate && project.endDate) {
        return { start: project.startDate, end: project.endDate };
    }
    return null;
}

// reportDate 为 YYYY-MM-DD, 可直接字典序比较
function isBugInBuPeriod(bug, period) {
    if (!period || !period.start || !period.end) return true; // 未设置BU时间 → 显示全部 (兼容老项目)
    var d = bug.reportDate || '';
    if (!d) return true;                                      // 缺日期保留, 避免数据"消失"
    return d >= period.start && d <= period.end;
}

function updateBuBugRangeHint(allBugs) {
    var hintEl = document.getElementById('bu-bug-range-hint');
    if (!hintEl) return;
    var period = getCurrentBuPeriod();
    var rangeCheckbox = document.getElementById('filter-bug-bu-range');
    var buRangeOn = rangeCheckbox ? rangeCheckbox.checked : true;
    if (period) {
        var text = '📅 BU时间轴: ' + period.start + ' ~ ' + period.end;
        if (buRangeOn) {
            var hiddenCount = (allBugs || []).filter(function(b) { return !isBugInBuPeriod(b, period); }).length;
            text += ' — 仅显示BU执行时间内的Bug';
            if (hiddenCount > 0) text += ' (时间轴外已隐藏 ' + hiddenCount + ' 条)';
        } else {
            text += ' — 已显示全部Bug (取消勾选"仅显示BU执行时间内的Bug"即展示时间轴外Bug)';
        }
        hintEl.textContent = text;
    } else {
        hintEl.textContent = '📅 未设置BU执行时间, 显示全部Bug (可在项目信息区设置BU执行时间)';
    }
}

function applyFiltersToBugs(bugs) {
    return bugs.filter(function(bug) {
        var normalizedSeverity = (bug.severity || '').toLowerCase();
        var filterSeverity = (App.currentBugFilters.severity || '').toLowerCase();
        
        if (App.currentBugFilters.bugId && bug.bugId.toLowerCase().indexOf(App.currentBugFilters.bugId.toLowerCase()) === -1) return false;
        if (App.currentBugFilters.domain && bug.domain.toLowerCase().indexOf(App.currentBugFilters.domain.toLowerCase()) === -1) return false;
        if (App.currentBugFilters.description && bug.description.toLowerCase().indexOf(App.currentBugFilters.description.toLowerCase()) === -1) return false;
        // "critical" = Highest/High (默认只显示Critical，可在筛选框切换)
        if (App.currentBugFilters.severity === 'critical') {
            if (normalizedSeverity !== 'highest' && normalizedSeverity !== 'high') return false;
        } else if (App.currentBugFilters.severity && normalizedSeverity !== filterSeverity) return false;
        if (App.currentBugFilters.status && bug.status !== App.currentBugFilters.status) return false;
        if (App.currentBugFilters.owner && bug.owner.toLowerCase().indexOf(App.currentBugFilters.owner.toLowerCase()) === -1) return false;
        
        // Hide closed/rejected bugs by default, unless explicitly filtered or checkbox is checked
        var isClosedStatus = (bug.status === 'closed' || bug.status === 'rejected');
        var isFilteringForClosed = (App.currentBugFilters.status === 'closed' || App.currentBugFilters.status === 'rejected');
        
        if (!App.currentBugFilters.showClosed && !isFilteringForClosed && isClosedStatus) {
            return false;
        }
        
        // BU 时间轴: 勾选"仅显示BU执行时间内的Bug"时才过滤 (默认勾选, 与一键总结口径一致)
        if (App.currentBugFilters.buRange !== false && !isBugInBuPeriod(bug, getCurrentBuPeriod())) return false;
        
        return true;
    });
}

function sortBugs(bugs) {
    var severityPriority = { 'highest': 0, 'high': 1, 'medium': 2, 'low': 3, 'lowest': 4 };
    
    if (!App.currentBugSort.field) {
        return bugs.sort(function(a, b) {
            // 1. Status: Closed/Rejected go to bottom
            var statusPriorityA = (a.status === 'closed' || a.status === 'rejected') ? 1 : 0;
            var statusPriorityB = (b.status === 'closed' || b.status === 'rejected') ? 1 : 0;
            if (statusPriorityA !== statusPriorityB) return statusPriorityA - statusPriorityB;
            
            // 2. Severity
            var priorityA = severityPriority[(a.severity || '').toLowerCase()] !== undefined ? severityPriority[(a.severity || '').toLowerCase()] : 999;
            var priorityB = severityPriority[(b.severity || '').toLowerCase()] !== undefined ? severityPriority[(b.severity || '').toLowerCase()] : 999;
            if (priorityA !== priorityB) return priorityA - priorityB;
            
            // 3. Date
            return new Date(b.reportDate) - new Date(a.reportDate);
        });
    }
    
    return bugs.sort(function(a, b) {
        var valA = a[App.currentBugSort.field];
        var valB = b[App.currentBugSort.field];
        
        if (App.currentBugSort.field === 'bugId') {
            valA = valA || '';
            valB = valB || '';
        } else if (App.currentBugSort.field === 'severity') {
            valA = severityPriority[(valA || '').toLowerCase()] !== undefined ? severityPriority[(valA || '').toLowerCase()] : 999;
            valB = severityPriority[(valB || '').toLowerCase()] !== undefined ? severityPriority[(valB || '').toLowerCase()] : 999;
        } else if (App.currentBugSort.field === 'reportDate') {
            valA = new Date(valA);
            valB = new Date(valB);
        } else {
            valA = (valA || '').toString().toLowerCase();
            valB = (valB || '').toString().toLowerCase();
        }
        
        var comparison = valA > valB ? 1 : valA < valB ? -1 : 0;
        return App.currentBugSort.direction === 'asc' ? comparison : -comparison;
    });
}

function updateBugSortIndicators() {
    document.querySelectorAll('.bug-table th').forEach(function(th) {
        th.classList.remove('sort-asc', 'sort-desc');
    });
    
    if (App.currentBugSort.field) {
        var th = document.querySelector('.bug-table th[data-sort="' + App.currentBugSort.field + '"]');
        if (th) {
            th.classList.add(App.currentBugSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    }
}

function renderBugs(bugs) {
    var tbody = getTableBody('bugs-body');
    updateBuBugRangeHint(bugs);
    
    if (bugs.length === 0) {
        tbody.appendChild(emptyTableRow(isAdmin() ? 9 : 8, '暂无Bug记录'));
        return;
    }
    
    var sortedBugs = sortBugs(applyFiltersToBugs(bugs));
    updateBugSortIndicators();
    
    if (sortedBugs.length === 0) {
        // 有数据但被筛选/BU时间轴过滤掉 → 明确提示
        var period = getCurrentBuPeriod();
        var hint = '';
        var rangeCheckbox = document.getElementById('filter-bug-bu-range');
        var buRangeOn = rangeCheckbox ? rangeCheckbox.checked : true;
        if (period && buRangeOn) {
            var outside = bugs.filter(function(b) { return !isBugInBuPeriod(b, period); }).length;
            if (outside > 0) hint = 'BU时间轴 (' + period.start + ' ~ ' + period.end + ') 内暂无Bug, 时间轴外有 ' + outside + ' 条已隐藏 (取消勾选可查看)';
        }
        if (!hint) hint = '没有符合筛选条件的Bug (可尝试重置筛选)';
        tbody.appendChild(emptyTableRow(isAdmin() ? 9 : 8, hint));
        return;
    }
    
    sortedBugs.forEach(function(bug) {
        var row = document.createElement('tr');
        row.setAttribute('data-bug-id', bug.id);
        // Mark closed/rejected rows for styling
        if (bug.status === 'closed' || bug.status === 'rejected') {
            row.classList.add('status-closed-row');
        }
        
        // Bug ID cell (JIRA link or plain text - safe)
        var idCell = document.createElement('td');
        var jiraLink = createJiraLink(bug.bugId, bug.jiraUrl);
        idCell.appendChild(jiraLink);
        row.appendChild(idCell);
        
        // Description (safe)
        var descCell = document.createElement('td');
        descCell.className = 'bug-description';
        descCell.textContent = bug.description || '';
        row.appendChild(descCell);
        
        // Domain (safe)
        var domainCell = document.createElement('td');
        domainCell.textContent = bug.domain || '';
        row.appendChild(domainCell);
        
        // Severity (safe)
        var sevCell = document.createElement('td');
        var severityDisplay = App.severityText[bug.severity] || bug.severity;
        var severityClass = App.severityColorClasses[bug.severity] || '';
        sevCell.className = severityClass;
        sevCell.textContent = severityDisplay || '';
        row.appendChild(sevCell);
        
        // Status (safe)
        var statusCell = document.createElement('td');
        statusCell.className = 'bug-status-static';
        statusCell.textContent = App.bugStatusText[bug.status] || bug.status || '';
        row.appendChild(statusCell);
        
        // Report date (safe)
        var dateCell = document.createElement('td');
        dateCell.textContent = bug.reportDate || '';
        row.appendChild(dateCell);
        
        // Owner (safe)
        var ownerCell = document.createElement('td');
        ownerCell.textContent = bug.owner || '';
        row.appendChild(ownerCell);
        
        // Debug Progress (safe - LLM summary from JIRA comments or manual input)
        // 2026-10-01: 渲染为时间戳记录列表(新→旧), 每条 AI归纳 前带时间戳; 仅管理员可见 AI归纳/添加/每条编辑按钮
        // 2026-10-02: 每条记录各自带 ✏️(编辑该条), 行级不再提供单一"编辑"
        var progressCell = document.createElement('td');
        progressCell.className = 'debug-progress-cell';
        var progressRecords = bugProgressRecords(bug);
        if (progressRecords.length === 0) {
            var emptyProgress = document.createElement('span');
            emptyProgress.className = 'debug-progress-text';
            emptyProgress.textContent = '—';
            progressCell.appendChild(emptyProgress);
        } else {
            for (var ri = progressRecords.length - 1; ri >= 0; ri--) {
                progressCell.appendChild(createDebugProgressItem(progressRecords[ri], bug));
            }
        }
        if (isAdmin()) {
            var progressActions = document.createElement('div');
            progressActions.className = 'progress-actions';
            var aiBtn = document.createElement('button');
            aiBtn.className = 'progress-ai-btn user-only ' + userVisibleClass();
            aiBtn.textContent = '✨ AI归纳';
            aiBtn.addEventListener('click', function() { summarizeBugProgress(bug.id, aiBtn); });
            progressActions.appendChild(aiBtn);
            var progressAddBtn = document.createElement('button');
            progressAddBtn.className = 'user-only ' + userVisibleClass();
            progressAddBtn.textContent = '➕ 添加';
            progressAddBtn.addEventListener('click', function() { addBugProgress(bug.id); });
            progressActions.appendChild(progressAddBtn);
            progressCell.appendChild(progressActions);
        }
        row.appendChild(progressCell);
        
        // Actions (2026-10-01: 仅管理员可见可操作; 非管理员整列不渲染)
        if (isAdmin()) {
            var actionsCell = document.createElement('td');
            var editBtn = document.createElement('button');
            editBtn.className = 'edit-btn user-only ' + userVisibleClass();
            editBtn.textContent = '编辑';
            editBtn.addEventListener('click', function() { editBug(bug.id); });
            actionsCell.appendChild(editBtn);
            
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn user-only ' + userVisibleClass();
            deleteBtn.textContent = '删除';
            deleteBtn.addEventListener('click', function() { deleteBug(bug.id); });
            actionsCell.appendChild(deleteBtn);
            
            row.appendChild(actionsCell);
        }
        tbody.appendChild(row);
    });
}

function editBug(bugId) {
    var bug = App.data.bugs.find(function(b) { return b.id === bugId; });
    if (!bug) return;
    
    App.currentEditBugId = bugId;
    document.getElementById('edit-bug-id').value = bug.bugId;
    document.getElementById('edit-bug-domain').value = bug.domain;
    document.getElementById('edit-bug-description').value = bug.description;
    document.getElementById('edit-bug-severity').value = bug.severity;
    document.getElementById('edit-bug-status').value = bug.status;
    document.getElementById('edit-bug-owner').value = bug.owner;
    
    openModal('edit-bug-modal');
}

function closeEditBugModal() {
    closeModal('edit-bug-modal');
    App.currentEditBugId = null;
}

function saveEditedBug() {
    if (!App.currentEditBugId) return;
    
    var bug = App.data.bugs.find(function(b) { return b.id === App.currentEditBugId; });
    if (!bug) return;
    
    bug.bugId = document.getElementById('edit-bug-id').value.trim();
    bug.domain = document.getElementById('edit-bug-domain').value.trim();
    bug.description = document.getElementById('edit-bug-description').value.trim();
    bug.severity = document.getElementById('edit-bug-severity').value;
    bug.status = document.getElementById('edit-bug-status').value;
    bug.owner = document.getElementById('edit-bug-owner').value.trim();
    
    saveAndRefresh('edit-bug-modal', renderBugs, 'bugs', function() { App.currentEditBugId = null; });
}

function deleteBugFromModal() {
    if (confirm('确定要删除这个Bug吗？')) {
        deleteBug(App.currentEditBugId);
        closeEditBugModal();
    }
}

function handleBugSort(field) {
    if (App.currentBugSort.field === field) {
        App.currentBugSort.direction = App.currentBugSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        App.currentBugSort.field = field;
        App.currentBugSort.direction = 'asc';
    }
    renderBugs(App.data.bugs);
}

function applyBugFilters() {
    App.currentBugFilters = {
        bugId: document.getElementById('filter-bug-id').value.trim(),
        domain: document.getElementById('filter-bug-domain').value.trim(),
        description: document.getElementById('filter-bug-description').value.trim(),
        severity: document.getElementById('filter-bug-severity').value,
        status: document.getElementById('filter-bug-status').value,
        owner: document.getElementById('filter-bug-owner').value.trim(),
        showClosed: document.getElementById('filter-bug-show-closed').checked,
        buRange: document.getElementById('filter-bug-bu-range').checked
    };
    renderBugs(App.data.bugs);
}

function resetBugFilters() {
    document.getElementById('filter-bug-id').value = '';
    document.getElementById('filter-bug-domain').value = '';
    document.getElementById('filter-bug-description').value = '';
    document.getElementById('filter-bug-severity').value = '';
    document.getElementById('filter-bug-status').value = '';
    document.getElementById('filter-bug-owner').value = '';
    document.getElementById('filter-bug-show-closed').checked = false;
    document.getElementById('filter-bug-bu-range').checked = true;
    
    App.currentBugFilters = { severity: '', showClosed: false, buRange: true };
    renderBugs(App.data.bugs);
}

// ==================== 从 JIRA 项目 Bug 同步到本地 (2026-09-30) ====================
// 从当前项目配置的 jiraProject(如 BR288Y) 拉取 JIRA Bug 并 upsert 进本地 bugs 数组(主页面Bug表)。
// 配合默认严重性=所有严重性, 让 Medium 等其他严重性也默认可见。
async function syncJiraBugsToProject() {
    var proj = (App.projectsList || []).find(function(p) { return p.id === App.currentProject; });
    if (!proj || !proj.jiraProject) {
        showSyncStatus('当前项目未配置 JIRA 项目(jiraProject)，无法从JIRA同步 Bug', 'warning');
        return false;
    }
    showSyncStatus('正在从 JIRA(' + proj.jiraProject + ')拉取最新 Bug...', 'info');
    try {
        var r = await apiCall('/api/data/import-jira', {
            method: 'POST',
            body: JSON.stringify({ project: proj.jiraProject, persistProjectId: App.currentProject })
        });
        if (r && r.success) {
            await loadDataFromAPI();
            showSyncStatus(r.message || ('已同步 ' + (r.bugs ? r.bugs.length : 0) + ' 条Bug'), 'success');
            return true;
        }
        showSyncStatus((r && r.error) || '从JIRA同步Bug失败', 'warning');
        return false;
    } catch (e) {
        showSyncStatus('从JIRA同步Bug失败: ' + (e && e.message || e), 'warning');
        return false;
    }
}

// ==================== Debug Progress (AI归纳 + 手工输入) ====================

// 取某 bug 的调试进展记录列表 (无 history 时回退单条文本)
function bugProgressRecords(bug) {
    if (bug && Array.isArray(bug.debugProgressHistory) && bug.debugProgressHistory.length) {
        return bug.debugProgressHistory;
    }
    if (bug && bug.debugProgress) {
        return [{ text: bug.debugProgress, timestamp: bug.debugProgressUpdatedAt, source: bug.debugProgressSource }];
    }
    return [];
}

// 取"上一次 AI 归纳"的文本 (用于判断本次是否明显进展): 优先 history 里最近一条 source==='llm', 否则当前 debugProgress(仅当为 llm)
function getPrevAiSummary(bug) {
    if (!bug) return '';
    if (Array.isArray(bug.debugProgressHistory)) {
        for (var i = bug.debugProgressHistory.length - 1; i >= 0; i--) {
            if (bug.debugProgressHistory[i] && bug.debugProgressHistory[i].source === 'llm' && bug.debugProgressHistory[i].text) {
                return bug.debugProgressHistory[i].text;
            }
        }
    }
    if (bug.debugProgressSource === 'llm' && bug.debugProgress) return bug.debugProgress;
    return '';
}

// 追加一条进展记录并回写最新字段 (供 AI归纳 记录 / 手工编辑复用)
function appendBugProgressRecord(bug, rec) {
    if (!bug.debugProgressHistory) bug.debugProgressHistory = [];
    bug.debugProgressHistory.push(rec);
    bug.debugProgress = rec.text;
    bug.debugProgressSource = rec.source;
    bug.debugProgressUpdatedAt = rec.timestamp;
}

// ISO → YYYY-MM-DD HH:mm 时间戳展示
function fmtDebugTs(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var p = function(n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// LLM summarize debug progress from JIRA comments
async function summarizeBugProgress(bugId, btn) {
    var bug = App.data.bugs.find(function(b) { return b.id === bugId; });
    if (!bug) return;
    
    var jiraKey = bug.jiraKey || '';
    if (!jiraKey && bug.bugId && /^[A-Z0-9]+-\d+$/i.test(bug.bugId)) {
        jiraKey = bug.bugId;
    }
    if (!jiraKey) {
        alert('该Bug没有关联JIRA单号，无法AI归纳，请点击"✏️ 编辑"手工填写调试进展。');
        return;
    }
    
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="progress-ai-spin">⏳</span>归纳中...';
    
    try {
        var result = await apiCall('/api/data/bug-debug-progress/summarize', {
            method: 'POST',
            body: JSON.stringify({ jiraKey: jiraKey, previousSummary: getPrevAiSummary(bug) })
        });
        
        if (!result.success) {
            alert(result.error || 'AI归纳失败');
            return;
        }
        
        if (result.noComments || !result.summary) {
            alert(result.warning || '该Bug在JIRA没有评论，无法归纳。请点击"✏️ 编辑"手工填写调试进展。');
            return;
        }
        
        // 2026-10-02: 每次触发AI归纳都记录一条独立时间戳的记录(不再因"与上次无明显进展"而跳过记录);
        //   hasProgress 附在记录上, 渲染时对 false 标注"⚠ 无显著进展"以保留该信号
        appendBugProgressRecord(bug, {
            text: result.summary,
            timestamp: result.updatedAt || new Date().toISOString(),
            source: 'llm',
            hasProgress: (result.hasProgress === false ? false : true)
        });
        
        await persistData();
        renderBugs(App.data.bugs);
        showSyncStatus('✓ 已用AI从JIRA ' + result.commentCount + ' 条评论归纳调试进展，已新增时间戳记录', 'success');
    } catch (error) {
        console.error('AI summarize debug progress failed:', error);
        alert('AI归纳失败: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// 2026-10-02: 单条 debug-progress 记录渲染(时间戳+文本+无显著进展标注); 管理员可见该条 ✏️ 编辑按钮(编辑当前bug某一条记录)
function createDebugProgressItem(rec, bug) {
    var item = document.createElement('div');
    item.className = 'debug-progress-item';
    if (rec.timestamp) {
        var tsSpan = document.createElement('span');
        tsSpan.className = 'debug-progress-ts';
        tsSpan.textContent = fmtDebugTs(rec.timestamp);
        item.appendChild(tsSpan);
    }
    var pt = document.createElement('span');
    pt.className = 'debug-progress-text';
    pt.textContent = rec.text || '';
    item.appendChild(pt);
    if (rec.hasProgress === false) {
        var nop = document.createElement('span');
        nop.className = 'debug-progress-noprogress';
        nop.textContent = '⚠ 无显著进展';
        nop.style.cssText = 'color:#e67e22;margin-left:6px;font-size:11px;';
        item.appendChild(nop);
    }
    if (isAdmin()) {
        var editRecBtn = document.createElement('button');
        editRecBtn.className = 'debug-progress-edit-btn user-only ' + userVisibleClass();
        editRecBtn.textContent = '✏️';
        editRecBtn.title = '编辑这条调试进展';
        editRecBtn.addEventListener('click', function() { editBugProgress(bug.id, rec); });
        item.appendChild(editRecBtn);
    }
    return item;
}

// 编辑弹窗: rec 指定要编辑的某条记录(不传则编辑最新一条/唯一的 debugProgress)
function editBugProgress(bugId, rec) {
    var bug = App.data.bugs.find(function(b) { return b.id === bugId; });
    if (!bug) return;
    App.currentEditProgressBugId = bugId;
    App.currentEditProgressRec = rec || null;
    App.currentProgressMode = rec ? 'editRec' : 'editLatest';
    document.getElementById('edit-progress-bugid').value = bug.bugId || '';
    document.getElementById('edit-progress-text').value = (rec ? (rec.text || '') : (bug.debugProgress || ''));
    setProgressModalMode('edit');
    openModal('edit-progress-modal');
}

// 2026-10-02: 手动"添加"一条调试进展记录(不预填现有内容), 保存 → append source='manual' + 独立时间戳
function addBugProgress(bugId) {
    var bug = App.data.bugs.find(function(b) { return b.id === bugId; });
    if (!bug) return;
    App.currentEditProgressBugId = bugId;
    App.currentEditProgressRec = null;
    App.currentProgressMode = 'add';
    document.getElementById('edit-progress-bugid').value = bug.bugId || '';
    document.getElementById('edit-progress-text').value = '';
    setProgressModalMode('add');
    openModal('edit-progress-modal');
}

function setProgressModalMode(mode) {
    var titleEl = document.querySelector('#edit-progress-modal .modal-title');
    if (titleEl) titleEl.textContent = (mode === 'add') ? '添加调试进展' : '调试进度 (Debug Progress)';
}

function closeEditProgressModal() {
    closeModal('edit-progress-modal');
    App.currentEditProgressBugId = null;
    App.currentEditProgressRec = null;
    App.currentProgressMode = null;
}

// 编辑后保持"最新"字段(debugProgress/debugProgressUpdatedAt/debugProgressSource)指向历史里最新一条, 供 daily-summary 等使用
function syncDebugProgressLatest(bug) {
    if (Array.isArray(bug.debugProgressHistory) && bug.debugProgressHistory.length) {
        var last = bug.debugProgressHistory[bug.debugProgressHistory.length - 1];
        bug.debugProgress = last.text;
        bug.debugProgressSource = last.source;
        bug.debugProgressUpdatedAt = last.timestamp;
    }
}

function saveEditedProgress() {
    if (!App.currentEditProgressBugId) return;
    var bug = App.data.bugs.find(function(b) { return b.id === App.currentEditProgressBugId; });
    if (!bug) return;
    var text = document.getElementById('edit-progress-text').value.trim();
    if (!text) { alert('调试进展内容不能为空'); return; }

    if (App.currentProgressMode === 'add') {
        // 新增: 追加一条 source='manual' + 独立时间戳
        appendBugProgressRecord(bug, { text: text, timestamp: new Date().toISOString(), source: 'manual' });
    } else {
        var hasHistory = Array.isArray(bug.debugProgressHistory) && bug.debugProgressHistory.length;
        if (hasHistory) {
            // 编辑某条记录: 若指定了且确在历史数组里则改那条, 否则改最新一条; 保留该条时间戳/source
            var rec = (App.currentEditProgressRec && bug.debugProgressHistory.indexOf(App.currentEditProgressRec) !== -1)
                ? App.currentEditProgressRec
                : bug.debugProgressHistory[bug.debugProgressHistory.length - 1];
            rec.text = text;
            syncDebugProgressLatest(bug);
        } else {
            // 仅单条 debugProgress(无历史) → 原地更新
            bug.debugProgress = text;
            bug.debugProgressUpdatedAt = new Date().toISOString();
            bug.debugProgressSource = bug.debugProgressSource || 'manual';
        }
    }
    saveAndRefresh('edit-progress-modal', renderBugs, 'bugs', function() {
        App.currentEditProgressBugId = null;
        App.currentEditProgressRec = null;
        App.currentProgressMode = null;
    });
}

// ==================== 批量 AI 归纳所有 Debug Progress (2026-10-03) ====================
// 遍历所有有JIRA单号的Bug逐个执行AI归纳:
//   - 已有Debug Progress(任意来源) → 仅当LLM判定有新增内容(hasProgress!==false)才追加一条带时间戳记录; 无新增→跳过
//   - 尚无Debug Progress → 首次归纳, 直接生成并追加一条记录
// 逐条调用后端 /api/data/bug-debug-progress/summarize (单条请求, 不阻塞, 逐条刷新进度条)
function getLatestProgressText(bug) {
    if (!bug) return '';
    if (bug.debugProgress && String(bug.debugProgress).trim()) return bug.debugProgress;
    var recs = bugProgressRecords(bug);
    if (recs.length && recs[recs.length - 1] && recs[recs.length - 1].text) return recs[recs.length - 1].text;
    return '';
}

function setBatchProgressUI(fillEl, textEl, done, total, added, skipped, noComments, errors) {
    var pct = total ? Math.round(done / total * 100) : 100;
    fillEl.style.width = pct + '%';
    var parts = [done + '/' + total, '新增' + added, '跳过' + skipped, '无评论' + noComments];
    if (errors) parts.push('失败' + errors);
    textEl.textContent = parts.join('  |  ');
}

async function batchSummarizeAllProgress() {
    if (!isAdmin()) return;
    var allBugs = App.data.bugs || [];
    var bugs = allBugs.filter(function(b) {
        var key = b.jiraKey || (b.bugId && /^[A-Z0-9]+-\d+$/i.test(b.bugId) ? b.bugId : '');
        return !!key;
    });
    var total = bugs.length;
    if (!total) {
        alert('没有可AI归纳的Bug（需有关联JIRA单号）。');
        return;
    }
    if (!confirm('将对 ' + total + ' 条有关联JIRA单号的Bug执行AI归纳：\n\n' +
        '· 已有Debug Progress的，仅当JIRA有新增内容才追加一条带时间戳记录；\n' +
        '· 无新增内容则跳过（保留原记录）；\n' +
        '· 尚无Debug Progress的，首次归纳生成一条记录。\n\n' +
        '每条会调用 JIRA + LLM，共约 ' + total + ' 次，耗时约几分钟，点击“确定”开始。')) {
        return;
    }

    var btn = document.getElementById('batch-ai-btn');
    var statusEl = document.getElementById('batch-ai-status');
    var progWrap = document.getElementById('batch-ai-progress');
    var fillEl = document.getElementById('batch-ai-progress-fill');
    var textEl = document.getElementById('batch-ai-progress-text');
    var origLabel = btn.textContent;

    btn.disabled = true;
    btn.textContent = '⏳ 批量归纳中...';
    progWrap.style.display = 'flex';
    statusEl.style.display = 'none';
    setBatchProgressUI(fillEl, textEl, 0, total, 0, 0, 0, 0);

    var done = 0, added = 0, skipped = 0, noComments = 0, errors = 0;
    try {
        for (var i = 0; i < bugs.length; i++) {
            var bug = bugs[i];
            var jiraKey = bug.jiraKey || (bug.bugId && /^[A-Z0-9]+-\d+$/i.test(bug.bugId) ? bug.bugId : '');
            var prev = getLatestProgressText(bug);
            try {
                var result = await apiCall('/api/data/bug-debug-progress/summarize', {
                    method: 'POST',
                    body: JSON.stringify({ jiraKey: jiraKey, previousSummary: prev })
                });
                if (result && result.success) {
                    if (result.noComments) {
                        noComments++;
                    } else if (!result.summary) {
                        skipped++;  // LLM 未产出内容 → 视为无新增, 跳过
                    } else if (prev && result.hasProgress === false) {
                        skipped++;  // 已有进展但无新增内容 → 忽略
                    } else {
                        appendBugProgressRecord(bug, {
                            text: result.summary,
                            timestamp: result.updatedAt || new Date().toISOString(),
                            source: 'llm',
                            hasProgress: (result.hasProgress === false ? false : true)
                        });
                        added++;
                    }
                } else {
                    errors++;
                }
            } catch (e) {
                errors++;
                console.error('[_bugprogress] batch summarize failed [' + jiraKey + ']:', e);
            }
            done++;
            setBatchProgressUI(fillEl, textEl, done, total, added, skipped, noComments, errors);
        }

        if (added > 0) {
            await persistData();
            renderBugs(App.data.bugs);
        }

        var sumMsg = '批量AI归纳完成：新增 ' + added + ' 条，跳过(无新增) ' + skipped + ' 条，无评论 ' + noComments + ' 条' + (errors ? '，失败 ' + errors + ' 条' : '');
        statusEl.textContent = '✓ ' + sumMsg;
        statusEl.style.display = 'block';
        showSyncStatus('✓ ' + sumMsg, 'success');
    } catch (e) {
        var errMsg = '批量AI归纳中断：' + (e && e.message || e);
        statusEl.textContent = errMsg;
        statusEl.style.display = 'block';
        showSyncStatus(errMsg, 'warning');
        console.error('[_bugprogress] batch summarize aborted:', e);
    } finally {
        btn.disabled = false;
        btn.textContent = origLabel;
        progWrap.style.display = 'none';
    }
}

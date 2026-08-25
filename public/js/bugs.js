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
        tbody.appendChild(emptyTableRow(9, '暂无Bug记录'));
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
        tbody.appendChild(emptyTableRow(9, hint));
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
        var jiraLink = createJiraLink(bug.bugId);
        idCell.appendChild(jiraLink);
        row.appendChild(idCell);
        
        // Domain (safe)
        var domainCell = document.createElement('td');
        domainCell.textContent = bug.domain || '';
        row.appendChild(domainCell);
        
        // Description (safe)
        var descCell = document.createElement('td');
        descCell.className = 'bug-description';
        descCell.textContent = bug.description || '';
        row.appendChild(descCell);
        
        // Debug Progress (safe - LLM summary from JIRA comments or manual input)
        var progressCell = document.createElement('td');
        progressCell.className = 'debug-progress-cell';
        var progressText = document.createElement('span');
        progressText.className = 'debug-progress-text';
        progressText.textContent = bug.debugProgress || '—';
        progressCell.appendChild(progressText);
        if (bug.debugProgressUpdatedAt) {
            var progressMeta = document.createElement('span');
            progressMeta.className = 'debug-progress-meta';
            progressMeta.textContent = (bug.debugProgressSource === 'llm' ? 'AI归纳' : '手工') + ' · ' + String(bug.debugProgressUpdatedAt).split('T')[0];
            progressCell.appendChild(progressMeta);
        }
        var progressActions = document.createElement('div');
        progressActions.className = 'progress-actions';
        var aiBtn = document.createElement('button');
        aiBtn.className = 'progress-ai-btn user-only ' + userVisibleClass();
        aiBtn.textContent = '✨ AI归纳';
        aiBtn.addEventListener('click', function() { summarizeBugProgress(bug.id, aiBtn); });
        progressActions.appendChild(aiBtn);
        var progressEditBtn = document.createElement('button');
        progressEditBtn.className = 'user-only ' + userVisibleClass();
        progressEditBtn.textContent = '✏️ 编辑';
        progressEditBtn.addEventListener('click', function() { editBugProgress(bug.id); });
        progressActions.appendChild(progressEditBtn);
        progressCell.appendChild(progressActions);
        row.appendChild(progressCell);
        
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
        
        // Actions
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
    document.getElementById('filter-bug-severity').value = 'critical';
    document.getElementById('filter-bug-status').value = '';
    document.getElementById('filter-bug-owner').value = '';
    document.getElementById('filter-bug-show-closed').checked = false;
    document.getElementById('filter-bug-bu-range').checked = true;
    
    App.currentBugFilters = { severity: 'critical', showClosed: false, buRange: true };
    renderBugs(App.data.bugs);
}

// ==================== Debug Progress (AI归纳 + 手工输入) ====================

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
            body: JSON.stringify({ jiraKey: jiraKey })
        });
        
        if (!result.success) {
            alert(result.error || 'AI归纳失败');
            return;
        }
        
        if (result.noComments || !result.summary) {
            alert(result.warning || '该Bug在JIRA没有评论，无法归纳。请点击"✏️ 编辑"手工填写调试进展。');
            return;
        }
        
        bug.debugProgress = result.summary;
        bug.debugProgressSource = 'llm';
        bug.debugProgressUpdatedAt = result.updatedAt || new Date().toISOString();
        
        await persistData();
        renderBugs(App.data.bugs);
        showSyncStatus('✓ 已用AI从JIRA ' + result.commentCount + ' 条评论归纳调试进展', 'success');
    } catch (error) {
        console.error('AI summarize debug progress failed:', error);
        alert('AI归纳失败: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// Open manual-edit modal for debug progress
function editBugProgress(bugId) {
    var bug = App.data.bugs.find(function(b) { return b.id === bugId; });
    if (!bug) return;
    
    App.currentEditProgressBugId = bugId;
    document.getElementById('edit-progress-bugid').value = bug.bugId || '';
    document.getElementById('edit-progress-text').value = bug.debugProgress || '';
    
    openModal('edit-progress-modal');
}

function closeEditProgressModal() {
    closeModal('edit-progress-modal');
    App.currentEditProgressBugId = null;
}

function saveEditedProgress() {
    if (!App.currentEditProgressBugId) return;
    
    var bug = App.data.bugs.find(function(b) { return b.id === App.currentEditProgressBugId; });
    if (!bug) return;
    
    bug.debugProgress = document.getElementById('edit-progress-text').value.trim();
    bug.debugProgressSource = 'manual';
    bug.debugProgressUpdatedAt = new Date().toISOString();
    
    saveAndRefresh('edit-progress-modal', renderBugs, 'bugs', function() { App.currentEditProgressBugId = null; });
}

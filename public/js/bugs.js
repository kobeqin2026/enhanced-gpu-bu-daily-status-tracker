// Bug rendering, filtering, sorting

function applyFiltersToBugs(bugs) {
    return bugs.filter(function(bug) {
        var normalizedSeverity = (bug.severity || '').toLowerCase();
        var filterSeverity = (App.currentBugFilters.severity || '').toLowerCase();
        
        if (App.currentBugFilters.bugId && bug.bugId.toLowerCase().indexOf(App.currentBugFilters.bugId.toLowerCase()) === -1) return false;
        if (App.currentBugFilters.domain && bug.domain.toLowerCase().indexOf(App.currentBugFilters.domain.toLowerCase()) === -1) return false;
        if (App.currentBugFilters.description && bug.description.toLowerCase().indexOf(App.currentBugFilters.description.toLowerCase()) === -1) return false;
        if (App.currentBugFilters.severity && normalizedSeverity !== filterSeverity) return false;
        if (App.currentBugFilters.status && bug.status !== App.currentBugFilters.status) return false;
        if (App.currentBugFilters.owner && bug.owner.toLowerCase().indexOf(App.currentBugFilters.owner.toLowerCase()) === -1) return false;
        
        // Hide closed/rejected bugs by default
        if (!App.currentBugFilters.showClosed && (bug.status === 'closed' || bug.status === 'rejected')) {
            return false;
        }
        
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
    
    if (bugs.length === 0) {
        tbody.appendChild(emptyTableRow(8, '暂无Bug记录'));
        return;
    }
    
    var sortedBugs = sortBugs(applyFiltersToBugs(bugs));
    updateBugSortIndicators();
    
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
        showClosed: document.getElementById('filter-bug-show-closed').checked
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
    
    App.currentBugFilters = { showClosed: false };
    renderBugs(App.data.bugs);
}

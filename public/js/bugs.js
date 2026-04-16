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
        return true;
    });
}

function sortBugs(bugs) {
    var severityPriority = { 'highest': 0, 'high': 1, 'medium': 2, 'low': 3, 'lowest': 4 };
    
    if (!App.currentBugSort.field) {
        return bugs.sort(function(a, b) {
            var priorityA = severityPriority[(a.severity || '').toLowerCase()] !== undefined ? severityPriority[(a.severity || '').toLowerCase()] : 999;
            var priorityB = severityPriority[(b.severity || '').toLowerCase()] !== undefined ? severityPriority[(b.severity || '').toLowerCase()] : 999;
            if (priorityA !== priorityB) return priorityA - priorityB;
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
    var openStatuses = ['open', 'triage', 'implement'];
    var openBugs = [];
    var closedBugs = [];

    applyFiltersToBugs(bugs).forEach(function(bug) {
        if (openStatuses.indexOf(bug.status) !== -1) {
            openBugs.push(bug);
        } else {
            closedBugs.push(bug);
        }
    });

    var sortedOpen = sortBugs(openBugs);
    var sortedClosed = sortBugs(closedBugs);

    var openTbody = getTableBody('bugs-body-open');
    if (sortedOpen.length === 0) {
        openTbody.appendChild(emptyTableRow(8, '暂无待修复Bug'));
    } else {
        sortedOpen.forEach(function(bug) { renderBugRow(openTbody, bug); });
    }

    var closedTbody = getTableBody('bugs-body-closed');
    if (sortedClosed.length === 0) {
        closedTbody.appendChild(emptyTableRow(8, '暂无已关闭Bug'));
    } else {
        sortedClosed.forEach(function(bug) { renderBugRow(closedTbody, bug); });
    }

    updateBugSortIndicators();
}

function renderBugRow(tbody, bug) {
    var row = document.createElement('tr');
    row.setAttribute('data-bug-id', bug.id);

    var idCell = document.createElement('td');
    var jiraLink = createJiraLink(bug.bugId);
    idCell.appendChild(jiraLink);
    row.appendChild(idCell);

    var domainCell = document.createElement('td');
    domainCell.textContent = bug.domain || '';
    row.appendChild(domainCell);

    var descCell = document.createElement('td');
    descCell.className = 'bug-description';
    descCell.textContent = bug.description || '';
    row.appendChild(descCell);

    var sevCell = document.createElement('td');
    var severityDisplay = App.severityText[bug.severity] || bug.severity;
    var severityClass = App.severityColorClasses[bug.severity] || '';
    sevCell.className = severityClass;
    sevCell.textContent = severityDisplay || '';
    row.appendChild(sevCell);

    var statusCell = document.createElement('td');
    statusCell.className = 'bug-status-static';
    statusCell.textContent = App.bugStatusText[bug.status] || bug.status || '';
    row.appendChild(statusCell);

    var dateCell = document.createElement('td');
    dateCell.textContent = bug.reportDate || '';
    row.appendChild(dateCell);

    var ownerCell = document.createElement('td');
    ownerCell.textContent = bug.owner || '';
    row.appendChild(ownerCell);

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
        owner: document.getElementById('filter-bug-owner').value.trim()
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
    
    App.currentBugFilters = {};
    App.currentBugSort = { field: null, direction: 'asc' };
    renderBugs(App.data.bugs);
}

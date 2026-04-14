function applyFiltersToBugs(bugs) {
    return bugs.filter(bug => {
        const normalizedSeverity = (bug.severity || '').toLowerCase();
        const filterSeverity = (currentBugFilters.severity || '').toLowerCase();
        
        if (currentBugFilters.bugId && !bug.bugId.toLowerCase().includes(currentBugFilters.bugId.toLowerCase())) return false;
        if (currentBugFilters.domain && !bug.domain.toLowerCase().includes(currentBugFilters.domain.toLowerCase())) return false;
        if (currentBugFilters.description && !bug.description.toLowerCase().includes(currentBugFilters.description.toLowerCase())) return false;
        if (currentBugFilters.severity && normalizedSeverity !== filterSeverity) return false;
        if (currentBugFilters.status && bug.status !== currentBugFilters.status) return false;
        if (currentBugFilters.owner && !bug.owner.toLowerCase().includes(currentBugFilters.owner.toLowerCase())) return false;
        return true;
    });
}

// Sort bugs based on current sort state
function sortBugs(bugs) {
    const severityPriority = { 'highest': 0, 'high': 1, 'medium': 2, 'low': 3, 'lowest': 4 };
    
    if (!currentBugSort.field) {
        return bugs.sort((a, b) => {
            const priorityA = severityPriority[(a.severity || '').toLowerCase()] !== undefined ? severityPriority[(a.severity || '').toLowerCase()] : 999;
            const priorityB = severityPriority[(b.severity || '').toLowerCase()] !== undefined ? severityPriority[(b.severity || '').toLowerCase()] : 999;
            if (priorityA !== priorityB) return priorityA - priorityB;
            return new Date(b.reportDate) - new Date(a.reportDate);
        });
    }
    
    return bugs.sort((a, b) => {
        let valA = a[currentBugSort.field];
        let valB = b[currentBugSort.field];
        
        if (currentBugSort.field === 'bugId') {
            valA = valA || '';
            valB = valB || '';
        } else if (currentBugSort.field === 'severity') {
            valA = severityPriority[(valA || '').toLowerCase()] !== undefined ? severityPriority[(valA || '').toLowerCase()] : 999;
            valB = severityPriority[(valB || '').toLowerCase()] !== undefined ? severityPriority[(valB || '').toLowerCase()] : 999;
        } else if (currentBugSort.field === 'reportDate') {
            valA = new Date(valA);
            valB = new Date(valB);
        } else {
            valA = (valA || '').toString().toLowerCase();
            valB = (valB || '').toString().toLowerCase();
        }
        
        let comparison = valA > valB ? 1 : valA < valB ? -1 : 0;
        return currentBugSort.direction === 'asc' ? comparison : -comparison;
    });
}

// Update bug table header sort indicators
function updateBugSortIndicators() {
    document.querySelectorAll('.bug-table th').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
    });
    
    if (currentBugSort.field) {
        const th = document.querySelector(`.bug-table th[data-sort="${currentBugSort.field}"]`);
        if (th) {
            th.classList.add(currentBugSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    }
}

// Render bugs table
function renderBugs(bugs) {
    const tbody = getTableBody('bugs-body');
    
    if (bugs.length === 0) {
        tbody.appendChild(emptyTableRow(8, '暂无Bug记录'));
        return;
    }
    
    const sortedBugs = sortBugs(applyFiltersToBugs(bugs));
    updateBugSortIndicators();
    
    sortedBugs.forEach(bug => {
        const row = document.createElement('tr');
        row.setAttribute('data-bug-id', bug.id);
        
        const bugIdCell = createJiraLink(bug.bugId);
        const severityDisplay = severityText[bug.severity] || bug.severity;
        const severityClass = severityColorClasses[bug.severity] || '';
        const statusDisplay = bugStatusText[bug.status] || bug.status;
        
        row.innerHTML = `
            <td>${bugIdCell}</td>
            <td>${escapeHtml(bug.domain)}</td>
            <td class="bug-description">${escapeHtml(bug.description)}</td>
            <td class="${severityClass}">${escapeHtml(severityDisplay)}</td>
            <td class="bug-status-static">${escapeHtml(statusDisplay)}</td>
            <td>${escapeHtml(bug.reportDate)}</td>
            <td>${escapeHtml(bug.owner)}</td>
            <td>
                <button class="edit-btn user-only ${userVisibleClass()}" onclick="editBug('${bug.id}')">编辑</button>
                <button class="delete-btn user-only ${userVisibleClass()}" onclick="deleteBug('${bug.id}')">删除</button>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

// Open edit bug modal
function editBug(bugId) {
    const bug = currentData.bugs.find(b => b.id === bugId);
    if (!bug) return;
    
    currentEditBugId = bugId;
    document.getElementById('edit-bug-id').value = bug.bugId;
    document.getElementById('edit-bug-domain').value = bug.domain;
    document.getElementById('edit-bug-description').value = bug.description;
    document.getElementById('edit-bug-severity').value = bug.severity;
    document.getElementById('edit-bug-status').value = bug.status;
    document.getElementById('edit-bug-owner').value = bug.owner;
    
    openModal('edit-bug-modal');
}

// Close edit bug modal
function closeEditBugModal() {
    closeModal('edit-bug-modal');
    currentEditBugId = null;
}

// Save edited bug
function saveEditedBug() {
    if (!currentEditBugId) return;
    
    const bug = currentData.bugs.find(b => b.id === currentEditBugId);
    if (!bug) return;
    
    bug.bugId = document.getElementById('edit-bug-id').value.trim();
    bug.domain = document.getElementById('edit-bug-domain').value.trim();
    bug.description = document.getElementById('edit-bug-description').value.trim();
    bug.severity = document.getElementById('edit-bug-severity').value;
    bug.status = document.getElementById('edit-bug-status').value;
    bug.owner = document.getElementById('edit-bug-owner').value.trim();
    
    saveAndRefresh('edit-bug-modal', renderBugs, 'bugs', () => { currentEditBugId = null; });
}

// Delete bug from modal
function deleteBugFromModal() {
    if (confirm('确定要删除这个Bug吗？')) {
        deleteBug(currentEditBugId);
        closeEditBugModal();
    }
}

// Handle bug column sorting
function handleBugSort(field) {
    if (currentBugSort.field === field) {
        currentBugSort.direction = currentBugSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentBugSort.field = field;
        currentBugSort.direction = 'asc';
    }
    renderBugs(currentData.bugs);
}

// Apply bug filters from UI
function applyBugFilters() {
    currentBugFilters = {
        bugId: document.getElementById('filter-bug-id').value.trim(),
        domain: document.getElementById('filter-bug-domain').value.trim(),
        description: document.getElementById('filter-bug-description').value.trim(),
        severity: document.getElementById('filter-bug-severity').value,
        status: document.getElementById('filter-bug-status').value,
        owner: document.getElementById('filter-bug-owner').value.trim()
    };
    renderBugs(currentData.bugs);
}

// Reset bug filters
function resetBugFilters() {
    document.getElementById('filter-bug-id').value = '';
    document.getElementById('filter-bug-domain').value = '';
    document.getElementById('filter-bug-description').value = '';
    document.getElementById('filter-bug-severity').value = '';
    document.getElementById('filter-bug-status').value = '';
    document.getElementById('filter-bug-owner').value = '';
    
    currentBugFilters = {};
    currentBugSort = { field: null, direction: 'asc' };
    renderBugs(currentData.bugs);
}
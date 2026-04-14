// ==================== Init & Main ====================

async function initProjects() {
    // Load saved project from localStorage
    const savedProject = localStorage.getItem('currentProject');
    if (savedProject) {
        currentProject = savedProject;
    }
    
    // Load projects list
    await loadProjects();
    
    // Set the select to current project
    const select = document.getElementById('project-select');
    if (select) {
        select.value = currentProject;
    }
    
    // Update timeline display
    updateProjectTimeline();
}

// Populate domain dropdowns
function populateDomainDropdowns() {
    const dailyDomainSelect = document.getElementById('daily-domain-select');
    const filterDailyDomainSelect = document.getElementById('filter-daily-domain');
    const editDailyDomainSelect = document.getElementById('edit-daily-domain');
    
    // Clear existing options (except first)
    dailyDomainSelect.innerHTML = '<option value="">选择Domain</option>';
    filterDailyDomainSelect.innerHTML = '<option value="">所有Domain</option>';
    if (editDailyDomainSelect) {
        editDailyDomainSelect.innerHTML = '<option value="">选择Domain</option>';
    }
    
    currentData.domains.forEach(domain => {
        const option3 = document.createElement('option');
        option3.value = domain.name;
        option3.textContent = domain.name;
        dailyDomainSelect.appendChild(option3);
        
        const option4 = document.createElement('option');
        option4.value = domain.name;
        option4.textContent = domain.name;
        filterDailyDomainSelect.appendChild(option4);
        
        if (editDailyDomainSelect) {
            const option5 = document.createElement('option');
            option5.value = domain.name;
            option5.textContent = domain.name;
            editDailyDomainSelect.appendChild(option5);
        }
    });
}

async function saveData() {
    // Save to localStorage immediately for instant feedback
    saveToLocalStorage(currentData);
    
    // Save to API asynchronously
    const apiSuccess = await saveDataToAPI();
    
    // Update timestamp
    currentData.lastUpdated = new Date().toLocaleString('zh-CN');
    document.getElementById('last-update').textContent = currentData.lastUpdated.split(' ')[0];
    document.getElementById('timestamp').textContent = currentData.lastUpdated;
    
    // Show save message
    const messageEl = document.getElementById('save-message');
    messageEl.textContent = apiSuccess ? '数据已保存到服务器！' : '数据已保存到本地缓存！';
    setTimeout(() => {
        messageEl.textContent = '';
    }, 3000);
}

// Add new bug
function addNewBug() {
    const bugId = document.getElementById('new-bug-id').value.trim();
    const domain = document.getElementById('new-bug-domain').value.trim();
    const description = document.getElementById('new-bug-description').value.trim();
    
    if (!bugId || !domain || !description) {
        alert('请填写Bug ID、Domain和描述');
        return;
    }
    
    const newBug = {
        id: 'bug-' + Date.now(),
        bugId: bugId,
        domain: domain,
        description: description,
        severity: document.getElementById('new-bug-severity').value,
        status: document.getElementById('new-bug-status').value,
        reportDate: new Date().toISOString().split('T')[0],
        owner: document.getElementById('new-bug-owner').value || 'TBD'
    };
    
    currentData.bugs.push(newBug);
    renderBugs(currentData.bugs);
    
    // Clear inputs
    document.getElementById('new-bug-id').value = '';
    document.getElementById('new-bug-domain').value = '';
    document.getElementById('new-bug-description').value = '';
    document.getElementById('new-bug-owner').value = '';
    
    persistData();
}

// Delete bug
function deleteBug(bugId) {
    if (confirm('确定要删除这个Bug吗？')) {
        currentData.bugs = currentData.bugs.filter(bug => bug.id !== bugId);
        renderBugs(currentData.bugs);
        persistData();
    }
}

// Initialize on page load

document.addEventListener('DOMContentLoaded', async function() {
    // Load saved user session first (MUST be awaited before rendering data)
    await loadSavedUser();
    
    // Initialize projects first
    await initProjects();
    
    // Load data (API first, falls back to localStorage internally)
    await loadDataFromAPI();
    
    // Setup event listeners for sorting
    document.querySelectorAll('.bug-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.getAttribute('data-sort');
            handleBugSort(field);
        });
    });
    
    // Setup bug filter event listeners
    document.getElementById('filter-bug-id').addEventListener('input', applyBugFilters);
    document.getElementById('filter-bug-domain').addEventListener('input', applyBugFilters);
    document.getElementById('filter-bug-description').addEventListener('input', applyBugFilters);
    document.getElementById('filter-bug-severity').addEventListener('change', applyBugFilters);
    document.getElementById('filter-bug-status').addEventListener('change', applyBugFilters);
    document.getElementById('filter-bug-owner').addEventListener('input', applyBugFilters);
    
    // Setup daily progress filter event listeners
    document.getElementById('filter-daily-date').addEventListener('change', applyDailyProgressFilters);
    document.getElementById('filter-daily-domain').addEventListener('change', applyDailyProgressFilters);
    
    // Setup enter key for daily progress
    document.getElementById('daily-content-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            addDailyProgress();
        }
    });
    
    // Setup enter key for domain
    document.getElementById('new-domain-name').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            addNewDomain();
        }
    });
    
    // Setup enter key for bug
    document.getElementById('new-bug-id').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            addNewBug();
        }
    });
    
    // Setup daily progress date input to today by default
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('daily-date-input').value = today;
    
    // Setup modal close events
    window.onclick = function(event) {
        const editDomainModal = document.getElementById('edit-domain-modal');
        const editBugModal = document.getElementById('edit-bug-modal');
        const editDailyProgressModal = document.getElementById('edit-daily-progress-modal');
        const editBUExitCriteriaModal = document.getElementById('edit-bu-exit-criteria-modal');
        const bulkUploadBUModal = document.getElementById('bulk-upload-bu-modal');
        if (event.target === editDomainModal) {
            closeEditDomainModal();
        }
        if (event.target === editBugModal) {
            closeEditBugModal();
        }
        if (event.target === editDailyProgressModal) {
            closeEditDailyProgressModal();
        }
        if (event.target === editBUExitCriteriaModal) {
            closeEditBUExitCriteriaModal();
        }
        if (event.target === bulkUploadBUModal) {
            closeBulkUploadBUModal();
        }
    };
});

// Keyboard shortcut for saving
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveData();
    }
});
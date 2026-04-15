// ==================== Init & Main ====================

async function initProjects() {
    var savedProject = localStorage.getItem('currentProject');
    if (savedProject) {
        App.currentProject = savedProject;
    }
    
    await loadProjects();
    
    var select = document.getElementById('project-select');
    if (select) {
        select.value = App.currentProject;
    }
    
    updateProjectTimeline();
}

function populateDomainDropdowns() {
    var dailyDomainSelect = document.getElementById('daily-domain-select');
    var filterDailyDomainSelect = document.getElementById('filter-daily-domain');
    var editDailyDomainSelect = document.getElementById('edit-daily-domain');
    
    dailyDomainSelect.innerHTML = '<option value="">选择Domain</option>';
    filterDailyDomainSelect.innerHTML = '<option value="">所有Domain</option>';
    if (editDailyDomainSelect) {
        editDailyDomainSelect.innerHTML = '<option value="">选择Domain</option>';
    }
    
    App.data.domains.forEach(function(domain) {
        var option3 = document.createElement('option');
        option3.value = domain.name;
        option3.textContent = domain.name;
        dailyDomainSelect.appendChild(option3);
        
        var option4 = document.createElement('option');
        option4.value = domain.name;
        option4.textContent = domain.name;
        filterDailyDomainSelect.appendChild(option4);
        
        if (editDailyDomainSelect) {
            var option5 = document.createElement('option');
            option5.value = domain.name;
            option5.textContent = domain.name;
            editDailyDomainSelect.appendChild(option5);
        }
    });
}

async function saveData() {
    saveToLocalStorage(App.data);
    
    var apiSuccess = await saveDataToAPI();
    
    App.data.lastUpdated = new Date().toLocaleString('zh-CN');
    document.getElementById('last-update').textContent = App.data.lastUpdated.split(' ')[0];
    document.getElementById('timestamp').textContent = App.data.lastUpdated;
    
    var messageEl = document.getElementById('save-message');
    messageEl.textContent = apiSuccess ? '数据已保存到服务器！' : '数据已保存到本地缓存！';
    setTimeout(function() {
        messageEl.textContent = '';
    }, 3000);
}

function addNewBug() {
    var bugId = document.getElementById('new-bug-id').value.trim();
    var domain = document.getElementById('new-bug-domain').value.trim();
    var description = document.getElementById('new-bug-description').value.trim();
    
    if (!bugId || !domain || !description) {
        alert('请填写Bug ID、Domain和描述');
        return;
    }
    
    var newBug = {
        id: 'bug-' + Date.now(),
        bugId: bugId,
        domain: domain,
        description: description,
        severity: document.getElementById('new-bug-severity').value,
        status: document.getElementById('new-bug-status').value,
        reportDate: new Date().toISOString().split('T')[0],
        owner: document.getElementById('new-bug-owner').value || 'TBD'
    };
    
    App.data.bugs.push(newBug);
    renderBugs(App.data.bugs);
    
    document.getElementById('new-bug-id').value = '';
    document.getElementById('new-bug-domain').value = '';
    document.getElementById('new-bug-description').value = '';
    document.getElementById('new-bug-owner').value = '';
    
    persistData();
}

function deleteBug(bugId) {
    if (confirm('确定要删除这个Bug吗？')) {
        App.data.bugs = App.data.bugs.filter(function(bug) { return bug.id !== bugId; });
        renderBugs(App.data.bugs);
        persistData();
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async function() {
    await loadSavedUser();
    await initProjects();
    await loadDataFromAPI();
    
    document.querySelectorAll('.bug-table th[data-sort]').forEach(function(th) {
        th.addEventListener('click', function() {
            var field = th.getAttribute('data-sort');
            handleBugSort(field);
        });
    });
    
    document.getElementById('filter-bug-id').addEventListener('input', applyBugFilters);
    document.getElementById('filter-bug-domain').addEventListener('input', applyBugFilters);
    document.getElementById('filter-bug-description').addEventListener('input', applyBugFilters);
    document.getElementById('filter-bug-severity').addEventListener('change', applyBugFilters);
    document.getElementById('filter-bug-status').addEventListener('change', applyBugFilters);
    document.getElementById('filter-bug-owner').addEventListener('input', applyBugFilters);
    
    document.getElementById('filter-daily-date').addEventListener('change', applyDailyProgressFilters);
    document.getElementById('filter-daily-domain').addEventListener('change', applyDailyProgressFilters);
    
    document.getElementById('daily-content-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addDailyProgress();
    });
    
    document.getElementById('new-domain-name').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addNewDomain();
    });
    
    document.getElementById('new-bug-id').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addNewBug();
    });
    
    var today = new Date().toISOString().split('T')[0];
    document.getElementById('daily-date-input').value = today;
    
    window.onclick = function(event) {
        var modals = ['edit-domain-modal', 'edit-bug-modal', 'edit-daily-progress-modal', 'edit-bu-exit-criteria-modal', 'bulk-upload-bu-modal'];
        modals.forEach(function(id) {
            if (event.target === document.getElementById(id)) {
                var closeFn = 'close' + id.replace('edit-', 'Edit').replace('bulk-upload-bu', 'BulkUploadBU').replace('-modal', 'Modal');
                if (typeof window[closeFn] === 'function') window[closeFn]();
            }
        });
    };
});

// Keyboard shortcut for saving
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveData();
    }
});

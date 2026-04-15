// ==================== URL Routing & Init ====================

// Reserved paths that are NOT project IDs
var RESERVED_PATHS = ['api', 'js', 'css', 'images', 'fonts', 'favicon.ico'];

// Parse projectId from URL path
// Supports: /gpu-bringup/, /project-2/, /project/:id (legacy)
// Falls back to '' for root URL
function getProjectIdFromURL() {
    var pathname = window.location.pathname;

    // Match direct project path: /gpu-bringup/ or /gpu-bringup
    var directMatch = pathname.match(/^\/([^\/\?]+)\/?$/);
    if (directMatch && RESERVED_PATHS.indexOf(directMatch[1]) === -1) {
        return decodeURIComponent(directMatch[1]);
    }

    // Legacy: Match /project/xxx or /project/xxx/
    var legacyMatch = pathname.match(/^\/project\/([^\/]+)\/?$/);
    if (legacyMatch) {
        return decodeURIComponent(legacyMatch[1]);
    }

    return '';
}

// Update browser URL to direct project path without page reload
function updateProjectURL(projectId) {
    var newPath = projectId ? '/' + encodeURIComponent(projectId) + '/' : '/';
    if (window.location.pathname !== newPath) {
        history.pushState({ projectId: projectId }, '', newPath);
    }
}

// Show/hide project switcher based on URL mode
function setProjectSwitcherVisibility(show) {
    var switcher = document.querySelector('.project-switcher');
    if (switcher) {
        switcher.style.display = show ? '' : 'none';
    }
    var backLink = document.getElementById('back-to-list-link');
    if (backLink) {
        backLink.style.display = show ? 'none' : 'inline-block';
    }
}

// Handle browser back/forward navigation
window.addEventListener('popstate', function(event) {
    var projectId = getProjectIdFromURL();
    if (projectId && projectId !== App.currentProject) {
        switchProjectById(projectId);
    }
});

async function initProjects() {
    var urlProjectId = getProjectIdFromURL();
    var isDirectProjectURL = !!urlProjectId;

    // Priority 1: URL path
    if (urlProjectId) {
        App.currentProject = urlProjectId;
    }
    // Priority 2: localStorage
    else {
        var savedProject = localStorage.getItem('currentProject');
        if (savedProject) {
            App.currentProject = savedProject;
        }
    }

    await loadProjects();

    // If the URL project is not in the list, fall back to first project
    var foundProject = App.projectsList.find(function(p) { return p.id === App.currentProject; });
    if (!foundProject && App.projectsList.length > 0) {
        App.currentProject = App.projectsList[0].id;
    }

    var select = document.getElementById('project-select');
    if (select) {
        select.value = App.currentProject;
    }

    // Sync URL to current project
    updateProjectURL(App.currentProject);

    // On direct project URL: hide switcher, update title
    // On root URL: show switcher for browsing all projects
    if (isDirectProjectURL) {
        setProjectSwitcherVisibility(false);
        var proj = App.projectsList.find(function(p) { return p.id === App.currentProject; });
        var projName = proj ? proj.name : App.currentProject;
        document.title = projName + ' - GPU Bring Up Tracker';
        var h1 = document.querySelector('h1');
        if (h1) h1.textContent = projName;
    } else {
        setProjectSwitcherVisibility(true);
    }

    updateProjectTimeline();
}

// Switch to a project by ID (called from popstate or manually)
async function switchProjectById(projectId) {
    if (!projectId || projectId === App.currentProject) return;

    await saveDataToAPI();

    App.currentProject = projectId;
    localStorage.setItem('currentProject', projectId);
    updateProjectURL(projectId);

    await loadDataFromAPI();

    var select = document.getElementById('project-select');
    if (select) select.value = projectId;

    renderProjectSelect();
    updateProjectTimeline();

    var proj = App.projectsList.find(function(p) { return p.id === projectId; });
    var projName = proj ? proj.name : projectId;
    showSyncStatus('已切换到项目: ' + projName, 'success');

    // Update title and switcher visibility
    setProjectSwitcherVisibility(false);
    document.title = projName + ' - GPU Bring Up Tracker';
    var h1 = document.querySelector('h1');
    if (h1) h1.textContent = projName;
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
        var modals = [
            'edit-domain-modal', 'edit-bug-modal', 'edit-daily-progress-modal',
            'edit-bu-exit-criteria-modal', 'domain-import-modal', 'bu-import-modal'
        ];
        modals.forEach(function(id) {
            if (event.target === document.getElementById(id)) {
                var closeFn;
                if (id === 'domain-import-modal') closeFn = 'closeDomainImportModal';
                else if (id === 'bu-import-modal') closeFn = 'closeBUImportModal';
                else closeFn = 'close' + id.replace('edit-', 'Edit').replace('-modal', 'Modal');
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

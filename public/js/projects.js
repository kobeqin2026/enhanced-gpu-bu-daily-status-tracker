// Project management functions

function renderProjectSelect() {
    var select = document.getElementById('project-select');
    select.innerHTML = '';
    
    App.projectsList.forEach(function(project) {
        var option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        if (project.id === App.currentProject) {
            option.selected = true;
        }
        select.appendChild(option);
    });
    
    var currentProjectObj = App.projectsList.find(function(p) { return p.id === App.currentProject; });
    if (currentProjectObj) {
        document.getElementById('current-project-label').textContent = '当前: ' + currentProjectObj.name;
    }
}

async function switchProject() {
    var select = document.getElementById('project-select');
    var newProject = select.value;
    
    if (newProject && newProject !== App.currentProject) {
        await saveDataToAPI();
        
        App.currentProject = newProject;
        localStorage.setItem('currentProject', App.currentProject);
        updateProjectURL(App.currentProject);
        
        await loadDataFromAPI();
        renderProjectSelect();
        updateProjectTimeline();
        
        var proj = App.projectsList.find(function(p) { return p.id === App.currentProject; });
        showSyncStatus('已切换到项目: ' + (proj ? proj.name : ''), 'success');
    }
}

function updateProjectTimeline() {
    var project = App.projectsList.find(function(p) { return p.id === App.currentProject; });
    var timelineEl = document.getElementById('project-timeline');
    
    if (project && project.startDate && project.endDate) {
        var formatDate = function(dateStr) {
            var date = new Date(dateStr);
            return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
        };
        timelineEl.textContent = formatDate(project.startDate) + ' - ' + formatDate(project.endDate);
    } else {
        timelineEl.textContent = '未设置';
    }
}

function showAddProjectModal() {
    document.getElementById('add-project-modal').style.display = 'block';
    document.getElementById('new-project-name').value = '';
    document.getElementById('new-project-description').value = '';
    document.getElementById('new-project-name').focus();
}

function closeAddProjectModal() {
    document.getElementById('add-project-modal').style.display = 'none';
}

async function createNewProject() {
    var name = document.getElementById('new-project-name').value.trim();
    var description = document.getElementById('new-project-description').value.trim();
    
    if (!name) {
        alert('请输入项目名称');
        return;
    }
    
    try {
        var response = await apiCall('/api/projects', {
            method: 'POST',
            body: JSON.stringify({ name: name, description: description })
        });
        
        if (response.success) {
            await loadProjects();
            App.currentProject = response.project.id;
            localStorage.setItem('currentProject', App.currentProject);
            updateProjectURL(App.currentProject);
            await loadDataFromAPI();
            renderProjectSelect();
            closeAddProjectModal();
            showSyncStatus('已创建并切换到新项目: ' + name, 'success');
        } else {
            alert(response.message || '创建项目失败');
        }
    } catch (error) {
        console.error('Failed to create project:', error);
        alert('创建项目失败，请重试');
    }
}

function showEditProjectModal() {
    if (!App.currentProject) {
        alert('请先选择一个项目');
        return;
    }
    
    var project = App.projectsList.find(function(p) { return p.id === App.currentProject; });
    if (!project) {
        alert('项目不存在');
        return;
    }
    
    document.getElementById('edit-project-start-date').value = project.startDate || '';
    document.getElementById('edit-project-end-date').value = project.endDate || '';
    document.getElementById('edit-project-modal').style.display = 'block';
}

function closeEditProjectModal() {
    document.getElementById('edit-project-modal').style.display = 'none';
}

async function saveEditedProject() {
    var startDate = document.getElementById('edit-project-start-date').value;
    var endDate = document.getElementById('edit-project-end-date').value;
    
    var project = App.projectsList.find(function(p) { return p.id === App.currentProject; });
    if (!project) {
        alert('项目不存在');
        return;
    }
    
    try {
        var response = await apiCall('/api/projects/' + App.currentProject, {
            method: 'PUT',
            body: JSON.stringify({ name: project.name, description: project.description || '', startDate: startDate, endDate: endDate })
        });
        
        if (response.success) {
            await loadProjects();
            updateProjectTimeline();
            closeEditProjectModal();
            showSyncStatus('项目时间线已更新', 'success');
        } else {
            alert(response.message || '更新项目失败');
        }
    } catch (error) {
        console.error('Failed to update project:', error);
        alert('更新项目失败，请重试');
    }
}

function showDeleteProjectConfirm() {
    if (!App.currentProject) {
        alert('请先选择一个项目');
        return;
    }
    
    var project = App.projectsList.find(function(p) { return p.id === App.currentProject; });
    if (!project) {
        alert('项目不存在');
        return;
    }
    
    document.getElementById('delete-project-warning').textContent = '确定要删除项目 "' + project.name + '" 吗？';
    document.getElementById('delete-project-modal').style.display = 'block';
}

function closeDeleteProjectModal() {
    document.getElementById('delete-project-modal').style.display = 'none';
}

async function confirmDeleteProject() {
    if (!App.currentProject) return;
    
    var project = App.projectsList.find(function(p) { return p.id === App.currentProject; });
    var projectName = project ? project.name : App.currentProject;
    
    try {
        var response = await apiCall('/api/projects/' + App.currentProject, {
            method: 'DELETE'
        });
        
        if (response.success) {
            App.currentProject = null;
            localStorage.removeItem('currentProject');
            
            await loadProjects();
            
            if (App.projectsList.length > 0) {
                App.currentProject = App.projectsList[0].id;
                localStorage.setItem('currentProject', App.currentProject);
                updateProjectURL(App.currentProject);
                await loadDataFromAPI();
            } else {
                App.currentProject = 'gpu-bringup';
                localStorage.setItem('currentProject', App.currentProject);
                updateProjectURL(App.currentProject);
                App.data = App.getDefaultData();
                App.renderAll();
            }
            
            renderProjectSelect();
            closeDeleteProjectModal();
            showSyncStatus('项目已删除: ' + projectName, 'success');
        } else {
            alert(response.message || '删除项目失败');
        }
    } catch (error) {
        console.error('Failed to delete project:', error);
        alert('删除项目失败，请重试');
    }
}

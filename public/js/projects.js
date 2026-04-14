// Render project select dropdown
function renderProjectSelect() {
    const select = document.getElementById('project-select');
    select.innerHTML = '';
    
    projectsList.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        if (project.id === currentProject) {
            option.selected = true;
        }
        select.appendChild(option);
    });
    
    // Update current project label
    const currentProjectObj = projectsList.find(p => p.id === currentProject);
    if (currentProjectObj) {
        document.getElementById('current-project-label').textContent = `当前: ${currentProjectObj.name}`;
    }
}

// Switch project
async function switchProject() {
    const select = document.getElementById('project-select');
    const newProject = select.value;
    
    if (newProject && newProject !== currentProject) {
        // Save current project data first
        await saveDataToAPI();
        
        // Switch to new project
        currentProject = newProject;
        localStorage.setItem('currentProject', currentProject);
        
        // Load new project data
        await loadDataFromAPI();
        renderProjectSelect();
        updateProjectTimeline();
        
        showSyncStatus(`已切换到项目: ${projectsList.find(p => p.id === currentProject)?.name}`, 'success');
    }
}

// Update project timeline display
function updateProjectTimeline() {
    const project = projectsList.find(p => p.id === currentProject);
    const timelineEl = document.getElementById('project-timeline');
    
    if (project && project.startDate && project.endDate) {
        // Format dates to Chinese format
        const formatDate = (dateStr) => {
            const date = new Date(dateStr);
            return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
        };
        timelineEl.textContent = `${formatDate(project.startDate)} - ${formatDate(project.endDate)}`;
    } else {
        timelineEl.textContent = '未设置';
    }
}

// Show add project modal
function showAddProjectModal() {
    document.getElementById('add-project-modal').style.display = 'block';
    document.getElementById('new-project-name').value = '';
    document.getElementById('new-project-description').value = '';
    document.getElementById('new-project-name').focus();
}

// Close add project modal
function closeAddProjectModal() {
    document.getElementById('add-project-modal').style.display = 'none';
}

// Create new project
async function createNewProject() {
    const name = document.getElementById('new-project-name').value.trim();
    const description = document.getElementById('new-project-description').value.trim();
    
    if (!name) {
        alert('请输入项目名称');
        return;
    }
    
    try {
        const response = await apiCall('/api/projects', {
            method: 'POST',
            body: JSON.stringify({ name, description })
        });
        
        if (response.success) {
            // Reload projects list
            await loadProjects();
            
            // Switch to the new project
            currentProject = response.project.id;
            localStorage.setItem('currentProject', currentProject);
            
            await loadDataFromAPI();
            renderProjectSelect();
            
            closeAddProjectModal();
            showSyncStatus(`已创建并切换到新项目: ${name}`, 'success');
        } else {
            alert(response.message || '创建项目失败');
        }
    } catch (error) {
        console.error('Failed to create project:', error);
        alert('创建项目失败，请重试');
    }
}

// Show edit project modal
function showEditProjectModal() {
    if (!currentProject) {
        alert('请先选择一个项目');
        return;
    }
    
    const project = projectsList.find(p => p.id === currentProject);
    if (!project) {
        alert('项目不存在');
        return;
    }
    
    document.getElementById('edit-project-start-date').value = project.startDate || '';
    document.getElementById('edit-project-end-date').value = project.endDate || '';
    document.getElementById('edit-project-modal').style.display = 'block';
}

// Close edit project modal
function closeEditProjectModal() {
    document.getElementById('edit-project-modal').style.display = 'none';
}

// Save edited project
async function saveEditedProject() {
    const startDate = document.getElementById('edit-project-start-date').value;
    const endDate = document.getElementById('edit-project-end-date').value;
    
    // Get current project name and description to preserve them
    const project = projectsList.find(p => p.id === currentProject);
    if (!project) {
        alert('项目不存在');
        return;
    }
    
    const name = project.name;
    const description = project.description || '';
    
    try {
        const response = await apiCall(`/api/projects/${currentProject}`, {
            method: 'PUT',
            body: JSON.stringify({ name, description, startDate, endDate })
        });
        
        if (response.success) {
            // Reload projects list
            await loadProjects();
            
            // Update timeline display
            updateProjectTimeline();
            
            closeEditProjectModal();
            showSyncStatus(`项目时间线已更新`, 'success');
        } else {
            alert(response.message || '更新项目失败');
        }
    } catch (error) {
        console.error('Failed to update project:', error);
        alert('更新项目失败，请重试');
    }
}

// Show delete project confirmation
function showDeleteProjectConfirm() {
    if (!currentProject) {
        alert('请先选择一个项目');
        return;
    }
    
    const project = projectsList.find(p => p.id === currentProject);
    if (!project) {
        alert('项目不存在');
        return;
    }
    
    document.getElementById('delete-project-warning').textContent = `确定要删除项目 "${project.name}" 吗？`;
    document.getElementById('delete-project-modal').style.display = 'block';
}

// Close delete project modal
function closeDeleteProjectModal() {
    document.getElementById('delete-project-modal').style.display = 'none';
}

// Confirm and delete project
async function confirmDeleteProject() {
    if (!currentProject) return;
    
    const project = projectsList.find(p => p.id === currentProject);
    const projectName = project ? project.name : currentProject;
    
    try {
        const response = await apiCall(`/api/projects/${currentProject}`, {
            method: 'DELETE'
        });
        
        if (response.success) {
            // Clear current project
            currentProject = null;
            localStorage.removeItem('currentProject');
            
            // Clear localStorage data for this project
            localStorage.removeItem(`gpuTrackerData_${currentProject}`);
            
            // Reload projects
            await loadProjects();
            
            // If there are remaining projects, switch to the first one
            if (projectsList.length > 0) {
                currentProject = projectsList[0].id;
                localStorage.setItem('currentProject', currentProject);
                await loadDataFromAPI();
            } else {
                // Create default project if none exist
                currentProject = 'gpu-bringup';
                localStorage.setItem('currentProject', currentProject);
                currentData = getDefaultData();
                renderAll();
            }
            
            renderProjectSelect();
            closeDeleteProjectModal();
            showSyncStatus(`项目已删除: ${projectName}`, 'success');
        } else {
            alert(response.message || '删除项目失败');
        }
    } catch (error) {
        console.error('Failed to delete project:', error);
        alert('删除项目失败，请重试');
    }
}
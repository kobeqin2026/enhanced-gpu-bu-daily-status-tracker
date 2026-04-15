// Storage keys
var PROJECTS_STORAGE_KEY = 'buTracker_projects';
var PROJECT_DATA_PREFIX = 'buTracker_data_';

// ====== Hybrid data management ======
// Strategy:
// 1. Primary: load from API
// 2. Fallback: load from project-specific localStorage
// 3. Save: write localStorage immediately + API async

function saveToLocalStorage(data, projectId) {
    var key = PROJECT_DATA_PREFIX + (projectId || App.currentProject);
    try {
        localStorage.setItem(key, JSON.stringify(data));
        console.log('Data saved to localStorage [' + key + ']');
        localStorage.setItem('buTrackerData', JSON.stringify(data));
    } catch (e) {
        console.error('Failed to save to localStorage:', e);
    }
}

function saveProjectsToLocalStorage(projects) {
    try {
        localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
        console.log('Projects saved to localStorage');
    } catch (e) {
        console.error('Failed to save projects to localStorage:', e);
    }
}

function loadProjectsFromLocalStorage() {
    try {
        var saved = localStorage.getItem(PROJECTS_STORAGE_KEY);
        if (saved) return JSON.parse(saved);
    } catch (e) {
        console.error('Failed to load projects from localStorage:', e);
    }
    return null;
}

function loadFromLocalStorage(projectId) {
    var key = PROJECT_DATA_PREFIX + (projectId || App.currentProject);
    try {
        var savedData = localStorage.getItem(key);
        if (!savedData) {
            savedData = localStorage.getItem('buTrackerData');
        }
        if (savedData) {
            var data = JSON.parse(savedData);
            console.log('Data loaded from localStorage [' + key + ']');
            return data;
        }
    } catch (e) {
        console.error('Failed to load from localStorage:', e);
    }
    return null;
}

// API call with error handling (httpOnly cookie auth + 401 auto-handling)
async function apiCall(url, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json' };
    
    if (options.headers) {
        Object.assign(headers, options.headers);
        delete options.headers;
    }
    
    var defaultOptions = Object.assign({}, options, {
        headers: headers,
        credentials: 'same-origin'
    });
    
    try {
        var response = await fetch(url, defaultOptions);
        
        if (response.status === 401) {
            handleTokenExpired();
            var result = await response.json().catch(function() { return { success: false, message: '登录已过期' }; });
            throw new Error(result.message || '登录已过期，请重新登录');
        }
        
        if (response.status === 403) {
            var result403 = await response.json().catch(function() { return { success: false, message: '无权限访问' }; });
            throw new Error(result403.message || '无权限执行此操作');
        }
        
        if (!response.ok) {
            throw new Error('HTTP ' + response.status + ': ' + response.statusText);
        }
        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

// Token expired handler
function handleTokenExpired() {
    App.currentUser = null;
    App.userRole = null;
    App.authToken = null;
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userRole');
    updateUIBasedOnRole();
    showSyncStatus('登录已过期，请重新登录', 'error');
    showLoginModal();
}

// Load data from API with localStorage fallback
async function loadDataFromAPI() {
    var projectKey = App.currentProject;
    
    try {
        showSyncStatus('正在从服务器加载最新数据...', 'info');
        var data = await apiCall('/api/data?project=' + App.currentProject);
        
        App.data.domains = data.domains || App.data.domains;
        App.data.bugs = data.bugs || App.data.bugs;
        App.data.dailyProgress = data.dailyProgress || App.data.dailyProgress;
        App.data.buExitCriteria = data.buExitCriteria || App.data.buExitCriteria;
        App.data.lastUpdated = data.lastUpdated || App.data.lastUpdated;
        
        saveToLocalStorage(App.data, projectKey);
        
        if (data.lastUpdated) {
            document.getElementById('last-update').textContent = data.lastUpdated.split(' ')[0];
            document.getElementById('timestamp').textContent = data.lastUpdated;
        }
        
        renderDomains(App.data.domains);
        renderBugs(App.data.bugs);
        renderDailyProgress(App.data.dailyProgress);
        renderBUExitCriteria(App.data.buExitCriteria);
        updateUIBasedOnRole();
        
        showSyncStatus('✓ 数据已从服务器同步', 'success');
        return true;
    } catch (error) {
        console.error('Failed to load data from API:', error);
        
        var localData = loadFromLocalStorage(projectKey);
        if (localData) {
            App.data = localData;
            renderDomains(App.data.domains);
            renderBugs(App.data.bugs);
            renderDailyProgress(App.data.dailyProgress);
            renderBUExitCriteria(App.data.buExitCriteria);
            updateUIBasedOnRole();
            
            if (localData.lastUpdated) {
                document.getElementById('last-update').textContent = localData.lastUpdated.split(' ')[0];
                document.getElementById('timestamp').textContent = localData.lastUpdated;
            }
            
            showSyncStatus('⚠ 无法连接服务器，使用本地缓存数据', 'warning');
            return 'localStorage';
        }
        
        showSyncStatus('✗ 无法连接服务器，且无本地缓存', 'error');
        return false;
    }
}

// Save data to API
async function saveDataToAPI() {
    try {
        showSyncStatus('正在保存数据到服务器...', 'info');
        var response = await apiCall('/api/data?project=' + App.currentProject, {
            method: 'POST',
            body: JSON.stringify(Object.assign({}, App.data, { projectId: App.currentProject }))
        });
        
        if (response.success) {
            showSyncStatus('数据已成功保存到服务器！', 'success');
            return true;
        } else {
            throw new Error(response.message || 'Save failed');
        }
    } catch (error) {
        console.error('Failed to save data to API:', error);
        showSyncStatus('服务器保存失败，数据已保存到本地缓存', 'warning');
        return false;
    }
}

// Load projects list from API with localStorage fallback
async function loadProjects() {
    try {
        var projects = await apiCall('/api/projects');
        App.projectsList = projects;
        saveProjectsToLocalStorage(projects);
        renderProjectSelect();
        return projects;
    } catch (error) {
        console.error('Failed to load projects from API:', error);
        
        var localProjects = loadProjectsFromLocalStorage();
        if (localProjects) {
            App.projectsList = localProjects;
            showSyncStatus('⚠ 服务器不可用，使用本地项目列表', 'warning');
        } else {
            App.projectsList = [
                { id: 'gpu-bringup', name: 'GPU Bring Up', description: '国产GPU芯片bring up每日追踪', createdAt: new Date().toISOString() }
            ];
        }
        renderProjectSelect();
        return App.projectsList;
    }
}

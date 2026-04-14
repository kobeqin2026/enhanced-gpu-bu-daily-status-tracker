// Storage keys
const PROJECTS_STORAGE_KEY = 'buTracker_projects';
const PROJECT_DATA_PREFIX = 'buTracker_data_';

// ====== 混合数据管理模式 ======
// 策略：
// 1. 优先从API加载数据
// 2. API失败时，从项目特定的localStorage加载
// 3. 保存时同时写localStorage（立即）和API（异步）

// 保存到localStorage（项目隔离）
function saveToLocalStorage(data, projectId) {
    const key = PROJECT_DATA_PREFIX + (projectId || currentProject);
    try {
        // 保存项目特定数据
        localStorage.setItem(key, JSON.stringify(data));
        console.log(`Data saved to localStorage [${key}]`);
        
        // 同时保存备份（最后一个项目）
        localStorage.setItem('buTrackerData', JSON.stringify(data));
    } catch (e) {
        console.error('Failed to save to localStorage:', e);
    }
}

// 保存项目列表到localStorage
function saveProjectsToLocalStorage(projects) {
    try {
        localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
        console.log('Projects saved to localStorage');
    } catch (e) {
        console.error('Failed to save projects to localStorage:', e);
    }
}

// 从localStorage加载项目列表
function loadProjectsFromLocalStorage() {
    try {
        const saved = localStorage.getItem(PROJECTS_STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load projects from localStorage:', e);
    }
    return null;
}

// Load from localStorage (项目隔离 fallback)
function loadFromLocalStorage(projectId) {
    const key = PROJECT_DATA_PREFIX + (projectId || currentProject);
    try {
        let savedData = localStorage.getItem(key);
        
        // 如果没有项目特定的数据，尝试加载备份
        if (!savedData) {
            savedData = localStorage.getItem('buTrackerData');
        }
        
        if (savedData) {
            const data = JSON.parse(savedData);
            console.log(`Data loaded from localStorage [${key}]`);
            return data;
        }
    } catch (e) {
        console.error('Failed to load from localStorage:', e);
    }
    return null;
}

// 获取同步状态文字描述
function getSyncModeText(source) {
    const modes = {
        'api': '从服务器加载',
        'localStorage': '从本地缓存加载',
        'default': '使用默认数据',
        'saved': '已保存到本地缓存'
    };
    return modes[source] || modes['default'];
}

// API call with error handling (使用httpOnly cookie认证 + 401自动处理)
async function apiCall(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
    };
    
    // 合并headers：保留options中自定义的headers
    if (options.headers) {
        Object.assign(headers, options.headers);
        delete options.headers;
    }
    
    const defaultOptions = {
        ...options,
        headers: headers,
        credentials: 'same-origin',  // 自动发送httpOnly cookie
    };
    
    try {
        const response = await fetch(url, defaultOptions);
        
        // 401 未授权：token过期或无效，自动处理
        if (response.status === 401) {
            handleTokenExpired();
            const result = await response.json().catch(() => ({ success: false, message: '登录已过期' }));
            throw new Error(result.message || '登录已过期，请重新登录');
        }
        
        // 403 禁止访问
        if (response.status === 403) {
            const result = await response.json().catch(() => ({ success: false, message: '无权限访问' }));
            throw new Error(result.message || '无权限执行此操作');
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

// Token过期处理：清除状态，提示重新登录
function handleTokenExpired() {
    currentUser = null;
    userRole = null;
    authToken = null;
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userRole');
    updateUIBasedOnRole();
    showSyncStatus('登录已过期，请重新登录', 'error');
    // 自动弹出登录框
    showLoginModal();
}

// Load data from API (primary source) with localStorage fallback
async function loadDataFromAPI() {
    const projectKey = currentProject;
    
    try {
        showSyncStatus('正在从服务器加载最新数据...', 'info');
        const data = await apiCall(`/api/data?project=${currentProject}`);
        
        // Update global data
        currentData.domains = data.domains || currentData.domains;
        currentData.bugs = data.bugs || currentData.bugs;
        currentData.dailyProgress = data.dailyProgress || currentData.dailyProgress;
        currentData.buExitCriteria = data.buExitCriteria || currentData.buExitCriteria;
        currentData.lastUpdated = data.lastUpdated || currentData.lastUpdated;
        
        // Save to localStorage as backup (project-specific)
        saveToLocalStorage(currentData, projectKey);
        
        // Update UI
        if (data.lastUpdated) {
            document.getElementById('last-update').textContent = data.lastUpdated.split(' ')[0];
            document.getElementById('timestamp').textContent = data.lastUpdated;
        }
        
        renderDomains(currentData.domains);
        renderBugs(currentData.bugs);
        renderDailyProgress(currentData.dailyProgress);
        renderBUExitCriteria(currentData.buExitCriteria);
        
        // Update UI based on role after rendering data
        updateUIBasedOnRole();
        
        showSyncStatus('✓ 数据已从服务器同步', 'success');
        return true;
    } catch (error) {
        console.error('Failed to load data from API:', error);
        
        // Fallback: 尝试从项目特定的localStorage加载
        const localData = loadFromLocalStorage(projectKey);
        if (localData) {
            currentData = localData;
            renderDomains(currentData.domains);
            renderBugs(currentData.bugs);
            renderDailyProgress(currentData.dailyProgress);
            renderBUExitCriteria(currentData.buExitCriteria);
            
            // Update UI based on role after rendering data
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

// Save data to API (primary storage)
async function saveDataToAPI() {
    try {
        showSyncStatus('正在保存数据到服务器...', 'info');
        const response = await apiCall(`/api/data?project=${currentProject}`, {
            method: 'POST',
            body: JSON.stringify({ ...currentData, projectId: currentProject })
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

// Load projects list from API (primary) with localStorage fallback
async function loadProjects() {
    try {
        const projects = await apiCall('/api/projects');
        projectsList = projects;
        // 保存项目列表到localStorage作为备份
        saveProjectsToLocalStorage(projects);
        renderProjectSelect();
        return projects;
    } catch (error) {
        console.error('Failed to load projects from API:', error);
        
        // 尝试从localStorage加载
        const localProjects = loadProjectsFromLocalStorage();
        if (localProjects) {
            projectsList = localProjects;
            showSyncStatus('⚠ 服务器不可用，使用本地项目列表', 'warning');
        } else {
            // 默认项目
            projectsList = [
                { id: 'gpu-bringup', name: 'GPU Bring Up', description: '国产GPU芯片bring up每日追踪', createdAt: new Date().toISOString() }
            ];
        }
        renderProjectSelect();
        return projectsList;
    }
}
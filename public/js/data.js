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

        // 409 = 乐观并发冲突 (数据已在别处更新): 抛出带 stale 标记 + 服务端最新数据的错误, 供保存流程合并重试
        if (response.status === 409) {
            var result409 = await response.json().catch(function() { return { success: false, message: '数据已更新' }; });
            var err409 = new Error((result409 && result409.message) || '数据已更新，请重新提交');
            err409.stale = true;
            err409.latestData = (result409 && result409.currentData) || null;
            throw err409;
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
    // 守卫: 仅当用户当前处于登录会话(有 token)时才视为"会话失效"强制登出并弹登录;
    // 若本就未登录(无 token), 该 401 只是未登录时的普通请求(登录门已处理), 不弹登录弹窗,
    // 避免初始化阶段未登录加载数据时弹出登录窗并在登录后残留"又要登录一次"。
    if (!App || !App.authToken) { updateUIBasedOnRole(); return; }
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
        // 乐观并发: 记录服务端版本, 保存时回传用于校验是否过期 (防止整包覆盖丢数据)
        App.data.version = typeof data.version === 'number' ? data.version : App.data.version;
        
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
        if (typeof loadJiraDomainProjects === 'function') loadJiraDomainProjects();
        
        // 2026-09-30: 项目配置了 jiraProject → 每次页面加载自动从 JIRA 拉取最新 Bug 并同步进本地(主页面Bug表)
        // 2026-10-02: 不再要求 bugs 数组为空(原逻辑只要 bugs 非空就不自动拉, 导致 BR288Y-1615 等新 bug 不出现);
        //   _autoJiraBugSync 防同一次页面加载内重复触发(flag 在页面刷新后重置, 即每次页面加载同步一次)
        if (!App._autoJiraBugSync) {
            var syncProj = (App.projectsList || []).find(function(p) { return p.id === App.currentProject; });
            if (syncProj && syncProj.jiraProject && typeof syncJiraBugsToProject === 'function') {
                App._autoJiraBugSync = true;
                syncJiraBugsToProject();
            }
        }
        
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
            if (typeof response.version === 'number') App.data.version = response.version;
            showSyncStatus('数据已成功保存到服务器！', 'success');
            return true;
        } else {
            throw new Error(response.message || 'Save failed');
        }
    } catch (error) {
        // 409 乐观并发: 数据已在别处更新 → 合并重试, 防止整包覆盖丢数据 (lost update)
        if (error && error.stale) {
            return await retrySaveWithMerge(error.latestData);
        }
        console.error('Failed to save data to API:', error);
        showSyncStatus('⚠ 保存失败：记录尚未写入服务器(可能被限流/网络)，已暂留本页；请保存重试，刷新前先核对，避免丢记录', 'error');
        return false;
    }
}

// 乐观并发冲突恢复: 以服务端最新数据为基准, 合并本地"刚新增/已修改"的记录(按 id), 再重存
// 目的: 杜绝"整包覆盖丢数据" — 客户端旧页面保存时不再静默丢掉服务端已有的记录
// preferServer=true(仅 domains): 服务端(最新)为准 —— 域是集中维护的实体(owner/status 等);
//   409 合并(说明客户端是 stale 快照)时不让 stale 客户端覆盖服务端同 id 域, 否则一个旧页面的
//   整包保存会把刚设置的域 owner/状态顶回旧值(lost update)。stale 客户端新加的域仍保留(push)。
function mergeDataById(latest, local, preferServer) {
    var latestIds = (latest || []).map(function(x) { return x && x.id; });
    var out = (latest || []).slice();    // 以服务端为基准 (恢复被旧保存丢弃的记录)
    (local || []).forEach(function(l) {
        var idx = latestIds.indexOf(l && l.id);
        if (idx >= 0) {
            if (!preferServer) out[idx] = l;   // bugs/dailyProgress/criteria: 客户端同 id 覆盖(客户端新造/编辑)
            // preferServer(domains): 保留服务端版本, 不让 stale 客户端覆盖同 id 域
        } else {
            out.push(l);                 // 客户端新增的记录 → 保留
        }
    });
    return out;
}

async function retrySaveWithMerge(latestData) {
    try {
        var merged = latestData || {};
        ['domains', 'bugs', 'dailyProgress', 'buExitCriteria'].forEach(function(key) {
            // domains: 服务端为准(域集中维护, stale 客户端不推翻服务端同 id 域的 owner/状态 — 防"刚设的 owner 被顶回");
            // 其余记录: 客户端同 id 覆盖(客户端新造/编辑的记录以客户端为准)
            merged[key] = mergeDataById((merged[key] || []), (App.data[key] || []), key === 'domains');
        });
        App.data = merged;
        // 重存 (携带合并后的最新 version)
        var response = await apiCall('/api/data?project=' + App.currentProject, {
            method: 'POST',
            body: JSON.stringify(Object.assign({}, App.data, { projectId: App.currentProject }))
        });
        if (response.success) {
            if (typeof response.version === 'number') App.data.version = response.version;
            // 同步渲染 (合并可能恢复了一些被旧保存丢弃的记录)
            if (typeof renderDailyProgress === 'function') renderDailyProgress(App.data.dailyProgress);
            if (typeof renderDomains === 'function') renderDomains(App.data.domains);
            if (typeof renderBugs === 'function') renderBugs(App.data.bugs);
            if (typeof renderBUExitCriteria === 'function') renderBUExitCriteria(App.data.buExitCriteria);
            showSyncStatus('✓ 检测到数据已在别处更新，已自动合并并重新保存', 'success');
            return true;
        }
        throw new Error('Save failed after merge');
    } catch (e) {
        console.error('Merge-save failed:', e);
        showSyncStatus('⚠ 保存冲突：记录尚未写入服务器，已暂留本页；请刷新后核对并重试，避免丢记录', 'error');
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
                { id: 'demo-daily', name: 'Demo Daily', description: 'daily demo project', createdAt: new Date().toISOString() }
            ];
        }
        renderProjectSelect();
        return App.projectsList;
    }
}

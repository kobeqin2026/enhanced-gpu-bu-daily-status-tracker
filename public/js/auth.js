// ==================== User Authentication ====================

function isLoggedIn() {
    return App.currentUser !== null;
}

function isAdmin() {
    return App.userRole === 'admin';
}

function requireAdmin() {
    if (!isAdmin()) {
        alert('您没有权限执行此操作，请使用管理员账号登录');
        return false;
    }
    return true;
}

function updateUIBasedOnRole() {
    var loginBtn = document.getElementById('login-btn');
    var logoutBtn = document.getElementById('logout-btn');
    var loginStatus = document.getElementById('login-status');
    var adminButtons = document.querySelectorAll('.admin-only');
    var userButtons = document.querySelectorAll('.user-only');
    
    if (isLoggedIn() && isAdmin()) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        
        loginStatus.innerHTML = '<span class="user-info" style="font-weight:bold; color:#2c3e50; margin-right:8px;">' + escapeHtml(App.currentUser) + '</span> <span class="user-role role-admin" style="background:#e74c3c;">管理员</span>';
        
        adminButtons.forEach(function(btn) { btn.classList.add('visible'); });
        userButtons.forEach(function(btn) { btn.classList.add('visible'); });
    } else if (isLoggedIn()) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        
        loginStatus.innerHTML = '<span class="user-info" style="font-weight:bold; color:#2c3e50; margin-right:8px;">' + escapeHtml(App.currentUser) + '</span> <span class="user-role role-user" style="background:#27ae60;">普通用户</span>';
        
        adminButtons.forEach(function(btn) { btn.classList.remove('visible'); });
        userButtons.forEach(function(btn) { btn.classList.add('visible'); });
    } else {
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        loginStatus.innerHTML = '<span class="user-info" style="color:#999;">未登录（只读模式）</span>';
        
        adminButtons.forEach(function(btn) { btn.classList.remove('visible'); });
        userButtons.forEach(function(btn) { btn.classList.remove('visible'); });
    }
}

function showLoginModal() {
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-modal').style.display = 'block';
}

function closeLoginModal() {
    document.getElementById('login-modal').style.display = 'none';
}

async function doLogin() {
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    
    if (!username || !password) {
        alert('请输入用户名和密码');
        return;
    }
    
    try {
        var response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        });
        
        var result = await response.json();
        
        if (result.success) {
            App.currentUser = result.user.name;
            App.userRole = result.user.role;
            App.authToken = result.token;
            
            localStorage.setItem('currentUser', App.currentUser);
            localStorage.setItem('userRole', App.userRole);
            
            closeLoginModal();
            updateUIBasedOnRole();
            
            if (isAdmin()) {
                showSyncStatus('登录成功！您是管理员，可以编辑所有内容', 'success');
            } else {
                showSyncStatus('登录成功！您是普通用户，只能查看', 'info');
            }
        } else {
            alert(result.message || '用户名或密码错误');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('登录失败，请稍后重试');
    }
}

async function logout() {
    try {
        await apiCall('/api/auth/logout', { method: 'POST' });
    } catch (error) {
        console.error('Logout error:', error);
    }
    
    App.currentUser = null;
    App.userRole = null;
    App.authToken = null;
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userRole');
    
    updateUIBasedOnRole();
    showSyncStatus('已退出登录', 'info');
}

async function loadSavedUser() {
    try {
        var response = await fetch('/api/auth/verify', {
            credentials: 'same-origin'
        });
        
        if (response.status === 401) {
            localStorage.removeItem('currentUser');
            localStorage.removeItem('userRole');
            App.currentUser = null;
            App.userRole = null;
            App.authToken = null;
            updateUIBasedOnRole();
            return;
        }
        
        var result = await response.json();
        
        if (result.success) {
            App.currentUser = result.user.name;
            App.userRole = result.user.role;
            localStorage.setItem('currentUser', App.currentUser);
            localStorage.setItem('userRole', App.userRole);
        } else {
            localStorage.removeItem('currentUser');
            localStorage.removeItem('userRole');
            App.currentUser = null;
            App.userRole = null;
            App.authToken = null;
        }
    } catch (error) {
        console.error('Token verification error:', error);
        localStorage.removeItem('currentUser');
        localStorage.removeItem('userRole');
        App.currentUser = null;
        App.userRole = null;
        App.authToken = null;
    }
    updateUIBasedOnRole();
}

// ============ User Management ============

function showUserManagementModal() {
    if (!isLoggedIn()) {
        alert('请先登录');
        showLoginModal();
        return;
    }
    
    document.getElementById('user-management-modal').style.display = 'block';
    loadUserList();
}

function closeUserManagementModal() {
    document.getElementById('user-management-modal').style.display = 'none';
}

async function loadUserList() {
    var addUserSection = document.getElementById('add-user-section');
    var userViewOnly = document.getElementById('user-view-only');
    
    if (App.userRole === 'admin') {
        addUserSection.style.display = 'block';
        userViewOnly.style.display = 'none';
    } else {
        addUserSection.style.display = 'none';
        userViewOnly.style.display = 'block';
    }
    
    var userListEl = document.getElementById('user-list');
    userListEl.innerHTML = '<p style="color:#666;">加载中...</p>';
    
    try {
        var result = await apiCall('/api/users');
        
        if (Array.isArray(result)) {
            if (result.length === 0) {
                userListEl.innerHTML = '<p style="color:#666;">暂无用户</p>';
                return;
            }
            
            var html = '<table style="width:100%; border-collapse:collapse; font-size:14px;">';
            html += '<tr style="background:#3498db; color:white;"><th style="padding:8px; text-align:left;">用户名</th><th style="padding:8px; text-align:left;">显示名称</th><th style="padding:8px; text-align:left;">角色</th><th style="padding:8px; text-align:left;">操作</th></tr>';
            
            result.forEach(function(user) {
                var roleText = user.role === 'admin' ? '管理员' : '普通用户';
                var roleClass = user.role === 'admin' ? 'role-admin' : 'role-user';
                var isCurrentUser = user.username === localStorage.getItem('currentUser');
                var isLoggedInUser = App.userRole !== null;
                
                html += '<tr style="border-bottom:1px solid #ddd;">';
                html += '<td style="padding:8px;">' + escapeHtml(user.username) + '</td>';
                html += '<td style="padding:8px;">' + escapeHtml(user.name) + '</td>';
                html += '<td style="padding:8px;"><span class="user-role ' + roleClass + '">' + roleText + '</span></td>';
                html += '<td style="padding:8px;">';
                if (isLoggedInUser) {
                    if (user.role !== 'admin') {
                        html += '<button class="edit-btn" onclick="showEditUserModal(\'' + escapeHtml(user.username) + '\', \'' + escapeHtml(user.name) + '\', \'' + escapeHtml(user.role) + '\')" style="padding:4px 8px; font-size:12px; margin-right:5px;">编辑</button>';
                    } else if (isCurrentUser) {
                        html += '<button class="edit-btn" onclick="showEditUserModal(\'' + escapeHtml(user.username) + '\', \'' + escapeHtml(user.name) + '\', \'' + escapeHtml(user.role) + '\')" style="padding:4px 8px; font-size:12px; margin-right:5px;">编辑</button>';
                    } else {
                        html += '<span style="color:#999; font-size:12px;">-</span>';
                    }
                    if (App.userRole === 'admin' && user.role !== 'admin' && !isCurrentUser) {
                        html += '<button class="delete-btn" onclick="deleteUser(\'' + escapeHtml(user.username) + '\')" style="padding:4px 8px; font-size:12px;">删除</button>';
                    } else if (App.userRole === 'admin' && user.role === 'admin' && isCurrentUser) {
                        html += '<span style="color:#999; font-size:12px;">(当前)</span>';
                    } else if (App.userRole === 'admin' && user.role === 'admin') {
                        html += '<span style="color:#999; font-size:12px;">-</span>';
                    } else if (isCurrentUser) {
                        html += '<span style="color:#999; font-size:12px;">(当前)</span>';
                    } else {
                        html += '<span style="color:#999; font-size:12px;">-</span>';
                    }
                } else {
                    html += '<span style="color:#999; font-size:12px;">只读</span>';
                }
                html += '</td></tr>';
            });
            
            html += '</table>';
            userListEl.innerHTML = html;
        } else {
            userListEl.innerHTML = '<p style="color:#e74c3c;">无法加载用户列表</p>';
        }
    } catch (error) {
        console.error('Load users error:', error);
        if (error.message && (error.message.indexOf('登录已过期') !== -1 || error.message.indexOf('无权限') !== -1)) {
            userListEl.innerHTML = '<p style="color:#e74c3c;">' + escapeHtml(error.message) + '</p>';
        } else {
            userListEl.innerHTML = '<p style="color:#e74c3c;">加载失败，请稍后重试</p>';
        }
    }
}

async function addNewUser() {
    var username = document.getElementById('new-user-username').value.trim();
    var password = document.getElementById('new-user-password').value;
    var name = document.getElementById('new-user-name').value.trim();
    var role = document.getElementById('new-user-role').value;
    
    if (!username || !password || !name) {
        alert('请填写所有字段');
        return;
    }
    
    if (password.length < 4) {
        alert('密码至少4个字符');
        return;
    }
    
    try {
        var result = await apiCall('/api/users', {
            method: 'POST',
            body: JSON.stringify({ username: username, password: password, name: name, role: role })
        });
        
        if (result.success) {
            alert('用户创建成功');
            document.getElementById('new-user-username').value = '';
            document.getElementById('new-user-password').value = '';
            document.getElementById('new-user-name').value = '';
            await loadUserList();
        } else {
            alert(result.message || '创建失败');
        }
    } catch (error) {
        console.error('Add user error:', error);
        alert(error.message || '创建失败，请稍后重试');
    }
}

function showEditUserModal(username, name, role) {
    document.getElementById('edit-user-username').value = username;
    document.getElementById('edit-user-name').value = name;
    document.getElementById('edit-user-role').value = role;
    document.getElementById('edit-user-password').value = '';
    document.getElementById('edit-user-modal').style.display = 'block';
}

function closeEditUserModal() {
    document.getElementById('edit-user-modal').style.display = 'none';
}

async function saveUserEdit() {
    var username = document.getElementById('edit-user-username').value;
    var name = document.getElementById('edit-user-name').value.trim();
    var role = document.getElementById('edit-user-role').value;
    var newPassword = document.getElementById('edit-user-password').value;
    
    if (!name) {
        alert('请填写显示名称');
        return;
    }
    
    if (newPassword && newPassword.length < 4) {
        alert('密码至少4个字符');
        return;
    }
    
    try {
        var result = await apiCall('/api/users/' + username, {
            method: 'PUT',
            body: JSON.stringify({ name: name, role: role })
        });
        
        if (!result.success) {
            alert(result.message || '更新失败');
            return;
        }
        
        if (newPassword) {
            var pwResult = await apiCall('/api/users/' + username + '/password', {
                method: 'PUT',
                body: JSON.stringify({ newPassword: newPassword })
            });
            
            if (!pwResult.success) {
                alert(pwResult.message || '密码更新失败');
                return;
            }
        }
        
        alert('用户信息已更新');
        closeEditUserModal();
        await loadUserList();
    } catch (error) {
        console.error('Save user edit error:', error);
        alert(error.message || '保存失败，请稍后重试');
    }
}

async function deleteUser(username) {
    if (!confirm('确定要删除用户 "' + username + '" 吗？')) {
        return;
    }
    
    try {
        var result = await apiCall('/api/users/' + username, {
            method: 'DELETE'
        });
        
        if (result.success) {
            alert('用户已删除');
            await loadUserList();
        } else {
            alert(result.message || '删除失败');
        }
    } catch (error) {
        console.error('Delete user error:', error);
        alert(error.message || '删除失败，请稍后重试');
    }
}

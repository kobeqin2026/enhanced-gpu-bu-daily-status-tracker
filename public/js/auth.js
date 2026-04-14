// ==================== User Authentication ====================

// Check if user is logged in
function isLoggedIn() {
    return currentUser !== null;
}

// Check if current user is admin
function isAdmin() {
    return userRole === 'admin';
}

// Require admin permission - returns true if admin, shows alert if not
function requireAdmin() {
    if (!isAdmin()) {
        alert('您没有权限执行此操作，请使用管理员账号登录');
        return false;
    }
    return true;
}

// Update UI based on user role
function updateUIBasedOnRole() {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const loginStatus = document.getElementById('login-status');
    const adminButtons = document.querySelectorAll('.admin-only');
    const userButtons = document.querySelectorAll('.user-only');
    
    if (isLoggedIn() && isAdmin()) {
        // 已登录且是管理员 - 显示所有管理按钮
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        
        loginStatus.innerHTML = `
            <span class="user-info" style="font-weight:bold; color:#2c3e50; margin-right:8px;">👤 ${currentUser}</span>
            <span class="user-role role-admin" style="background:#e74c3c;">管理员</span>
        `;
        
        // 显示管理员专用按钮
        adminButtons.forEach(btn => {
            btn.classList.add('visible');
        });
        // 显示登录用户专用按钮
        userButtons.forEach(btn => {
            btn.classList.add('visible');
        });
    } else if (isLoggedIn()) {
        // 已登录但不是管理员 - 显示用户管理按钮
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        
        loginStatus.innerHTML = `
            <span class="user-info" style="font-weight:bold; color:#2c3e50; margin-right:8px;">👤 ${currentUser}</span>
            <span class="user-role role-user" style="background:#27ae60;">普通用户</span>
        `;
        
        // 隐藏管理员专用按钮
        adminButtons.forEach(btn => {
            btn.classList.remove('visible');
        });
        // 显示登录用户专用按钮
        userButtons.forEach(btn => {
            btn.classList.add('visible');
        });
    } else {
        // 未登录 - 隐藏所有管理按钮
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        loginStatus.innerHTML = '<span class="user-info" style="color:#999;">未登录（只读模式）</span>';
        
        // 隐藏管理员专用按钮
        adminButtons.forEach(btn => {
            btn.classList.remove('visible');
        });
        // 隐藏登录用户专用按钮
        userButtons.forEach(btn => {
            btn.classList.remove('visible');
        });
    }
}

// Show login modal
function showLoginModal() {
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-modal').style.display = 'block';
}

// Close login modal
function closeLoginModal() {
    document.getElementById('login-modal').style.display = 'none';
}

// Perform login - 使用后端API
async function doLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    
    if (!username || !password) {
        alert('请输入用户名和密码');
        return;
    }
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const result = await response.json();
        
        if (result.success) {
            currentUser = result.user.name;
            userRole = result.user.role;
            authToken = result.token;
            
            // Save to localStorage
            localStorage.setItem('currentUser', currentUser);
            localStorage.setItem('userRole', userRole);
            localStorage.setItem('authToken', authToken);
            
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

// Logout - 使用后端API
async function logout() {
    const token = localStorage.getItem('authToken');
    
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
    } catch (error) {
        console.error('Logout error:', error);
    }
    
    currentUser = null;
    userRole = null;
    authToken = null;
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userRole');
    localStorage.removeItem('authToken');
    
    updateUIBasedOnRole();
    showSyncStatus('已退出登录', 'info');
}

// Load saved user on page load - 验证token
async function loadSavedUser() {
    const savedUser = localStorage.getItem('currentUser');
    const savedRole = localStorage.getItem('userRole');
    const savedToken = localStorage.getItem('authToken');
    
    if (savedUser && savedRole && savedToken) {
        // 验证token是否有效
        try {
            const response = await fetch('/api/auth/verify', {
                headers: { 'Authorization': `Bearer ${savedToken}` }
            });
            
            const result = await response.json();
            
            if (result.success) {
                currentUser = result.user.name;
                userRole = result.user.role;
                authToken = savedToken;
            } else {
                // Token无效，清除localStorage和变量
                localStorage.removeItem('currentUser');
                localStorage.removeItem('userRole');
                localStorage.removeItem('authToken');
                currentUser = null;
                userRole = null;
                authToken = null;
            }
        } catch (error) {
            console.error('Token verification error:', error);
            // 网络错误时使用缓存的用户信息
            currentUser = savedUser;
            userRole = savedRole;
            authToken = savedToken;
        }
    }
    updateUIBasedOnRole();
}

// ============ 用户管理函数 ============

// 获取认证头
function getAuthHeaders() {
    const token = localStorage.getItem('authToken');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

// 显示用户管理Modal
async function showUserManagementModal() {
    // 需要登录才能访问用户管理
    if (!isLoggedIn()) {
        alert('请先登录');
        showLoginModal();
        return;
    }
    
    document.getElementById('user-management-modal').style.display = 'block';
    await loadUserList();
}

// 关闭用户管理Modal
function closeUserManagementModal() {
    document.getElementById('user-management-modal').style.display = 'none';
}

// 加载用户列表
async function loadUserList() {
    // 根据角色显示/隐藏添加用户区域
    const addUserSection = document.getElementById('add-user-section');
    const userViewOnly = document.getElementById('user-view-only');
    
    if (userRole === 'admin') {
        addUserSection.style.display = 'block';
        userViewOnly.style.display = 'none';
    } else {
        addUserSection.style.display = 'none';
        userViewOnly.style.display = 'block';
    }
    
    const userListEl = document.getElementById('user-list');
    userListEl.innerHTML = '<p style="color:#666;">加载中...</p>';
    
    try {
        const response = await fetch('/api/users', {
            headers: getAuthHeaders()
        });
        
        const result = await response.json();
        
        if (Array.isArray(result)) {
            if (result.length === 0) {
                userListEl.innerHTML = '<p style="color:#666;">暂无用户</p>';
                return;
            }
            
            let html = '<table style="width:100%; border-collapse:collapse; font-size:14px;">';
            html += '<tr style="background:#3498db; color:white;"><th style="padding:8px; text-align:left;">用户名</th><th style="padding:8px; text-align:left;">显示名称</th><th style="padding:8px; text-align:left;">角色</th><th style="padding:8px; text-align:left;">操作</th></tr>';
            
            result.forEach(user => {
                const roleText = user.role === 'admin' ? '管理员' : '普通用户';
                const roleClass = user.role === 'admin' ? 'role-admin' : 'role-user';
                const isCurrentUser = user.username === localStorage.getItem('currentUser');
                const isLoggedInUser = userRole !== null; // 已登录用户（包括普通用户和管理员）
                
                html += `<tr style="border-bottom:1px solid #ddd;">`;
                html += `<td style="padding:8px;">${user.username}</td>`;
                html += `<td style="padding:8px;">${user.name}</td>`;
                html += `<td style="padding:8px;"><span class="user-role ${roleClass}">${roleText}</span></td>`;
                html += `<td style="padding:8px;">`;
                if (isLoggedInUser) {
                    // 登录用户都可以编辑（但不能编辑管理员账户）
                    if (user.role !== 'admin') {
                        html += `<button class="edit-btn" onclick="showEditUserModal('${user.username}', '${user.name}', '${user.role}')" style="padding:4px 8px; font-size:12px; margin-right:5px;">编辑</button>`;
                    } else if (isCurrentUser) {
                        // 管理员可以编辑自己的信息
                        html += `<button class="edit-btn" onclick="showEditUserModal('${user.username}', '${user.name}', '${user.role}')" style="padding:4px 8px; font-size:12px; margin-right:5px;">编辑</button>`;
                    } else {
                        html += `<span style="color:#999; font-size:12px;">-</span>`;
                    }
                    // 禁止删除管理员账户
                    if (userRole === 'admin' && user.role !== 'admin' && !isCurrentUser) {
                        html += `<button class="delete-btn" onclick="deleteUser('${user.username}')" style="padding:4px 8px; font-size:12px;">删除</button>`;
                    } else if (userRole === 'admin' && user.role === 'admin' && isCurrentUser) {
                        html += `<span style="color:#999; font-size:12px;">(当前)</span>`;
                    } else if (userRole === 'admin' && user.role === 'admin') {
                        html += `<span style="color:#999; font-size:12px;">-</span>`;
                    } else if (isCurrentUser) {
                        html += `<span style="color:#999; font-size:12px;">(当前)</span>`;
                    } else {
                        html += `<span style="color:#999; font-size:12px;">-</span>`;
                    }
                } else {
                    // 未登录
                    html += `<span style="color:#999; font-size:12px;">只读</span>`;
                }
                html += `</td></tr>`;
            });
            
            html += '</table>';
            userListEl.innerHTML = html;
        } else {
            userListEl.innerHTML = '<p style="color:#e74c3c;">无法加载用户列表</p>';
        }
    } catch (error) {
        console.error('Load users error:', error);
        userListEl.innerHTML = '<p style="color:#e74c3c;">加载失败，请稍后重试</p>';
    }
}

// 添加新用户
async function addNewUser() {
    const username = document.getElementById('new-user-username').value.trim();
    const password = document.getElementById('new-user-password').value;
    const name = document.getElementById('new-user-name').value.trim();
    const role = document.getElementById('new-user-role').value;
    
    if (!username || !password || !name) {
        alert('请填写所有字段');
        return;
    }
    
    if (password.length < 4) {
        alert('密码至少4个字符');
        return;
    }
    
    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ username, password, name, role })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('用户创建成功');
            // 清空表单
            document.getElementById('new-user-username').value = '';
            document.getElementById('new-user-password').value = '';
            document.getElementById('new-user-name').value = '';
            // 刷新用户列表
            await loadUserList();
        } else {
            alert(result.message || '创建失败');
        }
    } catch (error) {
        console.error('Add user error:', error);
        alert('创建失败，请稍后重试');
    }
}

// 显示编辑用户Modal
function showEditUserModal(username, name, role) {
    document.getElementById('edit-user-username').value = username;
    document.getElementById('edit-user-name').value = name;
    document.getElementById('edit-user-role').value = role;
    document.getElementById('edit-user-password').value = '';
    document.getElementById('edit-user-modal').style.display = 'block';
}

// 关闭编辑用户Modal
function closeEditUserModal() {
    document.getElementById('edit-user-modal').style.display = 'none';
}

// 保存用户编辑
async function saveUserEdit() {
    const username = document.getElementById('edit-user-username').value;
    const name = document.getElementById('edit-user-name').value.trim();
    const role = document.getElementById('edit-user-role').value;
    const newPassword = document.getElementById('edit-user-password').value;
    
    if (!name) {
        alert('请填写显示名称');
        return;
    }
    
    if (newPassword && newPassword.length < 4) {
        alert('密码至少4个字符');
        return;
    }
    
    try {
        // 先更新用户信息
        const response = await fetch(`/api/users/${username}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name, role })
        });
        
        const result = await response.json();
        
        if (!result.success) {
            alert(result.message || '更新失败');
            return;
        }
        
        // 如果填写了新密码，更新密码
        if (newPassword) {
            const pwResponse = await fetch(`/api/users/${username}/password`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ newPassword })
            });
            
            const pwResult = await pwResponse.json();
            
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
        alert('保存失败，请稍后重试');
    }
}

// 删除用户
async function deleteUser(username) {
    if (!confirm(`确定要删除用户 "${username}" 吗？`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/users/${username}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('用户已删除');
            await loadUserList();
        } else {
            alert(result.message || '删除失败');
        }
    } catch (error) {
        console.error('Delete user error:', error);
        alert('删除失败，请稍后重试');
    }
}
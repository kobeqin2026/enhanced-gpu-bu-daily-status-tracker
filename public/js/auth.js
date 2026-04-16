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
    userListEl.innerHTML = '';
    var loadingP = document.createElement('p');
    loadingP.style.color = '#666';
    loadingP.textContent = '加载中...';
    userListEl.appendChild(loadingP);

    try {
        var result = await apiCall('/api/users');

        if (Array.isArray(result)) {
            if (result.length === 0) {
                userListEl.innerHTML = '';
                var emptyP = document.createElement('p');
                emptyP.style.color = '#666';
                emptyP.textContent = '暂无用户';
                userListEl.appendChild(emptyP);
                return;
            }

            userListEl.innerHTML = '';

            var table = document.createElement('table');
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';
            table.style.fontSize = '14px';

            // Header row
            var thead = document.createElement('tr');
            thead.style.background = '#3498db';
            thead.style.color = 'white';
            ['用户名', '显示名称', '角色', '操作'].forEach(function(thText) {
                var th = document.createElement('th');
                th.style.padding = '8px';
                th.style.textAlign = 'left';
                th.textContent = thText;
                thead.appendChild(th);
            });
            table.appendChild(thead);

            // Data rows
            var currentUserStr = localStorage.getItem('currentUser');
            result.forEach(function(user) {
                var roleText = user.role === 'admin' ? '管理员' : '普通用户';
                var roleClass = user.role === 'admin' ? 'role-admin' : 'role-user';
                var isCurrentUser = user.username === currentUserStr;
                var isLoggedInUser = App.userRole !== null;

                var row = document.createElement('tr');
                row.style.borderBottom = '1px solid #ddd';

                // Username cell
                var tdUsername = document.createElement('td');
                tdUsername.style.padding = '8px';
                tdUsername.textContent = user.username;
                row.appendChild(tdUsername);

                // Name cell
                var tdName = document.createElement('td');
                tdName.style.padding = '8px';
                tdName.textContent = user.name;
                row.appendChild(tdName);

                // Role cell
                var tdRole = document.createElement('td');
                tdRole.style.padding = '8px';
                var roleSpan = document.createElement('span');
                roleSpan.className = 'user-role ' + roleClass;
                roleSpan.textContent = roleText;
                tdRole.appendChild(roleSpan);
                row.appendChild(tdRole);

                // Actions cell
                var tdActions = document.createElement('td');
                tdActions.style.padding = '8px';

                if (isLoggedInUser) {
                    // Edit button for non-admins or current user
                    if (user.role !== 'admin' || isCurrentUser) {
                        var editBtn = document.createElement('button');
                        editBtn.className = 'edit-btn';
                        editBtn.style.padding = '4px 8px';
                        editBtn.style.fontSize = '12px';
                        editBtn.style.marginRight = '5px';
                        editBtn.textContent = '编辑';
                        (function(u) {
                            editBtn.addEventListener('click', function() {
                                showEditUserModal(u.username, u.name, u.role);
                            });
                        })(user);
                        tdActions.appendChild(editBtn);
                    } else {
                        var dash1 = document.createElement('span');
                        dash1.style.color = '#999';
                        dash1.style.fontSize = '12px';
                        dash1.textContent = '-';
                        tdActions.appendChild(dash1);
                    }

                    // Delete button or status text
                    if (App.userRole === 'admin' && user.role !== 'admin' && !isCurrentUser) {
                        var delBtn = document.createElement('button');
                        delBtn.className = 'delete-btn';
                        delBtn.style.padding = '4px 8px';
                        delBtn.style.fontSize = '12px';
                        delBtn.textContent = '删除';
                        (function(u) {
                            delBtn.addEventListener('click', function() {
                                deleteUser(u.username);
                            });
                        })(user);
                        tdActions.appendChild(delBtn);
                    } else {
                        var statusSpan = document.createElement('span');
                        statusSpan.style.color = '#999';
                        statusSpan.style.fontSize = '12px';
                        if (App.userRole === 'admin' && user.role === 'admin') {
                            statusSpan.textContent = '-';
                        } else {
                            statusSpan.textContent = '(当前)';
                        }
                        tdActions.appendChild(statusSpan);
                    }
                } else {
                    var readOnlySpan = document.createElement('span');
                    readOnlySpan.style.color = '#999';
                    readOnlySpan.style.fontSize = '12px';
                    readOnlySpan.textContent = '只读';
                    tdActions.appendChild(readOnlySpan);
                }

                row.appendChild(tdActions);
                table.appendChild(row);
            });

            userListEl.appendChild(table);
        } else {
            userListEl.innerHTML = '';
            var errP = document.createElement('p');
            errP.style.color = '#e74c3c';
            errP.textContent = '无法加载用户列表';
            userListEl.appendChild(errP);
        }
    } catch (error) {
        console.error('Load users error:', error);
        userListEl.innerHTML = '';
        var errP2 = document.createElement('p');
        errP2.style.color = '#e74c3c';
        if (error.message && (error.message.indexOf('登录已过期') !== -1 || error.message.indexOf('无权限') !== -1)) {
            errP2.textContent = error.message;
        } else {
            errP2.textContent = '加载失败，请稍后重试';
        }
        userListEl.appendChild(errP2);
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

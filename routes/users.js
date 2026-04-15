// User management routes

var express = require('express');
var router = express.Router();
var users = require('../lib/users');
var sessions = require('../lib/sessions');
var auth = require('../middleware/auth');
var logger = require('../lib/logger');

var loadUsers = users.loadUsers;
var saveUsers = users.saveUsers;
var logOperation = logger.logOperation;

// GET /api/users - list users (admin only)
router.get('/', auth.authenticateToken, auth.requireAdmin, async function(req, res) {
    try {
        var allUsers = await loadUsers();
        var safeUsers = allUsers.map(function(u) {
            return {
                id: u.id,
                username: u.username,
                role: u.role,
                name: u.name,
                createdAt: u.createdAt
            };
        });
        res.json(safeUsers);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/users - create user (admin only)
router.post('/', auth.authenticateToken, auth.requireAdmin, async function(req, res) {
    try {
        var body = req.body;
        var username = body.username;
        var password = body.password;
        var role = body.role;
        var name = body.name;
        
        if (!username || !password || !role || !name) {
            return res.status(400).json({ success: false, message: '所有字段都不能为空' });
        }
        
        if (!['admin', 'user'].includes(role)) {
            return res.status(400).json({ success: false, message: '无效的角色' });
        }
        
        var allUsers = await loadUsers();
        
        if (allUsers.find(function(u) { return u.username === username; })) {
            return res.status(400).json({ success: false, message: '用户名已存在' });
        }
        
        var newUser = {
            id: username,
            username: username,
            password: password,
            role: role,
            name: name,
            createdAt: new Date().toISOString()
        };
        
        allUsers.push(newUser);
        await saveUsers(allUsers);
        
        logOperation(req.user.username, 'CREATE', 'users', { targetUser: username, role: role });
        console.log('User created: ' + username + ' by ' + req.user.username);
        
        res.json({ 
            success: true, 
            message: '用户创建成功',
            user: { id: newUser.id, username: newUser.username, role: newUser.role, name: newUser.name }
        });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'users', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/users/:id/password - change password (admin or self)
router.put('/:id/password', auth.authenticateToken, async function(req, res) {
    try {
        var userId = req.params.id;
        var newPassword = req.body.newPassword;
        
        if (!newPassword || newPassword.length < 4) {
            return res.status(400).json({ success: false, message: '密码至少 4 个字符' });
        }
        
        if (req.user.role !== 'admin' && req.user.username !== userId) {
            return res.status(403).json({ success: false, message: '没有权限修改此用户密码' });
        }
        
        var allUsers = await loadUsers();
        var userIndex = allUsers.findIndex(function(u) { return u.username === userId; });
        
        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        allUsers[userIndex].password = newPassword;
        await saveUsers(allUsers);
        
        logOperation(req.user.username, 'PASSWORD_CHANGE', 'users', { targetUser: userId });
        console.log('Password changed for: ' + userId + ' by ' + req.user.username);
        
        res.json({ success: true, message: '密码修改成功' });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'users', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/users/:id - delete user (admin only)
router.delete('/:id', auth.authenticateToken, auth.requireAdmin, async function(req, res) {
    try {
        var userId = req.params.id;
        
        if (userId === req.user.username) {
            return res.status(400).json({ success: false, message: '不能删除自己的账号' });
        }
        
        var allUsers = await loadUsers();
        var userIndex = allUsers.findIndex(function(u) { return u.username === userId; });
        
        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        var targetUser = allUsers[userIndex];
        if (targetUser.role === 'admin') {
            return res.status(400).json({ success: false, message: '不能删除管理员账号' });
        }
        
        var deletedUser = allUsers[userIndex];
        allUsers.splice(userIndex, 1);
        await saveUsers(allUsers);
        
        var allSessions = sessions.getSessions();
        if (allSessions[userId]) {
            delete allSessions[userId];
        }
        
        logOperation(req.user.username, 'DELETE', 'users', { targetUser: userId, role: deletedUser.role });
        console.log('User deleted: ' + userId + ' by ' + req.user.username);
        
        res.json({ success: true, message: '用户已删除', user: deletedUser });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'users', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/users/:id - update user info (admin or self)
router.put('/:id', auth.authenticateToken, async function(req, res) {
    try {
        var userId = req.params.id;
        var name = req.body.name;
        var role = req.body.role;
        var currentUser = req.user;
        
        var isAdmin = currentUser.role === 'admin';
        var isSelf = currentUser.username === userId;
        
        var allUsers = await loadUsers();
        var targetUser = allUsers.find(function(u) { return u.username === userId; });
        
        if (!targetUser) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        if (!isAdmin && !isSelf) {
            return res.status(403).json({ success: false, message: '没有权限修改此用户信息' });
        }
        
        if (!isAdmin && targetUser.role === 'admin') {
            return res.status(403).json({ success: false, message: '没有权限修改管理员信息' });
        }
        
        if (role) {
            if (isAdmin && ['admin', 'user'].includes(role)) {
                allUsers.find(function(u) { return u.username === userId; }).role = role;
            } else if (!isAdmin) {
                return res.status(403).json({ success: false, message: '普通用户不能修改角色' });
            }
        }
        
        if (name) {
            allUsers.find(function(u) { return u.username === userId; }).name = name;
        }
        
        await saveUsers(allUsers);
        
        var allSessions = sessions.getSessions();
        if (allSessions[userId]) {
            var updated = allUsers.find(function(u) { return u.username === userId; });
            allSessions[userId].role = updated.role;
        }
        
        logOperation(req.user.username, 'UPDATE', 'users', { targetUser: userId, changes: { name: name, role: role } });
        console.log('User updated: ' + userId + ' by ' + currentUser.username);
        
        var updatedUser = allUsers.find(function(u) { return u.username === userId; });
        res.json({ 
            success: true, 
            message: '用户信息已更新',
            user: { username: updatedUser.username, role: updatedUser.role, name: updatedUser.name }
        });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'users', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

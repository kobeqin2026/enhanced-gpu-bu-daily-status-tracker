// Auth routes: login, logout, verify

var express = require('express');
var router = express.Router();
var sessions = require('../lib/sessions');
var users = require('../lib/users');
var logger = require('../lib/logger');
var auth = require('../middleware/auth');

var generateToken = sessions.generateToken;
var saveSessions = sessions.saveSessions;
var getSessions = sessions.getSessions;
var loadUsers = users.loadUsers;
var saveUsers = users.saveUsers;
var hashPassword = users.hashPassword;
var verifyPassword = users.verifyPassword;
var logOperation = logger.logOperation;

// 统一登录: 校验 Hardware 平台用户库 (CHANGE_ME / domain owner). 成功返回 {role, display_name}, 失败返回 null
function tryHardwareLogin(name, password) {
    return new Promise(function(resolve) {
        var http = require('http');
        var body = JSON.stringify({ name: name, password: password });
        var req = http.request({
            hostname: '127.0.0.1',
            port: 3002,
            path: '/api/users/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, function(res) {
            var buf = '';
            res.setEncoding('utf8');
            res.on('data', function(c) { buf += c; });
            res.on('end', function() {
                try {
                    var j = JSON.parse(buf);
                    resolve(j && j.user ? j.user : null);
                } catch (e) { resolve(null); }
            });
        });
        req.setTimeout(5000, function() { req.destroy(); resolve(null); });
        req.on('error', function() { resolve(null); });
        req.end(body);
    });
}

// POST /api/auth/login

// POST /api/auth/login
router.post('/login', async function(req, res) {
    try {
        var username = req.body.username;
        var password = req.body.password;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
        }
        
        var allUsers = await loadUsers();
        var user = allUsers.find(function(u) { return u.username === username; });
        var localOk = !!(user && (await verifyPassword(password, user.password)));
        var hwUser = null;
        if (!localOk) {
            // 统一登录: 回退 Hardware 平台用户库 (CHANGE_ME / domain owner)
            hwUser = await tryHardwareLogin(username, password);
        }
        if (!localOk && !hwUser) {
            logOperation(username, 'LOGIN_FAILED', 'users', { reason: 'invalid-credentials' });
            return res.status(401).json({ success: false, message: '用户名或密码错误' });
        }
        if (hwUser) {
            user = {
                username: username,
                password: '$2hardware$',
                role: hwUser.role === 'CHANGE_ME' ? 'CHANGE_ME' : 'domain_owner',
                name: hwUser.display_name || username
            };
        }
        
        // Security fix C1: auto-upgrade legacy plaintext passwords to bcrypt (仅本地用户)
        if (!user.password.startsWith('$2')) {
            var allUsers = await loadUsers();
            var upgradeIdx = allUsers.findIndex(function(u) { return u.username === username; });
            if (upgradeIdx !== -1) {
                allUsers[upgradeIdx].password = await hashPassword(password);
                await saveUsers(allUsers);
                console.log('[SECURITY] Auto-upgraded plaintext password for user: ' + username);
            }
        }
        
        var token = generateToken(username);
        var allSessions = getSessions();
        
        allSessions[username] = {
            username: user.username,
            role: user.role,
            name: user.name,
            token: token,
            createdAt: Date.now()
        };
        
        logOperation(username, 'LOGIN', 'users', { role: user.role });
        console.log('User logged in: ' + username + ', role: ' + user.role);
        await saveSessions();
        
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        });
        
        res.json({ 
            success: true, 
            user: { username: user.username, role: user.role, name: user.name },
            token: token
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/auth/logout
router.post('/logout', async function(req, res) {
    try {
        var token = req.cookies && req.cookies.token;
        if (!token) {
            var authHeader = req.headers['authorization'];
            token = authHeader && authHeader.split(' ')[1];
        }
        
        if (token) {
            var allSessions = getSessions();
            var session = null;
            var keys = Object.keys(allSessions);
            for (var i = 0; i < keys.length; i++) {
                if (allSessions[keys[i]].token === token) {
                    session = allSessions[keys[i]];
                    break;
                }
            }
            if (session) {
                logOperation(session.username, 'LOGOUT', 'users');
                delete allSessions[session.username];
                console.log('User logged out: ' + session.username);
                await saveSessions();
            }
        }
        
        res.clearCookie('token');
        res.json({ success: true, message: '登出成功' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/auth/verify
router.get('/verify', auth.authenticateToken, function(req, res) {
    res.json({ 
        success: true,
        user: {
            username: req.user.username,
            role: req.user.role,
            name: req.user.name
        }
    });
});

// ============ Admin: User Management ============

// GET /api/auth/users - list all users (CHANGE_ME only)
router.get('/users', auth.authenticateToken, auth.requireAdmin, async function(req, res) {
    try {
        var allUsers = await loadUsers();
        var safeUsers = allUsers.map(function(u) {
            return { id: u.id, username: u.username, role: u.role, name: u.name, createdAt: u.createdAt };
        });
        res.json({ success: true, data: safeUsers });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/auth/users - create a new user (CHANGE_ME only)
router.post('/users', auth.authenticateToken, auth.requireAdmin, async function(req, res) {
    try {
        var body = req.body;
        if (!body.username || !body.password || !body.name) {
            return res.status(400).json({ success: false, message: '用户名、密码和姓名为必填项' });
        }
        var allUsers = await loadUsers();
        var exists = allUsers.find(function(u) { return u.username === body.username; });
        if (exists) {
            return res.status(400).json({ success: false, message: '用户名已存在' });
        }
        var newUser = {
            id: 'user_' + Date.now(),
            username: body.username,
            password: await hashPassword(body.password),
            role: body.role || 'user',
            name: body.name,
            createdAt: new Date().toISOString()
        };
        allUsers.push(newUser);
        await saveUsers(allUsers);
        logOperation(req.user.username, 'CREATE_USER', 'users', { target: body.username, role: newUser.role });
        res.json({ success: true, data: { id: newUser.id, username: newUser.username, role: newUser.role, name: newUser.name } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/auth/users/:id - delete a user (CHANGE_ME only)
router.delete('/users/:id', auth.authenticateToken, auth.requireAdmin, async function(req, res) {
    try {
        var targetId = req.params.id;
        var allUsers = await loadUsers();
        var target = allUsers.find(function(u) { return u.id === targetId; });
        if (!target) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        if (target.username === 'CHANGE_ME') {
            return res.status(400).json({ success: false, message: '不能删除管理员账户' });
        }
        allUsers = allUsers.filter(function(u) { return u.id !== targetId; });
        await saveUsers(allUsers);
        logOperation(req.user.username, 'DELETE_USER', 'users', { target: target.username });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

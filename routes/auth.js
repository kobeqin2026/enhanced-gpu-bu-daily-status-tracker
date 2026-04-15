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
var verifyPassword = users.verifyPassword;
var logOperation = logger.logOperation;

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
        
        if (!user || !verifyPassword(password, user.password)) {
            logOperation(username, 'LOGIN_FAILED', 'users', { reason: 'invalid-credentials' });
            return res.status(401).json({ success: false, message: '用户名或密码错误' });
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
            sameSite: 'strict'
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

module.exports = router;

// Authentication middleware

var sessions = require('../lib/sessions');

function authenticateToken(req, res, next) {
    var token = req.cookies && req.cookies.token;
    
    if (!token) {
        var authHeader = req.headers['authorization'];
        token = authHeader && authHeader.split(' ')[1];
    }
    
    if (!token) {
        return res.status(401).json({ success: false, message: '未登录或登录已过期' });
    }
    
    var allSessions = sessions.getSessions();
    var session = null;
    var sessionKeys = Object.keys(allSessions);
    for (var i = 0; i < sessionKeys.length; i++) {
        if (allSessions[sessionKeys[i]].token === token) {
            session = allSessions[sessionKeys[i]];
            break;
        }
    }
    
    if (!session) {
        return res.status(401).json({ success: false, message: '无效的 token' });
    }
    
    if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
        delete allSessions[session.username];
        sessions.saveSessions();
        res.clearCookie('token');
        return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
    }
    
    req.user = session;
    next();
}

function requireAdmin(req, res, next) {
    var logOperation = require('../lib/logger').logOperation;
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        logOperation(req.user && req.user.username, 'DENIED', 'admin-access', { reason: 'non-admin' });
        res.status(403).json({ success: false, message: '需要管理员权限' });
    }
}

module.exports = { authenticateToken, requireAdmin };

// GPU Bring-up Daily Tracker - Server Entry Point
// Modular architecture: routes, middleware, lib

var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var rateLimit = require('express-rate-limit');

var sessions = require('./lib/sessions');
var dataStore = require('./lib/dataStore');

// Initialize data directory
dataStore.ensureDataDir();

// Load sessions and start auto-save
sessions.loadSessions();
sessions.startAutoSave(30000);
sessions.setupGracefulShutdown();

var app = express();
var PORT = process.env.PORT || 3000;

// 禁用 ETag: API 响应带 ETag 会让浏览器条件请求返回 304, 304 无 body 导致前端 fetch .json() 抛错/挂起
// (症状: domain_owner 登录后"项目一直在加载中" - verify 304 卡死 loadSavedUser -> initProjects 永不执行)
app.disable('etag');

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
var generalLimiter = rateLimit({
    windowMs: 60 * 1000,   // 1 minute
    max: 120,               // 120 requests per minute per IP
    message: { success: false, error: '请求过于频繁，请稍后再试' }
});
var diagnoseLimiter = rateLimit({
    windowMs: 60 * 1000,   // 1 minute
    max: 10,                // 10 diagnosis requests per minute per IP
    message: { success: false, error: '诊断请求过于频繁，请稍后再试' }
});
app.use('/api/', generalLimiter);

// 所有 /api 响应禁用缓存 — ETag/304 会让 fetch 拿到无 body 的 304 响应, 前端 .json() 抛错
app.use('/api/', function(req, res, next) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/data', require('./routes/data'));
app.use('/api/data', require('./routes/jira'));
app.use('/api/testcase', require('./routes/testcase'));
app.use('/api/data', require('./routes/domain-source'));
app.use('/api/data/diagnose-bug', diagnoseLimiter);

// Logs route (admin only)
app.get('/api/logs/:date?', require('./middleware/auth').authenticateToken, require('./middleware/auth').requireAdmin, async function(req, res) {
    try {
        var date = req.params.date || new Date().toISOString().split('T')[0];
        var logs = require('./lib/logger').readLogByDate(date);
        res.json(logs);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', function() {
    console.log('GPU bring-up Web Server running on http://0.0.0.0:' + PORT);
    console.log('Data directory: ' + dataStore.DATA_DIR);
});

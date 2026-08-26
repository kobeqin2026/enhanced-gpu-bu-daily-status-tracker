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

// ==================== 定时自动总结 ====================
// 从 BU 开始的第一天起, BU 执行期内每天两次自动总结 (09:30 / 17:30), 生成并存档当天时刻快照
var autoProjectsLib = require('./lib/projects');
var autoDataRouter = require('./routes/data');
var AUTO_SUMMARY_TIMES = ['09:30', '17:30'];
var AUTO_SUMMARY_PROJECTS = ['br288y'];
var autoRunDates = {}; // 键=时刻, 值=日期: 防同日同时刻重复触发
setInterval(function() {
    (async function() {
        try {
            var now = new Date();
            var pad = function(n) { return String(n).padStart(2, '0'); };
            var hm = pad(now.getHours()) + ':' + pad(now.getMinutes());
            if (AUTO_SUMMARY_TIMES.indexOf(hm) === -1) return;
            var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
            if (autoRunDates[hm] === today) return;
            autoRunDates[hm] = today;
            var projs = await autoProjectsLib.loadProjects();
            for (var i = 0; i < AUTO_SUMMARY_PROJECTS.length; i++) {
                var pid = AUTO_SUMMARY_PROJECTS[i];
                var found = (projs || []).find(function(p) { return p.id === pid; });
                if (!found || !found.startDate) continue;
                // BU 执行期内才自动总结
                if (today < found.startDate || (found.endDate && today > found.endDate)) continue;
                var list = await autoProjectsLib.loadDailySummaries(pid);
                var dup = (list || []).some(function(r) { return r.date === today && r.time === hm; });
                if (dup) continue; // 该日该时刻已有快照, 不重复生成
                var result = await autoDataRouter.generateDailySummaryInternal(pid, today, hm);
                if (result && result.success) {
                    await autoProjectsLib.upsertDailySummary(pid, {
                        date: today, time: hm, aiFailed: !!result.aiFailed,
                        skeleton: result.skeleton, ai: result.ai || null, generatedBy: 'auto'
                    });
                    console.log('[AutoSummary] 自动总结完成 ' + pid + ' @ ' + today + ' ' + hm + (result.aiFailed ? ' (规则版)' : ' (AI版)'));
                }
            }
        } catch (e) {
            console.error('[AutoSummary] error:', e.message);
        }
    })();
}, 60 * 1000);

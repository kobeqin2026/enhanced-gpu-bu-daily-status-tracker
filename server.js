// GPU Bring-up Daily Tracker - Server Entry Point
// Modular architecture: routes, middleware, lib

var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var rateLimit = require('express-rate-limit');

// 加载本地环境变量(~/skills/.env; JIRA 地址/项目名/密钥均经此注入, 不入公开仓库)
var fs = require('fs');
var envFile = path.join(process.env.HOME || '', 'skills', '.env');
if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(function(line) {
        line = line.trim();
        if (line && !line.startsWith('#') && line.indexOf('=') !== -1) {
            var idx = line.indexOf('=');
            var key = line.substring(0, idx).trim();
            if (!process.env[key]) process.env[key] = line.substring(idx + 1).trim();
        }
    });
}

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

// 位于 nginx 反向代理之后: 信任第一跳, 让 req.ip 取 X-Forwarded-For 里的真实客户端 IP。
// 否则(无 trust proxy)所有用户都共享 nginx 同机代理 IP 这一个限流配额 → 多人用时整板被 429 →
// 保存(POST /api/data)被挡, 前端只存本地缓存 → 记录丢失(同事反馈"提交的记录会丢失"根因)。
app.set('trust proxy', 1);

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
    message: { success: false, error: '请求过于频繁，请稍后再试' },
    // 只对 GET(读)限流防滥用; 写操作(POST/PUT/DELETE)不限流 —— 否则"保存"这类写入被 429 挡住,
    // 前端只把记录塞进本地缓存("已保存到本地缓存"), 刷新即丢 = 同事反馈的"提交记录丢失"。
    skip: function(req) { return req.method !== 'GET'; }
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
app.use('/api/data', require('./routes/uploads'));
app.use('/api/data/diagnose-bug', diagnoseLimiter);

// 运行配置下发(env 注入; 公开仓库默认仅占位示例, 真实值在 ~/skills/.env)
app.get('/api/config', function(req, res) {
    var jiraCfg = require('./lib/jiraConfig');
    res.json({
        jiraBaseUrl: jiraCfg.baseUrl.replace(/\/+$/, '') + '/browse/',
        dailyProject: process.env.DAILY_PROJECT || 'demo-daily'
    });
});

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

// ==================== 定时自动总结 (已改为人工触发, 2026-09-30) ====================
// 一键总结 Daily 状态 只由页面「📊 一键总结Daily状态」按钮手动触发;
// 原 09:30/17:30 自动生成定时器默认关闭 (如需恢复自动, 设环境变量 AUTO_SUMMARY_ENABLED=1 再重启)。
var autoProjectsLib = require('./lib/projects');
var autoDataRouter = require('./routes/data');
var AUTO_SUMMARY_ENABLED = process.env['AUTO_SUMMARY_ENABLED'] === '1';
if (AUTO_SUMMARY_ENABLED) {
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
}

// ==================== 每日"前日增量"邮件正文落盘 ====================
// 每天在 MAIL_REPORT_TIME (默认 09:00) 为 BU 项目生成"昨日增量"邮件正文, 存成 .md 供手动发送
// 只生成不真发信: subject 在 # 标题行, 正文为 Markdown, 用户取文件后手动粘贴到邮件客户端
var fsMail = require('fs');
var pathMail = require('path');
var MAIL_REPORT_TIME = process.env.MAIL_REPORT_TIME || '09:00';
var MAIL_REPORT_PROJECTS = process.env.MAIL_REPORT_PROJECTS
    ? process.env.MAIL_REPORT_PROJECTS.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
    : ['br288y'];
var mailRunDates = {}; // 键=日期, 防同日同时刻重复触发
setInterval(function() {
    (async function() {
        try {
            var now = new Date();
            var pad = function(n) { return String(n).padStart(2, '0'); };
            var hm = pad(now.getHours()) + ':' + pad(now.getMinutes());
            if (hm !== MAIL_REPORT_TIME) return; // 仅目标时刻触发
            var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
            if (mailRunDates[today]) return;
            mailRunDates[today] = true;
            // 前日 (总结"昨日增量")
            var y = new Date(now.getTime() - 86400000);
            var yd = y.getFullYear() + '-' + pad(y.getMonth() + 1) + '-' + pad(y.getDate());
            var projs = await autoProjectsLib.loadProjects();
            for (var i = 0; i < MAIL_REPORT_PROJECTS.length; i++) {
                var pid = MAIL_REPORT_PROJECTS[i];
                var found = (projs || []).find(function(p) { return p.id === pid; });
                if (!found) continue;
                // BU 执行期内才生成真实增量 (前日须在 start~end 内)
                if (!found.startDate || yd < found.startDate || (found.endDate && yd > found.endDate)) continue;
                // 防重: 同项目+日期已落盘则跳过
                var outDir = pathMail.join(__dirname, 'data', 'mail-report', pid);
                var outFile = pathMail.join(outDir, yd + '.md');
                if (fsMail.existsSync(outFile)) continue;
                var res = await autoDataRouter.buildEmailContent(pid, yd);
                if (!res || !res.subject) continue;
                fsMail.mkdirSync(outDir, { recursive: true });
                fsMail.writeFileSync(outFile, '# ' + res.subject + '\n\n' + res.body + '\n', 'utf8');
                console.log('[MailReport] 前日增量邮件已保存 ' + pid + ' @ ' + yd + ' -> ' + outFile + (res.aiFailed ? ' (规则版)' : ' (AI版)'));
            }
        } catch (e) {
            console.error('[MailReport] error:', e.message);
        }
    })();
}, 60 * 1000);

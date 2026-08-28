// Project data routes (read/write)

var express = require('express');
var router = express.Router();
var projects = require('../lib/projects');
var auth = require('../middleware/auth');
var logger = require('../lib/logger');
var dailySummary = require('../lib/daily-summary');
var diagnosis = require('../lib/diagnosis');

var loadProjectData = projects.loadProjectData;
var saveProjectData = projects.saveProjectData;
var loadProjects = projects.loadProjects;
var logOperation = logger.logOperation;

// ===== Domain 状态一致性: 准出标准全部 pass → completed + 记录 BU准出时间 =====
// 域名别名映射与前端 bu-exit-criteria.js 的 CRITERIA_DOMAIN_MAP 保持一致
var CRITERIA_DOMAIN_MAP = {
    'firmware': 'FW', 'pcie': 'PCIE', 'ethernet': 'ETH', 'diagnostic': 'Diag',
    'ucie': 'UCIE', 'iodie': 'IOD', 'iodieethernet': 'IOD', 'iodcl': 'IOD', 'iodieucie': 'IOD', 'dft': 'JTAG'
};
function normDomainKey(s) {
    return String(s || '').trim().toLowerCase().replace(/[\s\-/]/g, '');
}
function domainKeyOf(name) {
    var norm = normDomainKey(name);
    return normDomainKey(CRITERIA_DOMAIN_MAP[norm] || name);
}
// 就地修正 data.domains:
//  全部pass → status=completed + endDate=当天(首次)
//  不再全部pass且当前completed → 回退 not-started + 清空 endDate (双向一致)
// 返回是否有变化
function reconcileDomainCompletion(data) {
    var changed = false;
    var now = new Date();
    var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    var criteriaList = Array.isArray(data.buExitCriteria) ? data.buExitCriteria : [];
    (Array.isArray(data.domains) ? data.domains : []).forEach(function(dm) {
        var cList = criteriaList.filter(function(c) { return domainKeyOf(c.domain) === domainKeyOf(dm.name); });
        if (!cList.length) return;
        var total = cList.length;
        var pass = cList.filter(function(c) { return c.status === 'pass'; }).length;
        var allPass = (pass === total);
        if (allPass) {
            // 自动完成: 仅从未开始/无状态自动置完成; 用户手动保留的进行中/受阻不覆盖
            if (dm.status !== 'completed' && dm.status !== 'in-progress' && dm.status !== 'blocked') {
                dm.status = 'completed'; dm.endDate = dm.endDate || today; changed = true;
            }
            else if (dm.status === 'completed' && !dm.endDate) { dm.endDate = today; changed = true; }
        } else if (dm.status === 'completed') {
            // 标准不再全部pass: 回退未开始 + 清空结束时间
            dm.status = 'not-started';
            if (dm.endDate) dm.endDate = '';
            changed = true;
        }
    });
    return changed;
}

// GET /api/data - get project data
router.get('/', async function(req, res) {
    try {
        var projectId = req.query.project || 'gpu-bringup';
        var data = await loadProjectData(projectId);
        // 显示层一致性: 满足准出标准的 domain 显示为已完成+结束时间 (不落库, 下次保存时持久化)
        reconcileDomainCompletion(data);
        res.json(data);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/data - save project data (authenticated)
router.post('/', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = req.body.projectId || req.query.project || 'gpu-bringup';
        var body = req.body;
        
        var data = {
            domains: body.domains || [],
            bugs: body.bugs || [],
            dailyProgress: body.dailyProgress || [],
            buExitCriteria: body.buExitCriteria || [],
            lastUpdated: new Date().toLocaleString('zh-CN')
        };
        
        // 状态一致性(权威): 准出标准全部pass的domain → completed + endDate=当天, 落库
        var reconciled = reconcileDomainCompletion(data);
        if (reconciled) {
            console.log('[Data] 保存时自动完成满足准出标准的Domain: ' + projectId);
        }
        
        await saveProjectData(projectId, data);
        logOperation(req.user.username, 'UPDATE', 'project-data', { projectId: projectId });
        console.log('Saved data for project: ' + projectId);
        res.json({ success: true, message: 'Data saved successfully', reconciled: reconciled });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'project-data', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// 生成每日总结 (规则骨架 + LLM 润色) — 供路由与定时自动总结复用
async function generateDailySummaryInternal(projectId, date, time) {
    var data = await loadProjectData(projectId);

    // 项目元信息 (BU执行时间)
    var projectInfo = {};
    try {
        var projectList = await projects.loadProjects();
        var found = (projectList || []).find(function(p) { return p.id === projectId; });
        if (found) {
            projectInfo = {
                name: found.name || projectId,
                description: found.description || '',
                startDate: found.startDate || '',
                endDate: found.endDate || ''
            };
        }
    } catch (e) {
        console.error('[DailySummary] load projects info error:', e.message);
    }

    // 1. 规则骨架 (纯规则, 保证准确; time 决定当日快照口径)
    var skeleton = dailySummary.buildDailySkeleton(data, date, projectInfo, time);
    var skeletonText = dailySummary.skeletonToText(skeleton);

    // 2. LLM 润色 (失败降级: aiFailed=true, 前端只展示规则版)
    var ai = null;
    var aiFailed = false;
    try {
        ai = await diagnosis.summarizeDailyStatus(skeleton, skeletonText);
        if (!ai.overallStatus && (!ai.domainSummaries || ai.domainSummaries.length === 0)) {
            aiFailed = true;
            ai = null;
        }
    } catch (err) {
        console.error('[DailySummary] LLM 润色失败,降级为规则版:', err.message);
        aiFailed = true;
        ai = null;
    }

    return { success: true, date: date, time: time, skeleton: skeleton, ai: ai, aiFailed: aiFailed };
}

// POST /api/data/daily-summary - 一键总结 daily bringup 状态 (手动/人为触发)
router.post('/daily-summary', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = (req.body && req.body.projectId) || req.query.project || 'gpu-bringup';
        var date = (req.body && req.body.date) || new Date().toISOString().split('T')[0];
        var time = (req.body && req.body.time) || '';
        var result = await generateDailySummaryInternal(projectId, date, time);
        res.json(result);
    } catch (error) {
        console.error('[DailySummary] error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/data/daily-summary/history?project=xxx - 递增式历史总结列表 (按 date+time 升序, 轻量字段)
router.get('/daily-summary/history', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = req.query.project || 'gpu-bringup';
        var list = await projects.loadDailySummaries(projectId);
        var items = list.map(function(r) {
            var skel = r.skeleton || {};
            var crit = skel.criteria || {};
            return {
                date: r.date,
                time: r.time || '',
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
                aiFailed: !!r.aiFailed,
                overview: (r.ai && r.ai.overallStatus) ? r.ai.overallStatus : '',
                counts: {
                    domains: (skel.domainSummaries || []).length,
                    criticalBugs: (skel.criticalBugs || []).length,
                    allBugs: (skel.allBugs || []).length,
                    criteriaTotal: crit.total || 0,
                    criteriaPass: crit.pass || 0
                }
            };
        });
        res.json({ success: true, items: items });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/data/daily-summary/history/:date?project=xxx - 指定日期的全部快照 (同一天多次更新 → 多个时刻)
router.get('/daily-summary/history/:date', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = req.query.project || 'gpu-bringup';
        var list = await projects.loadDailySummaries(projectId);
        var found = list.filter(function(r) { return r.date === req.params.date; });
        if (!found.length) return res.status(404).json({ success: false, error: '该日期暂无历史总结' });
        res.json({ success: true, date: req.params.date, items: found });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/data/daily-summary/save - 保存/更新一条历史总结
// 键 = project+date+time: 同日期同时刻 → 覆盖更新; 同日期不同时刻(多次更新) → 新增快照 (递增存储)
// Body: { projectId, date: 'YYYY-MM-DD', time: 'HH:MM'(可选), aiFailed, skeleton, ai }
router.post('/daily-summary/save', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = (req.body && req.body.projectId) || req.query.project || 'gpu-bringup';
        if (!req.body || !req.body.date || !req.body.skeleton) {
            return res.status(400).json({ success: false, error: '缺少 date 或 skeleton' });
        }
        var record = {
            projectId: projectId,
            date: req.body.date,
            time: (req.body && req.body.time) || '',
            aiFailed: !!req.body.aiFailed,
            skeleton: req.body.skeleton,
            ai: req.body.ai || null,
            generatedBy: (req.user && req.user.username) || ''
        };
        var result = await projects.upsertDailySummary(projectId, record);
        logOperation(req.user.username, 'CREATE', 'daily-summary-history', { projectId: projectId, date: record.date, time: record.time, mode: result.mode });
        console.log('[DailySummary] history ' + result.mode + ' for ' + projectId + ' @ ' + record.date + ' ' + record.time + ' (dayCount=' + result.dayCount + ')');
        res.json({ success: true, mode: result.mode, date: record.date, time: record.time, dayCount: result.dayCount });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'daily-summary-history', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/data/daily-summary/summarize-day - 全天 LLM 归纳汇总 (实时数据优先)
// 基于当天全部当前进度记录(实时, 含新增未生成快照的记录) + 历史时刻快照AI概览做归纳;
// LLM 失败降级规则版
// Body: { projectId, date: 'YYYY-MM-DD' }
// 返回: { success, date, summary: {dayOverview, highlights[], risks[], nextSteps[], derived}, aiFailed, snapshots: [{time, aiFailed, overall}] }
router.post('/daily-summary/summarize-day', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = (req.body && req.body.projectId) || req.query.project || 'gpu-bringup';
        var date = (req.body && req.body.date) || '';
        if (!date) return res.status(400).json({ success: false, error: '缺少 date' });

        // 1) 实时数据: 该日全部进度 (不依赖历史快照 → 新添加的进度也纳入归纳)
        var data = await loadProjectData(projectId);
        var projectInfo = null;
        try {
            var found = (await projects.getProjects()).find(function(p) { return p.id === projectId; });
            if (found) {
                projectInfo = {
                    name: found.name || projectId,
                    description: found.description || '',
                    startDate: found.startDate || '',
                    endDate: found.endDate || ''
                };
            }
        } catch (e) { console.error('[DailySummary] summarize-day load projects info error:', e.message); }
        if (!projectInfo) projectInfo = { name: projectId, description: '', startDate: '', endDate: '' };
        // 全天快照口径 (无 time = 当天全部记录)
        var skeleton = dailySummary.buildDailySkeleton(data, date, projectInfo);

        // 2) 历史快照 AI 参考 (该日已有快照 → 附概览时间线; 无快照也能工作)
        var snaps = [];
        try { snaps = (await projects.loadDailySummaries(projectId)).filter(function(r) { return r.date === date; }); } catch (e) { snaps = []; }

        // 3) 拼 LLM 上下文: 实时规则文本(去HTML) + 历史快照 AI 摘要
        var L = [];
        L.push('以下是 ' + date + ' 当天全部实时进度数据' + (snaps.length ? ('，以及该日 ' + snaps.length + ' 个历史总结快照的AI概览') : '') + '，请归纳这份全天进展汇总。');
        try {
            var rulesText = String(dailySummary.skeletonToText(skeleton)).replace(/<[^>]+>/g, '').replace(/\s+\n/g, '\n').substring(0, 5000);
            L.push('【当天实时数据】\n' + rulesText);
        } catch (e) { L.push('【当天实时数据】(构建失败: ' + e.message + ')'); }
        if (snaps.length) {
            var tl = snaps.map(function(s) {
                var aiLine = (s.ai && s.ai.overallStatus) ? String(s.ai.overallStatus).replace(/\s+/g, ' ').trim() : '(该快照为规则版)';
                return (s.time || '全天') + ' 快照: ' + aiLine;
            }).join('\n');
            L.push('【该日历史时刻快照 AI 概览】\n' + tl);
        }
        var dayMarkdown = L.join('\n\n');

        // 4) 规则派生摘要 (实时骨架; LLM 失败时的降级信息源)
        var domSummaries = skeleton.domainSummaries || [];
        var crit = skeleton.criteria || {};
        var lastSnap = snaps.length ? snaps[snaps.length - 1] : null;
        var derived = {
            mode: lastSnap ? (lastSnap.aiFailed ? '规则版' : 'AI版') : '实时版',
            lastTime: lastSnap ? (lastSnap.time || '全天') : '全天',
            lastOverall: (lastSnap && lastSnap.ai && lastSnap.ai.overallStatus) ? lastSnap.ai.overallStatus : '',
            activeDomains: domSummaries.filter(function(d) { return d.dayProgress && d.dayProgress.length; }).length,
            totalDomains: domSummaries.length,
            criteria: { total: crit.total || 0, pass: crit.pass || 0, fail: crit.fail || 0, notReady: crit.notReady || 0, allPass: !!crit.allPass },
            criticalBugs: (skeleton.criticalBugs || []).length,
            allBugs: (skeleton.allBugs || []).length
        };

        var summary = null;
        var aiFailed = false;
        try {
            summary = await diagnosis.summarizeDailyDay(dayMarkdown);
            if (!summary || !summary.dayOverview) { summary = null; aiFailed = true; }
        } catch (err) {
            console.error('[DailySummary] summarize-day LLM 失败,降级为规则版:', err.message);
            summary = null;
            aiFailed = true;
        }

        // 5) 降级: 规则版 (实时进度要点 + 快照 AI 摘要, 保证复制内容不为空)
        if (!summary) {
            var ruleHighlights = [];
            var ruleRisks = [];
            var rulePerDomains = [];
            domSummaries.forEach(function(dm) {
                (dm.dayProgress || []).forEach(function(p) {
                    var t = (p.time ? '[' + p.time + '] ' : '');
                    if (p.workDone) ruleHighlights.push(dm.name + ' ' + t + p.workDone);
                    if (p.nextSteps) ruleHighlights.push(dm.name + ' 下一步: ' + p.nextSteps);
                    if (p.blockers) ruleRisks.push(dm.name + ' 阻塞: ' + p.blockers);
                });
                // 规则压缩: 每个有进度的 domain 一条归纳句 (分号合并记录)
                if (dm.dayProgress && dm.dayProgress.length) {
                    var parts = dm.dayProgress.map(function(p) {
                        var s = (p.time ? p.time + ' ' : '') + p.workDone;
                        if (p.nextSteps) s += '(下一步:' + p.nextSteps + ')';
                        if (p.blockers) s += '(阻塞:' + p.blockers + ')';
                        return s;
                    });
                    rulePerDomains.push({ domain: dm.name, summary: parts.join('；') });
                }
            });
            snaps.forEach(function(s) {
                if (s.ai && s.ai.overallStatus) {
                    ruleHighlights.push('[' + (s.time || '全天') + '快照] ' + String(s.ai.overallStatus).replace(/\s+/g, ' ').trim());
                }
            });
            summary = {
                dayOverview: '当天共 ' + ruleHighlights.length + ' 条进度记录' + (snaps.length ? (' / ' + snaps.length + ' 个时刻快照') : '') + '，详见"主要进展"。',
                highlights: ruleHighlights,
                risks: ruleRisks,
                nextSteps: [],
                perDomains: rulePerDomains
            };
        }
        summary.derived = derived;
        // 快照索引 (前端展示用)
        var snapshotList = snaps.map(function(s) {
            return {
                time: s.time || '全天',
                aiFailed: !!s.aiFailed,
                overall: (s.ai && s.ai.overallStatus) ? String(s.ai.overallStatus).replace(/\s+/g, ' ').trim().slice(0, 80) : ''
            };
        });
        logOperation(req.user.username, 'CREATE', 'daily-summary-day', { projectId: projectId, date: date, snaps: snaps.length, realtime: true, aiFailed: aiFailed });
        res.json({ success: true, date: date, summary: summary, aiFailed: aiFailed, snapshots: snapshotList });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'daily-summary-day', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===== 测试用例进度 (BU测试计划 JIRA Sub-task 统计, 组件=Domain) =====
// 数据源: JIRA 项目 (domain.jiraProject, 缺省 BR200 — 与 8089 jira-testcase、kpi-portal 相同)
// 语义: 每个 domain 的测试用例 = 该项目下挂组件=域名 的 Sub-task 用例
// 状态映射 (BR200 workflow: Opened → 进行中 → Validated/Blocked/WAIVED):
//   Validated → done(执行完毕); 进行中/Blocked → inprogress(执行中); Opened → todo(待执行); WAIVED → waived(豁免)
var JIRA_BASE = process.env['JIRA_BASE_URL'] || 'https://jira01.birentech.com';
var JIRA_PAT = process.env['JIRA_PAT'] || '';
var DEFAULT_TC_PROJECT = process.env['DOMAIN_SOURCE_PROJECT'] || 'BR200';
// 域名→JIRA组件真实名 别名 (组件名与域概览名不一致时; 键=normDomainKey(域名): 小写+去空白/横线)
// BR200 实际组件名 'SW' ↔ 域概览 'SW Model'
var TC_COMPONENT_ALIAS = { 'swmodel': 'SW' };

function jiraGet(path) {
    return new Promise(function(resolve) {
        var https = require('https');
        var u = new URL(JIRA_BASE + path);
        var req = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + JIRA_PAT, 'Accept': 'application/json' }
        }, function(resp) {
            var buf = '';
            resp.setEncoding('utf8');
            resp.on('data', function(c) { buf += c; });
            resp.on('end', function() {
                try {
                    var j = JSON.parse(buf);
                    if (resp.statusCode < 200 || resp.statusCode >= 300) {
                        resolve({ ok: false, status: resp.statusCode, error: j.errorMessages ? j.errorMessages.join('; ') : buf.slice(0, 200) });
                    } else {
                        resolve({ ok: true, data: j });
                    }
                } catch (e) {
                    resolve({ ok: false, status: resp.statusCode, error: 'JSON parse failed' });
                }
            });
        });
        req.setTimeout(30000, function() { req.destroy(); });
        req.on('error', function(e) { resolve({ ok: false, error: e.message }); });
        req.end();
    });
}

// 分页拉取全部 JIRA issue (fields 数组)
async function jiraSearchAll(jql, fields) {
    var all = [];
    var startAt = 0;
    var page = 100;
    var fieldStr = (fields || []).join(',');
    for (;;) {
        var q = '/rest/api/2/search?jql=' + encodeURIComponent(jql) +
            '&fields=' + encodeURIComponent(fieldStr) +
            '&startAt=' + startAt + '&maxResults=' + page;
        var r = await jiraGet(q);
        if (!r.ok) {
            throw new Error('JIRA查询失败: ' + (r.error || ('HTTP ' + r.status)));
        }
        var issues = (r.data && r.data.issues) || [];
        all = all.concat(issues);
        var total = (r.data && r.data.total) || 0;
        startAt += issues.length;
        if (startAt >= total || issues.length === 0) break;
    }
    return all;
}

// 收集某 Test Plan 及其 outward 关联(Relates)子 Test Plan 的 key 集合 (BFS: visited 防环, 深度≤4, 数量≤60)
// 与 kpi-portal collectPlanTree 同款语义 — 子计划用 issuelinks outwardIssue 表达
async function collectPlanTree(rootKey) {
    var collected = [rootKey];
    var visited = {}; visited[rootKey] = true;
    var level = [rootKey];
    for (var d = 0; d < 4 && level.length; d++) {
        if (collected.length >= 60) break;
        var results = await Promise.all(level.map(function(k) {
            return jiraGet('/rest/api/2/issue/' + encodeURIComponent(k) + '?fields=issuelinks')
                .then(function(r) { return (r.ok && r.data && r.data.fields && r.data.fields.issuelinks) || []; })
                .catch(function() { return []; });
        }));
        var next = [];
        results.forEach(function(links) {
            links.forEach(function(l) {
                if (l.outwardIssue && l.outwardIssue.key && !visited[l.outwardIssue.key]) {
                    visited[l.outwardIssue.key] = true;
                    collected.push(l.outwardIssue.key);
                    next.push(l.outwardIssue.key);
                }
            });
        });
        level = next;
    }
    return collected;
}

// 测试用例状态归一: done=完成(Validated) / fail=失败(Blocked/受阻/Fail/失败) / inprogress=执行中(进行中) / todo=未执行(Opened) / waived=豁免(WAIVED)
// 进度条语义(对齐满足准出标准条): 绿=完成(pass) 红=失败(fail) 灰=未执行(todo); 执行中不渲染
function normalizeTestCaseStatus(status) {
    if (!status) return 'todo';
    var name = String(status.name || status || '').toLowerCase();
    if (name.indexOf('waive') !== -1 || name.indexOf('wont') !== -1) return 'waived';
    if (name.indexOf('valid') !== -1 || name.indexOf('done') !== -1 || name.indexOf('close') !== -1 || name.indexOf('resolve') !== -1) return 'done';
    if (name.indexOf('fail') !== -1 || name.indexOf('失败') !== -1 || name.indexOf('block') !== -1 || name.indexOf('受阻') !== -1) return 'fail';
    if (name.indexOf('progress') !== -1 || name.indexOf('进行中') !== -1 || name.indexOf('test') !== -1 || name.indexOf('review') !== -1 || name.indexOf('开发') !== -1) return 'inprogress';
    return 'todo';
}

// GET /api/data/testcase-progress?project=br288y[&plan=BR288Y-1] — 各 domain 测试用例进度 (组件=Domain)
// 数据源解析: 项目配置 projects.json 的 jiraProject/testPlan 优先 (br288y → BR288Y / BR288Y-1);
//   无项目配置时回退 domain.jiraProject 分组(缺省 BR200); plan 未配置则统计项目全部 Sub-task。
// plan 树 = 顶层 Test Plan + outward(Relates)子 Test Plan; 用例限定 parent in 树内 key (BU 测试计划范围)
router.get('/testcase-progress', async function(req, res) {
    try {
        var projectId = req.query.project || 'gpu-bringup';
        var data = await loadProjectData(projectId);
        var domains = Array.isArray(data.domains) ? data.domains : [];
        // 项目级配置 (jiraProject + testPlan)
        var projList = await loadProjects();
        var projCfg = (projList || []).find(function(p) { return p.id === projectId; }) || {};
        var cfgJiraProject = String(projCfg.jiraProject || '').trim().toUpperCase();
        var cfgPlan = String(projCfg.testPlan || '').trim().toUpperCase();
        var byProj = {};
        if (cfgJiraProject) {
            byProj[cfgJiraProject] = domains.map(function(d) { return d.name; });
        } else {
            // 回退: 按各 domain 自带的 jiraProject 分组 (缺省 BR200)
            domains.forEach(function(d) {
                var p = String(d.jiraProject || DEFAULT_TC_PROJECT).trim().toUpperCase();
                (byProj[p] = byProj[p] || []).push(d.name);
            });
        }
        var projects = {};   // {BR288Y:{total, plan, components:{原始组件名:{total,done,inprogress,todo,waived}}}}
        var byComponent = {}; // {域名:{matched,total,done,inprogress,todo,waived}}
        for (var p in byProj) {
            var planQuery = cfgJiraProject ? cfgPlan : String(req.query.plan || '').trim().toUpperCase();
            var jql;
            if (planQuery) {
                var treeKeys = await collectPlanTree(planQuery);
                jql = 'project = ' + p + ' AND issuetype = Sub-task AND parent in (' + treeKeys.join(', ') + ')';
            } else {
                jql = 'project = ' + p + ' AND issuetype = Sub-task';
            }
            var issues = await jiraSearchAll(jql, ['components', 'status']);
            var compAgg = {};
            issues.forEach(function(iss) {
                var comps = (iss.fields.components && iss.fields.components.length) ? iss.fields.components : [{ name: '未分配' }];
                var c = normalizeTestCaseStatus(iss.fields.status);
                comps.forEach(function(cp) {
                    var nm = String(cp.name || '未分配');
                    var st = compAgg[nm] || (compAgg[nm] = { total: 0, done: 0, fail: 0, inprogress: 0, todo: 0, waived: 0 });
                    st.total++;
                    st[c]++;
                });
            });
            projects[p] = { total: issues.length, plan: planQuery || null, planKeys: planQuery ? treeKeys.length : null, components: compAgg };
            // 域名匹配: 先精确 → 忽略大小写 → 别名表 (TC_COMPONENT_ALIAS)
            var ciIndex = {};
            Object.keys(compAgg).forEach(function(k) { ciIndex[String(k).toLowerCase()] = k; });
            byProj[p].forEach(function(dn) {
                var key = compAgg[dn] ? dn : (ciIndex[String(dn).toLowerCase()] || '');
                if (!key) {
                    var alias = TC_COMPONENT_ALIAS[normDomainKey(dn)];
                    if (alias && compAgg[alias]) key = alias;
                }
                if (key && compAgg[key]) {
                    byComponent[dn] = Object.assign({ matched: true }, compAgg[key]);
                } else {
                    byComponent[dn] = { matched: false, total: 0, done: 0, fail: 0, inprogress: 0, todo: 0, waived: 0 };
                }
            });
        }
        res.json({ success: true, updatedAt: new Date().toISOString(), projects: projects, byComponent: byComponent });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
// 内部生成函数导出 (供 server.js 定时自动总结复用)
router.generateDailySummaryInternal = generateDailySummaryInternal;

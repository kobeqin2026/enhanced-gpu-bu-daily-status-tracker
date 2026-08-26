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
var logOperation = logger.logOperation;

// ===== Domain 状态一致性: 准出标准全部 pass → completed + 记录执行结束时间 =====
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
            if (dm.status !== 'completed') { dm.status = 'completed'; dm.endDate = dm.endDate || today; changed = true; }
            else if (!dm.endDate) { dm.endDate = today; changed = true; }
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

// POST /api/data/daily-summary - 一键总结 daily bringup 状态 (方案C: 规则骨架 + LLM 润色)
// Body: { projectId 或 ?project=, date: 'YYYY-MM-DD' (默认今天), time: 'HH:MM' (可选, 同一天多次更新时按截至该时刻取快照) }
// 返回: { success, date, time, skeleton, ai (LLM润色结果), aiFailed }
router.post('/daily-summary', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = (req.body && req.body.projectId) || req.query.project || 'gpu-bringup';
        var date = (req.body && req.body.date) || new Date().toISOString().split('T')[0];
        var time = (req.body && req.body.time) || '';

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

        res.json({ success: true, date: date, time: time, skeleton: skeleton, ai: ai, aiFailed: aiFailed });
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
            domSummaries.forEach(function(dm) {
                (dm.dayProgress || []).forEach(function(p) {
                    var t = (p.time ? '[' + p.time + '] ' : '');
                    if (p.workDone) ruleHighlights.push(dm.name + ' ' + t + p.workDone);
                    if (p.nextSteps) ruleHighlights.push(dm.name + ' 下一步: ' + p.nextSteps);
                    if (p.blockers) ruleRisks.push(dm.name + ' 阻塞: ' + p.blockers);
                });
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
                nextSteps: []
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

module.exports = router;

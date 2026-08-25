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

// GET /api/data - get project data
router.get('/', async function(req, res) {
    try {
        var projectId = req.query.project || 'gpu-bringup';
        var data = await loadProjectData(projectId);
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
        
        await saveProjectData(projectId, data);
        logOperation(req.user.username, 'UPDATE', 'project-data', { projectId: projectId });
        console.log('Saved data for project: ' + projectId);
        res.json({ success: true, message: 'Data saved successfully' });
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

// POST /api/data/daily-summary/summarize-day - 全天快照 LLM 归纳汇总
// 把该日期所有时刻快照合并归纳为一份连续进展报告; LLM 失败降级规则版
// Body: { projectId, date: 'YYYY-MM-DD' }
// 返回: { success, date, summary: {dayOverview, highlights[], risks[], nextSteps[], derived}, aiFailed }
router.post('/daily-summary/summarize-day', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = (req.body && req.body.projectId) || req.query.project || 'gpu-bringup';
        var date = (req.body && req.body.date) || '';
        if (!date) return res.status(400).json({ success: false, error: '缺少 date' });

        var list = await projects.loadDailySummaries(projectId);
        var snaps = list.filter(function(r) { return r.date === date; });
        if (!snaps.length) return res.status(404).json({ success: false, error: '该日期暂无历史总结快照' });

        // 拼快照文本: 每个快照 = 时刻 + AI总体/风险 + 规则明细(截断控制长度)
        var dayMarkdown = snaps.map(function(s, i) {
            var L = [];
            L.push('## 快照 ' + (s.time || '全天') + ' (第' + (i + 1) + '/' + snaps.length + '个)');
            if (s.ai && s.ai.overallStatus) L.push('AI总体: ' + s.ai.overallStatus);
            if (s.ai && s.ai.riskAndNextSteps) L.push('AI风险/下一步: ' + s.ai.riskAndNextSteps);
            var rulesText = '';
            try { rulesText = dailySummary.skeletonToText(s.skeleton || {}); } catch (e) { rulesText = ''; }
            if (rulesText) L.push('规则明细:\n' + rulesText.substring(0, 1500));
            return L.join('\n');
        }).join('\n\n');

        // 规则派生摘要 (LLM 失败时的降级信息源)
        var last = snaps[snaps.length - 1];
        var lastSkel = last.skeleton || {};
        var domSummaries = lastSkel.domainSummaries || [];
        var crit = lastSkel.criteria || {};
        var derived = {
            mode: last.aiFailed ? '规则版' : 'AI版',
            lastTime: last.time || '全天',
            lastOverall: (last.ai && last.ai.overallStatus) ? last.ai.overallStatus : '',
            activeDomains: domSummaries.filter(function(d) { return d.dayProgress && d.dayProgress.length; }).length,
            totalDomains: domSummaries.length,
            criteria: { total: crit.total || 0, pass: crit.pass || 0, fail: crit.fail || 0, notReady: crit.notReady || 0, allPass: !!crit.allPass },
            criticalBugs: (lastSkel.criticalBugs || []).length,
            allBugs: (lastSkel.allBugs || []).length
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

        // 降级: 规则版 dayOverview (基于最新快照 + 快照时间线)
        if (!summary) {
            summary = {
                dayOverview: derived.lastOverall ||
                    ('当天共 ' + snaps.length + ' 个时刻快照 (' + snaps.map(function(s) { return s.time || '全天'; }).join(' / ') + ')，最新状态见快照索引。'),
                highlights: [],
                risks: [],
                nextSteps: []
            };
        }
        summary.derived = derived;
        logOperation(req.user.username, 'CREATE', 'daily-summary-day', { projectId: projectId, date: date, snaps: snaps.length, aiFailed: aiFailed });
        res.json({ success: true, date: date, summary: summary, aiFailed: aiFailed });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'daily-summary-day', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

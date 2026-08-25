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
// Body: { projectId 或 ?project=, date: 'YYYY-MM-DD' (默认今天) }
// 返回: { success, skeleton, ai (LLM润色结果), aiFailed }
router.post('/daily-summary', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = (req.body && req.body.projectId) || req.query.project || 'gpu-bringup';
        var date = (req.body && req.body.date) || new Date().toISOString().split('T')[0];

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

        // 1. 规则骨架 (纯规则, 保证准确)
        var skeleton = dailySummary.buildDailySkeleton(data, date, projectInfo);
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

        res.json({ success: true, date: date, skeleton: skeleton, ai: ai, aiFailed: aiFailed });
    } catch (error) {
        console.error('[DailySummary] error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/data/daily-summary/history?project=xxx - 递增式历史总结列表 (按日期升序, 轻量字段)
router.get('/daily-summary/history', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = req.query.project || 'gpu-bringup';
        var list = await projects.loadDailySummaries(projectId);
        var items = list.map(function(r) {
            var skel = r.skeleton || {};
            var crit = skel.criteria || {};
            return {
                date: r.date,
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

// GET /api/data/daily-summary/history/:date?project=xxx - 单条完整历史总结 (含 skeleton + ai)
router.get('/daily-summary/history/:date', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = req.query.project || 'gpu-bringup';
        var list = await projects.loadDailySummaries(projectId);
        var found = list.find(function(r) { return r.date === req.params.date; });
        if (!found) return res.status(404).json({ success: false, error: '该日期暂无历史总结' });
        res.json({ success: true, item: found });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/data/daily-summary/save - 保存/更新一条历史总结 (同日期重新生成则覆盖, 递增存储)
// Body: { projectId, date: 'YYYY-MM-DD', aiFailed, skeleton, ai }
router.post('/daily-summary/save', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = (req.body && req.body.projectId) || req.query.project || 'gpu-bringup';
        if (!req.body || !req.body.date || !req.body.skeleton) {
            return res.status(400).json({ success: false, error: '缺少 date 或 skeleton' });
        }
        var record = {
            projectId: projectId,
            date: req.body.date,
            aiFailed: !!req.body.aiFailed,
            skeleton: req.body.skeleton,
            ai: req.body.ai || null,
            generatedBy: (req.user && req.user.username) || ''
        };
        var result = await projects.upsertDailySummary(projectId, record);
        logOperation(req.user.username, 'CREATE', 'daily-summary-history', { projectId: projectId, date: record.date, mode: result.mode });
        console.log('[DailySummary] history ' + result.mode + ' for ' + projectId + ' @ ' + record.date);
        res.json({ success: true, mode: result.mode, date: record.date });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'daily-summary-history', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

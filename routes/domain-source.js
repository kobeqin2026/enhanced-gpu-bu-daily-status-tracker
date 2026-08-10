// Domain sync from JIRA BR200 components
// 组件 = Domain, 组件 lead = Domain owner, 组件描述 = notes
// JIRA 组件页: https://jira01.birentech.com/projects/BR200?selectedItem=com.atlassian.jira.jira-projects-plugin:components-page

var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var projects = require('../lib/projects');
var logger = require('../lib/logger');

var loadProjectData = projects.loadProjectData;
var saveProjectData = projects.saveProjectData;
var logOperation = logger.logOperation;

var JIRA_BASE = process.env['JIRA_BASE_URL'] || 'https://jira01.birentech.com';
var JIRA_PAT = process.env['JIRA_PAT'] || '';
var CONF_PROJECT_KEY = process.env['DOMAIN_SOURCE_PROJECT'] || 'BR200';

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

// GET /api/data/domain-source — 拉取 JIRA 组件列表(只读预览,不落库)
router.get('/domain-source', auth.authenticateToken, async function(req, res) {
    try {
        var r = await jiraGet('/rest/api/2/project/' + CONF_PROJECT_KEY + '/components');
        if (!r.ok) return res.status(502).json({ success: false, error: r.error || ('JIRA HTTP ' + r.status) });
        res.json({ success: true, project: CONF_PROJECT_KEY, components: r.data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/domain-source/sync?project=br288y — 组件 upsert 进 domains
router.post('/domain-source/sync', auth.authenticateToken, async function(req, res) {
    var projectId = req.query.project || 'gpu-bringup';
    try {
        var r = await jiraGet('/rest/api/2/project/' + CONF_PROJECT_KEY + '/components');
        if (!r.ok) return res.status(502).json({ success: false, error: r.error || ('JIRA HTTP ' + r.status) });

        var data = await loadProjectData(projectId);
        var existing = data.domains || [];
        var byJiraId = {};
        existing.forEach(function(d) { if (d.jiraComponentId) byJiraId[d.jiraComponentId] = d; });

        var created = [], updated = [], matchedByName = [], errors = [];
        r.data.forEach(function(c) {
            try {
                var leadName = (c.lead && (c.lead.displayName || c.lead.name)) || '';
                var d = byJiraId[c.id];
                if (!d) {
                    // 后端项目里已有同名 domain(没有 jiraComponentId 的历史数据)
                    d = existing.find(function(x) { return (x.name || '').toLowerCase() === (c.name || '').toLowerCase(); });
                    if (d) d.jiraComponentId = String(c.id);
                }
                if (d) {
                    // 更新 lead/notes,保留手动状态
                    if (leadName && d.owner !== leadName) d.owner = leadName;
                    if (c.description && d.notes !== c.description) d.notes = c.description;
                    d.jiraLeadKey = (c.lead && c.lead.name) || d.jiraLeadKey || '';
                    d.syncedAt = new Date().toISOString();
                    updated.push(c.name);
                } else {
                    existing.push({
                        id: 'domain-' + String(existing.length + 1),
                        name: c.name,
                        owner: leadName,
                        status: 'not-started',
                        notes: c.description || '',
                        jiraComponentId: String(c.id),
                        jiraLeadKey: (c.lead && c.lead.name) || '',
                        syncedAt: new Date().toISOString()
                    });
                    created.push(c.name);
                }
            } catch (e) { errors.push(c.name + ': ' + e.message); }
        });

        data.domains = existing;
        data.lastUpdated = new Date().toLocaleString('zh-CN');
        await saveProjectData(projectId, data);
        logOperation(req.user.username, 'SYNC', 'domains', { projectId: projectId, componentCount: r.data.length });

        res.json({
            success: true,
            summary: { created: created, updated: updated, errors: errors, total: r.data.length }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
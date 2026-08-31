// Domain sync from JIRA components (component = Domain)
// 组件 = Domain, 组件 lead = Domain owner, 组件描述 = notes
// 支持选择 JIRA 项目: ?jiraProject=<项目> (默认取 env DOMAIN_SOURCE_PROJECT)
// JIRA 组件页: 按 env JIRA_BASE_URL 定位 components-page

var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var projects = require('../lib/projects');
var logger = require('../lib/logger');

var loadProjectData = projects.loadProjectData;
var saveProjectData = projects.saveProjectData;
var logOperation = logger.logOperation;

var JIRA_BASE = process.env['JIRA_BASE_URL'] || 'https://jira.example.com';
var JIRA_PAT = process.env['JIRA_PAT'] || '';
var DEFAULT_SOURCE_PROJECT = process.env['DOMAIN_SOURCE_PROJECT'] || 'DEMO-TC';

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

function sourceProject(req) {
    var p = (req.query.jiraProject || '').trim().toUpperCase();
    return p || DEFAULT_SOURCE_PROJECT;
}

// GET /api/data/domain-source/users?jiraProject=XXXX[&q=关键字] — 负责人候选集合
// 返回: 1) components 的 lead 全集(确定候选, 对应 domain owner)
//       2) 若带 q 参数, 追加全局 user/search 搜索结果(输入时补全)
router.get('/domain-source/users', auth.authenticateToken, async function(req, res) {
    var proj = sourceProject(req);
    var q = (req.query.q || '').trim();
    try {
        var rComp = await jiraGet('/rest/api/2/project/' + proj + '/components');
        if (!rComp.ok) return res.status(502).json({ success: false, error: rComp.error || ('JIRA HTTP ' + rComp.status) });

        var users = [], seen = {};
        (rComp.data || []).forEach(function(c) {
            var lead = c.lead || {};
            var dn = (lead.displayName || '').trim();
            if (!dn || seen[dn]) return;
            seen[dn] = true;
            users.push({ name: lead.name || '', displayName: dn, active: lead.active !== false, source: 'component-lead' });
        });

        if (q) {
            var rSearch = await jiraGet('/rest/api/2/user/search?username=' + encodeURIComponent(q) + '&maxResults=20');
            if (rSearch.ok && Array.isArray(rSearch.data)) {
                rSearch.data.forEach(function(u) {
                    var dn = (u.displayName || '').trim();
                    if (!dn || seen[dn]) return;
                    seen[dn] = true;
                    users.push({ name: u.name || '', displayName: dn, active: u.active !== false, source: 'search' });
                });
            }
        }
        users.sort(function(a, b) { return a.displayName.localeCompare(b.displayName); });
        res.json({ success: true, project: proj, users: users });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/data/domain-source/projects — 可选的 JIRA 项目列表(供下拉,只读)
router.get('/domain-source/projects', auth.authenticateToken, async function(req, res) {
    try {
        var r = await jiraGet('/rest/api/2/project?maxResults=200&fields=key,name');
        if (!r.ok) return res.status(502).json({ success: false, error: r.error || ('JIRA HTTP ' + r.status) });
        var list = (r.data || []).map(function(p) {
            return { key: p.key, name: p.name };
        }).sort(function(a, b) { return a.key.localeCompare(b.key); });
        res.json({ success: true, projects: list });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/data/domain-source?jiraProject=XXXX — 拉取指定 JIRA 项目组件列表(只读预览,不落库)
router.get('/domain-source', auth.authenticateToken, async function(req, res) {
    var proj = sourceProject(req);
    try {
        var r = await jiraGet('/rest/api/2/project/' + proj + '/components');
        if (!r.ok) return res.status(502).json({ success: false, error: r.error || ('JIRA HTTP ' + r.status) });
        res.json({ success: true, project: proj, components: r.data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/data/domain-source/sync?project=br288y&jiraProject=XXXX — 组件 upsert 进 domains
router.post('/domain-source/sync', auth.authenticateToken, async function(req, res) {
    var projectId = req.query.project || (process.env['DAILY_PROJECT'] || 'demo-daily');
    var jiraProj = sourceProject(req);
    try {
        var r = await jiraGet('/rest/api/2/project/' + jiraProj + '/components');
        if (!r.ok) return res.status(502).json({ success: false, error: r.error || ('JIRA HTTP ' + r.status) });

        var data = await loadProjectData(projectId);
        var existing = data.domains || [];
        var byKey = {};  // jiraProject + '/' + jiraComponentId → domain
        existing.forEach(function(d) {
            if (d.jiraComponentId) byKey[d.jiraProject + '/' + d.jiraComponentId] = d;
        });

        var created = [], updated = [], errors = [];
        r.data.forEach(function(c) {
            try {
                var leadName = (c.lead && (c.lead.displayName || c.lead.name)) || '';
                var key = jiraProj + '/' + c.id;
                var d = byKey[key];
                if (!d) {
                    // 同源同名的历史 domain(无 jiraComponentId 或旧源) → 绑到当前源
                    d = existing.find(function(x) {
                        return !x.jiraComponentId && (x.name || '').toLowerCase() === (c.name || '').toLowerCase();
                    });
                    if (d) { d.jiraComponentId = String(c.id); d.jiraProject = jiraProj; }
                }
                if (d) {
                    if (leadName && d.owner !== leadName) d.owner = leadName;
                    if (c.description && d.notes !== c.description) d.notes = c.description;
                    d.jiraLeadKey = (c.lead && c.lead.name) || d.jiraLeadKey || '';
                    d.jiraProject = jiraProj;
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
                        jiraProject: jiraProj,
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
        logOperation(req.user.username, 'SYNC', 'domains', { projectId: projectId, jiraProject: jiraProj, componentCount: r.data.length });

        res.json({ success: true, source: jiraProj, summary: { created: created, updated: updated, errors: errors, total: r.data.length } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
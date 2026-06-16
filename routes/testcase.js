// Test Case Upload to JIRA
// Bulk create JIRA issues from CSV/Excel data

var express = require('express');
var router = express.Router();
var url = require('url');
var auth = require('../middleware/auth');
var jiraConfig = require('../lib/jiraConfig');

/**
 * Build auth header for JIRA API
 */
function getAuthHeader() {
    if (jiraConfig.pat) {
        return 'Bearer ' + jiraConfig.pat;
    } else if (jiraConfig.email && jiraConfig.apiToken) {
        var token = Buffer.from(jiraConfig.email + ':' + jiraConfig.apiToken).toString('base64');
        return 'Basic ' + token;
    } else if (jiraConfig.username && jiraConfig.password) {
        var creds = Buffer.from(jiraConfig.username + ':' + jiraConfig.password).toString('base64');
        return 'Basic ' + creds;
    }
    return null;
}

/**
 * Sanitize JIRA project/issue key (prevent JQL injection)
 */
function sanitizeKey(key) {
    if (!key) return '';
    return key.replace(/[^A-Za-z0-9\-]/g, '');
}

/**
 * Make a JIRA REST API request
 */
function jiraRequest(method, apiPath, body) {
    return new Promise(function(resolve, reject) {
        var authHeader = getAuthHeader();
        if (!authHeader) {
            return reject(new Error('JIRA认证未配置'));
        }

        var jiraUrl = jiraConfig.baseUrl;
        var parsedUrl = url.parse(jiraUrl);

        var options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: apiPath,
            method: method,
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            protocol: parsedUrl.protocol,
            timeout: 30000
        };

        var https = parsedUrl.protocol === 'https:' ? require('https') : require('http');

        var req = https.request(options, function(resp) {
            var data = '';
            resp.on('data', function(chunk) { data += chunk; });
            resp.on('end', function() {
                try {
                    var parsed = JSON.parse(data);
                    if (resp.statusCode >= 200 && resp.statusCode < 300) {
                        resolve(parsed);
                    } else {
                        var errMsg = parsed.errorMessages ? parsed.errorMessages.join(', ') : (parsed.message || 'Unknown error');
                        reject(new Error('JIRA API ' + resp.statusCode + ': ' + errMsg));
                    }
                } catch (e) {
                    reject(new Error('JIRA API response parse error: ' + data.substring(0, 200)));
                }
            });
        });

        req.setTimeout(30000, function() {
            req.destroy();
            reject(new Error('JIRA API request timeout'));
        });

        req.on('error', function(e) {
            reject(new Error('JIRA API request failed: ' + e.message));
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

/**
 * POST /api/testcase/create
 * Create a single JIRA issue
 * Body: { project, issuetype, summary, description, priority, labels, assignee, parentKey }
 */
router.post('/create', auth.authenticateToken, async function(req, res) {
    try {
        var body = req.body;
        if (!body.project || !body.summary) {
            return res.status(400).json({ success: false, error: 'project和summary为必填项' });
        }

        var projectKey = sanitizeKey(body.project);
        if (!projectKey) {
            return res.status(400).json({ success: false, error: '无效的项目Key' });
        }

        var issueBody = {
            fields: {
                project: { key: projectKey },
                issuetype: { name: body.issuetype || 'Task' },
                summary: body.summary
            }
        };

        if (body.description) {
            issueBody.fields.description = body.description;
        }
        if (body.priority) {
            issueBody.fields.priority = { name: body.priority };
        }
        if (body.labels && Array.isArray(body.labels)) {
            issueBody.fields.labels = body.labels;
        } else if (body.labels && typeof body.labels === 'string') {
            issueBody.fields.labels = body.labels.split(/[;,，]/).map(function(l) { return l.trim(); }).filter(Boolean);
        }
        if (body.assignee) {
            issueBody.fields.assignee = { name: body.assignee };
        }
        if (body.parentKey) {
            var parentKey = sanitizeKey(body.parentKey);
            if (parentKey) {
                issueBody.fields.parent = { key: parentKey };
            }
        }

        var result = await jiraRequest('POST', '/rest/api/2/issue', issueBody);
        res.json({
            success: true,
            data: {
                key: result.key,
                id: result.id,
                url: jiraConfig.baseUrl + '/browse/' + result.key
            }
        });
    } catch (error) {
        console.error('[TestCase] Create error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/testcase/batch-create
 * Batch create JIRA issues
 * Body: { project, issues: [{ summary, description, issuetype, priority, labels, assignee, parentKey }] }
 */
router.post('/batch-create', auth.authenticateToken, async function(req, res) {
    try {
        var body = req.body;
        if (!body.project || !body.issues || !Array.isArray(body.issues) || body.issues.length === 0) {
            return res.status(400).json({ success: false, error: 'project和issues数组为必填项' });
        }

        if (body.issues.length > 50) {
            return res.status(400).json({ success: false, error: '单次最多创建50条Issue' });
        }

        var projectKey = sanitizeKey(body.project);
        if (!projectKey) {
            return res.status(400).json({ success: false, error: '无效的项目Key' });
        }

        var results = [];
        var errors = [];
        var createdKeys = [];

        for (var i = 0; i < body.issues.length; i++) {
            var issue = body.issues[i];
            try {
                var issueBody = {
                    fields: {
                        project: { key: projectKey },
                        issuetype: { name: issue.issuetype || 'Task' },
                        summary: issue.summary
                    }
                };

                if (issue.description) {
                    issueBody.fields.description = issue.description;
                }
                if (issue.priority) {
                    issueBody.fields.priority = { name: issue.priority };
                }
                if (issue.labels) {
                    var labels = Array.isArray(issue.labels) ? issue.labels : issue.labels.split(/[;,，]/).map(function(l) { return l.trim(); }).filter(Boolean);
                    issueBody.fields.labels = labels;
                }
                if (issue.assignee) {
                    issueBody.fields.assignee = { name: issue.assignee };
                }
                // Support parent key — if it's a newly created key from this batch, map it
                if (issue.parentKey) {
                    var parentKey = sanitizeKey(issue.parentKey);
                    // Check if parentKey is a row reference (e.g. "row:0" means first created issue)
                    if (parentKey.indexOf('row:') === 0) {
                        var rowIdx = parseInt(parentKey.split(':')[1]);
                        if (createdKeys[rowIdx]) {
                            parentKey = createdKeys[rowIdx];
                        }
                    }
                    if (parentKey) {
                        issueBody.fields.parent = { key: parentKey };
                    }
                }

                var result = await jiraRequest('POST', '/rest/api/2/issue', issueBody);
                createdKeys.push(result.key);
                results.push({
                    row: i + 1,
                    key: result.key,
                    id: result.id,
                    url: jiraConfig.baseUrl + '/browse/' + result.key,
                    summary: issue.summary,
                    status: 'created'
                });

                // Rate limit: 100ms between requests
                if (i < body.issues.length - 1) {
                    await new Promise(function(r) { setTimeout(r, 100); });
                }
            } catch (err) {
                errors.push({
                    row: i + 1,
                    summary: issue.summary,
                    error: err.message,
                    status: 'failed'
                });
            }
        }

        res.json({
            success: true,
            data: {
                total: body.issues.length,
                created: results.length,
                failed: errors.length,
                results: results,
                errors: errors
            }
        });
    } catch (error) {
        console.error('[TestCase] Batch create error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/testcase/template
 * Download CSV template
 */
router.get('/template', function(req, res) {
    var csv = '\uFEFF项目Key,Issue类型,标题,描述,优先级,标签,负责人,父任务Key\n';
    csv += 'BR200,Task,PCIe Gen3链路训练测试,验证LTSSM状态机在Gen3速率下的训练过程,Highest,"pcie;ltssm",qin.ke,\n';
    csv += 'BR200,Sub-task,IOMMU地址翻译测试,测试DMA地址翻译功能,High,"iommu;dma",qin.ke,BR200-100\n';
    csv += 'BR200,Task,GPIO中断测试,验证GPIO中断触发和处理,Medium,gpio,\n';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="testcase-template.csv"');
    res.send(csv);
});

/**
 * GET /api/testcase/projects
 * Get available JIRA projects for dropdown
 */
router.get('/projects', auth.authenticateToken, async function(req, res) {
    try {
        var result = await jiraRequest('GET', '/rest/api/2/project');
        var projects = result.map(function(p) {
            return { key: p.key, name: p.name };
        }).sort(function(a, b) { return a.key.localeCompare(b.key); });
        res.json({ success: true, data: projects });
    } catch (error) {
        console.error('[TestCase] Get projects error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/testcase/issuetypes
 * Get issue types for a project
 */
router.get('/issuetypes/:project', auth.authenticateToken, async function(req, res) {
    try {
        var projectKey = sanitizeKey(req.params.project);
        if (!projectKey) {
            return res.status(400).json({ success: false, error: '无效的项目Key' });
        }
        var result = await jiraRequest('GET', '/rest/api/2/issue/createmeta?projectKeys=' + projectKey + '&expand=projects.issuetypes');
        var types = [];
        if (result.projects && result.projects.length > 0) {
            types = result.projects[0].issuetypes.map(function(t) {
                return { name: t.name, subtask: t.subtask };
            });
        }
        res.json({ success: true, data: types });
    } catch (error) {
        console.error('[TestCase] Get issue types error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/testcase/search?project=XXX&startAt=0&maxResults=50&query=xxx
 * Search issues in a project via JQL
 */
router.get('/search', auth.authenticateToken, async function(req, res) {
    try {
        var projectKey = sanitizeKey(req.query.project);
        if (!projectKey) {
            return res.status(400).json({ success: false, error: '项目Key为必填项' });
        }

        var startAt = parseInt(req.query.startAt) || 0;
        var maxResults = Math.min(parseInt(req.query.maxResults) || 20, 100);
        var searchText = req.query.query || '';
        var issueType = req.query.issuetype || '';
        var status = req.query.status || '';

        // Build JQL
        var jqlParts = ['project = ' + projectKey];
        if (searchText) {
            var safeText = searchText.replace(/"/g, '\\"');
            jqlParts.push('(summary ~ "' + safeText + '" OR description ~ "' + safeText + '" OR key = "' + safeText + '")');
        }
        if (issueType) {
            jqlParts.push('issuetype = "' + issueType.replace(/"/g, '\\"') + '"');
        }
        if (status) {
            jqlParts.push('status = "' + status.replace(/"/g, '\\"') + '"');
        }
        jqlParts.push('ORDER BY created DESC');

        var jql = jqlParts.join(' AND ');
        var apiPath = '/rest/api/2/search?jql=' + encodeURIComponent(jql)
            + '&startAt=' + startAt
            + '&maxResults=' + maxResults
            + '&fields=summary,status,assignee,priority,issuetype,created,updated,labels,description';

        var result = await jiraRequest('GET', apiPath);
        var issues = result.issues.map(function(issue) {
            return {
                key: issue.key,
                id: issue.id,
                summary: issue.fields.summary,
                description: issue.fields.description || '',
                status: issue.fields.status ? issue.fields.status.name : '',
                assignee: issue.fields.assignee ? issue.fields.assignee.displayName || issue.fields.assignee.name : '',
                priority: issue.fields.priority ? issue.fields.priority.name : '',
                issuetype: issue.fields.issuetype ? issue.fields.issuetype.name : '',
                labels: issue.fields.labels || [],
                created: issue.fields.created,
                updated: issue.fields.updated,
                url: jiraConfig.baseUrl + '/browse/' + issue.key,
                parent: issue.fields.parent ? { key: issue.fields.parent.key, summary: issue.fields.parent.fields ? issue.fields.parent.fields.summary : '' } : null
            };
        });

        res.json({
            success: true,
            data: {
                total: result.total,
                startAt: result.startAt,
                maxResults: result.maxResults,
                issues: issues
            }
        });
    } catch (error) {
        console.error('[TestCase] Search error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/testcase/testplans?project=XXX
 * List test plans (Epics) from a JIRA project
 */
router.get('/testplans', auth.authenticateToken, async function(req, res) {
    try {
        var projectKey = sanitizeKey(req.query.project);
        if (!projectKey) {
            return res.status(400).json({ success: false, error: '项目Key为必填项' });
        }

        // Fetch Epics from the project
        var jql = 'project = ' + projectKey + ' AND issuetype = Epic ORDER BY created DESC';
        var apiPath = '/rest/api/2/search?jql=' + encodeURIComponent(jql)
            + '&startAt=0&maxResults=100'
            + '&fields=summary,status,description,assignee,created';

        var result = await jiraRequest('GET', apiPath);
        var plans = result.issues.map(function(issue) {
            return {
                key: issue.key,
                id: issue.id,
                summary: issue.fields.summary,
                description: issue.fields.description || '',
                status: issue.fields.status ? issue.fields.status.name : '',
                assignee: issue.fields.assignee ? issue.fields.assignee.displayName || issue.fields.assignee.name : '',
                created: issue.fields.created,
                url: jiraConfig.baseUrl + '/browse/' + issue.key
            };
        });

        res.json({
            success: true,
            data: {
                total: result.total,
                plans: plans
            }
        });
    } catch (error) {
        console.error('[TestCase] Get test plans error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/testcase/testplan
 * Create a new test plan (Epic)
 * Body: { project, summary, description }
 */
router.post('/testplan', auth.authenticateToken, async function(req, res) {
    try {
        var body = req.body;
        if (!body.project || !body.summary) {
            return res.status(400).json({ success: false, error: 'project和summary为必填项' });
        }

        var projectKey = sanitizeKey(body.project);
        if (!projectKey) {
            return res.status(400).json({ success: false, error: '无效的项目Key' });
        }

        var issueBody = {
            fields: {
                project: { key: projectKey },
                issuetype: { name: 'Epic' },
                summary: body.summary
            }
        };

        if (body.description) {
            issueBody.fields.description = body.description;
        }

        var result = await jiraRequest('POST', '/rest/api/2/issue', issueBody);
        res.json({
            success: true,
            data: {
                key: result.key,
                id: result.id,
                summary: body.summary,
                url: jiraConfig.baseUrl + '/browse/' + result.key
            }
        });
    } catch (error) {
        console.error('[TestCase] Create test plan error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

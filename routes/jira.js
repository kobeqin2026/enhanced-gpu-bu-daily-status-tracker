// JIRA import route - fetches bugs from JIRA REST API

var express = require('express');
var router = express.Router();
var https = require('https');
var http = require('http');
var url = require('url');
var auth = require('../middleware/auth');
var jiraConfig = require('../lib/jiraConfig');

/**
 * Make an HTTP request (supports both http and https)
 */
function makeRequest(options, postData) {
    return new Promise(function(resolve, reject) {
        var client = options.protocol === 'https:' ? https : http;
        var req = client.request(options, function(res) {
            var data = '';
            res.on('data', function(chunk) { data += chunk; });
            res.on('end', function() {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Failed to parse JIRA response: ' + data.substring(0, 200)));
                }
            });
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

/**
 * Build Basic Auth header
 */
function getAuthHeader() {
    // Priority: PAT (Bearer) > Cloud auth (email + API token) > Server auth
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
 * Map JIRA priority to tracker severity
 */
function mapPriority(jiraPriority) {
    if (!jiraPriority) return 'medium';
    var name = (jiraPriority.name || '').toLowerCase();
    if (name.indexOf('highest') !== -1 || name.indexOf('blocker') !== -1) return 'highest';
    if (name.indexOf('high') !== -1 || name.indexOf('major') !== -1) return 'high';
    if (name.indexOf('medium') !== -1 || name.indexOf('normal') !== -1 || name.indexOf('minor') !== -1) return 'medium';
    if (name.indexOf('low') !== -1) return 'low';
    if (name.indexOf('lowest') !== -1 || name.indexOf('trivial') !== -1) return 'lowest';
    return 'medium';
}

/**
 * Map JIRA status to tracker status
 */
function mapStatus(jiraStatus) {
    if (!jiraStatus) return 'open';
    var name = (jiraStatus.name || '').toLowerCase();
    // Closed / Done / Resolved
    if (name.indexOf('closed') !== -1 || name.indexOf('done') !== -1 || name.indexOf('resolved') !== -1) return 'closed';
    // Reject / Won't Fix
    if (name.indexOf('reject') !== -1 || name.indexOf('wont') !== -1 || name.indexOf('won\'t') !== -1) return 'rejected';
    // Implemented
    if (name.indexOf('implement') !== -1) return 'implement';
    // Triaged / 开发中 / In Progress / Review / Test / Verify / QA
    if (name.indexOf('triage') !== -1 || name.indexOf('开发') !== -1 || name.indexOf('in progress') !== -1 || name.indexOf('review') !== -1 || name.indexOf('test') !== -1 || name.indexOf('verify') !== -1 || name.indexOf('qa') !== -1) return 'triage';
    // Opened / Open / New / To Do
    if (name.indexOf('open') !== -1 || name.indexOf('new') !== -1 || name.indexOf('to do') !== -1) return 'open';
    return 'open';
}

/**
 * POST /api/data/import-jira
 * Fetches bugs from JIRA and returns them in tracker format
 */
router.post('/import-jira', auth.authenticateToken, async function(req, res) {
    try {
        var authHeader = getAuthHeader();
        if (!authHeader) {
            return res.status(500).json({
                success: false,
                error: 'JIRA认证未配置。请在环境变量中设置 JIRA_PAT 或 JIRA_EMAIL + JIRA_API_TOKEN'
            });
        }

        // Support custom JQL from request body, or build from project
        var jql, maxResults, selectedProject;
        if (req.body && req.body.project) {
            var project = req.body.project;
            var includeClosed = req.body && req.body.includeClosed === true;
            selectedProject = project;
            if (includeClosed) {
                jql = 'project = ' + project + ' AND issuetype = Bug ORDER BY priority DESC';
            } else {
                jql = 'project = ' + project + ' AND issuetype = Bug AND status not in (Done, Closed, Rejected) ORDER BY priority DESC';
            }
            maxResults = (req.body && req.body.maxResults) || jiraConfig.maxResults;
        } else {
            jql = (req.body && req.body.jql) || jiraConfig.jql;
            maxResults = (req.body && req.body.maxResults) || jiraConfig.maxResults;
        }

        var jiraUrl = jiraConfig.baseUrl;
        var parsedUrl = url.parse(jiraUrl);

        // Build JIRA API request
        var apiPath = '/rest/api/2/search';
        var queryParams = 'jql=' + encodeURIComponent(jql) +
            '&fields=' + encodeURIComponent(jiraConfig.fields) +
            '&maxResults=' + maxResults;

        var requestOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: apiPath + '?' + queryParams,
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            protocol: parsedUrl.protocol,
            rejectUnauthorized: false  // Allow self-signed certs in internal networks
        };

        console.log('Fetching JIRA bugs: ' + jiraUrl + apiPath + '?' + queryParams);

        var jiraData = await makeRequest(requestOptions);

        if (!jiraData || !jiraData.issues) {
            return res.status(500).json({
                success: false,
                error: 'JIRA API返回格式异常',
                rawData: JSON.stringify(jiraData).substring(0, 500)
            });
        }

        // Map JIRA issues to tracker bug format
        var bugs = [];
        jiraData.issues.forEach(function(issue, idx) {
            var f = issue.fields || {};
            var assignee = f.assignee || {};
            var reporter = f.reporter || {};
            var status = f.status || {};
            var priority = f.priority || {};
            var created = f.created || new Date().toISOString();
            var reportDate = created.split('T')[0];

            var labels = f.labels || [];

            // Try to extract domain from labels or components
            var domain = 'TBD';
            if (labels.length > 0) {
                domain = labels[0];
            }

            var bug = {
                id: 'jira-' + Date.now() + '-' + idx,
                bugId: issue.key || '',
                domain: domain,
                description: f.summary || '',
                severity: mapPriority(priority),
                status: mapStatus(status),
                reportDate: reportDate,
                owner: assignee.displayName || assignee.name || 'TBD',
                jiraKey: issue.key,
                jiraStatus: status.name || '',
                jiraUrl: jiraUrl + '/browse/' + issue.key,
                labels: labels
            };

            bugs.push(bug);
        });

        console.log('Fetched ' + bugs.length + ' bugs from JIRA');

        res.json({
            success: true,
            bugs: bugs,
            total: jiraData.total || bugs.length,
            project: selectedProject || null,
            message: '成功从JIRA获取 ' + bugs.length + ' 条Bug'
        });

    } catch (error) {
        console.error('JIRA import error: ' + error.message);
        res.status(500).json({
            success: false,
            error: 'JIRA导入失败: ' + error.message
        });
    }
});

/**
 * GET /api/data/jira-projects
 * Fetches all projects from JIRA
 */
router.get('/jira-projects', auth.authenticateToken, async function(req, res) {
    try {
        var authHeader = getAuthHeader();
        if (!authHeader) {
            return res.status(500).json({
                success: false,
                error: 'JIRA认证未配置'
            });
        }

        var jiraUrl = jiraConfig.baseUrl;
        var parsedUrl = url.parse(jiraUrl);

        var requestOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: '/rest/api/2/project?expand=lead,description',
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            protocol: parsedUrl.protocol,
            rejectUnauthorized: false
        };

        var projectData = await makeRequest(requestOptions);

        if (!Array.isArray(projectData)) {
            return res.status(500).json({
                success: false,
                error: 'JIRA API返回格式异常',
                rawData: JSON.stringify(projectData).substring(0, 500)
            });
        }

        var projects = projectData.map(function(p) {
            return {
                key: p.key || '',
                name: p.name || '',
                lead: p.lead ? (p.lead.displayName || p.lead.name || '') : '',
                description: p.description || ''
            };
        });

        res.json({
            success: true,
            projects: projects,
            total: projects.length
        });

    } catch (error) {
        console.error('JIRA projects fetch error: ' + error.message);
        res.status(500).json({
            success: false,
            error: '获取JIRA项目列表失败: ' + error.message
        });
    }
});

module.exports = router;

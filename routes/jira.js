// JIRA import route - fetches bugs from JIRA REST API

var express = require('express');
var router = express.Router();
var https = require('https');
var http = require('http');
var url = require('url');
var auth = require('../middleware/auth');
var jiraConfig = require('../lib/jiraConfig');
var diagnosis = require('../lib/diagnosis');

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
                id: 'jira-' + issue.key + '-' + Date.now(),
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

/**
 * POST /api/data/sync-jira-status
 * Fetches latest status for JIRA bugs from JIRA API
 */
router.post('/sync-jira-status', auth.authenticateToken, async function(req, res) {
    try {
        var authHeader = getAuthHeader();
        if (!authHeader) {
            return res.status(500).json({
                success: false,
                error: 'JIRA认证未配置'
            });
        }

        var jiraKeys = req.body.jiraKeys || [];
        if (jiraKeys.length === 0) {
            return res.json({ success: true, updated: 0, bugs: [] });
        }

        var jiraUrl = jiraConfig.baseUrl;
        var parsedUrl = url.parse(jiraUrl);

        // Build JQL to fetch all matching JIRA keys
        var jql = 'issueKey in (' + jiraKeys.join(',') + ')';
        var queryParams = 'jql=' + encodeURIComponent(jql) +
            '&fields=status,assignee' +
            '&maxResults=' + jiraKeys.length;

        var requestOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: '/rest/api/2/search?' + queryParams,
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            protocol: parsedUrl.protocol,
            rejectUnauthorized: false
        };

        console.log('Syncing JIRA status for ' + jiraKeys.length + ' bugs');

        var jiraData = await makeRequest(requestOptions);

        if (!jiraData || !jiraData.issues) {
            return res.status(500).json({
                success: false,
                error: 'JIRA API返回格式异常'
            });
        }

        // Build status map: jiraKey -> {jiraStatus, status, owner}
        var statusMap = {};
        jiraData.issues.forEach(function(issue) {
            var f = issue.fields || {};
            var status = f.status || {};
            var assignee = f.assignee || {};
            var key = issue.key;

            statusMap[key] = {
                jiraStatus: status.name || '',
                status: mapStatus(status),
                owner: assignee.displayName || assignee.name || ''
            };
        });

        console.log('JIRA sync: found ' + Object.keys(statusMap).length + ' of ' + jiraKeys.length + ' bugs');

        res.json({
            success: true,
            updated: Object.keys(statusMap).length,
            bugs: statusMap,
            total: jiraKeys.length
        });

    } catch (error) {
        console.error('JIRA sync error: ' + error.message);
        res.status(500).json({
            success: false,
            error: '同步JIRA状态失败: ' + error.message
        });
    }
});

/**
 * POST /api/data/jira-dashboard
 * Fetches all bugs for dashboard aggregation + caches snapshot for trend history
 */
router.post('/jira-dashboard', auth.authenticateToken, async function(req, res) {
    try {
        var authHeader = getAuthHeader();
        if (!authHeader) {
            return res.status(500).json({
                success: false,
                error: 'JIRA认证未配置。请在环境变量中设置 JIRA_PAT 或 JIRA_EMAIL + JIRA_API_TOKEN'
            });
        }

        var project = req.body.project || null;
        var projects = req.body.projects || [];
        var includeClosed = req.body.includeClosed !== false; // default true for dashboard
        var jql;

        if (projects.length > 0) {
            var projectClause = projects.length === 1
                ? 'project = ' + projects[0]
                : 'project in (' + projects.join(',') + ')';
            jql = projectClause + ' AND issuetype = Bug';
            if (!includeClosed) {
                jql += ' AND status not in (Done, Closed, Rejected)';
            }
            jql += ' ORDER BY created DESC';
        } else if (project) {
            jql = 'project = ' + project + ' AND issuetype = Bug';
            if (!includeClosed) {
                jql += ' AND status not in (Done, Closed, Rejected)';
            }
            jql += ' ORDER BY created DESC';
        } else {
            // Default: fetch from configured projects
            jql = jiraConfig.jql;
        }

        var maxResults = req.body.maxResults || 500;

        // Fetch bugs from JIRA
        var allBugs = await fetchJiraBugs(authHeader, jql, maxResults);

        // Build dashboard stats
        var stats = computeDashboardStats(allBugs);
        var charts = computeChartData(allBugs);

        // Cache snapshot for trend history
        if (project) {
            cacheSnapshot(project, allBugs);
        }
        // Also cache per-project if multi-project fetch
        if (projects.length > 0) {
            projects.forEach(function(p) {
                var projectBugs = allBugs.filter(function(b) { return b.projectKey === p; });
                cacheSnapshot(p, projectBugs);
            });
        }

        res.json({
            success: true,
            bugs: allBugs,
            stats: stats,
            charts: charts,
            total: allBugs.length,
            project: project,
            projects: projects,
            message: '成功获取 ' + allBugs.length + ' 条Bug数据'
        });

    } catch (error) {
        console.error('JIRA dashboard error: ' + error.message);
        res.status(500).json({
            success: false,
            error: '获取Dashboard数据失败: ' + error.message
        });
    }
});

/**
 * GET /api/data/jira-dashboard-history/:project
 * Returns cached snapshots for trend analysis
 */
router.get('/jira-dashboard-history/:project', auth.authenticateToken, async function(req, res) {
    try {
        var project = req.params.project.replace(/[^a-zA-Z0-9\-_]/g, '');
        if (!project) {
            return res.status(400).json({ success: false, error: '无效的项目名' });
        }

        var fs = require('fs');
        var path = require('path');
        var cacheDir = path.join(__dirname, '..', 'data', 'jira-cache');

        if (!fs.existsSync(cacheDir)) {
            return res.json({ success: true, project: project, snapshots: [], trendData: [] });
        }

        var cacheFile = path.join(cacheDir, project + '-history.json');
        var history = [];
        if (fs.existsSync(cacheFile)) {
            history = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        }

        // Build trend data from snapshots
        var trendData = buildTrendData(history);

        res.json({
            success: true,
            project: project,
            snapshots: history.slice(-30), // last 30 snapshots
            trendData: trendData
        });

    } catch (error) {
        console.error('JIRA history error: ' + error.message);
        res.status(500).json({
            success: false,
            error: '获取历史数据失败: ' + error.message
        });
    }
});

// ============ Helper Functions for Dashboard ============

/**
 * Fetch bugs from JIRA with given JQL
 */
function fetchJiraBugs(authHeader, jql, maxResults) {
    return new Promise(function(resolve, reject) {
        var jiraUrl = jiraConfig.baseUrl;
        var parsedUrl = url.parse(jiraUrl);

        var apiPath = '/rest/api/2/search';
        var queryParams = 'jql=' + encodeURIComponent(jql) +
            '&fields=' + encodeURIComponent(jiraConfig.fields + ',description,reporter,updated,duedate,components,customfield_10023') +
            '&maxResults=' + maxResults;

        var client = parsedUrl.protocol === 'https:' ? https : http;
        var options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: apiPath + '?' + queryParams,
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            rejectUnauthorized: false
        };

        var req = client.request(options, function(resp) {
            var data = '';
            resp.on('data', function(chunk) { data += chunk; });
            resp.on('end', function() {
                try {
                    var jiraData = JSON.parse(data);
                    if (!jiraData || !jiraData.issues) {
                        if (jiraData && jiraData.errorMessages) {
                            console.error('[FetchBugs] JIRA API error:', JSON.stringify(jiraData.errorMessages).substring(0, 300));
                            console.error('[FetchBugs] JQL was:', jql.substring(0, 200));
                        }
                        resolve([]);
                        return;
                    }

                    var bugs = jiraData.issues.map(function(issue) {
                        var f = issue.fields || {};
                        var assignee = f.assignee || {};
                        var reporter = f.reporter || {};
                        var status = f.status || {};
                        var priority = f.priority || {};
                        var created = f.created || new Date().toISOString();
                        var updated = f.updated || created;

                        var labels = f.labels || [];
                        var domain = 'TBD';
                        if (labels.length > 0) {
                            domain = labels[0];
                        }
                        // Try components as domain fallback
                        if (domain === 'TBD' && f.components && f.components.length > 0) {
                            domain = f.components[0].name;
                        }

                        // Extract project key from issue key (e.g., MPW2-77 -> MPW2)
                        var projectKey = '';
                        if (issue.key && issue.key.indexOf('-') !== -1) {
                            projectKey = issue.key.split('-')[0];
                        }

                        var bug = {
                            id: 'jira-' + issue.key + '-' + Date.now(),
                            bugId: issue.key || '',
                            domain: domain,
                            description: f.description || f.summary || '',
                            summary: f.summary || '',
                            severity: mapPriority(priority),
                            status: mapStatus(status),
                            reportDate: created.split('T')[0],
                            updatedDate: updated.split('T')[0],
                            owner: assignee.displayName || assignee.name || 'TBD',
                            reporter: reporter.displayName || reporter.name || '',
                            jiraKey: issue.key,
                            jiraStatus: status.name || '',
                            jiraPriority: priority.name || '',
                            jiraUrl: jiraUrl + '/browse/' + issue.key,
                            projectKey: projectKey,
                            labels: labels,
                            createdTimestamp: new Date(created).getTime(),
                            updatedTimestamp: new Date(updated).getTime()
                        };

                        // Calculate age in days
                        var createdDate = new Date(created);
                        var now = new Date();
                        var ageMs = now - createdDate;
                        bug.ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

                        // If closed, calculate resolution time
                        if (bug.status === 'closed' || bug.status === 'rejected') {
                            var updatedDate = new Date(updated);
                            var resolutionMs = updatedDate - createdDate;
                            bug.resolutionDays = Math.floor(resolutionMs / (1000 * 60 * 60 * 24));
                        }

                        return bug;
                    });

                    resolve(bugs);
                } catch (e) {
                    reject(new Error('解析JIRA响应失败: ' + data.substring(0, 200)));
                }
            });
        });
        req.on('error', function(e) { reject(e); });
        req.end();
    });
}

/**
 * Compute top-level KPI stats
 */
function computeDashboardStats(bugs) {
    var total = bugs.length;
    var open = 0, triage = 0, implement = 0, closed = 0, rejected = 0;
    var today = new Date().toISOString().split('T')[0];
    var weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    var todayNew = 0, weekClosed = 0;
    var resolutionDays = [];
    var overdue = 0;

    bugs.forEach(function(bug) {
        switch (bug.status) {
            case 'open': open++; break;
            case 'triage': triage++; break;
            case 'implement': implement++; break;
            case 'closed': closed++; break;
            case 'rejected': rejected++; break;
        }

        if (bug.reportDate === today) todayNew++;
        if (bug.status === 'closed' && bug.updatedDate >= weekAgo) weekClosed++;

        if (bug.resolutionDays !== undefined) resolutionDays.push(bug.resolutionDays);
        if (bug.status !== 'closed' && bug.status !== 'rejected' && bug.ageDays > 14) overdue++;
    });

    var avgResolution = resolutionDays.length > 0
        ? Math.round(resolutionDays.reduce(function(a, b) { return a + b; }, 0) / resolutionDays.length)
        : 0;

    return {
        total: total,
        open: open + triage + implement, // all non-closed
        closed: closed,
        rejected: rejected,
        todayNew: todayNew,
        weekClosed: weekClosed,
        avgResolutionDays: avgResolution,
        overdue: overdue
    };
}

/**
 * Compute chart data aggregates
 */
function computeChartData(bugs) {
    // Status distribution
    var statusCount = { open: 0, triage: 0, implement: 0, closed: 0, rejected: 0 };
    // Severity distribution
    var severityCount = { highest: 0, high: 0, medium: 0, low: 0, lowest: 0 };
    // Owner distribution
    var ownerCount = {};
    // Domain distribution
    var domainCount = {};
    // Daily trend: date -> { new: N, closed: N }
    var dailyTrend = {};
    // Age distribution
    var ageBuckets = { '0-3天': 0, '3-7天': 0, '7-14天': 0, '14-30天': 0, '30天+': 0 };

    bugs.forEach(function(bug) {
        // Status
        if (statusCount[bug.status] !== undefined) statusCount[bug.status]++;

        // Severity
        if (severityCount[bug.severity] !== undefined) severityCount[bug.severity]++;

        // Owner
        var owner = bug.owner || 'TBD';
        ownerCount[owner] = (ownerCount[owner] || 0) + 1;

        // Domain
        var domain = bug.domain || 'TBD';
        domainCount[domain] = (domainCount[domain] || 0) + 1;

        // Daily trend (by reportDate)
        var date = bug.reportDate;
        if (!dailyTrend[date]) dailyTrend[date] = { date: date, new: 0, closed: 0 };
        dailyTrend[date].new++;
        if ((bug.status === 'closed' || bug.status === 'rejected') && bug.updatedDate) {
            var uDate = bug.updatedDate;
            if (!dailyTrend[uDate]) dailyTrend[uDate] = { date: uDate, new: 0, closed: 0 };
            dailyTrend[uDate].closed++;
        }

        // Age buckets (for open bugs)
        if (bug.status !== 'closed' && bug.status !== 'rejected') {
            if (bug.ageDays <= 3) ageBuckets['0-3天']++;
            else if (bug.ageDays <= 7) ageBuckets['3-7天']++;
            else if (bug.ageDays <= 14) ageBuckets['7-14天']++;
            else if (bug.ageDays <= 30) ageBuckets['14-30天']++;
            else ageBuckets['30天+']++;
        }
    });

    // Sort daily trend by date
    var trendArray = Object.keys(dailyTrend).sort().map(function(d) { return dailyTrend[d]; });

    // Sort owner by count descending
    var ownerArray = Object.keys(ownerCount).sort(function(a, b) { return ownerCount[b] - ownerCount[a]; }).map(function(o) {
        return { owner: o, count: ownerCount[o] };
    });

    // Sort domain by count descending
    var domainArray = Object.keys(domainCount).sort(function(a, b) { return domainCount[b] - domainCount[a]; }).map(function(d) {
        return { domain: d, count: domainCount[d] };
    });

    return {
        statusCount: statusCount,
        severityCount: severityCount,
        ownerCount: ownerArray,
        domainCount: domainArray,
        dailyTrend: trendArray,
        ageBuckets: ageBuckets
    };
}

/**
 * Cache a snapshot of bugs for historical trend tracking
 */
function cacheSnapshot(project, bugs) {
    try {
        var fs = require('fs');
        var pathModule = require('path');
        var cacheDir = pathModule.join(__dirname, '..', 'data', 'jira-cache');

        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        var cacheFile = pathModule.join(cacheDir, project + '-history.json');
        var history = [];
        if (fs.existsSync(cacheFile)) {
            history = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        }

        // Create summary snapshot
        var stats = computeDashboardStats(bugs);
        var charts = computeChartData(bugs);
        var snapshot = {
            date: new Date().toISOString(),
            project: project,
            total: bugs.length,
            stats: stats,
            statusCount: charts.statusCount,
            severityCount: charts.severityCount
        };

        // Check if snapshot for today already exists, update it
        var today = new Date().toISOString().split('T')[0];
        var existingIndex = -1;
        for (var i = 0; i < history.length; i++) {
            if (history[i].date && history[i].date.split('T')[0] === today) {
                existingIndex = i;
                break;
            }
        }
        if (existingIndex >= 0) {
            history[existingIndex] = snapshot;
        } else {
            history.push(snapshot);
        }

        // Keep only last 90 days
        if (history.length > 90) {
            history = history.slice(history.length - 90);
        }

        fs.writeFileSync(cacheFile, JSON.stringify(history, null, 2), 'utf8');
        console.log('Cached JIRA snapshot for ' + project + ' (' + bugs.length + ' bugs)');
    } catch (e) {
        console.error('Failed to cache JIRA snapshot: ' + e.message);
    }
}

/**
 * Build trend data from cached snapshots
 */
function buildTrendData(history) {
    var trendData = [];
    history.forEach(function(snapshot) {
        var date = snapshot.date ? snapshot.date.split('T')[0] : 'unknown';
        var sc = snapshot.statusCount || {};
        trendData.push({
            date: date,
            total: snapshot.total || 0,
            open: (sc.open || 0) + (sc.triage || 0) + (sc.implement || 0),
            closed: sc.closed || 0,
            rejected: sc.rejected || 0
        });
    });
    return trendData;
}

/**
 * POST /api/data/diagnose-bug
 * Analyzes a JIRA bug using Bailian LLM with cross-project similar bug search
 */
router.post('/diagnose-bug', auth.authenticateToken, async function(req, res) {
    try {
        var bugInfo = req.body;
        if (!bugInfo || !bugInfo.key) {
            return res.status(400).json({ success: false, error: '缺少 Bug Key' });
        }

        console.log('[Diagnosis] Request for bug:', bugInfo.key, 'project:', bugInfo.projectKey || 'unknown');

        // Build cross-project search function
        var authHeader = getAuthHeader();
        if (!authHeader) {
            return res.status(500).json({
                success: false,
                error: 'JIRA认证未配置。请在环境变量中设置 JIRA_PAT 或 JIRA_EMAIL + JIRA_API_TOKEN'
            });
        }

        // Auto-fetch comments for the source bug if not already provided by frontend
        // This ensures comment-based reference extraction (e.g., "Similar to .../BRHW110-1677")
        // works even when the dashboard bug data doesn't include comments
        if (!bugInfo.comments || !Array.isArray(bugInfo.comments) || bugInfo.comments.length === 0) {
            try {
                var details = await fetchJiraBugsWithDetails(authHeader, 'key = "' + bugInfo.key + '"', 1);
                if (details && details.length > 0) {
                    bugInfo.comments = details[0].comments || [];
                    bugInfo.description = details[0].description || bugInfo.description || '';
                    console.log('[Diagnosis] Auto-fetched', bugInfo.comments.length, 'comments for', bugInfo.key);
                }
            } catch (e) {
                console.log('[Diagnosis] Failed to auto-fetch comments:', e.message);
            }
        }

        var jiraCtx = {
            searchSimilarBugsFn: function(bug) {
                return searchSimilarBugs(authHeader, bug);
            }
        };

        var result = await diagnosis.analyzeBug(bugInfo, jiraCtx);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Diagnosis] Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Search for similar CLOSED bugs across projects to learn from their solutions
 */
function searchSimilarBugs(authHeader, bugInfo) {
    return new Promise(function(resolve, reject) {
        // Include comments in text for reference extraction and keyword matching
        // This catches bug keys (e.g., BRHW110-1677) mentioned in comments like "same as BRHW110-1677"
        var commentsText = '';
        if (bugInfo.comments && Array.isArray(bugInfo.comments) && bugInfo.comments.length > 0) {
            commentsText = ' ' + bugInfo.comments.map(function(c) { return (c.body || '') + ' ' + (c.author || ''); }).join(' ');
        }
        var text = (bugInfo.summary || '') + ' ' + (bugInfo.description || '') + commentsText;
        var keywordGroups = extractKeywords(text);

        if (keywordGroups.primary.length === 0) {
            return resolve([]);
        }

        // Build multiple targeted AND queries for better coverage
        var queries = buildTargetedQueries(keywordGroups, bugInfo.projectKey);

        console.log('[Diagnosis] Running', queries.length, 'targeted queries for bug', bugInfo.key);
        queries.forEach(function(q, i) {
            console.log('[Diagnosis]   Query ' + (i + 1) + ':', q.jql.substring(0, 200));
        });

        // Extract explicit bug key references from source bug text (summary + description + ALL comments)
        // This catches cases like "参见 BRHW110-1677" or "Similar to .../browse/BRHW110-1677" in comments
        var referencedBugKeys = extractBugKeyReferences(text);
        if (referencedBugKeys.length > 0) {
            console.log('[Diagnosis] Found bug key references in text:', referencedBugKeys.join(', '));
        }

        var sourceText = {
            summary: bugInfo.summary || '',
            description: bugInfo.description || '',
            comments: commentsText || '',
            fullText: text.toLowerCase(),
            projectKey: bugInfo.projectKey || ''
        };

        var promises = queries.map(function(q) {
            return fetchJiraBugs(authHeader, q.jql, q.maxResults)
                .then(function(bugs) {
                    // Filter out bugs from the same project
                    if (bugInfo.projectKey) {
                        bugs = bugs.filter(function(b) {
                            return b.projectKey !== bugInfo.projectKey;
                        });
                    }
                    return bugs.map(function(b) {
                        b.queryBonus = q.bonus;
                        return b;
                    });
                })
                .catch(function(err) {
                    console.error('[Diagnosis] Query failed:', err.message);
                    return [];
                });
        });

        // Fetch explicitly referenced bugs directly — NO status filter, ALWAYS include them
        // These bugs are specifically mentioned in the source bug's comments/description,
        // so they must appear in the related bugs list regardless of status or score.
        // E.g., MPW2-181 comment: "Similar to .../browse/BRHW110-1677"
        if (referencedBugKeys.length > 0) {
            referencedBugKeys.forEach(function(refKey) {
                var refJql = 'key = "' + refKey + '"';
                promises.push(
                    fetchJiraBugsWithDetails(authHeader, refJql, 1)
                        .then(function(details) {
                            if (details && details.length > 0) {
                                var bug = details[0];
                                if (!bug.bugId) bug.bugId = bug.jiraKey || bug.bugId;
                                // Also filter out same-project bugs for consistency
                                if (bugInfo.projectKey && bug.projectKey === bugInfo.projectKey) {
                                    return null;
                                }
                                return bug;
                            }
                            return null;
                        })
                        .catch(function(err) {
                            console.error('[Diagnosis] Failed to fetch referenced bug', refKey, err.message);
                            return null;
                        })
                        .then(function(bug) {
                            if (bug) {
                                // Explicit references: base 90, small bonus for content match, max 100
                                bug.queryBonus = 0;
                                bug.isExplicitReference = true;
                                console.log('[Diagnosis] Explicit reference found:', bug.bugId);
                                return bug;
                            }
                            return null;
                        })
                );
            });
        }

        Promise.all(promises)
            .then(function(results) {
                var seen = {};
                var scored = [];

                results.forEach(function(bugs) {
                    // Handle both arrays (from queries) and single objects (from referenced bugs)
                    if (!bugs) return;
                    if (!Array.isArray(bugs)) bugs = [bugs];

                    bugs.forEach(function(bug) {
                        if (!bug || !bug.bugId) return;
                        if (!seen[bug.bugId]) {
                            seen[bug.bugId] = true;
                            // Scoring: explicit refs 90-100, keyword matches 0-85
                            var contentScore = scoreBugRelevance(bug, keywordGroups, sourceText);
                            var baseScore;
                            if (bug.isExplicitReference) {
                                // Explicit mention in comments: 90 base + up to 10 from content match
                                baseScore = 90 + Math.round(contentScore * 0.1);
                            } else {
                                // Keyword-based: content score only, capped at 85
                                baseScore = Math.min(contentScore, 85);
                            }
                            bug.relevanceScore = Math.min(Math.round(baseScore + (bug.queryBonus || 0)), 100);
                            scored.push(bug);
                        }
                    });
                });

                scored.sort(function(a, b) { return b.relevanceScore - a.relevanceScore; });

                // Select Top 8 (wider pool for detail fetching, then re-score)
                var topCandidates = scored.slice(0, 8);

                console.log('[Diagnosis] Selected Top', topCandidates.length, 'candidates for detail fetch');
                topCandidates.forEach(function(b) {
                    console.log('  -', b.bugId, 'score:', b.relevanceScore, b.isExplicitReference ? '(explicit ref)' : '');
                });

                var detailPromises = topCandidates.map(function(bug) {
                    // Skip detail fetch if already fetched (explicit references)
                    if (bug.isExplicitReference && bug.comments) {
                        return bug;
                    }
                    var detailJql = 'key = "' + bug.bugId + '"';
                    return fetchJiraBugsWithDetails(authHeader, detailJql, 1)
                        .then(function(details) {
                            if (details && details.length > 0) {
                                var detail = details[0];
                                bug.comments = detail.comments;
                                bug.rootCauseComment = detail.rootCauseComment;
                                bug.description = detail.description || bug.description;
                                bug.summary = detail.summary || bug.summary;

                                // Re-score with full details available, cap at 100
                                var reContentScore = scoreBugRelevance(bug, keywordGroups, sourceText);
                                var reBase;
                                if (bug.isExplicitReference) {
                                    reBase = 90 + Math.round(reContentScore * 0.1);
                                } else {
                                    reBase = Math.min(reContentScore, 85);
                                }
                                bug.relevanceScore = Math.min(Math.round(reBase + (bug.queryBonus || 0)), 100);
                            }
                            return bug;
                        })
                        .catch(function(err) {
                            console.error('[Diagnosis] Failed details for', bug.bugId, err.message);
                            return bug;
                        });
                });

                return Promise.all(detailPromises);
            })
            .then(function(topBugs) {
                // Filter out nulls
                topBugs = topBugs.filter(function(b) { return b != null; });

                // Final sort after re-scoring
                topBugs.sort(function(a, b) { return b.relevanceScore - a.relevanceScore; });

                console.log('[Diagnosis] Final Result: Found', topBugs.length, 'bugs with details.');
                topBugs.forEach(function(b) {
                    console.log('  -', b.bugId, 'final score:', b.relevanceScore, b.isExplicitReference ? '(explicit ref)' : '');
                });
                resolve(topBugs.slice(0, 3));
            })
            .catch(function(err) {
                console.error('[Diagnosis] Similar bug search failed:', err.message);
                resolve([]);
            });
    });
}

/**
 * Extract explicit bug key references from text
 * Matches patterns like BRHW110-1677, MPW2-181, GPU1-42, etc.
 */
function extractBugKeyReferences(text) {
    if (!text) return [];
    // Match common JIRA key patterns: PROJECT-123
    var regex = /\b([A-Z][A-Z0-9]{1,6}-\d{1,6})\b/g;
    var matches = [];
    var match;
    while ((match = regex.exec(text)) !== null) {
        if (matches.indexOf(match[1]) === -1) {
            matches.push(match[1]);
        }
    }
    return matches;
}

/**
 * Build multiple targeted AND queries for better coverage
 * Each query combines one hardware keyword with one issue pattern keyword
 * Now includes explicit comment search queries since text~ in JIRA Server
 * may not reliably search comments.
 */
function buildTargetedQueries(keywordGroups, excludeProject) {
    var queries = [];
    var primary = keywordGroups.primary || [];
    var secondary = keywordGroups.secondary || [];

    if (primary.length === 0) return queries;

    // Helper to escape JQL string
    function jqlStr(kw) { return kw.replace(/"/g, '\\"'); }

    // Query 1: ALL primary AND ANY secondary, no sort (JIRA relevance)
    if (secondary.length > 0) {
        var parts1 = primary.map(function(kw) { return 'text ~ "' + jqlStr(kw) + '"'; });
        var secParts = secondary.slice(0, 6).map(function(kw) {
            return 'text ~ "' + jqlStr(kw) + '"';
        });
        parts1.push('(' + secParts.join(' OR ') + ')');
        var jql1 = parts1.join(' AND ') + ' AND statusCategory = Done';
        queries.push({ jql: jql1, maxResults: 30, bonus: 0 });

        // Query 1b: Same query but ORDER BY created (to catch old bugs)
        var jql1b = jql1 + ' ORDER BY created DESC';
        queries.push({ jql: jql1b, maxResults: 20, bonus: 0 });
    }

    // Query 2: Just primary keywords (WIDE NET - catch bugs with minimal descriptions like empty desc)
    var primaryJql = primary.map(function(kw) { return 'text ~ "' + jqlStr(kw) + '"'; }).join(' AND ');
    var jql2 = primaryJql + ' AND statusCategory = Done ORDER BY created DESC';
    queries.push({ jql: jql2, maxResults: 40, bonus: 0 });

    // Query 3: OR query for each primary keyword (widest possible net)
    var orJql = primary.map(function(kw) { return 'text ~ "' + jqlStr(kw) + '"'; }).join(' OR ');
    var jql3 = '(' + orJql + ') AND statusCategory = Done ORDER BY created DESC';
    queries.push({ jql: jql3, maxResults: 50, bonus: 0 });

    // Query 4: Most specific pair - first primary + first secondary
    if (primary.length > 0 && secondary.length > 0) {
        var jql4 = 'text ~ "' + jqlStr(primary[0]) + '" AND text ~ "' + jqlStr(secondary[0]) + '" AND statusCategory = Done ORDER BY created DESC';
        queries.push({ jql: jql4, maxResults: 6, bonus: 0 });
    }

    // Query 5: Explicit comment search - keywords mentioned in comments
    // JIRA Server text~ is unreliable for comments, so search comment field directly
    var commentOrJql = primary.map(function(kw) { return 'comment ~ "' + jqlStr(kw) + '"'; }).join(' OR ');
    var jql5 = '(' + commentOrJql + ') AND statusCategory = Done ORDER BY created DESC';
    queries.push({ jql: jql5, maxResults: 50, bonus: 0 });

    // Query 6: Comment search with secondary keywords too
    if (secondary.length > 0) {
        var secCommentJql = secondary.slice(0, 4).map(function(kw) { return 'comment ~ "' + jqlStr(kw) + '"'; }).join(' OR ');
        var jql6 = '(' + commentOrJql + ') AND (' + secCommentJql + ') AND statusCategory = Done ORDER BY created DESC';
        queries.push({ jql: jql6, maxResults: 40, bonus: 0 });
    }

    // Max 8 queries (was 5, expanded for better comment coverage)
    return queries.slice(0, 8);
}

/**
 * Score a bug's relevance based on keyword overlap AND semantic similarity to source bug
 */
function scoreBugRelevance(bug, keywordGroups, sourceText) {
    var score = 0;
    var allKeywords = (keywordGroups.primary || []).concat(keywordGroups.secondary || []);
    var primaryKws = keywordGroups.primary || [];
    var secondaryKws = keywordGroups.secondary || [];

    // Helper: count keyword matches in text with weight
    function countMatches(text, weight) {
        if (!text) return 0;
        var lower = text.toLowerCase();
        var matches = 0;
        allKeywords.forEach(function(kw) {
            if (lower.indexOf(kw.toLowerCase()) !== -1) matches++;
        });
        return matches * weight;
    }

    function countPrimaryMatches(text, weight) {
        if (!text) return 0;
        var lower = text.toLowerCase();
        var matches = 0;
        primaryKws.forEach(function(kw) {
            if (lower.indexOf(kw.toLowerCase()) !== -1) matches++;
        });
        return matches * weight;
    }

    // --- Keyword overlap scoring ---
    score += countMatches(bug.summary, 10);
    score += countPrimaryMatches(bug.summary, 15);

    if (secondaryKws.indexOf('time') !== -1) {
        var lowerSummary = (bug.summary || '').toLowerCase();
        if (lowerSummary.indexOf('time') !== -1 && lowerSummary.indexOf('timeout') === -1) {
            score += 15;
        }
    }

    score += countMatches(bug.description, 5);
    score += countPrimaryMatches(bug.description, 8);

    var allCommentsText = (bug.comments || []).map(function(c) { return c.body || ''; }).join(' ');
    score += countMatches(allCommentsText, 2);

    var recentComments = (bug.comments || []).slice(-5).map(function(c) { return c.body || ''; }).join(' ');
    score += countMatches(recentComments, 3);

    if (primaryKws.length > 0) {
        var bugText = ((bug.summary || '') + ' ' + (bug.description || '') + ' ' + allCommentsText).toLowerCase();
        var domainMatches = 0;
        primaryKws.forEach(function(kw) {
            if (bugText.indexOf(kw.toLowerCase()) !== -1) domainMatches++;
        });
        if (domainMatches >= primaryKws.length * 0.5) {
            score += 10;
        }
    }

    // --- Semantic similarity scoring (compare to source bug) ---
    if (sourceText && sourceText.summary) {
        var candidateSummary = (bug.summary || '').toLowerCase();
        var candidateDesc = (bug.description || '').toLowerCase();
        var candidateFull = (candidateSummary + ' ' + candidateDesc + ' ' + allCommentsText).toLowerCase();

        // 1) Problem pattern overlap - check for shared error/symptom phrases
        var problemPatterns = [
            'init.*time', 'init.*long', 'init.*slow', 'init.*fail', 'init.*timeout',
            'link.*time', 'link.*long', 'training.*time', 'training.*long',
            'pci.*time', 'pci.*long', 'pci.*init.*time',
            'poll.*time', 'poll.*long', 'polling.*time',
            'too long', 'too slow', 'take.*long', 'time.*long',
            'not.*ready', 'not.*complete', 'wait.*time',
            'cycle.*time', 'duration.*long'
        ];
        var sharedPatterns = 0;
        problemPatterns.forEach(function(pattern) {
            var re = new RegExp(pattern, 'i');
            if (re.test(sourceText.summary) && re.test(candidateFull)) {
                sharedPatterns++;
            }
        });
        score += sharedPatterns * 12; // Each shared pattern = significant boost

        // 2) N-gram overlap on summary (2-grams and 3-grams)
        var sourceSummary = sourceText.summary.toLowerCase();
        var summaryOverlap = ngramOverlap(sourceSummary, candidateSummary);
        score += Math.floor(summaryOverlap * 30); // Up to 30 points for high summary overlap

        // 3) Description word-level Jaccard similarity
        var descOverlap = wordJaccard(sourceText.fullText, candidateFull);
        score += Math.floor(descOverlap * 25); // Up to 25 points for description similarity

        // 4) Specific error term co-occurrence boost
        var errorSignatures = ['link down', 'link training', 'gen1', 'gen2', 'gen3', 'gen4',
            'lane 0', 'lane 1', 'phy', 'serdes', 'retimer', 're-driver',
            'l0s', 'l1', 'ltssm', 'detect', 'config', 'configuration',
            'rc', 'endpoint', 'root complex', 'enumeration'];
        var sigMatches = 0;
        errorSignatures.forEach(function(sig) {
            if (sourceText.fullText.indexOf(sig) !== -1 && candidateFull.indexOf(sig) !== -1) {
                sigMatches++;
            }
        });
        if (sigMatches > 0) {
            score += Math.min(sigMatches * 5, 20); // Cap at 20
        }

        // 5) Same project family boost (BRHW projects share more IP)
        if (bug.bugId && sourceText.projectKey) {
            var bugProject = bug.bugId.split('-')[0] || '';
            var srcProject = sourceText.projectKey;
            // BRHW and MPW2 both relate to same chip family
            if (bugProject && srcProject) {
                var familyMap = {
                    'BRHW110': 'br', 'BR110': 'br', 'BRHW200': 'br', 'BR200': 'br',
                    'MPW2': 'br', 'MPW': 'br', 'ES': 'br', 'BR': 'br'
                };
                if (familyMap[bugProject] && familyMap[srcProject] && familyMap[bugProject] === familyMap[srcProject]) {
                    score += 8; // Same chip family
                }
            }
        }
    }

    return score;
}

/**
 * Compute bigram/trigram overlap ratio between two texts
 */
function ngramOverlap(textA, textB) {
    var wordsA = textA.split(/\s+/).filter(function(w) { return w.length > 2; });
    var wordsB = textB.split(/\s+/).filter(function(w) { return w.length > 2; });
    if (wordsA.length < 2 || wordsB.length < 2) return 0;

    var ngramsA = {};
    var ngramsB = {};

    for (var n = 2; n <= 3; n++) {
        for (var i = 0; i <= wordsA.length - n; i++) {
            var gram = wordsA.slice(i, i + n).join(' ');
            ngramsA[gram] = (ngramsA[gram] || 0) + 1;
        }
        for (var i = 0; i <= wordsB.length - n; i++) {
            var gram = wordsB.slice(i, i + n).join(' ');
            ngramsB[gram] = (ngramsB[gram] || 0) + 1;
        }
    }

    var shared = 0;
    var total = 0;
    for (var key in ngramsA) {
        total++;
        if (ngramsB[key]) shared++;
    }
    for (var key in ngramsB) {
        total++;
        if (!ngramsA[key]) total++;
    }

    return total > 0 ? shared / total : 0;
}

/**
 * Compute word-level Jaccard similarity between two texts
 */
function wordJaccard(textA, textB) {
    var stopWords = {'the': 1, 'a': 1, 'an': 1, 'is': 1, 'are': 1, 'was': 1, 'were': 1,
        'be': 1, 'been': 1, 'being': 1, 'have': 1, 'has': 1, 'had': 1, 'do': 1,
        'does': 1, 'did': 1, 'will': 1, 'would': 1, 'could': 1, 'should': 1,
        'may': 1, 'might': 1, 'must': 1, 'shall': 1, 'can': 1, 'need': 1,
        'to': 1, 'of': 1, 'in': 1, 'for': 1, 'on': 1, 'with': 1, 'at': 1,
        'by': 1, 'from': 1, 'as': 1, 'into': 1, 'through': 1, 'during': 1,
        'before': 1, 'after': 1, 'above': 1, 'below': 1, 'between': 1, 'out': 1,
        'off': 1, 'over': 1, 'under': 1, 'again': 1, 'further': 1, 'then': 1,
        'once': 1, 'here': 1, 'there': 1, 'when': 1, 'where': 1, 'why': 1,
        'how': 1, 'all': 1, 'both': 1, 'each': 1, 'few': 1, 'more': 1,
        'most': 1, 'other': 1, 'some': 1, 'such': 1, 'no': 1, 'nor': 1,
        'not': 1, 'only': 1, 'own': 1, 'same': 1, 'so': 1, 'than': 1,
        'too': 1, 'very': 1, 'just': 1, 'because': 1, 'but': 1, 'and': 1, 'or': 1};

    var setA = {};
    var setB = {};

    textA.split(/\s+/).forEach(function(w) {
        w = w.replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (w.length > 2 && !stopWords[w]) setA[w] = true;
    });
    textB.split(/\s+/).forEach(function(w) {
        w = w.replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (w.length > 2 && !stopWords[w]) setB[w] = true;
    });

    var keysA = Object.keys(setA);
    var keysB = Object.keys(setB);
    if (keysA.length === 0 && keysB.length === 0) return 0;

    var intersection = 0;
    keysA.forEach(function(k) { if (setB[k]) intersection++; });

    var union = {};
    keysA.forEach(function(k) { union[k] = true; });
    keysB.forEach(function(k) { union[k] = true; });

    return intersection / Object.keys(union).length;
}

/**
 * Fetch bugs with full details including comments, resolution, and description
 */
function fetchJiraBugsWithDetails(authHeader, jql, maxResults) {
    return new Promise(function(resolve, reject) {
        var jiraUrl = jiraConfig.baseUrl;
        var parsedUrl = url.parse(jiraUrl);

        var extraFields = 'summary,status,assignee,priority,created,updated,labels,components,' +
            'description,resolution,comment,reporter,duedate';

        var apiPath = '/rest/api/2/search';
        var queryParams = 'jql=' + encodeURIComponent(jql) +
            '&fields=' + encodeURIComponent(extraFields) +
            '&maxResults=' + maxResults;

        var client = parsedUrl.protocol === 'https:' ? https : http;
        var options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: apiPath + '?' + queryParams,
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            rejectUnauthorized: false
        };

        var req = client.request(options, function(resp) {
            var data = '';
            resp.on('data', function(chunk) { data += chunk; });
            resp.on('end', function() {
                try {
                    var jiraData = JSON.parse(data);
                    if (!jiraData || !jiraData.issues) {
                        resolve([]);
                        return;
                    }
                    console.log("[FetchDetails] Requested:", maxResults, "Received:", jiraData.issues.length, "Total:", jiraData.total);

                    var bugs = jiraData.issues.map(function(issue) {
                        var f = issue.fields || {};
                        var status = f.status || {};
                        var priority = f.priority || {};
                        var resolution = f.resolution || {};
                        var created = f.created || new Date().toISOString();
                        var updated = f.updated || created;

                        var projectKey = '';
                        if (issue.key && issue.key.indexOf('-') !== -1) {
                            projectKey = issue.key.split('-')[0];
                        }

                        // Extract comments
                        var commentData = f.comment || {};
                        var comments = (commentData.comments || []).map(function(c) {
                            return {
                                author: (c.author || {}).displayName || (c.author || {}).name || '',
                                body: c.body || '',
                                created: c.created || ''
                            };
                        });

                        // Try to find the resolution/root cause comment (usually last few comments)
                        var rootCauseComment = '';
                        if (comments.length > 0) {
                            // Take last 3 comments as likely resolution info
                            var recent = comments.slice(-3);
                            rootCauseComment = recent.map(function(c) {
                                return '[' + c.author + ']: ' + (c.body.length > 200 ? c.body.substring(0, 200) + '...' : c.body);
                            }).join('\n');
                        }

                        return {
                            bugId: issue.key || '',
                            jiraKey: issue.key || '',
                            projectKey: projectKey,
                            description: f.description || '',
                            summary: f.summary || '',
                            status: mapStatus(status),
                            jiraStatus: status.name || '',
                            resolution: resolution.name || '',
                            jiraUrl: jiraUrl + '/browse/' + issue.key,
                            comments: comments,
                            rootCauseComment: rootCauseComment,
                            created: created,
                            updated: updated
                        };
                    });

                    resolve(bugs);
                } catch (e) {
                    reject(new Error('Failed to parse JIRA response: ' + e.message));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, function() { req.destroy(); reject(new Error('Timeout')); });
        req.end();
    });
}

/**
 * Extract meaningful keywords from text for JIRA search
 * Returns { primary: [main hardware terms], secondary: [error/pattern terms] }
 */
function extractKeywords(text) {
    if (!text) return { primary: [], secondary: [] };

    // Primary: hardware/software components and protocols
    var hardwareTerms = ['pcie', 'i2c', 'i2s', 'spi', 'i3c', 'uart', 'jtag',
        'gpio', 'clock', 'pll', 'refclk', 'retimer', 're-driver', 'power', 'vdd',
        'voltage', 'thermal', 'temperature', 'fan', 'bsm', 'bmc', 'ipmi',
        'dram', 'ddr', 'memory', 'hbm', 'sram', 'flash', 'eeprom',
        'pcbi', 'pcba', 'oam', 'mezzanine', 'connector', 'slot',
        'iomm', 'dma', 'interrupt', 'irq', 'msi', 'msix',
        'bios', 'uefi', 'firmware', 'fw', 'bootloader', 'pxe',
        'gpu', 'soc', 'asic', 'phy', 'serdes', 'lane', 'ltssm',
        'ethernet', 'mac', 'rgmii', 'sgmii', 'sfp', 'qsfp',
        'reset', 'perst', 'wake', 'suspend', 'resume'];

    // Secondary: issue patterns and error behaviors
    var errorTerms = ['fail', 'error', 'timeout', 'hang', 'crash', 'reset',
        'down', 'off', 'lost', 'stuck', 'stall', 'exception',
        'panic', 'assert', 'warn', 'fault', 'broken',
        'slow', 'delay', 'time', 'long', 'cycle', 'poll', 'polling',
        'training', 'init', 'initialization', 'link up', 'linkup',
        'not detect', 'not ready', 'no response'];

    var primary = [];
    var secondary = [];
    var lowerText = text.toLowerCase();

    hardwareTerms.forEach(function(term) {
        if (lowerText.indexOf(term) !== -1) primary.push(term);
    });

    errorTerms.forEach(function(term) {
        if (lowerText.indexOf(term) !== -1) secondary.push(term);
    });

    // Map common Chinese terms to English search keywords for JIRA
    var chineseMap = {
        '初始化': 'init',
        '轮询': 'polling',
        '周期': 'cycle',
        '时间': 'time',
        '耗时': 'time',
        '太久': 'long',
        '太长': 'long',
        '过长': 'long',
        '太慢': 'slow',
        '卡': 'stuck',
        '挂起': 'hang',
        '死机': 'hang',
        '失败': 'fail',
        '错误': 'error',
        '超时': 'timeout',
        '断开': 'lost',
        '连接': 'link',
        '建立': 'training', // link training
        '训练': 'training',
        '链路': 'link'
    };
    
    Object.keys(chineseMap).forEach(function(cn) {
        if (text.indexOf(cn) !== -1) {
            var en = chineseMap[cn];
            if (secondary.indexOf(en) === -1) secondary.push(en);
        }
    });

    // Deduplicate
    var seen = {};
    primary = primary.filter(function(k) { if (seen[k]) return false; seen[k] = true; return true; });
    seen = {};
    secondary = secondary.filter(function(k) { if (seen[k]) return false; seen[k] = true; return true; });

    // Limit: max 3 primary + 5 secondary
    return { primary: primary.slice(0, 3), secondary: secondary.slice(0, 6) };
}

module.exports = router;

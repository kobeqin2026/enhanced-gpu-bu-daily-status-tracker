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
            '&fields=' + encodeURIComponent(jiraConfig.fields + ',reporter,updated,duedate,components,customfield_10023') +
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
                            description: f.summary || '',
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

module.exports = router;

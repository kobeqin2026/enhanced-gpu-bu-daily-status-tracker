// JIRA import route - fetches bugs from JIRA REST API

var express = require('express');
var router = express.Router();
var https = require('https');
var http = require('http');
var url = require('url');
var auth = require('../middleware/auth');
var jiraConfig = require('../lib/jiraConfig');
var diagnosis = require('../lib/diagnosis');
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');

// ---- JQL injection prevention ----
var JIRA_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9\-]*$/;
function sanitizeJiraKey(val) {
    if (typeof val !== 'string' || !JIRA_KEY_RE.test(val)) {
        throw new Error('Invalid JIRA key: ' + val);
    }
    return val;
}
function escapeJqlString(val) {
    return String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Image analysis cache path — populated by the AI agent via vision_analyze
var visionAnalysis = require('../lib/vision-analysis');
var IMAGE_CACHE_DIR = path.join(os.homedir(), '.hermes', 'gpu-tracker', 'image-cache');
var IMAGE_CACHE_FILE = path.join(IMAGE_CACHE_DIR, 'analysis-cache.json');

function loadImageCache() {
    try {
        if (fs.existsSync(IMAGE_CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(IMAGE_CACHE_FILE, 'utf8'));
        }
    } catch(e) {
        console.error('[VisionCache] Failed to load cache:', e.message);
    }
    return {};
}

function urlHash(url) {
    return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

/**
 * Parse legacy analysis string into structured format.
 * Detects image type from content keywords and extracts technical terms.
 */
function parseAnalysisString(text, timestamp) {
    var lowerText = (text || '').toLowerCase();
    var type = 'other';
    var keywords = [];
    var keyData = [];

    // Detect image type from content
    if (/ltssm|link training|gen[1-5]|lane.*down|recovery|detect/i.test(lowerText)) {
        type = 'ltssm_log';
    } else if (/oscilloscope|示波器|波形|waveform/i.test(lowerText)) {
        type = 'oscilloscope';
    } else if (/register|寄存器|dump|hex.*value|0x[0-9a-f]/i.test(lowerText)) {
        type = 'register_dump';
    } else if (/terminal|log|console|command/i.test(lowerText) && !/ltssm|oscilloscope/i.test(lowerText)) {
        type = 'terminal_log';
    } else if (/diagram|architect|flow|schematic|block/i.test(lowerText)) {
        type = 'diagram';
    }

    // Extract technical keywords
    var techTerms = ['pcie', 'jtag', 'i2c', 'uart', 'gpio', 'clock', 'voltage', 'power', 'thermal', 'phy', 'serdes',
        'ltssm', 'link', 'training', 'reset', 'firmware', 'bios', 'boot', 'hang', 'fail', 'timeout',
        'dram', 'memory', 'flash', 'interrupt', 'irq', 'dma'];
    techTerms.forEach(function(term) {
        if (lowerText.indexOf(term) !== -1) keywords.push(term);
    });

    // Try to extract key data (hex values, timing, error codes)
    var hexMatches = text.match(/0x[0-9a-fA-F]{4,8}/g);
    if (hexMatches) keyData = keyData.concat(hexMatches.slice(0, 5));
    var msMatches = text.match(/(\d+)\s*ms/g);
    if (msMatches) keyData = keyData.concat(msMatches.slice(0, 3));

    return {
        summary: text.substring(0, 200),
        type: type,
        key_data: keyData,
        technical_details: text.substring(0, 500),
        keywords: keywords,
        timestamp: timestamp || Date.now()
    };
}

function getCachedImageAnalysis(imageUrl) {
    var cache = loadImageCache();
    var h = urlHash(imageUrl);
    var entry = cache[h];
    if (entry && entry.analysis) {
        console.log('[VisionCache] HIT for', imageUrl.substring(imageUrl.lastIndexOf('/') + 1), '(' + h + ')');
        // Upgrade legacy string format to structured format
        if (typeof entry.analysis === 'string') {
            return parseAnalysisString(entry.analysis, entry.timestamp);
        }
        return entry.analysis;
    }
    console.log('[VisionCache] MISS for', imageUrl.substring(imageUrl.lastIndexOf('/') + 1), '(' + h + ')');
    return '';
}

var SUPPORTED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

function visionAnalysis_extractImageUrls(bug, jiraBaseUrl, maxImages) {
    maxImages = maxImages || 5;
    var urls = [];
    var seen = {};

    // 1) From attachment field
    if (bug.attachments && Array.isArray(bug.attachments)) {
        for (var i = 0; i < bug.attachments.length && urls.length < maxImages; i++) {
            var att = bug.attachments[i];
            if (att.mimeType && SUPPORTED_IMAGE_MIMES.indexOf(att.mimeType) !== -1) {
                if (!seen[att.content]) {
                    seen[att.content] = true;
                    urls.push(att.content);
                }
            }
        }
    }

    // 2) Fallback: parse !image-xxx.png! from comment bodies
    if (bug.comments && Array.isArray(bug.comments)) {
        var filenameToUrl = {};
        if (bug.attachments && Array.isArray(bug.attachments)) {
            bug.attachments.forEach(function(att) {
                if (att.filename && att.content) {
                    filenameToUrl[att.filename] = att.content;
                }
            });
        }

        for (var i = 0; i < bug.comments.length && urls.length < maxImages; i++) {
            var comment = bug.comments[i];
            var body = comment.body || '';
            var regex = /!(image-[^\s|!]+(?:\.png|\.jpg|\.jpeg|\.gif|\.webp))/gi;
            var match;
            while ((match = regex.exec(body)) !== null && urls.length < maxImages) {
                var filename = match[1];
                var attUrl = filenameToUrl[filename];
                if (attUrl && !seen[attUrl]) {
                    seen[attUrl] = true;
                    urls.push(attUrl);
                }
            }
        }
    }

    return urls.slice(0, maxImages);
}

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
var selectedProject;
        if (req.body && req.body.project) {
            var project = sanitizeJiraKey(req.body.project);
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
        var jql = 'issueKey in (' + jiraKeys.map(sanitizeJiraKey).join(',') + ')';
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
            var safeProjects = projects.map(sanitizeJiraKey);
            var projectClause = safeProjects.length === 1
                ? 'project = ' + safeProjects[0]
                : 'project in (' + safeProjects.join(',') + ')';
            jql = projectClause + ' AND issuetype = Bug';
            if (!includeClosed) {
                jql += ' AND status not in (Done, Closed, Rejected)';
            }
            jql += ' ORDER BY created DESC';
        } else if (project) {
            var safeProject = sanitizeJiraKey(project);
            jql = 'project = ' + safeProject + ' AND issuetype = Bug';
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
            if (resp.statusCode < 200 || resp.statusCode >= 300) {
                var errData = '';
                resp.on('data', function(c) { errData += c; });
                resp.on('end', function() {
                    console.error('[FetchBugs] HTTP', resp.statusCode, 'for JQL:', jql.substring(0, 150));
                    resolve([]);
                });
                return;
            }
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
                        var components = f.components || [];
                        var componentNames = components.map(function(c) { return c.name || ''; }).filter(function(n) { return n; });

                        // Extract root cause from customfield_10023
                        var rootCause = '';
                        var rcField = f.customfield_10023;
                        if (rcField) {
                            // Could be a string, or a select object with {value, name}
                            if (typeof rcField === 'string') {
                                rootCause = rcField;
                            } else if (rcField.value) {
                                rootCause = rcField.value;
                            } else if (rcField.name) {
                                rootCause = rcField.name;
                            }
                        }

                        // Domain priority: first label -> first component -> TBD
                        var domain = 'TBD';
                        if (labels.length > 0) {
                            domain = labels[0];
                        } else if (componentNames.length > 0) {
                            domain = componentNames[0];
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
                            components: componentNames,
                            rootCause: rootCause,
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
        req.setTimeout(30000, function() {
            console.error('[FetchBugs] Timeout (30s) for JQL:', jql.substring(0, 150));
            req.destroy();
            resolve([]);
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
    // Component distribution
    var componentCount = {};
    // Root cause distribution
    var rootCauseCount = {};
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

        // Components (a bug can have multiple)
        if (bug.components && bug.components.length > 0) {
            bug.components.forEach(function(comp) {
                componentCount[comp] = (componentCount[comp] || 0) + 1;
            });
        } else {
            componentCount['未设置'] = (componentCount['未设置'] || 0) + 1;
        }

        // Root cause
        var rc = bug.rootCause || '未设置';
        rootCauseCount[rc] = (rootCauseCount[rc] || 0) + 1;

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

    // Sort component by count descending
    var componentArray = Object.keys(componentCount).sort(function(a, b) { return componentCount[b] - componentCount[a]; }).map(function(c) {
        return { component: c, count: componentCount[c] };
    });

    // Sort root cause by count descending
    var rootCauseArray = Object.keys(rootCauseCount).sort(function(a, b) { return rootCauseCount[b] - rootCauseCount[a]; }).map(function(r) {
        return { rootCause: r, count: rootCauseCount[r] };
    });

    return {
        statusCount: statusCount,
        severityCount: severityCount,
        ownerCount: ownerArray,
        domainCount: domainArray,
        componentCount: componentArray,
        rootCauseCount: rootCauseArray,
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

        // Early cache check — skip ALL expensive operations if result is cached
        if (!bugInfo.force) {
            var earlyCached = diagnosis.getCachedResult(bugInfo.key);
            if (earlyCached) {
                return res.json({ success: true, data: earlyCached, bug_status: bugInfo.status || '' });
            }
        } else {
            console.log('[Diagnosis] Force refresh for', bugInfo.key, '— bypassing cache');
        }

        // Build cross-project search function
        var authHeader = getAuthHeader();
        if (!authHeader) {
            return res.status(500).json({
                success: false,
                error: 'JIRA认证未配置。请在环境变量中设置 JIRA_PAT 或 JIRA_EMAIL + JIRA_API_TOKEN'
            });
        }

        // Auto-fetch comments and attachments for the source bug if not already provided
        if (!bugInfo.comments || !Array.isArray(bugInfo.comments) || bugInfo.comments.length === 0) {
            try {
                var safeKey = escapeJqlString(sanitizeJiraKey(bugInfo.key));
                var details = await fetchJiraBugsWithDetails(authHeader, 'key = "' + safeKey + '"', 1);
                if (details && details.length > 0) {
                    bugInfo.comments = details[0].comments || [];
                    bugInfo.description = details[0].description || bugInfo.description || '';
                    bugInfo.attachments = details[0].attachments || [];
                    // Also capture status, summary, components, labels for full diagnosis
                    bugInfo.status = details[0].status || bugInfo.status || '';
                    bugInfo.summary = details[0].summary || bugInfo.summary || details[0].description || '';
                    bugInfo.components = details[0].components || bugInfo.components || [];
                    bugInfo.labels = details[0].labels || bugInfo.labels || [];
                    bugInfo.rootCause = details[0].rootCauseComment || bugInfo.rootCause || '';
                    console.log('[Diagnosis] Auto-fetched', bugInfo.comments.length, 'comments,', bugInfo.attachments.length, 'attachments, status=' + bugInfo.status, 'for', bugInfo.key);
                }
            } catch (e) {
                console.log('[Diagnosis] Failed to auto-fetch:', e.message);
            }
        }

        // Load cached image analysis for the source bug's attachments
        var sourceImageUrls = visionAnalysis_extractImageUrls(bugInfo, jiraConfig.baseUrl, Number.MAX_SAFE_INTEGER);
        bugInfo.imageSummaries = [];
        bugInfo.unanalyzedImages = [];
        sourceImageUrls.forEach(function(imageUrl) {
            var analysis = getCachedImageAnalysis(imageUrl);
            if (analysis) {
                bugInfo.imageSummaries.push(analysis);
            } else {
                bugInfo.unanalyzedImages.push({
                    url: imageUrl,
                    filename: imageUrl.substring(imageUrl.lastIndexOf('/') + 1)
                });
            }
        });
        if (bugInfo.imageSummaries.length > 0) {
            var imageText = bugInfo.imageSummaries.map(function(s, i) {
                return '[截图' + (i + 1) + ']: ' + (typeof s === 'string' ? s : (s.summary || ''));
            }).join('\n');
            // Inject image analysis into description so LLM sees it
            bugInfo.description = (bugInfo.description || '') + '\n\n**截图分析（AI提取）**:\n' + imageText;
            console.log('[VisionCache] Source bug', bugInfo.key + ':', bugInfo.imageSummaries.length, 'images analyzed,', bugInfo.unanalyzedImages.length, 'pending');
        }

        // Phase 1: Real-time analysis of source bug's uncached images (parallel)
        if (bugInfo.unanalyzedImages.length > 0) {
            console.log('[VisionRealtime] Phase 1 - Analyzing', bugInfo.unanalyzedImages.length, 'uncached source images for', bugInfo.key);
            var authHdr = getAuthHeader();
            var imagePromises = bugInfo.unanalyzedImages.map(function(img, ri) {
                return visionAnalysis.analyzeImage(img.url, authHdr).then(function(summary) {
                    if (summary) {
                        console.log('[VisionRealtime] Source', bugInfo.key, 'image', ri + 1, 'analyzed:', summary.substring(0, 100));
                    }
                    return summary;
                }).catch(function(e) {
                    console.error('[VisionRealtime] Failed to analyze image', img.filename, ':', e.message);
                    return null;
                });
            });
            var realtimeResults = (await Promise.all(imagePromises)).filter(function(s) { return s; });
            bugInfo.imageSummaries = bugInfo.imageSummaries.concat(realtimeResults);
            // Update description with newly analyzed images
            if (realtimeResults.length > 0) {
                var newText = realtimeResults.map(function(s, i) {
                    return '[实时分析截图' + (i + 1) + ']: ' + s;
                }).join('\n');
                bugInfo.description = (bugInfo.description || '') + '\n\n**截图实时分析（本次诊断时调用VLM）**:\n' + newText;
                console.log('[VisionRealtime] Source bug', bugInfo.key + ':', realtimeResults.length, 'images analyzed in real-time');
            }
            // Clear unanalyzed list since they are now analyzed (or attempted)
            bugInfo.unanalyzedImages = [];
            console.log('[VisionRealtime] Source bug', bugInfo.key + ':', bugInfo.imageSummaries.length, 'analyzed,', bugInfo.unanalyzedImages.length, 'still pending');
        }

        var jiraCtx = {
            searchSimilarBugsFn: function(bug) {
                // After Phase 1, bugInfo.imageSummaries contains structured image data
                // Extract keywords from images to enhance search
                return searchSimilarBugs(authHeader, bug, bugInfo.imageSummaries);
            }
        };

        var result = await diagnosis.analyzeBug(bugInfo, jiraCtx);

        // Attach source bug image analysis results to the response for frontend display
        // Fixes the issue where frontend shows "待分析" even after backend analyzed them
        result.source_image_summaries = bugInfo.imageSummaries || [];
        result.source_unanalyzed_images = bugInfo.unanalyzedImages || [];
        // Attach bug status so frontend can show correct sections (结论 vs 建议操作)
        result.bug_status = bugInfo.status || '';

        console.log('[Diagnosis] Returning to frontend: status=' + result.bug_status + ', source_image_summaries=' + result.source_image_summaries.length + ', source_unanalyzed_images=' + result.source_unanalyzed_images.length);

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Diagnosis] Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Search for similar CLOSED bugs across projects to learn from their solutions
 * @param {string} authHeader - JIRA auth header
 * @param {Object} bugInfo - source bug info
 * @param {Array} sourceImageSummaries - optional: structured image analysis from Phase 1
 */
function searchSimilarBugs(authHeader, bugInfo, sourceImageSummaries) {
    return new Promise(function(resolve, reject) {
        // Include comments in text for reference extraction and keyword matching
        // This catches bug keys (e.g., BRHW110-1677) mentioned in comments like "same as BRHW110-1677"
        var commentsText = '';
        if (bugInfo.comments && Array.isArray(bugInfo.comments) && bugInfo.comments.length > 0) {
            commentsText = ' ' + bugInfo.comments.map(function(c) { return (c.body || '') + ' ' + (c.author || ''); }).join(' ');
        }
        var text = (bugInfo.summary || '') + ' ' + (bugInfo.description || '') + commentsText;
        var keywordGroups = extractKeywords(text, bugInfo.components, bugInfo.labels);

        // Break 2 Fix: Extract keywords from Phase 1 image analysis and add to search keywords
        var imageKeywords = [];
        if (sourceImageSummaries && sourceImageSummaries.length > 0) {
            sourceImageSummaries.forEach(function(s) {
                // Handle both structured objects and legacy string data
                if (typeof s === 'object') {
                    if (Array.isArray(s.keywords)) {
                        s.keywords.forEach(function(kw) {
                            var kwLower = kw.toLowerCase();
                            if (/^[a-z0-9\-\+\.]{3,}$/.test(kwLower) && imageKeywords.indexOf(kwLower) === -1) imageKeywords.push(kwLower);
                        });
                    }
                    // Also extract from summary and technical_details
                    ['summary', 'technical_details', 'key_data'].forEach(function(field) {
                        if (s[field]) {
                            var fieldText = Array.isArray(s[field]) ? s[field].join(' ') : s[field];
                            fieldText.toLowerCase().split(/[\s,，|]+/).forEach(function(w) {
                                // Only keep English technical terms
                                if (/^[a-z0-9\-\+\.]{3,}$/.test(w) && imageKeywords.indexOf(w) === -1) {
                                    imageKeywords.push(w);
                                }
                            });
                        }
                    });
                } else if (typeof s === 'string' && s.length > 10) {
                    // Legacy string data: extract ONLY English technical terms
                    s.toLowerCase().split(/[\s,，|]+/).forEach(function(w) {
                        if (/^[a-z0-9\-\+\.]{3,}$/.test(w) && imageKeywords.indexOf(w) === -1) {
                            imageKeywords.push(w);
                        }
                    });
                }
            });
            // Add image keywords to primary (they're technical terms from VLM)
            if (imageKeywords.length > 0) {
                console.log('[ImageKeywords] Extracted', imageKeywords.length, 'keywords from source images:', imageKeywords.slice(0, 8).join(', '));
                // Allow up to 8 primary keywords when image keywords are available
                var maxPrimary = 8;
                var maxSecondary = 12;
                var hardwareIndicators = ['pcie', 'i2c', 'spi', 'gpio', 'clock', 'pll', 'phy', 'serdes', 'ltssm', 'lane', 'link', 'gen', 'voltage', 'power', 'thermal', 'memory', 'dram', 'bios', 'firmware', 'register', 'oscilloscope'];
                imageKeywords.forEach(function(kw) {
                    var isHardware = hardwareIndicators.some(function(h) { return kw.indexOf(h) !== -1; });
                    if (isHardware && keywordGroups.primary.indexOf(kw) === -1 && keywordGroups.primary.length < maxPrimary) {
                        // Promote hardware image keywords to primary even if already in secondary
                        var secIdx = keywordGroups.secondary.indexOf(kw);
                        if (secIdx !== -1) keywordGroups.secondary.splice(secIdx, 1);
                        keywordGroups.primary.push(kw);
                    } else if (keywordGroups.primary.indexOf(kw) === -1 && keywordGroups.secondary.indexOf(kw) === -1 && keywordGroups.secondary.length < maxSecondary) {
                        keywordGroups.secondary.push(kw);
                    }
                });
            }
        }

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
                // Debug logging for zero results issue
                if (!Array.isArray(bugs)) bugs = [];
                var beforeFilter = bugs.length;
                if (bugInfo.projectKey) {
                    bugs = bugs.filter(function(b) {
                        return b.projectKey !== bugInfo.projectKey;
                    });
                }
                console.log('[Diagnosis] Fetched', beforeFilter, 'bugs, kept', bugs.length, 'for JQL:', q.jql.substring(0, 60));
                return bugs.map(function(b) {
                    // Take max bonus when a bug is hit by multiple queries (don't overwrite with lower bonus)
                    if (b.queryBonus === undefined || q.bonus > b.queryBonus) {
                        b.queryBonus = q.bonus;
                    }
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

                // Pass 1: Collect unique bugs, explicit references override keyword matches
                results.forEach(function(bugs) {
                    // Handle both arrays (from queries) and single objects (from referenced bugs)
                    if (!bugs) return;
                    if (!Array.isArray(bugs)) bugs = [bugs];

                    bugs.forEach(function(bug) {
                        if (!bug || !bug.bugId) return;
                        if (!seen[bug.bugId]) {
                            seen[bug.bugId] = bug;
                        } else if (bug.isExplicitReference && !seen[bug.bugId].isExplicitReference) {
                            seen[bug.bugId] = bug;  // explicit ref overrides keyword match
                        }
                    });
                });

                // Pass 2: Score each unique bug uniformly (all dimensions including Dim10 explicit reference)
                Object.keys(seen).forEach(function(key) {
                    var bug = seen[key];
                    var contentScore = scoreBugRelevance(bug, keywordGroups, sourceText, bugInfo.imageSummaries, {components: bugInfo.components, labels: bugInfo.labels}, true);
                    // Uniform scoring: contentScore includes all dimensions (Dim1-10), capped at 100
                    bug.relevanceScore = Math.min(contentScore + (bug.queryBonus || 0), 100);
                    scored.push(bug);
                });

                console.log('[Keywords] Primary:', JSON.stringify(keywordGroups.primary), '| Secondary:', JSON.stringify(keywordGroups.secondary));
                console.log('[SourceText] Summary:', (sourceText.summary || '').substring(0, 100));

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
                                var reContentScore = scoreBugRelevance(bug, keywordGroups, sourceText, bugInfo.imageSummaries, {components: bugInfo.components, labels: bugInfo.labels}, true);
                                bug.relevanceScore = Math.min(reContentScore + (bug.queryBonus || 0), 100);
                                console.log('[Diagnosis] Re-scored (detail)', bug.bugId, '->', bug.relevanceScore);
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

                // Attach JIRA base URL to each bug for image URL resolution
                topBugs.forEach(function(b) {
                    b.jiraBaseUrl = jiraConfig.baseUrl;
                });

                console.log('[Diagnosis] Detail fetch done for', topBugs.length, 'bugs, loading cached image analysis...');
                return topBugs;
            })
            .then(function(topBugs) {
                // Load cached image analysis for each bug's screenshots (unlimited)
                // Then do real-time analysis for high-score candidates
                var analysisTasks = topBugs.map(function(bug) {
                    var maxImagesPerBug = Number.MAX_SAFE_INTEGER;
                    var imageUrls = visionAnalysis_extractImageUrls(bug, bug.jiraBaseUrl || jiraConfig.baseUrl, maxImagesPerBug);
                    bug.imageSummaries = [];
                    bug.imageText = '';
                    bug.unanalyzedImages = [];

                    if (imageUrls.length === 0) {
                        return Promise.resolve(bug);
                    }

                    console.log('[VisionCache] Found', imageUrls.length, 'images for', bug.bugId);
                    imageUrls.forEach(function(imageUrl) {
                        var analysis = getCachedImageAnalysis(imageUrl);
                        if (analysis) {
                            bug.imageSummaries.push(analysis);
                        } else {
                            bug.unanalyzedImages.push({
                                url: imageUrl,
                                filename: imageUrl.substring(imageUrl.lastIndexOf('/') + 1)
                            });
                        }
                    });

                    if (bug.imageSummaries.length > 0) {
                        bug.imageText = bug.imageSummaries.map(function(s, i) {
                            return '[截图' + (i + 1) + ']: ' + (typeof s === 'string' ? s : (s.summary || ''));
                        }).join('\n');

                        // Re-score with image text included
                        var originalDesc = bug.description || '';
                        bug.description = originalDesc + ' ' + bug.imageText;
                        var reContentScore = scoreBugRelevance(bug, keywordGroups, sourceText, bugInfo.imageSummaries, {components: bugInfo.components, labels: bugInfo.labels}, true);
                        bug.relevanceScore = Math.min(reContentScore + (bug.queryBonus || 0), 100);
                        console.log('[Diagnosis] Re-scored (img cache)', bug.bugId, '->', bug.relevanceScore);
                        bug.description = originalDesc;
                    }

                    // Phase 2: Real-time analysis for Top candidates — always analyze images for re-scoring
                    if (bug.unanalyzedImages.length > 0) {
                        console.log('[VisionRealtime] Phase 2 - Top candidate', bug.bugId, '(score:', bug.relevanceScore + ') - analyzing', bug.unanalyzedImages.length, 'images in real-time');
                        var authHdr = getAuthHeader();
                        var analyzePromises = bug.unanalyzedImages.map(function(img, idx) {
                            return visionAnalysis.analyzeImage(img.url, authHdr)
                                .then(function(summary) {
                                    if (summary) {
                                        console.log('[VisionRealtime] Candidate', bug.bugId, 'image', idx + 1, ':', summary.substring(0, 100));
                                        return summary;
                                    }
                                    return '';
                                })
                                .catch(function(e) {
                                    console.error('[VisionRealtime] Failed to analyze image for', bug.bugId, img.filename, ':', e.message);
                                    return '';
                                });
                        });

                        return Promise.all(analyzePromises).then(function(summaries) {
                            var realtimeResults = summaries.filter(function(s) { return s; });
                            if (realtimeResults.length > 0) {
                                realtimeResults.forEach(function(s) { bug.imageSummaries.push(s); });
                                var imgText = realtimeResults.map(function(s, i) {
                                    return '[实时分析截图' + (i + 1) + ']: ' + s;
                                }).join('\n');

                                // Re-score with newly analyzed image text
                                var originalDesc = bug.description || '';
                                bug.description = originalDesc + ' ' + imgText;
                                var reContentScore = scoreBugRelevance(bug, keywordGroups, sourceText, bugInfo.imageSummaries, {components: bugInfo.components, labels: bugInfo.labels}, true);
                                var oldScore = bug.relevanceScore;
                                bug.relevanceScore = Math.min(reContentScore + (bug.queryBonus || 0), 100);
                                bug.description = originalDesc;
                                console.log('[VisionRealtime] Candidate', bug.bugId, 're-scored:', oldScore, '->', bug.relevanceScore, '(+ images)');
                            }
                            // Clear unanalyzed list for related bugs so frontend doesn't show "Pending" after analysis
                            bug.unanalyzedImages = [];
                            return bug;
                        });
                    }
                    return Promise.resolve(bug);
                });

                return Promise.all(analysisTasks).then(function(results) {
                    return results.filter(function(b) { return b != null; });
                });
            })
            .then(function(topBugs) {
                // Final sort after re-scoring (includes image-based re-score)
                topBugs.sort(function(a, b) { return b.relevanceScore - a.relevanceScore; });

                console.log('[Diagnosis] Final Result: Found', topBugs.length, 'bugs with details.');
                topBugs.forEach(function(b) {
                    console.log('  -', b.bugId, 'final score:', b.relevanceScore, b.isExplicitReference ? '(explicit ref)' : '', b.imageSummaries && b.imageSummaries.length > 0 ? '(' + b.imageSummaries.length + ' images)' : '');
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

    // Use only the top 2 primary keywords for strict matching to avoid over-filtering
    // This prevents the case where 3+ keywords (text + image) make the query too restrictive
    var mainPrimary = primary.slice(0, 2);

    // Query 1: ALL main primary AND ANY secondary (Strict match) — HIGH bonus
    // e.g. "jtag" AND ("fail" OR "hang")
    if (secondary.length > 0) {
        var parts1 = mainPrimary.map(function(kw) { return 'text ~ "' + jqlStr(kw) + '"'; });
        var secParts = secondary.slice(0, 6).map(function(kw) {
            return 'text ~ "' + jqlStr(kw) + '"';
        });
        parts1.push('(' + secParts.join(' OR ') + ')');
        var jql1 = parts1.join(' AND ') + ' AND statusCategory = Done';
        queries.push({ jql: jql1, maxResults: 30, bonus: 6 });

        // Query 1b: Same query but ORDER BY created (to catch old bugs)
        var jql1b = jql1 + ' ORDER BY created DESC';
        queries.push({ jql: jql1b, maxResults: 20, bonus: 6 });
    }

    // Query 2: Just main primary keywords (WIDE NET) — MEDIUM bonus
    // e.g. "jtag" AND "clock" (instead of jtag AND clock AND hbm)
    if (mainPrimary.length > 0) {
        var primaryJql = mainPrimary.map(function(kw) { return 'text ~ "' + jqlStr(kw) + '"'; }).join(' AND ');
        var jql2 = primaryJql + ' AND statusCategory = Done ORDER BY created DESC';
        queries.push({ jql: jql2, maxResults: 40, bonus: 5 });
    }

    // Query 3: OR query for all primary keywords (widest possible net) — LOW bonus
    // e.g. "jtag" OR "clock" OR "hbm"
    if (primary.length > 0) {
        var orJql = primary.map(function(kw) { return 'text ~ "' + jqlStr(kw) + '"'; }).join(' OR ');
        var jql3 = '(' + orJql + ') AND statusCategory = Done ORDER BY created DESC';
        queries.push({ jql: jql3, maxResults: 50, bonus: 2 });
    }

    // Query 4: Most specific pair - first primary + first secondary — MEDIUM-HIGH bonus
    if (mainPrimary.length > 0 && secondary.length > 0) {
        var jql4 = 'text ~ "' + jqlStr(mainPrimary[0]) + '" AND text ~ "' + jqlStr(secondary[0]) + '" AND statusCategory = Done ORDER BY created DESC';
        queries.push({ jql: jql4, maxResults: 20, bonus: 4 });
    }

    // Query 5: Explicit comment search - keywords mentioned in comments — MEDIUM bonus
    // JIRA Server text~ is unreliable for comments, so search comment field directly
    if (primary.length > 0) {
        var commentOrJql = primary.map(function(kw) { return 'comment ~ "' + jqlStr(kw) + '"'; }).join(' OR ');
        var jql5 = '(' + commentOrJql + ') AND statusCategory = Done ORDER BY created DESC';
        queries.push({ jql: jql5, maxResults: 50, bonus: 3 });
    }

    // Query 6: Comment search with secondary keywords too — MEDIUM-HIGH bonus
    if (primary.length > 0 && secondary.length > 0) {
        var commentOrJql = mainPrimary.map(function(kw) { return 'comment ~ "' + jqlStr(kw) + '"'; }).join(' OR ');
        var secCommentJql = secondary.slice(0, 4).map(function(kw) { return 'comment ~ "' + jqlStr(kw) + '"'; }).join(' OR ');
        var jql6 = '(' + commentOrJql + ') AND (' + secCommentJql + ') AND statusCategory = Done ORDER BY created DESC';
        queries.push({ jql: jql6, maxResults: 40, bonus: 4 });
    }

    // Max 8 queries (was 5, expanded for better comment coverage)
    return queries.slice(0, 8);
}

/**
 * Score a bug's relevance based on keyword overlap AND semantic similarity to source bug
 * Returns 0-100, normalized across all dimensions.
 * @param {Object} bug - candidate bug with imageSummaries (structured objects)
 * @param {Object} keywordGroups - {primary: [...], secondary: [...]}
 * @param {Object} sourceText - {summary, description, fullText}
 * @param {Object} sourceImages - optional: source bug's imageSummaries structured objects
 * @param {Object} sourceMetadata - optional: {components: [...], labels: [...]} from source bug
 */

/** Check if keyword appears with word boundaries in text (prevents "voltage" matching "voltageRegulator") */
function hasWordBoundary(text, kw) {
    if (!text || !kw) return false;
    // Short keywords (< 3 chars) use indexOf for performance
    if (kw.length < 3) return text.indexOf(kw) !== -1;
    // Use word boundary regex: match only at start/end or surrounded by non-word chars
    var escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(^|[^a-z0-9])' + escaped + '($|[^a-z0-9])', 'i');
    return re.test(text);
}

function scoreBugRelevance(bug, keywordGroups, sourceText, sourceImages, sourceMetadata, debug) {
    var score = 0;
    var allKeywords = (keywordGroups.primary || []).concat(keywordGroups.secondary || []);
    var primaryKws = keywordGroups.primary || [];
    var secondaryKws = keywordGroups.secondary || [];
    var bugKey = bug.bugId || bug.key || 'unknown';

    var allCommentsText = (bug.comments || []).map(function(c) { return c.body || ''; }).join(' ');
    var bugText = ((bug.summary || '') + ' ' + (bug.description || '') + ' ' + allCommentsText).toLowerCase();
    var summaryLower = (bug.summary || '').toLowerCase();
    var descLower = (bug.description || '').toLowerCase();

    // === PHASE A: Keyword matching (core signal) ===

    // --- Dim1: Title match (per-keyword) ---
    // Primary: +8/word, Secondary: +3/word. Hard cap at 32.
    var dim1_pri = 0;
    var dim1_sec = 0;
    primaryKws.forEach(function(kw) { if (hasWordBoundary(summaryLower, kw)) dim1_pri += 8; });
    secondaryKws.forEach(function(kw) { if (hasWordBoundary(summaryLower, kw)) dim1_sec += 3; });
    var dim1 = dim1_pri + dim1_sec;
    if (dim1 > 32) dim1 = 32;
    score += dim1;

    // --- Dim2: Description keyword match (per-keyword) ---
    // Primary: +4/word, Secondary: +3/word. Hard cap at 24.
    var dim2_pri = 0;
    var dim2_sec = 0;
    primaryKws.forEach(function(kw) { if (hasWordBoundary(descLower, kw)) dim2_pri += 4; });
    secondaryKws.forEach(function(kw) { if (hasWordBoundary(descLower, kw)) dim2_sec += 3; });
    var dim2 = dim2_pri + dim2_sec;
    if (dim2 > 24) dim2 = 24;
    score += dim2;

    // --- Dim3: Comment keyword match (per-keyword) ---
    // Primary: 2pts each. Secondary: 2pts each. Cap at 16
    var dim3 = 0;
    var commentsLower = allCommentsText.toLowerCase();
    primaryKws.forEach(function(kw) { if (hasWordBoundary(commentsLower, kw)) dim3 += 2; });
    secondaryKws.forEach(function(kw) { if (hasWordBoundary(commentsLower, kw)) dim3 += 2; });
    if (dim3 > 16) dim3 = 16; // cap at 16
    score += dim3;

    if (debug) console.log('[Score]', bugKey, 'Dim1-Title: ' + dim1 + ' (pri+' + dim1_pri + ' sec+' + dim1_sec + ') | Dim2-Desc: ' + dim2 + ' (pri+' + dim2_pri + ' sec+' + dim2_sec + ') | Dim3-Comment: ' + dim3);

    // === PHASE B: Context signals ===

    // --- Dim4: Metadata (components/labels) overlap ---
    var dim4 = 0;
    if (sourceMetadata && (sourceMetadata.components || sourceMetadata.labels)) {
        var bugComponents = bug.components || [];
        var bugLabels = bug.labels || [];
        var metaMatches = 0;
        var totalMeta = 0;

        if (sourceMetadata.components && sourceMetadata.components.length > 0) {
            var srcComp = sourceMetadata.components.map(function(c) { return (c.name || c).toLowerCase(); });
            totalMeta += srcComp.length;
            srcComp.forEach(function(c) {
                var found = bugComponents.some(function(bc) {
                    var bcName = (typeof bc === 'string' ? bc : (bc.name || '')).toLowerCase();
                    return bcName === c || bcName.indexOf(c) !== -1 || c.indexOf(bcName) !== -1;
                });
                if (found) metaMatches++;
            });
        }

        if (sourceMetadata.labels && sourceMetadata.labels.length > 0) {
            var srcLabels = sourceMetadata.labels.map(function(l) { return l.toLowerCase(); });
            totalMeta += srcLabels.length;
            srcLabels.forEach(function(l) {
                if (bugLabels.some(function(bl) { return bl.toLowerCase() === l || bl.toLowerCase().indexOf(l) !== -1; })) {
                    metaMatches++;
                }
            });
        }

        if (metaMatches > 0 && totalMeta > 0) {
            dim4 = Math.round(Math.min(metaMatches / totalMeta, 1) * 8);
            score += dim4;
        }
    }
    if (debug) console.log('[Score]', bugKey, 'Dim4-Metadata: +' + dim4);

    // --- Dim5: Error signature co-occurrence (both bugs share same GPU error term) ---
    // Only include GPU/PCIe-specific error terms, not generic words
    var dim5 = 0;
    if (sourceText && sourceText.fullText) {
        var errorSignatures = ['link down', 'link training',
            'l0s', 'l1', 'ltssm', 'serdes', 'retimer', 're-driver'];
        var sigMatches = 0;
        errorSignatures.forEach(function(sig) {
            if (sourceText.fullText.indexOf(sig) !== -1 && bugText.indexOf(sig) !== -1) {
                sigMatches++;
            }
        });
        dim5 = Math.min(sigMatches * 5, 15);
        score += dim5;
    }
    if (debug) console.log('[Score]', bugKey, 'Dim5-ErrSig: +' + dim5);

    // --- Dim6: Image type matching ---
    var dim6 = 0;
    if (sourceImages && sourceImages.length > 0) {
        var candidateImages = bug.imageSummaries || [];
        if (candidateImages.length > 0) {
            var sourceTypes = {};
            sourceImages.forEach(function(s) {
                if (typeof s === 'object' && s.type) sourceTypes[s.type] = true;
            });
            var typeMatches = 0;
            candidateImages.forEach(function(s) {
                if (typeof s === 'object' && s.type && sourceTypes[s.type]) typeMatches++;
            });
            if (typeMatches > 0) {
                dim6 = Math.min(typeMatches * 3, 10);
                score += dim6;
            }
        }
    }

    // --- Dim7: Image keyword overlap ---
    var dim7 = 0;
    if (sourceImages && sourceImages.length > 0) {
        var candidateImages = bug.imageSummaries || [];
        if (candidateImages.length > 0) {
            var sourceImgKws = {};
            sourceImages.forEach(function(s) {
                if (typeof s === 'object' && Array.isArray(s.keywords)) {
                    s.keywords.forEach(function(kw) { sourceImgKws[kw.toLowerCase()] = true; });
                }
                if (typeof s === 'object' && s.summary) {
                    s.summary.toLowerCase().split(/[\s,，|]+/).forEach(function(w) {
                        if (w.length > 2) sourceImgKws[w] = true;
                    });
                }
            });
            var imgKwMatches = 0;
            candidateImages.forEach(function(s) {
                if (typeof s === 'object' && Array.isArray(s.keywords)) {
                    s.keywords.forEach(function(kw) {
                        if (sourceImgKws[kw.toLowerCase()]) imgKwMatches++;
                    });
                }
                if (typeof s === 'object' && s.summary) {
                    s.summary.toLowerCase().split(/[\s,，|]+/).forEach(function(w) {
                        if (w.length > 2 && sourceImgKws[w]) imgKwMatches++;
                    });
                }
            });
            if (imgKwMatches > 0) {
                dim7 = Math.min(imgKwMatches * 2, 10);
                score += dim7;
            }
        }
    }
    if (debug) console.log('[Score]', bugKey, 'Dim6-ImgType: +' + dim6 + ' | Dim7-ImgKw: +' + dim7);

    // --- Dim9: Coverage bonus — rewards bugs that match ALL source keywords ---
    // Base bonus = matched count * 4 (favors more matches)
    // + extra bonus for high coverage ratio (100% = +8, 75% = +4)
    var dim9 = 0;
    if (allKeywords.length > 0 && allKeywords.length <= 15) {
        var matchedCount = 0;
        allKeywords.forEach(function(kw) {
            if (hasWordBoundary(bugText, kw)) matchedCount++;
        });
        var coverageRatio = matchedCount / allKeywords.length;
        dim9 = matchedCount * 4; // base: each match worth 4pts
        if (coverageRatio >= 1.0) dim9 += 8;   // 100% coverage bonus
        else if (coverageRatio >= 0.75) dim9 += 4; // 75% coverage bonus
        if (dim9 > 30) dim9 = 30; // cap at 30
        score += dim9;
    }

    // --- Dim10: Explicit reference — bug was specifically mentioned in source bug's comments/description ---
    var dim10 = 0;
    if (bug.isExplicitReference) {
        dim10 = 20; // meaningful bonus but doesn't override content quality
        score += dim10;
    }

    if (debug) console.log('[Score]', bugKey, 'Dim10-RefBonus: +' + dim10);

    // --- Dim8: Age bonus — newer bugs slightly more relevant ---
    var dim8 = 0;
    if (bug.createdTimestamp) {
        var ageDays = (Date.now() - bug.createdTimestamp) / (1000 * 60 * 60 * 24);
        if (ageDays < 30) dim8 = 5;
        else if (ageDays < 90) dim8 = 3;
        else if (ageDays < 180) dim8 = 1;
        score += dim8;
    }

    if (debug) console.log('[Score]', bugKey, 'Dim1-Title: ' + dim1 + ' | Dim2-Desc: ' + dim2 + ' | Dim3-Comment: ' + dim3 + ' | Dim4-Meta: ' + dim4 + ' | Dim5-ErrSig: ' + dim5 + ' | Dim6-ImgType: ' + dim6 + ' | Dim7-ImgKw: ' + dim7 + ' | Dim9-Cover: ' + dim9 + ' | Dim10-Ref: ' + dim10 + ' | Dim8-Age: ' + dim8 + ' | TOTAL raw=' + score);

    // Cap at 100
    return Math.min(score, 100);
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
            'description,resolution,comment,reporter,duedate,attachment';

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

                        // Extract components and labels
                        var labels = f.labels || [];
                        var components = f.components || [];
                        var componentNames = components.map(function(c) { return c.name || ''; }).filter(function(n) { return n; });

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
                            attachments: f.attachment || [],
                            labels: labels,
                            components: componentNames,
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
function extractKeywords(text, components, labels) {
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

    // Inject metadata: components -> primary, labels -> secondary
    if (Array.isArray(components)) {
        components.forEach(function(c) {
            if (c && typeof c === 'string' && primary.indexOf(c) === -1) {
                primary.push(c.toLowerCase());
            }
        });
    }
    if (Array.isArray(labels)) {
        labels.forEach(function(l) {
            if (l && typeof l === 'string' && secondary.indexOf(l) === -1) {
                secondary.push(l.toLowerCase());
            }
        });
    }

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

    // Limit: allow more keywords to be added later from image analysis
    return { primary: primary.slice(0, 6), secondary: secondary.slice(0, 10) };
}

module.exports = router;

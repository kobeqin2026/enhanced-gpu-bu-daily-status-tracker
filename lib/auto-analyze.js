#!/usr/bin/env node
/**
 * GPU Tracker Auto Image Analyzer
 * 
 * Scans JIRA bugs for image attachments, downloads them,
 * analyzes via Bailian (qwen3.6-plus) API, and caches results.
 * 
 * Usage: node lib/auto-analyze.js [--bug-keys KEY1,KEY2,...]
 * 
 * If --bug-keys is provided, only analyzes those specific bugs.
 * Otherwise, scans all projects for recently updated bugs.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const os = require('os');
const { spawnSync } = require('child_process');

// Load environment variables from skills/.env (same as server)
var envFile = path.join(os.homedir(), 'skills', '.env');
if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(function(line) {
        line = line.trim();
        if (line && !line.startsWith('#') && line.indexOf('=') !== -1) {
            var idx = line.indexOf('=');
            var key = line.substring(0, idx).trim();
            var val = line.substring(idx + 1).trim();
            if (!process.env[key]) process.env[key] = val;
        }
    });
}

// Configuration
const BAILIAN_API_KEY = process.env.BAILIAN_API_KEY || '';
const BAILIAN_BASE_URL = process.env.BAILIAN_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1';
const JIRA_BASE_URL = process.env.JIRA_BASE_URL || 'https://jira01.birentech.com';
const JIRA_PAT = process.env.JIRA_PAT || '';
const CACHE_DIR = path.join(os.homedir(), '.hermes', 'gpu-tracker', 'image-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'analysis-cache.json');
const RESIZE_SCRIPT = path.join(__dirname, 'resize_image.py');
const ANALYSIS_PROMPT = '这是一张GPU芯片调试相关的截图。请：1)识别这是什么类型的截图 2)提取所有关键数据和数值 3)用中文简要描述图中信息';

// Supported image MIME types
const SUPPORTED_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

// Parse CLI args
var args = process.argv.slice(2);
var bugKeys = null;
for (var i = 0; i < args.length; i++) {
    if (args[i] === '--bug-keys' && i + 1 < args.length) {
        bugKeys = args[i + 1].split(',').map(function(k) { return k.trim(); });
        i++;
    }
}

// Load existing cache
function loadCache() {
    if (fs.existsSync(CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
    return {};
}

function saveCache(cache) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function urlHash(url) {
    return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

// Download image from JIRA
function downloadImage(imageUrl) {
    return new Promise(function(resolve, reject) {
        var parsedUrl = new URL(imageUrl);
        var client = parsedUrl.protocol === 'https:' ? https : http;
        var req = client.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + JIRA_PAT },
            rejectUnauthorized: false
        }, function(resp) {
            if (resp.statusCode >= 400) {
                reject(new Error('HTTP ' + resp.statusCode));
                return;
            }
            var chunks = [];
            resp.on('data', function(c) { chunks.push(c); });
            resp.on('end', function() { resolve(Buffer.concat(chunks)); });
        });
        req.on('error', reject);
        req.setTimeout(15000, function() { req.destroy(); reject(new Error('timeout')); });
        req.end();
    });
}

// Resize image using Pillow
function resizeImage(buffer) {
    var result = spawnSync('python3', [RESIZE_SCRIPT, '1200', '80'], {
        input: buffer.toString('base64'),
        encoding: 'utf8',
        timeout: 10000
    });
    if (result.error) throw result.error;
    if (result.stderr) {
        // Log but don't fail - the image might still work
    }
    return result.stdout.trim();
}

// Analyze image via Bailian API
function analyzeImage(base64Data) {
    var body = JSON.stringify({
        model: 'qwen3.6-plus',
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: ANALYSIS_PROMPT },
                { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64Data } }
            ]
        }],
        max_tokens: 500
    });

    return fetch(BAILIAN_BASE_URL.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + BAILIAN_API_KEY
        },
        body: body,
        signal: AbortSignal.timeout(90000)
    }).then(function(res) {
        return res.text();
    }).then(function(data) {
        try {
            var json = JSON.parse(data);
            if (json.error) {
                return '';
            }
            if (json.choices && json.choices[0] && json.choices[0].message) {
                return json.choices[0].message.content.substring(0, 500);
            }
            return '';
        } catch(e) {
            return '';
        }
    });
}

// Extract image URLs from a JIRA issue
function extractImageUrls(issue) {
    var urls = [];
    var seen = {};
    var f = issue.fields || {};
    var attachments = f.attachment || [];
    var comments = (f.comment || {}).comments || [];

    // 1) From attachments
    attachments.forEach(function(att) {
        if (att.mimeType && SUPPORTED_MIMES.indexOf(att.mimeType) !== -1) {
            if (!seen[att.content]) {
                seen[att.content] = true;
                urls.push(att.content);
            }
        }
    });

    // 2) From comments (!image-xxx.png! format)
    var filenameToUrl = {};
    attachments.forEach(function(att) {
        if (att.filename && att.content) {
            filenameToUrl[att.filename] = att.content;
        }
    });

    comments.forEach(function(c) {
        var body = c.body || '';
        var regex = /!(image-[^\s|!]+(?:\.png|\.jpg|\.jpeg|\.gif|\.webp))/gi;
        var match;
        while ((match = regex.exec(body)) !== null) {
            var filename = match[1];
            var attUrl = filenameToUrl[filename];
            if (attUrl && !seen[attUrl]) {
                seen[attUrl] = true;
                urls.push(attUrl);
            }
        }
    });

    return urls;
}

// Fetch bugs from JIRA
function fetchBugs(jql) {
    return new Promise(function(resolve, reject) {
        var queryPath = '/rest/api/2/search?jql=' + encodeURIComponent(jql) +
            '&maxResults=100&fields=summary,attachment,comment';
        var parsedUrl = new URL(JIRA_BASE_URL + queryPath);
        var client = parsedUrl.protocol === 'https:' ? https : http;
        var req = client.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + JIRA_PAT },
            rejectUnauthorized: false
        }, function(resp) {
            var data = '';
            resp.on('data', function(c) { data += c; });
            resp.on('end', function() {
                try {
                    var json = JSON.parse(data);
                    resolve(json.issues || []);
                } catch(e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, function() { req.destroy(); reject(new Error('timeout')); });
        req.end();
    });
}

// Main logic
async function main() {
    var cache = loadCache();
    var allImageUrls = [];

    if (bugKeys) {
        // Fetch specific bugs
        console.log('Fetching specific bugs:', bugKeys.join(', '));
        for (var i = 0; i < bugKeys.length; i++) {
            var jql = 'key = "' + bugKeys[i] + '"';
            var issues = await fetchBugs(jql);
            issues.forEach(function(issue) {
                var urls = extractImageUrls(issue);
                console.log('Bug', issue.key + ':', urls.length, 'images found');
                urls.forEach(function(u) { allImageUrls.push(u); });
            });
        }
    } else {
        // Scan recently updated bugs across all projects
        console.log('Scanning recently updated bugs...');
        var jql = 'updated >= -7d ORDER BY updated DESC';
        var issues = await fetchBugs(jql);
        console.log('Found', issues.length, 'recently updated bugs');
        issues.forEach(function(issue) {
            var urls = extractImageUrls(issue);
            if (urls.length > 0) {
                console.log('Bug', issue.key + ':', urls.length, 'images');
                urls.forEach(function(u) { allImageUrls.push(u); });
            }
        });
    }

    console.log('\nTotal images to check:', allImageUrls.length);

    // Filter to unanalyzed images
    var pending = allImageUrls.filter(function(url) {
        var h = urlHash(url);
        return !cache[h];
    });

    console.log('Already cached:', allImageUrls.length - pending.length);
    console.log('Pending analysis:', pending.length);

    if (pending.length === 0) {
        console.log('\nNo new images to analyze. Done.');
        return;
    }

    // Analyze each pending image
    var analyzed = 0;
    var failed = 0;
    for (var i = 0; i < pending.length; i++) {
        var url = pending[i];
        var fname = url.substring(url.lastIndexOf('/') + 1);
        console.log('\n[' + (i + 1) + '/' + pending.length + '] Downloading', fname, '...');

        try {
            // Download
            var buffer = await downloadImage(url);
            console.log('  Downloaded:', buffer.length, 'bytes');

            // Resize
            var resized = resizeImage(buffer);
            console.log('  Resized:', resized.length, 'base64 chars');

            // Analyze
            var analysis = await analyzeImage(resized);
            if (analysis) {
                var h = urlHash(url);
                cache[h] = { url: url, analysis: analysis, timestamp: Date.now() };
                saveCache(cache);
                console.log('  Analyzed:', analysis.substring(0, 80) + '...');
                analyzed++;
            } else {
                console.log('  No result (skipped)');
                failed++;
            }
        } catch(e) {
            console.log('  Error:', e.message);
            failed++;
        }

        // Rate limit between requests
        if (i < pending.length - 1) {
            await new Promise(function(r) { setTimeout(r, 1500); });
        }
    }

    console.log('\n=== Summary ===');
    console.log('Analyzed:', analyzed);
    console.log('Failed:', failed);
    console.log('Total cached entries:', Object.keys(cache).length);
    console.log('Cache saved to:', CACHE_FILE);
}

main().catch(function(err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
});

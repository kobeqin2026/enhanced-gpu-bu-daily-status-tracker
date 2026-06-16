// 图片智能分析模块 -- DashScope qwen-vl
// 分析 JIRA Bug 附件中的截图（LTSSM 日志、示波器波形、寄存器 dump 等）
// 提取关键信息注入到相关 Bug 评分和 AI 诊断流程中

var https = require('https');
var http = require('http');
var url = require('url');

var VLM_API_KEY = process.env.VLM_API_KEY || process.env.BAILIAN_API_KEY || '';
var VLM_BASE_URL = process.env.VLM_BASE_URL || process.env.BAILIAN_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1';
var VLM_MODEL = process.env.VLM_MODEL || 'qwen-vl';

// 分析结果缓存 (imageUrl -> {summary, type, key_data, technical_details, keywords, timestamp})
var analysisCache = {};
var CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时

// 支持的图片 MIME 类型
var SUPPORTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

var SYSTEM_PROMPT = '你是一个GPU芯片Bring-up调试专家。你的任务是分析Bug附件中的截图，' +
    '提取所有有价值的技术信息。截图可能包含：\n' +
    '1. LTSSM状态机日志（PCIe链路训练状态序列）\n' +
    '2. 示波器/逻辑分析仪波形\n' +
    '3. 寄存器dump或配置表\n' +
    '4. 终端log输出（包含时间戳、错误码、状态值等）\n' +
    '5. 架构图或调试流程图\n\n' +
    '请严格按照以下JSON格式返回结果，只输出JSON，不要输出其他内容：\n' +
    '{\n' +
    '  "type": "ltssm_log|oscilloscope|register_dump|terminal_log|diagram|other",\n' +
    '  "summary": "一句话概括这张图是什么",\n' +
    '  "key_data": ["关键数据/数值1", "关键数据/数值2"],\n' +
    '  "technical_details": "详细的技术描述，包括所有可读的文字、数值、状态等",\n' +
    '  "keywords": ["相关技术术语1", "相关技术术语2"]\n' +
    '}\n' +
    '注意：\n' +
    '1. 尽可能提取图中所有可读的文字和数值\n' +
    '2. 特别关注PCIe相关术语（ltssm、gen1-5、lane、link、training、recovery等）\n' +
    '3. 特别关注时间数值、状态码、寄存器地址和值\n' +
    '4. 输出语言使用中文';

/**
 * 分析单张图片（返回完整结构化数据）
 * @param {string} imageUrl - 图片 URL
 * @param {string} authHeader - JIRA auth header (用于下载需要鉴权的图片)
 * @returns {Promise<Object>} - 完整分析结果 {summary, type, key_data, technical_details, keywords}
 */
function analyzeImageFull(imageUrl, authHeader) {
    // 检查缓存
    var cached = analysisCache[imageUrl];
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        console.log('[Vision] Cache hit (full) for', imageUrl.substring(imageUrl.lastIndexOf('/') + 1));
        return Promise.resolve(cached);
    }

    if (!VLM_API_KEY) {
        console.log('[Vision] VLM_API_KEY not configured, skipping analysis');
        return Promise.resolve(null);
    }

    return callVisionAPIFull(imageUrl, authHeader);
}

/**
 * 分析单张图片
 * @param {string} imageUrl - 图片 URL
 * @param {string} authHeader - JIRA auth header (用于下载需要鉴权的图片)
 * @returns {Promise<string>} - 分析结果摘要
 */
function analyzeImage(imageUrl, authHeader) {
    return analyzeImageFull(imageUrl, authHeader).then(function(result) {
        return result ? (result.summary || '') : '';
    });
}

/**
 * 批量分析图片（并发控制）
 * @param {string[]} imageUrls - 图片 URL 数组
 * @param {string} authHeader - JIRA auth header
 * @param {number} maxConcurrent - 最大并发数
 * @returns {Promise<string[]>} - 每个图片的分析摘要
 */
function analyzeImages(imageUrls, authHeader, maxConcurrent) {
    maxConcurrent = maxConcurrent || 3;

    var results = new Array(imageUrls.length).fill('');
    var index = 0;

    function next() {
        if (index >= imageUrls.length) return Promise.resolve();
        var i = index++;
        var imageUrl = imageUrls[i];

        return analyzeImage(imageUrl, authHeader)
            .then(function(summary) {
                results[i] = summary;
            })
            .catch(function(err) {
                console.error('[Vision] Analysis failed for', imageUrl, err.message);
                results[i] = '';
            })
            .then(next);
    }

    var workers = [];
    for (var w = 0; w < Math.min(maxConcurrent, imageUrls.length); w++) {
        workers.push(next());
    }

    return Promise.all(workers).then(function() {
        return results;
    });
}

/**
 * 从 Bug 对象中提取所有图片 URL
 * @param {Object} bug - Bug 对象（包含 attachments 和 comments）
 * @param {string} jiraBaseUrl - JIRA 基础 URL
 * @param {number} maxImages - 最多分析几张图
 * @returns {string[]} - 图片 URL 数组
 */
function extractImageUrls(bug, jiraBaseUrl, maxImages) {
    maxImages = maxImages || 5;
    var urls = [];
    var seen = {};

    // 1) From attachment field (primary source - has full URLs)
    if (bug.attachments && Array.isArray(bug.attachments)) {
        for (var i = 0; i < bug.attachments.length && urls.length < maxImages; i++) {
            var att = bug.attachments[i];
            if (att.mimeType && SUPPORTED_MIME_TYPES.indexOf(att.mimeType) !== -1) {
                if (!seen[att.content]) {
                    seen[att.content] = true;
                    urls.push(att.content);
                }
            }
        }
    }

    // 2) Fallback: parse !image-xxx.png! from comment bodies
    // Try to match by filename against attachments list
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
 * 将图片分析摘要合并到 bugText（用于评分）和 prompt（用于诊断）
 * @param {string[]} imageSummaries - 图片分析摘要数组
 * @param {Object} bug - Bug 对象
 * @returns {string} - 合并后的文本
 */
function buildImageText(imageSummaries, bug) {
    var parts = [];

    imageSummaries.forEach(function(summary, i) {
        if (summary) {
            parts.push('[截图' + (i + 1) + ']: ' + summary);
        }
    });

    return parts.join('\n');
}

function callVisionAPIFull(imageUrl, authHeader) {
    return new Promise(function(resolve, reject) {
        var needAuth = imageUrl.indexOf('jira01.birentech.com') !== -1 ||
                       imageUrl.indexOf('birentech.com') !== -1;

        if (needAuth && authHeader) {
            downloadAndResizeImage(imageUrl, authHeader)
                .then(function(base64Data) {
                    return callVisionAPIWithBase64(base64Data, imageUrl);
                })
                .then(resolve)
                .catch(reject);
        } else {
            callVisionAPIWithUrl(imageUrl)
                .then(resolve)
                .catch(reject);
        }
    });
}

function downloadAndResizeImage(imageUrl, authHeader) {
    return new Promise(function(resolve, reject) {
        var parsedUrl = url.parse(imageUrl);
        var client = parsedUrl.protocol === 'https:' ? https : http;

        var options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.path,
            method: 'GET',
            headers: { 'Authorization': authHeader },
            rejectUnauthorized: false
        };

        var req = client.request(options, function(resp) {
            if (resp.statusCode >= 400) {
                reject(new Error('Download failed: HTTP ' + resp.statusCode));
                return;
            }
            var chunks = [];
            resp.on('data', function(chunk) { chunks.push(chunk); });
            resp.on('end', function() {
                var buffer = Buffer.concat(chunks);
                // Resize using Python Pillow (max 800px, quality 70%)
                var resizeScript = __dirname + '/resize_image.py';
                try {
                    var result = require('child_process').spawnSync('python3', [resizeScript, '800', '70'], {
                        input: buffer.toString('base64'),
                        encoding: 'utf8',
                        timeout: 10000
                    });
                    if (result.error) throw result.error;
                    var resizedBase64 = result.stdout.trim();
                    console.log('[Vision] Resized image:', buffer.length, '->', resizedBase64.length, 'base64 chars');
                    resolve('data:image/jpeg;base64,' + resizedBase64);
                } catch(e) {
                    // Fallback: send original if resize fails
                    console.log('[Vision] Resize failed, using original:', e.message);
                    resolve('data:' + (resp.headers['content-type'] || 'image/png') + ';base64,' + buffer.toString('base64'));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(15000, function() { req.destroy(); reject(new Error('Download timeout')); });
        req.end();
    });
}

function callVisionAPIWithBase64(base64Data, originalUrl) {
    var cleanUrl = VLM_BASE_URL.replace(/\/+$/, '');
    var apiUrl = cleanUrl + '/chat/completions';

    var body = JSON.stringify({
        model: VLM_MODEL,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    { type: 'text', text: '请分析这张截图并提取所有技术信息。按以下JSON格式返回：{\"type\":\"类型\",\"summary\":\"一句话概括\",\"key_data\":[\"关键数据1\",\"关键数据2\"],\"technical_details\":\"详细描述\",\"keywords\":[\"术语1\",\"术语2\"]}' },
                    { type: 'image_url', image_url: { url: base64Data } }
                ]
            }
        ],
        temperature: 0.2,
        max_tokens: 1000
    });

    console.log('[Vision] Calling DashScope:', VLM_MODEL, 'for', originalUrl.substring(originalUrl.lastIndexOf('/') + 1));

    return new Promise(function(resolve, reject) {
        var parsedUrl = url.parse(apiUrl);
        var client = parsedUrl.protocol === 'https:' ? https : http;

        var req = client.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + VLM_API_KEY,
                'Content-Length': Buffer.byteLength(body)
            },
            rejectUnauthorized: false
        }, function(resp) {
            var data = '';
            resp.on('data', function(chunk) { data += chunk; });
            resp.on('end', function() {
                try {
                    var json = JSON.parse(data);
                    if (json.error) {
                        var errMsg = typeof json.error === 'string' ? json.error : (json.error.message || json.error.code || JSON.stringify(json.error));
                        reject(new Error('API error: ' + errMsg));
                        return;
                    }
                    var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
                    if (!content) {
                        reject(new Error('Empty response | status: ' + resp.statusCode));
                        return;
                    }
                    // Try to parse as JSON (model may return wrapped in code fence)
                    var cleanContent = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
                    var summary = '';
                    var structuredData = null;
                    try {
                        var parsed = JSON.parse(cleanContent);
                        summary = parsed.summary || '';
                        structuredData = {
                            summary: summary,
                            type: parsed.type || 'other',
                            key_data: parsed.key_data || [],
                            technical_details: parsed.technical_details || '',
                            keywords: parsed.keywords || [],
                            timestamp: Date.now()
                        };
                    } catch(jsonErr) {
                        // Fallback: use plain text response directly
                        summary = content.substring(0, 500);
                        structuredData = { summary: summary, type: 'other', key_data: [], technical_details: summary, keywords: [], timestamp: Date.now() };
                    }

                    // 缓存完整结构
                    analysisCache[originalUrl] = structuredData;
                    resolve(summary);
                } catch (e) {
                    reject(new Error('Parse failed: ' + e.message + ' | raw: ' + data.substring(0, 200)));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, function() { req.destroy(); reject(new Error('Vision API timeout')); });
        req.write(body);
        req.end();
    });
}

function callVisionAPIWithUrl(imageUrl) {
    var cleanUrl = VLM_BASE_URL.replace(/\/+$/, '');
    var apiUrl = cleanUrl + '/chat/completions';

    var body = JSON.stringify({
        model: VLM_MODEL,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    { type: 'text', text: '请分析这张截图并提取所有技术信息。按以下JSON格式返回：{\\\"type\\\":\\\"类型\\\",\\\"summary\\\":\\\"一句话概括\\\",\\\"key_data\\\":[\\\"关键数据1\\\",\\\"关键数据2\\\"],\\\"technical_details\\\":\\\"详细描述\\\",\\\"keywords\\\":[\\\"术语1\\\",\\\"术语2\\\"]}' },
                    { type: 'image_url', image_url: { url: imageUrl } }
                ]
            }
        ],
        temperature: 0.2,
        max_tokens: 1000
    });

    console.log('[Vision] Calling DashScope with URL:', imageUrl.substring(imageUrl.lastIndexOf('/') + 1));

    return new Promise(function(resolve, reject) {
        var parsedUrl = url.parse(apiUrl);
        var client = parsedUrl.protocol === 'https:' ? https : http;

        var req = client.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + VLM_API_KEY,
                'Content-Length': Buffer.byteLength(body)
            },
            rejectUnauthorized: false
        }, function(resp) {
            var data = '';
            resp.on('data', function(chunk) { data += chunk; });
            resp.on('end', function() {
                try {
                    var json = JSON.parse(data);
                    if (json.error) {
                        var errMsg = typeof json.error === 'string' ? json.error : (json.error.message || json.error.code || JSON.stringify(json.error));
                        reject(new Error('API error: ' + errMsg));
                        return;
                    }
                    var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
                    if (!content) {
                        reject(new Error('Empty response | status: ' + resp.statusCode));
                        return;
                    }
                    var cleanContent = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
                    var summary = '';
                    var structuredData = null;
                    try {
                        var parsed = JSON.parse(cleanContent);
                        summary = parsed.summary || '';
                        structuredData = {
                            summary: summary,
                            type: parsed.type || 'other',
                            key_data: parsed.key_data || [],
                            technical_details: parsed.technical_details || '',
                            keywords: parsed.keywords || [],
                            timestamp: Date.now()
                        };
                    } catch(jsonErr) {
                        summary = content.substring(0, 500);
                        structuredData = { summary: summary, type: 'other', key_data: [], technical_details: summary, keywords: [], timestamp: Date.now() };
                    }

                    analysisCache[imageUrl] = structuredData;
                    resolve(summary);
                } catch (e) {
                    reject(new Error('Parse failed: ' + e.message));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, function() { req.destroy(); reject(new Error('Vision API timeout')); });
        req.write(body);
        req.end();
    });
}

function getCacheStats() {
    var keys = Object.keys(analysisCache);
    return { cached: keys.length, ttl_hours: CACHE_TTL / 3600000 };
}

/**
 * 获取缓存中的完整结构化分析结果
 * @param {string} imageUrl - 图片 URL
 * @returns {Object|null} - 完整结构 {summary, type, key_data, technical_details, keywords, timestamp} 或 null
 */
function getCachedImageAnalysis(imageUrl) {
    var cached = analysisCache[imageUrl];
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached;
    }
    return null;
}

module.exports = {
    analyzeImage: analyzeImage,
    analyzeImageFull: analyzeImageFull,
    analyzeImages: analyzeImages,
    extractImageUrls: extractImageUrls,
    buildImageText: buildImageText,
    getCacheStats: getCacheStats,
    getCachedImageAnalysis: getCachedImageAnalysis
};

// Bug 智能诊断引擎 -- Bailian (通义千问)
// 使用 LLM 分析 Bug 描述、评论和日志，结合跨项目类似 Bug 历史，给出下一步调试方向

var https = require('https');
var http = require('http');
var url = require('url');

var API_KEY = process.env.BAILIAN_API_KEY || '';
var BASE_URL = process.env.BAILIAN_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1';
var MODEL = process.env.BAILIAN_MODEL || 'qwen3.6-plus';

// 诊断结果缓存 (key -> {result, timestamp})
var diagnosisCache = {};
var CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时

// Clear old cache entries that don't have related_bugs
Object.keys(diagnosisCache).forEach(function(key) {
    var entry = diagnosisCache[key];
    if (entry.result && !entry.result.related_bugs) {
        delete diagnosisCache[key];
        console.log('[Diagnosis] Cleared stale cache for', key);
    }
});

var SYSTEM_PROMPT = '你是一个GPU芯片Bring-up调试专家。你的任务是分析Bug的描述、评论和相关日志，' +
    '结合已关闭类似Bug的解决方案，给出下一步调试方向。\n' +
    '请严格按照以下JSON格式返回结果，只输出JSON，不要输出其他内容：\n' +
    '{\n' +
    '  "summary": "一句话概括问题",\n' +
    '  "possible_causes": ["原因1", "原因2"],\n' +
    '  "suggested_actions": ["建议操作1", "建议操作2"],\n' +
    '  "needed_data": ["需要收集的诊断数据1", "诊断数据2"],\n' +
    '  "confidence": 75,\n' +
    '  "references": ["相关知识点或工具"]\n' +
    '}\n' +
    '分析要点：\n' +
    '1. 根据错误关键词定位可能的硬件/软件问题（PCIE、IOMMU、GPIO、时钟、电源、BIOS、固件、PHY等）\n' +
    '2. 结合评论区已有讨论，避免重复建议，给出新方向\n' +
    '3. **重点参考"已关闭的类似Bug及其解决方案"中其他项目的根因分析和解决记录，特别是已验证有效的修复方法**\n' +
    '4. 如果历史Bug有明确的根因和修复步骤，优先建议验证该方法是否适用于当前场景\n' +
    '5. 给出具体可执行的下一步操作（运行脚本、收集log、检查配置、参考哪个已关闭Bug的解决方案）\n' +
    '6. 置信度根据信息充分程度和历史匹配度给出(0-100)\n' +
    '7. 输出语言使用中文';

/**
 * 分析一个 Bug（包含跨项目类似 Bug 检索）
 * @param {Object} bugInfo - { key, summary, status, severity, description, comments, logContent, projectKey }
 * @param {Object} jiraCtx - { authHeader, searchSimilarBugsFn }
 */
function analyzeBug(bugInfo, jiraCtx) {
    var bugKey = bugInfo.key;

    // 检查缓存
    var cached = diagnosisCache[bugKey];
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        console.log('[Diagnosis] Cache hit for', bugKey);
        return Promise.resolve(cached.result);
    }

    // 1) 跨项目搜索类似 Bug
    var relatedBugsPromise = jiraCtx && jiraCtx.searchSimilarBugsFn
        ? jiraCtx.searchSimilarBugsFn(bugInfo)
        : Promise.resolve([]);

    return relatedBugsPromise.then(function(relatedBugs) {
        bugInfo.relatedBugs = relatedBugs;
        console.log('[Diagnosis] Found', relatedBugs.length, 'related bugs for', bugKey);

        // 2) 构建 prompt
        var userPrompt = buildPrompt(bugInfo);

        // 3) 调用 LLM
        return callBailian(userPrompt);
    }).then(function(result) {
        // 附加相关 Bug 信息到结果中
        if (bugInfo.relatedBugs && bugInfo.relatedBugs.length > 0) {
            result.related_bugs = bugInfo.relatedBugs.map(function(b) {
                return {
                    key: b.bugId || b.jiraKey || '',
                    project: b.projectKey || '',
                    summary: b.summary || b.description || '',
                    status: b.status || b.jiraStatus || '',
                    resolution: b.resolution || '',
                    url: b.jiraUrl || b.url || '',
                    root_cause: b.rootCauseComment || '',
                    relevance_score: b.relevanceScore || 0
                };
            });
        }

        diagnosisCache[bugKey] = { result: result, timestamp: Date.now() };
        console.log('[Diagnosis] Result cached for', bugKey);
        return result;
    });
}

function buildPrompt(bugInfo) {
    var parts = [];

    parts.push('**Bug Key**: ' + (bugInfo.key || 'N/A'));
    parts.push('**标题**: ' + (bugInfo.summary || '无'));
    parts.push('**状态**: ' + (bugInfo.status || '无'));
    parts.push('**严重性**: ' + (bugInfo.severity || '无'));
    parts.push('**项目**: ' + (bugInfo.projectKey || '无'));

    if (bugInfo.description) {
        parts.push('\n**描述**:\n' + bugInfo.description);
    }

    if (bugInfo.comments && bugInfo.comments.length > 0) {
        parts.push('\n**评论记录**:');
        bugInfo.comments.forEach(function(c, i) {
            parts.push('[' + (i + 1) + '] [' + (c.author || 'Unknown') + ']: ' + (c.body || ''));
        });
    }

    if (bugInfo.logContent) {
        parts.push('\n**相关日志**:\n' + bugInfo.logContent);
    }

    // 附加跨项目已关闭 Bug 的解决方案
    if (bugInfo.relatedBugs && bugInfo.relatedBugs.length > 0) {
        parts.push('\n**已关闭的类似Bug及其解决方案（跨项目）**:');
        parts.push('以下是其他项目中已经解决的问题，请重点学习其根因分析和解决方案：\n');
        bugInfo.relatedBugs.forEach(function(b, i) {
            var bugKey = b.bugId || b.jiraKey || 'unknown';
            var proj = b.projectKey || '';
            var desc = b.description || b.summary || '无描述';
            var st = b.status || b.jiraStatus || '';
            var res = b.resolution || '';
            var rootCause = b.rootCauseComment || '';

            parts.push('[' + (i + 1) + '] ' + bugKey + ' (' + proj + ')');
            parts.push('    标题: ' + (desc.length > 200 ? desc.substring(0, 200) + '...' : desc));
            parts.push('    状态: ' + st + ' | 解决方式: ' + (res || 'Fixed'));

            if (rootCause) {
                parts.push('    📌 解决记录/根因分析:');
                parts.push(rootCause.split('\n').map(function(line) { return '    ' + line; }).join('\n'));
            }

            parts.push('');
        });
    }

    parts.push('请综合以上信息（包括历史类似Bug的解决经验），给出当前Bug的下一步调试方向。');

    return parts.join('\n');
}

function callBailian(prompt) {
    return new Promise(function(resolve, reject) {
        if (!API_KEY) {
            return reject(new Error('BAILIAN_API_KEY 未配置'));
        }

        var cleanUrl = BASE_URL.replace(/\/+$/, '');
        var apiUrl = cleanUrl + '/chat/completions';

        var body = JSON.stringify({
            model: MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 2000,
            response_format: { type: 'json_object' }
        });

        console.log('[Diagnosis] Calling Bailian:', MODEL, 'at', apiUrl);

        fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + API_KEY
            },
            body: body,
            signal: AbortSignal.timeout(150000)
        })
        .then(function(res) {
            console.log('[Diagnosis] Bailian response status:', res.status);
            return res.text();
        })
        .then(function(data) {
            try {
                var json = JSON.parse(data);
                if (json.error) {
                    reject(new Error(json.error.message || 'API error'));
                    return;
                }
                var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
                if (!content) {
                    reject(new Error('LLM 返回内容为空'));
                    return;
                }
                var cleanContent = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
                var parsed = JSON.parse(cleanContent);
                resolve(parsed);
            } catch (e) {
                reject(new Error('解析响应失败: ' + e.message + ' | raw: ' + data.substring(0, 200)));
            }
        })
        .catch(reject);
    });
}

function getCacheStats() {
    var keys = Object.keys(diagnosisCache);
    return { cached: keys.length, ttl_hours: CACHE_TTL / 3600000 };
}

module.exports = { analyzeBug: analyzeBug, getCacheStats: getCacheStats };

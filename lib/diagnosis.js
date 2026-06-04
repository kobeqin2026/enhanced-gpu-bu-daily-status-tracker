// Bug 智能诊断引擎 -- Bailian (通义千问)
// 使用 LLM 分析 Bug 描述、评论和日志，结合跨项目类似 Bug 历史，给出下一步调试方向

var https = require('https');
var http = require('http');
var url = require('url');

var API_KEY = process.env.BAILIAN_API_KEY || '';
var BASE_URL = process.env.BAILIAN_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1';
var MODEL = process.env.BAILIAN_MODEL || 'mimo-v2.5';

// 诊断结果缓存 (key -> {result, timestamp})
var diagnosisCache = {};
var CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时
var CACHE_VERSION = 2; // Bump to invalidate all old caches after scoring refactor

// Clear old cache entries from previous versions or missing related_bugs
Object.keys(diagnosisCache).forEach(function(key) {
    var entry = diagnosisCache[key];
    if (!entry.version || entry.version < CACHE_VERSION || !entry.result || !entry.result.related_bugs) {
        delete diagnosisCache[key];
        console.log('[Diagnosis] Cleared stale cache for', key);
    }
});

var SYSTEM_PROMPT = '你是一个GPU芯片Bring-up调试专家和芯片硬件测试调试专家。你的任务是分析Bug的描述、评论和相关日志，' +
    '结合已关闭类似Bug的解决方案，给出下一步调试方向。\\n' +
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
    '7. **深度利用图片证据**：如果提供了"截图分析"（如示波器波形、代码Diff、协议分析仪日志），必须结合其中的具体数据（如延迟时间、信号电平状态、寄存器值）来验证或反驳假设。不要仅仅列出截图内容，要用截图中的数据支持你的结论。\n' +
    '8. 输出语言使用中文';

// 针对已关闭Bug的诊断结论 prompt
var CLOSED_BUG_PROMPT = '你是一个GPU芯片Bring-up调试专家和芯片硬件测试调试专家。现在有一个已解决的Bug（状态为Closed或Rejected），' +
    '请根据它的描述、评论、Root Cause（如果有）以及类似Bug的历史解决方案，给出一份简洁的诊断结论。\n' +
    '请严格按照以下JSON格式返回结果，只输出JSON，不要输出其他内容：\n' +
    '{\n' +
    '  "summary": "一句话概括问题",\n' +
    '  "possible_causes": ["最终确认的原因"],\n' +
    '  "conclusion": "对该Bug的完整诊断结论，包括：根因是什么、如何解决的、关键经验总结。200-400字。",\n' +
    '  "confidence": 90,\n' +
    '  "references": ["相关知识点或工具"]\n' +
    '}\n' +
    '分析要点：\n' +
    '1. 如果Bug已有Root Cause，请基于它进行总结和扩展\n' +
    '2. 如果没有Root Cause，请根据描述、评论和类似Bug的解决经验推断最可能的根因\n' +
    '3. 输出语言使用中文';

/**
 * 分析一个 Bug（包含跨项目类似 Bug 检索）
 * @param {Object} bugInfo - { key, summary, status, severity, description, comments, logContent, projectKey, rootCause, components, labels }
 * @param {Object} jiraCtx - { authHeader, searchSimilarBugsFn }
 */
function analyzeBug(bugInfo, jiraCtx) {
    var bugKey = bugInfo.key;
    var isClosed = (bugInfo.status === 'closed' || bugInfo.status === 'rejected');

    // 检查缓存
    var cached = diagnosisCache[bugKey];
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        // 旧缓存没有 related_bugs 数据或版本过旧，必须重新搜索
        if (!cached.version || cached.version < CACHE_VERSION || !cached.result || !cached.result.related_bugs) {
            console.log('[Diagnosis] Stale cache for', bugKey, '(version mismatch or missing data) — re-running search');
            delete diagnosisCache[bugKey];
        } else {
            console.log('[Diagnosis] Cache hit for', bugKey);
            return Promise.resolve(cached.result);
        }
    }

    // 1) 跨项目搜索类似 Bug
    var relatedBugsPromise = jiraCtx && jiraCtx.searchSimilarBugsFn
        ? jiraCtx.searchSimilarBugsFn(bugInfo)
        : Promise.resolve([]);

    return relatedBugsPromise.then(function(relatedBugs) {
        bugInfo.relatedBugs = relatedBugs;
        console.log('[Diagnosis] Found', relatedBugs.length, 'related bugs for', bugKey);

        // For closed bugs with root cause: use closed-bug prompt for conclusion
        // For closed bugs without root cause: also use closed-bug prompt
        // For open bugs: use the normal debugging prompt
        if (isClosed) {
            // Inject root cause into prompt context if available
            if (bugInfo.rootCause) {
                bugInfo.description = (bugInfo.description || '') + '\n\n**Root Cause (JIRA字段)**:\n' + bugInfo.rootCause;
            }
            if (bugInfo.components && bugInfo.components.length > 0) {
                bugInfo.description = (bugInfo.description || '') + '\n**Components**: ' + bugInfo.components.join(', ');
            }
            if (bugInfo.labels && bugInfo.labels.length > 0) {
                bugInfo.description = (bugInfo.description || '') + '\n**Labels**: ' + bugInfo.labels.join(', ');
            }
            // Build user prompt with CLOSED_BUG_SYSTEM_PROMPT
            var userPrompt = buildPrompt(bugInfo);
            return callBailian(userPrompt, CLOSED_BUG_PROMPT);
        }

        // 2) 构建 prompt（正常调试流程）
        var userPrompt = buildPrompt(bugInfo);

        // 3) 调用 LLM
        return callBailian(userPrompt);
    }).then(function(result) {
        // 附加相关 Bug 信息到结果中
        if (bugInfo.relatedBugs && bugInfo.relatedBugs.length > 0) {
            result.related_bugs = bugInfo.relatedBugs.map(function(b) {
                var resultObj = {
                    key: b.bugId || b.jiraKey || '',
                    project: b.projectKey || '',
                    summary: b.summary || b.description || '',
                    status: b.status || b.jiraStatus || '',
                    resolution: b.resolution || '',
                    url: b.jiraUrl || b.url || '',
                    root_cause: b.rootCauseComment || '',
                    relevance_score: b.relevanceScore || 0
                };
                // Include image analysis results
                if (b.imageSummaries && b.imageSummaries.length > 0) {
                    resultObj.image_summaries = b.imageSummaries;
                }
                // Include unanalyzed images for frontend to show pending analysis
                if (b.unanalyzedImages && b.unanalyzedImages.length > 0) {
                    resultObj.unanalyzed_images = b.unanalyzedImages;
                }
                return resultObj;
            });
        }

        // 附加源 Bug 自己的图片信息到结果中
        if (bugInfo.imageSummaries && bugInfo.imageSummaries.length > 0) {
            result.source_image_summaries = bugInfo.imageSummaries;
        }
        if (bugInfo.unanalyzedImages && bugInfo.unanalyzedImages.length > 0) {
            result.source_unanalyzed_images = bugInfo.unanalyzedImages;
        }

        diagnosisCache[bugKey] = { result: result, timestamp: Date.now(), version: CACHE_VERSION };
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

            // 附加截图分析结果
            if (b.imageSummaries && b.imageSummaries.length > 0) {
                parts.push('    📷 截图分析 (AI提取):');
                b.imageSummaries.forEach(function(s, idx) {
                    parts.push('    [截图' + (idx + 1) + '] ' + s.substring(0, 400));
                });
            }

            parts.push('');
        });
    }

    parts.push('请综合以上信息（包括历史类似Bug的解决经验），给出当前Bug的下一步调试方向。');

    return parts.join('\n');
}

function callBailian(prompt, systemPrompt) {
    return new Promise(function(resolve, reject) {
        if (!API_KEY) {
            return reject(new Error('BAILIAN_API_KEY 未配置'));
        }

        var cleanUrl = BASE_URL.replace(/\/+$/, '');
        var apiUrl = cleanUrl + '/chat/completions';

        var sysPrompt = systemPrompt || SYSTEM_PROMPT;

        var body = JSON.stringify({
            model: MODEL,
            messages: [
                { role: 'system', content: sysPrompt },
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

/**
 * Check if a diagnosis result is cached (no side effects).
 * Used by the route to skip expensive pre-processing on cache hits.
 * @param {string} bugKey
 * @returns {Object|null} cached result or null
 */
function getCachedResult(bugKey) {
    var cached = diagnosisCache[bugKey];
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        if (cached.version >= CACHE_VERSION && cached.result && cached.result.related_bugs) {
            console.log('[Diagnosis] Early cache hit for', bugKey, '— skipping JIRA fetch + image analysis');
            return cached.result;
        }
    }
    return null;
}

module.exports = { analyzeBug: analyzeBug, getCacheStats: getCacheStats, getCachedResult: getCachedResult };

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
            response_format: { type: 'json_object' },
            // 禁用思考模式: 后端模型(br-qwen3/Qwen3.6-27B)是推理模型,
            // 思考过程会吃光 max_tokens 导致 content 为空 (finish_reason=length, 实测97s空返)
            chat_template_kwargs: { enable_thinking: false }
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
                // Robust JSON extraction: try multiple strategies
                var parsed = null;

                // Strategy 1: Direct parse (model returned clean JSON)
                try {
                    parsed = JSON.parse(content);
                } catch (_) {}

                // Strategy 2: Strip markdown code fences
                if (!parsed) {
                    var stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
                    try {
                        parsed = JSON.parse(stripped);
                    } catch (_) {}
                }

                // Strategy 3: Extract first {...} block (model may have prepended/appended text)
                if (!parsed) {
                    var match = content.match(/\{[\s\S]*\}/);
                    if (match) {
                        try {
                            parsed = JSON.parse(match[0]);
                        } catch (_) {}
                    }
                }

                if (parsed) {
                    resolve(parsed);
                } else {
                    // Log full content for debugging (up to 1000 chars)
                    console.error('[Diagnosis] JSON parse failed. Content (first 1000 chars):', content.substring(0, 1000));
                    reject(new Error('解析响应失败: ' + (content.substring(0, 200) || 'empty')));
                }
            } catch (e) {
                console.error('[Diagnosis] Unexpected error in response handler:', e.message);
                reject(new Error('解析响应失败: ' + e.message));
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
 * Summarize debug progress from JIRA comments + description using LLM.
 * Used by the Bug Tracking table "AI归纳" button (debug progress column).
 * @param {string} bugKey - JIRA issue key, e.g. BR200-123
 * @param {string} bugSummary - issue summary text
 * @param {Array} comments - [{created, author, body}]
 * @param {string} description - issue description (optional)
 * @returns {Promise<{summary: string, noComments: boolean}>}
 */
function summarizeDebugProgress(bugKey, bugSummary, comments, description) {
    var commentText = '';
    if (Array.isArray(comments) && comments.length) {
        commentText = comments.map(function(c) {
            var line = '- ';
            if (c.created) line += '[' + c.created + '] ';
            if (c.author) line += String(c.author) + ': ';
            line += (c.body || '');
            return line;
        }).join('\n');
    }

    if (!commentText.trim()) {
        return Promise.resolve({ summary: '', noComments: true });
    }

    var prompt = '请根据以下JIRA Bug的标题、描述和评论，归纳总结当前调试进展（Debug Progress）。\n' +
        '要求：\n' +
        '1. 用中文，2-4句话概括，包含：已完成的分析/验证动作、当前结论或假设、尚待解决的问题或下一步动作\n' +
        '2. 只依据评论内容归纳，不要编造或推测评论中不存在的信息\n' +
        '3. 如果评论只是过程性讨论（如"看下log"、"测试中"），如实概括为阶段性进展\n' +
        '4. 输出简洁，适合放在表格列中展示，不要换行\n\n' +
        'Bug: ' + bugKey + ' - ' + (bugSummary || '') + '\n' +
        '描述: ' + (description || '（无）') + '\n' +
        '评论:\n' + commentText + '\n\n' +
        '请只输出JSON，不要输出其他内容: {"summary": "调试进展总结"}';

    return callBailian(prompt, '你是一个严谨的GPU芯片Bring-up调试工程师，擅长从JIRA评论中提炼调试进展。只输出JSON，不要任何解释。')
        .then(function(parsed) {
            return { summary: (parsed && parsed.summary) ? String(parsed.summary).trim() : '' };
        })
        .catch(function(err) {
            console.error('[Diagnosis] summarizeDebugProgress LLM error:', err.message);
            throw err;
        });
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

/**
 * 一键 Daily Bring-up 状态总结 — LLM 润色层 (方案C)
 * 规则骨架已由 lib/daily-summary.js 生成, 这里只负责把骨架组织成日报文字。
 * @param {Object} skeleton - buildDailySkeleton() 的结果
 * @param {string} skeletonText - skeletonToText() 生成的紧凑文本
 * @returns {Promise<Object>} { overallStatus, domainSummaries, criteriaVerdict, criticalBugsHighlight, riskAndNextSteps }
 */
function summarizeDailyStatus(skeleton, skeletonText) {
    var prompt = '你是GPU芯片Bring-up团队的测试负责人，请根据以下当日Bring-up状态数据，撰写一份简洁的日报总结。\n' +
        '要求：\n' +
        '1. 只总结本数据中出现的Domain和内容，不要编造、不要引入数据外的Domain或建议\n' +
        '2. 对每个Domain给出1-2句当天状态总结（做了什么、有无阻塞、下一步）\n' +
        '3. 明确给出BU准出标准是否满足的判定结论（全部通过/未通过/未配置），并指出未达标项\n' +
        '4. Critical Bug的调试进展要突出强调，简述每个关键Bug当前进展和风险\n' +
        '5. 总体结论要能直接作为日报开头使用\n' +
        '6. 使用中文\n\n' +
        '当日数据：\n' + skeletonText + '\n\n' +
        '请只输出JSON，不要输出其他内容: {"overallStatus": "总体一句话结论", "domainSummaries": [{"domain": "Domain名", "summary": "该Domain当天状态总结"}], "criteriaVerdict": "准出标准判定结论", "criticalBugsHighlight": "Critical Bug调试进展要点（无则写无）", "riskAndNextSteps": "风险与下一步建议"}';

    return callBailian(prompt, '你是一个严谨的GPU芯片Bring-up测试负责人，擅长撰写每日Bring-up状态日报。只输出JSON，不要任何解释。')
        .then(function(parsed) {
            return {
                overallStatus: (parsed && parsed.overallStatus) ? String(parsed.overallStatus).trim() : '',
                domainSummaries: (parsed && Array.isArray(parsed.domainSummaries)) ? parsed.domainSummaries : [],
                criteriaVerdict: (parsed && parsed.criteriaVerdict) ? String(parsed.criteriaVerdict).trim() : '',
                criticalBugsHighlight: (parsed && parsed.criticalBugsHighlight) ? String(parsed.criticalBugsHighlight).trim() : '',
                riskAndNextSteps: (parsed && parsed.riskAndNextSteps) ? String(parsed.riskAndNextSteps).trim() : ''
            };
        })
        .catch(function(err) {
            console.error('[Diagnosis] summarizeDailyStatus LLM error:', err.message);
            throw err;
        });
}

/**
 * 全天快照归纳汇总 (同一天多个时刻快照 → LLM 归纳成一份连续进展报告)
 * @param {string} dayMarkdown - 该日全部快照的紧凑文本 (每个快照标注时刻)
 * @returns {Promise<Object>} { dayOverview, highlights[], risks[], nextSteps[] }
 */
function summarizeDailyDay(dayMarkdown) {
    var prompt = '你是GPU芯片Bring-up团队的测试负责人。下面是BU执行期内**同一天**的多个时刻快照（每个快照是该时刻的Bring-up状态，包含AI总体总结与规则明细）。' +
        '请把这些快照归纳成一份连贯的"全天进展汇总"，而不是逐条罗列。要求：\n' +
        '1. dayOverview: 全天整体进展归纳（3-6句），要体现从早到晚的变化趋势（如阻塞解除、测试通过、新风险出现）\n' +
        '2. highlights: 当天主要进展/亮点的数组（每项一句话，3-8项，只基于输入数据）\n' +
        '3. risks: 当天出现或持续的风险与阻塞的数组（每项一句话；无则空数组）\n' +
        '4. nextSteps: 后续/明天建议的数组（每项一句话，2-5项）\n' +
        '5. 只使用输入中出现的信息，不要编造，使用中文\n\n' +
        '全天快照输入：\n' + dayMarkdown + '\n\n' +
        '请只输出JSON，不要输出其他内容: {"dayOverview": "全天进展归纳", "highlights": ["进展1", "进展2"], "risks": ["风险1"], "nextSteps": ["建议1"]}';

    return callBailian(prompt, '你是一个严谨的GPU芯片Bring-up测试负责人，擅长归纳多时刻快照为全天进展汇总。只输出JSON，不要任何解释。')
        .then(function(parsed) {
            function strArr(v) {
                if (!Array.isArray(v)) return [];
                return v.map(function(x) { return String(x).trim(); }).filter(Boolean);
            }
            return {
                dayOverview: (parsed && parsed.dayOverview) ? String(parsed.dayOverview).trim() : '',
                highlights: strArr(parsed && parsed.highlights),
                risks: strArr(parsed && parsed.risks),
                nextSteps: strArr(parsed && parsed.nextSteps)
            };
        })
        .catch(function(err) {
            console.error('[Diagnosis] summarizeDailyDay LLM error:', err.message);
            throw err;
        });
}

module.exports = { analyzeBug: analyzeBug, getCacheStats: getCacheStats, getCachedResult: getCachedResult, summarizeDebugProgress: summarizeDebugProgress, summarizeDailyStatus: summarizeDailyStatus, summarizeDailyDay: summarizeDailyDay };

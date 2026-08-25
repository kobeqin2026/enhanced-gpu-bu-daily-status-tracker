// ====== 一键总结 Daily Bring-up 状态 (方案C: 规则骨架 + LLM 润色) ======
// 依赖: apiCall (data.js), App (globals.js), escapeHtml 不可用则用本地安全创建

// 本地安全 HTML 转义
function summaryEscapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 当前日期 YYYY-MM-DD (本地时区)
function summaryTodayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 当前时刻 YYYY-MM-DDTHH:MM (datetime-local 值, 支持同一天多次更新的快照选择)
function summaryNowLocal() {
    var d = new Date();
    var date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return date + 'T' + time;
}

// 打开总结弹窗
function openDailySummaryModal() {
    var modal = document.getElementById('daily-summary-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    // 默认今天当前时刻
    document.getElementById('daily-summary-date').value = summaryNowLocal();
    document.getElementById('daily-summary-status').textContent = '';
    generateDailySummary();
}

function closeDailySummaryModal() {
    document.getElementById('daily-summary-modal').style.display = 'none';
}

// Tab 切换
function switchSummaryTab(tab) {
    document.getElementById('summary-tab-ai').className = 'summary-tab-btn' + (tab === 'ai' ? ' active' : '');
    document.getElementById('summary-tab-data').className = 'summary-tab-btn' + (tab === 'data' ? ' active' : '');
    var historyBtn = document.getElementById('summary-tab-history');
    if (historyBtn) historyBtn.className = 'summary-tab-btn' + (tab === 'history' ? ' active' : '');
    var content = document.getElementById('daily-summary-content');
    // 重新按当前 tab 渲染
    if (tab === 'ai' && window._summaryResult) renderSummaryAI(window._summaryResult);
    else if (tab === 'data' && window._summaryResult) renderSummaryData(window._summaryResult);
    else if (tab === 'history') loadSummaryHistory();
}

// 生成总结
async function generateDailySummary() {
    var dateTime = document.getElementById('daily-summary-date').value;
    var date = dateTime ? dateTime.slice(0, 10) : '';
    var time = dateTime && dateTime.length > 10 ? dateTime.slice(11) : '';
    var statusEl = document.getElementById('daily-summary-status');
    var contentEl = document.getElementById('daily-summary-content');
    var genBtn = document.getElementById('daily-summary-gen-btn');

    if (!date) { statusEl.textContent = '请选择总结时刻'; return; }
    statusEl.textContent = '生成中... (LLM润色约需5-15秒)';
    statusEl.style.color = 'var(--muted)';
    genBtn.disabled = true;
    contentEl.innerHTML = '<div style="color: var(--muted); font-size: 14px; padding: 30px; text-align:center;">⏳ 正在生成总结，请稍候...</div>';

    try {
        var result = await apiCall('/api/data/daily-summary?project=' + encodeURIComponent(App.currentProject), {
            method: 'POST',
            body: JSON.stringify({ projectId: App.currentProject, date: date, time: time }),
            cache: 'no-store'
        });

        if (!result || !result.success) {
            throw new Error((result && result.error) || '生成失败');
        }

        window._summaryResult = result;
        // 自动存档到历史 (键=日期+时刻: 同时刻覆盖, 不同时刻新增快照) — 失败不影响展示
        var savedInfo = null;
        try { savedInfo = await saveSummaryToHistory(result); } catch (e) { console.error('[DailySummary] 存档失败:', e); }
        var tsText = (result.time ? ' ' + result.time : ' 全天');
        statusEl.textContent = (result.aiFailed ? '⚠ LLM润色失败，显示规则版数据明细' : '✓ 生成完成') +
            (savedInfo ? ' · 已存档(当日第' + savedInfo.dayCount + '条)' : '') + ' · 快照:' + result.date + tsText;
        statusEl.style.color = result.aiFailed ? 'var(--yellow)' : 'var(--green)';

        // 默认展示 AI 总结 tab；AI 失败则展示数据明细
        if (result.aiFailed || !result.ai) {
            switchSummaryTab('data');
        } else {
            switchSummaryTab('ai');
        }
    } catch (err) {
        console.error('[DailySummary] error:', err);
        statusEl.textContent = '生成失败: ' + err.message;
        statusEl.style.color = 'var(--red)';
        contentEl.innerHTML = '<div style="color: var(--red); font-size: 14px; padding: 30px; text-align:center;">生成失败: ' + summaryEscapeHtml(err.message) + '</div>';
    } finally {
        genBtn.disabled = false;
        if (statusEl.textContent === '生成中... (LLM润色约需5-15秒)') statusEl.textContent = '';
    }
}

// ---------- 安全 DOM 构建辅助 ----------
function summaryEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
}

function summaryCard(title, bodyEl, accentClass) {
    var card = summaryEl('div', 'summary-card' + (accentClass ? ' ' + accentClass : ''));
    var h = summaryEl('div', 'summary-card-title', title);
    card.appendChild(h);
    if (bodyEl) card.appendChild(bodyEl);
    return card;
}

// 渲染 AI 总结 tab
function renderSummaryAI(result) {
    var container = document.getElementById('daily-summary-content');
    container.innerHTML = '';
    var ai = result.ai || {};
    var frag = document.createDocumentFragment();

    // 总体状态
    if (ai.overallStatus) {
        frag.appendChild(summaryCard('📌 总体状态', summaryEl('div', 'summary-text', ai.overallStatus), 'card-accent-blue'));
    }

    // 每 domain 总结
    if (ai.domainSummaries && ai.domainSummaries.length) {
        var list = summaryEl('div', 'summary-list');
        ai.domainSummaries.forEach(function(ds) {
            var row = summaryEl('div', 'summary-domain-row');
            var name = summaryEl('span', 'summary-domain-name', ds.domain);
            row.appendChild(name);
            row.appendChild(summaryEl('span', 'summary-domain-summary', ds.summary || ''));
            list.appendChild(row);
        });
        frag.appendChild(summaryCard('🧩 各 Domain 当天状态', list));
    }

    // 准出标准判定
    if (ai.criteriaVerdict) {
        var verdict = ai.criteriaVerdict;
        var vClass = 'card-accent-yellow';
        if (verdict.indexOf('通过') !== -1 || verdict.indexOf('符合') !== -1) vClass = 'card-accent-green';
        else if (verdict.indexOf('未') !== -1 || verdict.indexOf('不') !== -1) vClass = 'card-accent-red';
        frag.appendChild(summaryCard('✅ BU准出标准判定', summaryEl('div', 'summary-text', verdict), vClass));
    }

    // Critical bug 调试进展 (突出)
    if (ai.criticalBugsHighlight && ai.criticalBugsHighlight !== '无') {
        var critCard = summaryCard('🔥 Critical Bug 调试进展', null, 'card-accent-red');
        var critBody = summaryEl('div', 'critical-highlight-box');
        critBody.appendChild(summaryEl('div', 'summary-text', ai.criticalBugsHighlight));
        // 附规则明细: 各 critical bug 的 debugProgress
        if (result.skeleton && result.skeleton.criticalBugs && result.skeleton.criticalBugs.length) {
            var critList = summaryEl('div', 'summary-list');
            result.skeleton.criticalBugs.forEach(function(b) {
                var row = summaryEl('div', 'summary-bug-row');
                var head = summaryEl('div', 'summary-bug-head');
                head.appendChild(summaryEl('span', 'bug-key', b.bugId));
                head.appendChild(summaryEl('span', 'bug-meta', ' [' + (b.domain || 'TBD') + '] ' + (b.statusLabel || b.status || '') + (b.owner ? ' / ' + b.owner : '')));
                row.appendChild(head);
                if (b.debugProgress) {
                    row.appendChild(summaryEl('div', 'debug-progress-text', '🔎 ' + b.debugProgress));
                    var src = b.debugProgressSource === 'manual' ? '手动填写' : (b.debugProgressSource === 'llm' ? 'LLM总结' : '');
                    if (src) row.appendChild(summaryEl('div', 'debug-progress-src', '来源: ' + src + (b.debugProgressUpdatedAt ? ' · ' + b.debugProgressUpdatedAt : '')));
                } else {
                    row.appendChild(summaryEl('div', 'debug-progress-text', '⚠ 暂无调试进展'));
                }
                critList.appendChild(row);
            });
            critBody.appendChild(critList);
        }
        critCard.appendChild(critBody);
        frag.appendChild(critCard);
    } else if (!ai.criticalBugsHighlight && result.skeleton && result.skeleton.criticalBugs && result.skeleton.criticalBugs.length) {
        // LLM 没单独写, 规则层给出
        var critCard2 = summaryCard('🔥 Critical Bug 列表 (highest/high)', null, 'card-accent-red');
        var critList2 = summaryEl('div', 'summary-list');
        result.skeleton.criticalBugs.forEach(function(b) {
            var row = summaryEl('div', 'summary-bug-row');
            var head = summaryEl('div', 'summary-bug-head');
            head.appendChild(summaryEl('span', 'bug-key', b.bugId));
            head.appendChild(summaryEl('span', 'bug-meta', ' [' + (b.domain || 'TBD') + '] ' + (b.statusLabel || b.status || '') + (b.owner ? ' / ' + b.owner : '')));
            row.appendChild(head);
            if (b.debugProgress) row.appendChild(summaryEl('div', 'debug-progress-text', '🔎 ' + b.debugProgress));
            else row.appendChild(summaryEl('div', 'debug-progress-text', '⚠ 暂无调试进展'));
            critList2.appendChild(row);
        });
        critCard2.appendChild(critList2);
        frag.appendChild(critCard2);
    }

    // 风险与下一步
    if (ai.riskAndNextSteps) {
        frag.appendChild(summaryCard('⚠️ 风险与下一步', summaryEl('div', 'summary-text', ai.riskAndNextSteps), 'card-accent-yellow'));
    }

    // 全部 bug 汇总提示
    if (result.skeleton && result.skeleton.allBugs) {
        var totalHint = summaryEl('div', 'summary-text muted-hint',
            '全部Bug共 ' + result.skeleton.allBugs.length + ' 条，见"数据明细"tab 或复制Markdown查看完整列表。');
        frag.appendChild(totalHint);
    }

    container.appendChild(frag);
}

// ---------- 规则明细渲染 ----------
function summaryTable(headers, rows) {
    var table = summaryEl('table', 'summary-table');
    var thead = summaryEl('thead');
    var tr = summaryEl('tr');
    headers.forEach(function(h) { tr.appendChild(summaryEl('th', '', h)); });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = summaryEl('tbody');
    rows.forEach(function(cells) {
        var r = summaryEl('tr');
        cells.forEach(function(c) {
            var td = summaryEl('td');
            if (c && c._el) td.appendChild(c._el);        // 预构建 DOM 节点 (安全)
            else if (c && c._html) td.innerHTML = c._html; // 仅受控样式 span (无用户数据)
            else td.textContent = (c === null || c === undefined) ? '' : String(c);
            r.appendChild(td);
        });
        tbody.appendChild(r);
    });
    table.appendChild(tbody);
    return table;
}

function statusBadgeHtml(label, kind) {
    var color = kind === 'ok' ? 'var(--green)' : kind === 'bad' ? 'var(--red)' : kind === 'warn' ? 'var(--yellow)' : 'var(--muted)';
    return '<span style="display:inline-block; padding:1px 8px; border-radius:10px; font-size:12px; background:' + color + '22; color:' + color + '; border:1px solid ' + color + '55;">' + summaryEscapeHtml(label) + '</span>';
}

// 今日进展单元格 (DOM 构建, 安全)
function progressCellEl(dayProgress) {
    var wrap = summaryEl('div');
    (dayProgress || []).forEach(function(p) {
        var parts = [];
        if (p.workDone) parts.push('✅ ' + p.workDone);
        if (p.nextSteps) parts.push('➡️ ' + p.nextSteps);
        if (p.blockers) parts.push('⛔ ' + p.blockers);
        if (!parts.length) parts.push('(记录无内容)');
        parts.forEach(function(t, i) {
            var line = summaryEl('div', 'progress-line');
            line.textContent = t;
            wrap.appendChild(line);
        });
    });
    return wrap;
}

// 渲染数据明细 tab
function renderSummaryData(result) {
    var container = document.getElementById('daily-summary-content');
    container.innerHTML = '';
    var skel = result.skeleton;
    if (!skel) { container.appendChild(summaryEl('div', 'summary-text', '无数据')); return; }
    var frag = document.createDocumentFragment();

    // 1. 每 domain 当天状态
    var domCard = summaryCard('🧩 各 Domain 当天状态 (' + (skel.domainSummaries ? skel.domainSummaries.length : 0) + ' 个Domain)', null);
    var domRows = (skel.domainSummaries || []).map(function(d) {
        var statusKind = d.status === 'completed' ? 'ok' : (d.status === 'blocked' ? 'bad' : (d.status === 'in-progress' ? 'warn' : ''));
        var hasProgress = d.dayProgress && d.dayProgress.length;
        var doneCell = null;
        if (hasProgress) {
            doneCell = { _el: progressCellEl(d.dayProgress) };
        } else if (d.latestProgress) {
            doneCell = { _el: summaryEl('span', 'muted-hint', '今日无记录 (最近' + d.latestProgress.date + ': ' + (d.latestProgress.workDone || '') + ')') };
        } else {
            doneCell = { _el: summaryEl('span', 'muted-hint', '今日无进度记录') };
        }
        return [d.name || '-', d.owner || '-', { _html: statusBadgeHtml(d.statusLabel || d.status || '-', statusKind) }, d.startDate || '-', d.endDate || '-', doneCell];
    });
    domCard.appendChild(summaryTable(['Domain', '负责人', '状态', '执行开始', '执行结束', '今日进展 / 下一步 / 阻塞'], domRows));
    frag.appendChild(domCard);

    // 2. BU准出标准
    var c = skel.criteria || { total: 0, pass: 0, fail: 0, notReady: 0, items: [] };
    var verdictLine = c.total === 0 ? '未配置BU准出标准' :
        (c.allPass ? '✅ 全部通过，符合BU准出标准' : '❌ 未全部通过 (通过' + c.pass + '/不通过' + c.fail + '/未就绪' + c.notReady + ')');
    var critCard = summaryCard('✅ BU准出标准 (' + c.total + '条) — ' + verdictLine, null,
        c.total === 0 ? '' : (c.allPass ? 'card-accent-green' : 'card-accent-red'));
    var critRows = (c.items || []).map(function(it) {
        var kind = it.status === 'pass' ? 'ok' : (it.status === 'fail' ? 'bad' : 'warn');
        return [it.domain || '-', it.criteria || '-', it.signoffOwner || '-', { _html: statusBadgeHtml(it.statusLabel || it.status || '-', kind) }];
    });
    critCard.appendChild(summaryTable(['Domain', '准出标准', '签核人', '状态'], critRows));
    frag.appendChild(critCard);

    // 3. Critical bugs (突出)
    var critBugs = skel.criticalBugs || [];
    var critCard2 = summaryCard('🔥 Critical Bug (' + critBugs.length + ') — highest/high 突出显示', null, critBugs.length ? 'card-accent-red' : '');
    if (critBugs.length === 0) {
        critCard2.appendChild(summaryEl('div', 'summary-text muted-hint', '当前无 Critical (highest/high) Bug'));
    } else {
        var critRows2 = critBugs.map(function(b) {
            return [b.bugId || '-', b.domain || 'TBD', b.severity || '-', b.statusLabel || b.status || '-', b.owner || '-',
                b.debugProgress ? b.debugProgress : '⚠ 暂无调试进展'];
        });
        critCard2.appendChild(summaryTable(['Bug ID', 'Domain', 'Severity', '状态', 'Owner', 'Debug Progress'], critRows2));
    }
    frag.appendChild(critCard2);

    // 4. 全部 bugs
    var allBugs = skel.allBugs || [];
    var allCard = summaryCard('🐛 全部 Bug (' + allBugs.length + ')', null);
    if (allBugs.length === 0) {
        allCard.appendChild(summaryEl('div', 'summary-text muted-hint', '当前无Bug'));
    } else {
        var allRows = allBugs.map(function(b) {
            var sevKind = (b.severity === 'highest' || b.severity === 'high' || b.severity === 'critical') ? 'bad' : '';
            return [b.bugId || '-', b.domain || 'TBD', { _html: statusBadgeHtml(b.severity || '-', sevKind) }, b.statusLabel || b.status || '-', b.owner || '-', b.reportDate || '-'];
        });
        allCard.appendChild(summaryTable(['Bug ID', 'Domain', 'Severity', '状态', 'Owner', '报告日期'], allRows));
    }
    frag.appendChild(allCard);

    container.appendChild(frag);
}

// ---------- 复制 Markdown ----------
function buildSummaryMarkdown(result) {
    var skel = result.skeleton;
    var ai = result.ai || {};
    var L = [];
    var projectName = (skel.project && skel.project.name) ? skel.project.name : App.currentProject;
    var timeline = (skel.project && skel.project.startDate) ? (' (BU: ' + skel.project.startDate + ' ~ ' + (skel.project.endDate || '-') + ')') : '';
    L.push('# ' + projectName + ' Daily Bring-up 状态总结 — ' + skel.date + (result.time ? ' ' + result.time : '') + timeline);
    L.push('');

    if (ai.overallStatus) { L.push('## 📌 总体状态'); L.push(ai.overallStatus); L.push(''); }
    if (ai.riskAndNextSteps) { L.push('## ⚠️ 风险与下一步'); L.push(ai.riskAndNextSteps); L.push(''); }

    L.push('## 🧩 Domain 当天状态');
    (skel.domainSummaries || []).forEach(function(d) {
        var line = '- **' + d.name + '** (' + (d.owner || '无') + ', ' + (d.statusLabel || d.status || '') + (d.startDate || d.endDate ? ', 执行: ' + (d.startDate || '?') + ' ~ ' + (d.endDate || '?') : '') + ')';
        L.push(line);
        if (d.dayProgress && d.dayProgress.length) {
            d.dayProgress.forEach(function(p) {
                if (p.workDone) L.push('    - 完成: ' + p.workDone);
                if (p.nextSteps) L.push('    - 下一步: ' + p.nextSteps);
                if (p.blockers) L.push('    - 阻塞: ' + p.blockers);
            });
        } else if (d.latestProgress) {
            L.push('    - 今日无记录 (最近' + d.latestProgress.date + ': ' + (d.latestProgress.workDone || '') + ')');
        } else {
            L.push('    - 今日无进度记录');
        }
    });
    L.push('');

    var c = skel.criteria || {};
    L.push('## ✅ BU准出标准 (' + (c.total || 0) + '条)');
    if (ai.criteriaVerdict) L.push(ai.criteriaVerdict);
    if (c.total === 0) L.push('未配置BU准出标准');
    else L.push(c.allPass ? '规则判定: 全部通过 ✅' : '规则判定: 通过' + c.pass + '/不通过' + c.fail + '/未就绪' + c.notReady + ' ❌');
    (c.items || []).forEach(function(it) {
        L.push('- [' + (it.statusLabel || it.status || '') + '] ' + (it.domain || '') + ' — ' + (it.criteria || '') + (it.signoffOwner ? ' (签核: ' + it.signoffOwner + ')' : ''));
    });
    L.push('');

    L.push('## 🔥 Critical Bug 调试进展 (highest/high)');
    var critBugs = skel.criticalBugs || [];
    if (ai.criticalBugsHighlight && ai.criticalBugsHighlight !== '无') L.push(ai.criticalBugsHighlight);
    if (critBugs.length === 0) L.push('- 无');
    critBugs.forEach(function(b) {
        L.push('- **' + b.bugId + '** [' + (b.domain || 'TBD') + '] ' + (b.statusLabel || b.status || '') + (b.owner ? ' / ' + b.owner : ''));
        if (b.debugProgress) L.push('    - 调试进展: ' + b.debugProgress);
        else L.push('    - 暂无调试进展');
    });
    L.push('');

    L.push('## 🐛 全部 Bug (' + (skel.allBugs || []).length + ')');
    L.push('| Bug ID | Domain | Severity | 状态 | Owner | 报告日期 |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    (skel.allBugs || []).forEach(function(b) {
        L.push('| ' + (b.bugId || '-') + ' | ' + (b.domain || 'TBD') + ' | ' + (b.severity || '-') + ' | ' + (b.statusLabel || b.status || '-') + ' | ' + (b.owner || '-') + ' | ' + (b.reportDate || '-') + ' |');
    });
    L.push('');
    if (skel.lastUpdated) { L.push('> 数据最后更新: ' + skel.lastUpdated); }
    return L.join('\n');
}

function copyDailySummaryMarkdown() {
    if (!window._summaryResult) { alert('请先生成总结'); return; }
    var md = buildSummaryMarkdown(window._summaryResult);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(function() {
            var st = document.getElementById('daily-summary-status');
            st.textContent = '✓ 已复制到剪贴板';
            st.style.color = 'var(--green)';
        }).catch(function() {
            // fallback
            var ta = document.createElement('textarea');
            ta.value = md;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            document.getElementById('daily-summary-status').textContent = '✓ 已复制';
        });
    } else {
        var ta = document.createElement('textarea');
        ta.value = md;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        document.getElementById('daily-summary-status').textContent = '✓ 已复制';
    }
}

// ==================== 历史总结 (递增存储, 查看bringup 14天进度) ====================

// 生成成功后自动存档 → POST /api/data/daily-summary/save
// 键 = 日期+时刻: 同一天同时刻 → 覆盖更新; 不同时刻(当天多次更新) → 新增快照
async function saveSummaryToHistory(result) {
    var res = await apiCall('/api/data/daily-summary/save?project=' + encodeURIComponent(App.currentProject), {
        method: 'POST',
        body: JSON.stringify({
            projectId: App.currentProject,
            date: result.date,
            time: result.time || '',
            aiFailed: !!result.aiFailed,
            skeleton: result.skeleton,
            ai: result.ai || null
        }),
        cache: 'no-store'
    });
    if (!res || !res.success) return null;
    return { ok: true, mode: res.mode, dayCount: res.dayCount || 1 };
}

// 加载历史列表 (轻量) 并渲染
async function loadSummaryHistory() {
    var contentEl = document.getElementById('daily-summary-content');
    if (!contentEl) return;
    contentEl.innerHTML = '<div style="color: var(--muted); font-size: 14px; padding: 30px; text-align:center;">⏳ 加载历史总结...</div>';
    try {
        var res = await apiCall('/api/data/daily-summary/history?project=' + encodeURIComponent(App.currentProject), { cache: 'no-store' });
        if (!res || !res.success) throw new Error((res && res.error) || '加载失败');
        renderSummaryHistory((res.items || []).slice()); // 后端已按日期升序
    } catch (err) {
        console.error('[DailySummary] history load error:', err);
        contentEl.innerHTML = '<div style="color: var(--red); font-size: 14px; padding: 30px; text-align:center;">加载失败: ' + summaryEscapeHtml(err.message) + '</div>';
    }
}

// 渲染历史列表: 按日期分组, 组内同一日期的多个时刻快照按 time 升序 (同一天多次更新 → 多次总结)
function renderSummaryHistory(items) {
    var container = document.getElementById('daily-summary-content');
    if (!container) return;
    container.innerHTML = '';
    var frag = document.createDocumentFragment();

    if (!items.length) {
        frag.appendChild(summaryEl('div', 'summary-text muted-hint',
            '暂无历史总结。点击"生成总结"后会自动存档，按日期+时刻递增记录，可回看BU 14天bringup进度。'));
        container.appendChild(frag);
        return;
    }

    var days = [];
    items.forEach(function(item) {
        var day = days.find(function(g) { return g.date === item.date; });
        if (!day) { day = { date: item.date, snaps: [] }; days.push(day); }
        day.snaps.push(item);
    });

    frag.appendChild(summaryEl('div', 'summary-text',
        '📅 历史总结共 ' + items.length + ' 条快照 / ' + days.length + ' 天（按日期+时刻递增，最新在底部）— 点击任意一条查看完整总结'));
    frag.appendChild(summaryEl('div', 'summary-text muted-hint',
        '同一天多次更新可生成多个时刻快照（如 09:30 / 15:20），记录保存在 data/' + summaryEscapeHtml(App.currentProject) + '.daily-summaries.json'));

    days.forEach(function(day) {
        // 日期组头
        var head = summaryEl('div', 'summary-text');
        head.style.cssText = 'font-weight:600; color:var(--accent); font-size:13px; margin:12px 0 6px; border-bottom:1px dashed var(--border); padding-bottom:4px;';
        head.textContent = '📅 ' + day.date + ' (' + day.snaps.length + ' 个时刻)';
        frag.appendChild(head);

        day.snaps.forEach(function(item) {
            var row = summaryEl('div', 'summary-history-row');
            row.style.cssText = 'display:flex; align-items:flex-start; gap:12px; padding:8px 12px; background:var(--panel2); border:1px solid var(--border); border-radius:8px; margin-bottom:6px; cursor:pointer;';
            row.addEventListener('click', function() { viewSummaryHistory(item.date, item.time || ''); });

            // 左侧: 时刻 + AI/规则徽章
            var left = summaryEl('div');
            var timeEl = summaryEl('div', '', item.time || '全天');
            timeEl.style.cssText = 'font-weight:600; color:var(--text); font-size:13px; min-width:44px;';
            left.appendChild(timeEl);
            var badgeColor = item.aiFailed ? 'var(--yellow)' : 'var(--green)';
            var badge = summaryEl('span', '', item.aiFailed ? '规则版' : 'AI版');
            badge.style.cssText = 'display:inline-block; padding:0 8px; border-radius:10px; font-size:11px; margin-top:3px; background:' + badgeColor + '22; color:' + badgeColor + '; border:1px solid ' + badgeColor + '55;';
            left.appendChild(badge);
            row.appendChild(left);

            // 右侧: 总体状态概览 + 统计
            var right = summaryEl('div');
            right.style.cssText = 'flex:1; min-width:0;';
            if (item.overview) {
                var ov = summaryEl('div', 'summary-text muted-hint', item.overview);
                ov.style.cssText = 'font-size:12px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;';
                right.appendChild(ov);
            } else {
                right.appendChild(summaryEl('div', 'muted-hint', '(无AI总结，仅规则版数据)'));
            }
            var meta = 'Domain ' + item.counts.domains + ' · Critical ' + item.counts.criticalBugs + ' · Bug ' + item.counts.allBugs + ' · 准出 ' + item.counts.criteriaPass + '/' + item.counts.criteriaTotal;
            if (item.updatedAt) meta += ' · 更新 ' + String(item.updatedAt).split('T')[0];
            var metaEl = summaryEl('div', 'muted-hint', meta);
            metaEl.style.cssText = 'font-size:11px; color:var(--muted); margin-top:4px;';
            right.appendChild(metaEl);
            row.appendChild(right);

            row.appendChild(summaryEl('span', '', '查看 →'));
            frag.appendChild(row);
        });
    });

    container.appendChild(frag);
}

// 查看某天某个时刻的历史快照: 拉取该日全部快照 → 定位 time → 复用 AI总结/数据明细 渲染
async function viewSummaryHistory(date, time) {
    var contentEl = document.getElementById('daily-summary-content');
    if (!contentEl) return;
    contentEl.innerHTML = '<div style="color: var(--muted); font-size: 14px; padding: 30px; text-align:center;">⏳ 加载 ' + summaryEscapeHtml(date) + (time ? ' ' + summaryEscapeHtml(time) : '') + ' 总结...</div>';
    try {
        var res = await apiCall('/api/data/daily-summary/history/' + encodeURIComponent(date) + '?project=' + encodeURIComponent(App.currentProject), { cache: 'no-store' });
        if (!res || !res.success) throw new Error((res && res.error) || '加载失败');
        var snaps = res.items || [];
        var item = snaps.find(function(s) { return (s.time || '') === (time || ''); }) || snaps[snaps.length - 1];
        window._summaryResult = { success: true, date: item.date, time: item.time || '', skeleton: item.skeleton, ai: item.ai, aiFailed: item.aiFailed };
        var st = document.getElementById('daily-summary-status');
        if (st) {
            st.textContent = '📅 查看历史快照: ' + item.date + (item.time ? ' ' + item.time : ' 全天') + (item.aiFailed ? ' (规则版)' : '');
            st.style.color = 'var(--accent)';
        }
        if (item.aiFailed || !item.ai) switchSummaryTab('data');
        else switchSummaryTab('ai');
    } catch (err) {
        console.error('[DailySummary] history view error:', err);
        contentEl.innerHTML = '<div style="color: var(--red); font-size: 14px; padding: 30px; text-align:center;">加载失败: ' + summaryEscapeHtml(err.message) + '</div>';
    }
}
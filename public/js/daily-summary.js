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

// 打开总结弹窗
function openDailySummaryModal() {
    var modal = document.getElementById('daily-summary-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    // 默认今天
    document.getElementById('daily-summary-date').value = summaryTodayStr();
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
    var content = document.getElementById('daily-summary-content');
    // 重新按当前 tab 渲染
    if (tab === 'ai' && window._summaryResult) renderSummaryAI(window._summaryResult);
    else if (tab === 'data' && window._summaryResult) renderSummaryData(window._summaryResult);
}

// 生成总结
async function generateDailySummary() {
    var date = document.getElementById('daily-summary-date').value;
    var statusEl = document.getElementById('daily-summary-status');
    var contentEl = document.getElementById('daily-summary-content');
    var genBtn = document.getElementById('daily-summary-gen-btn');

    if (!date) { statusEl.textContent = '请选择日期'; return; }
    statusEl.textContent = '生成中... (LLM润色约需5-15秒)';
    statusEl.style.color = 'var(--muted)';
    genBtn.disabled = true;
    contentEl.innerHTML = '<div style="color: var(--muted); font-size: 14px; padding: 30px; text-align:center;">⏳ 正在生成总结，请稍候...</div>';

    try {
        var result = await apiCall('/api/data/daily-summary?project=' + encodeURIComponent(App.currentProject), {
            method: 'POST',
            body: JSON.stringify({ projectId: App.currentProject, date: date }),
            cache: 'no-store'
        });

        if (!result || !result.success) {
            throw new Error((result && result.error) || '生成失败');
        }

        window._summaryResult = result;
        statusEl.textContent = result.aiFailed ? '⚠ LLM润色失败，显示规则版数据明细' : '✓ 生成完成';
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
    L.push('# ' + projectName + ' Daily Bring-up 状态总结 — ' + skel.date + timeline);
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
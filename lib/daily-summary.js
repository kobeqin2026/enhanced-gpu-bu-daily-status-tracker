// Daily Bring-up Status Summary — 规则骨架生成器
// 方案C: 规则层先生成结构化事实骨架(保证准确), 再由 LLM 润色成日报文字。
// 纯规则、无副作用, 可在后端复用。

// Severity 归一化 (与前端 bugs.js 一致)
function normalizeSeverity(sev) {
    if (!sev) return '';
    var s = String(sev).toLowerCase().trim();
    var map = {
        'p0': 'highest', 'p1': 'high', 'p2': 'medium', 'p3': 'low', 'p4': 'lowest',
        'blocker': 'highest', 'critical': 'highest', 'urgent': 'highest',
        'highest': 'highest', 'high': 'high', 'medium': 'medium', 'low': 'low', 'lowest': 'lowest'
    };
    return map[s] || s;
}

function isCriticalBug(bug) {
    var n = normalizeSeverity(bug.severity);
    return (n === 'highest' || n === 'high');
}

// status 中文文案
function statusLabel(status) {
    var map = {
        'not-started': '未开始', 'in-progress': '进行中', 'blocked': '受阻', 'completed': '已完成',
        'open': '未解决', 'implement': '实现中', 'closed': '已关闭', 'rejected': '已拒绝',
        'pass': '通过', 'not-ready': '未就绪', 'fail': '不通过', 'waiver': '豁免'
    };
    return map[status] || status || '未知';
}

// 构建规则骨架
// @param {Object} data - loadProjectData 结果 {domains, bugs, dailyProgress, buExitCriteria, lastUpdated}
// @param {string} date - 'YYYY-MM-DD'，要总结的日期
// @param {Object} projectInfo - {name, description, startDate, endDate}
// @param {string} [time] - 'HH:MM' 可选，同一天多次更新时按"截至该时刻"取快照；缺省 = 全天
// @returns {Object} skeleton
function buildDailySkeleton(data, date, projectInfo, time) {
    var domains = Array.isArray(data.domains) ? data.domains : [];
    var bugs = Array.isArray(data.bugs) ? data.bugs : [];
    var progress = Array.isArray(data.dailyProgress) ? data.dailyProgress : [];
    var criteria = Array.isArray(data.buExitCriteria) ? data.buExitCriteria : [];
    var snapshotTime = time || '';

    // 记录是否在快照时刻(含)之前: 老记录无 time → 视为当天全天有效
    function isBeforeSnapshot(p) {
        if (!snapshotTime) return true;
        if ((p.date || '') < date) return true;
        if ((p.date || '') > date) return false;
        if (!p.time) return true;          // 同一天无时刻的记录 = 整天有效
        return p.time <= snapshotTime;     // 'HH:MM' 字典序比较
    }

    // BU 时间轴: 只统计 BU执行时间 (projectInfo.startDate~endDate) 内的 bug, 与前端 Bug 表口径一致
    var buStart = (projectInfo && projectInfo.startDate) || '';
    var buEnd = (projectInfo && projectInfo.endDate) || '';
    bugs = bugs.filter(function(b) {
        if (!buStart || !buEnd) return true; // 未设置BU时间 → 全部统计 (兼容老项目)
        var d = b.reportDate || '';
        if (!d) return true;                 // 缺日期保留
        return d >= buStart && d <= buEnd;   // YYYY-MM-DD 字典序比较
    });

    // 该日期截至快照时刻的所有进度记录 (同一 domain 可能多条, 保留全部)
    var dayProgress = progress.filter(function(p) {
        if ((p.date || '') !== date) return false;
        return isBeforeSnapshot(p);
    });
    // 所有日期(去重降序), 用于"最近有记录的日期"提示
    var allDates = [];
    progress.forEach(function(p) {
        if (p.date && allDates.indexOf(p.date) === -1) allDates.push(p.date);
    });
    allDates.sort(function(a, b) { return b < a ? -1 : (b > a ? 1 : 0); });

    // 1. 每 domain 当天状态
    var domainSummaries = domains.map(function(d) {
        var recs = dayProgress.filter(function(p) { return (p.domain || '') === d.name; });
        // 该 domain 截至快照时刻最近一次进度记录 (同日按 time 取最新, 无 time 视为 23:59 前的全天记录)
        var latest = null;
        progress.filter(function(p) {
            return (p.domain || '') === d.name && isBeforeSnapshot(p);
        }).forEach(function(p) {
            var key = (p.date || '') + '|' + (p.time || '23:59');
            if (!latest || key > ((latest.date || '') + '|' + (latest.time || '23:59'))) latest = p;
        });
        return {
            name: d.name,
            owner: d.owner || '',
            status: d.status || 'not-started',
            statusLabel: statusLabel(d.status),
            startDate: d.startDate || '',
            endDate: d.endDate || '',
            notes: d.notes || '',
            dayProgress: recs.map(function(p) {
                return {
                    date: p.date, time: p.time || '', owner: p.owner || '',
                    workDone: p.workDone || p.content || '',
                    nextSteps: p.nextSteps || '',
                    blockers: p.blockers || ''
                };
            }).sort(function(a, b) { return a.time < b.time ? -1 : (a.time > b.time ? 1 : 0); }),
            latestProgress: latest ? { date: latest.date, time: latest.time || '', workDone: latest.workDone || latest.content || '', nextSteps: latest.nextSteps || '' } : null
        };
    });
    // 记录了但不在 domains 里的 domain 也补上(防止漏)
    dayProgress.forEach(function(p) {
        if (p.domain && !domainSummaries.some(function(d) { return d.name === p.domain; })) {
            domainSummaries.push({
                name: p.domain, owner: p.owner || '', status: 'in-progress', statusLabel: '进行中', notes: '',
                dayProgress: [{ date: p.date, time: p.time || '', owner: p.owner || '', workDone: p.workDone || p.content || '', nextSteps: p.nextSteps || '', blockers: p.blockers || '' }],
                latestProgress: { date: p.date, time: p.time || '', workDone: p.workDone || p.content || '', nextSteps: p.nextSteps || '' }
            });
        }
    });

    // 2. BU准出标准
    var criteriaItems = criteria.map(function(c) {
        return {
            domain: c.domain || '', index: c.index || '',
            criteria: c.criteria || '', signoffOwner: c.signoffOwner || c.owner || '',
            status: c.status || 'not-ready', statusLabel: statusLabel(c.status || 'not-ready')
        };
    });
    var passCount = criteriaItems.filter(function(c) { return c.status === 'pass'; }).length;
    var failCount = criteriaItems.filter(function(c) { return c.status === 'fail'; }).length;
    var waiverCount = criteriaItems.filter(function(c) { return c.status === 'waiver'; }).length;
    var notReadyCount = criteriaItems.filter(function(c) { return c.status !== 'pass' && c.status !== 'fail' && c.status !== 'waiver'; }).length;
    var criteriaInfo = {
        total: criteriaItems.length,
        pass: passCount, fail: failCount, notReady: notReadyCount, waiver: waiverCount,
        allPass: criteriaItems.length > 0 && failCount === 0 && notReadyCount === 0,
        items: criteriaItems
    };

    // 3. Critical bugs (highest/high) + debug progress
    var criticalBugs = bugs.filter(isCriticalBug).map(function(b) {
        return {
            bugId: b.bugId || b.jiraKey || b.id, domain: b.domain || 'TBD',
            severity: b.severity, status: b.status, statusLabel: statusLabel(b.status),
            owner: b.owner || '', reportDate: b.reportDate || '',
            debugProgress: b.debugProgress || '', debugProgressSource: b.debugProgressSource || '',
            debugProgressUpdatedAt: b.debugProgressUpdatedAt || '', jiraUrl: b.jiraUrl || ''
        };
    });

    // 4. 全部 bugs
    var allBugs = bugs.map(function(b) {
        return {
            bugId: b.bugId || b.jiraKey || b.id, domain: b.domain || 'TBD',
            severity: b.severity, status: b.status, statusLabel: statusLabel(b.status),
            owner: b.owner || '', reportDate: b.reportDate || '', jiraUrl: b.jiraUrl || '',
            debugProgress: b.debugProgress || ''
        };
    });
    allBugs.sort(function(a, b) {
        var pa = normalizeSeverity(a.severity), pb = normalizeSeverity(b.severity);
        var pri = { 'highest': 0, 'high': 1, 'medium': 2, 'low': 3, 'lowest': 4 };
        var va = pri[pa] !== undefined ? pri[pa] : 5;
        var vb = pri[pb] !== undefined ? pri[pb] : 5;
        return va - vb;
    });

    return {
        date: date,
        time: snapshotTime,
        project: projectInfo || {},
        availableDates: allDates,
        domainSummaries: domainSummaries,
        criteria: criteriaInfo,
        criticalBugs: criticalBugs,
        allBugs: allBugs,
        lastUpdated: data.lastUpdated || ''
    };
}

// 把骨架转成给 LLM 的紧凑文本 (截断过长字段, 防 token 爆)
function skeletonToText(skel, maxBugProgressLen) {
    maxBugProgressLen = maxBugProgressLen || 120;
    var lines = [];
    lines.push('项目: ' + (skel.project.name || ''));
    if (skel.project.startDate) {
        lines.push('BU执行时间: ' + (skel.project.startDate || '') + ' ~ ' + (skel.project.endDate || ''));
    }
    lines.push('总结日期: ' + skel.date);
    lines.push('');
    lines.push('【Domain 当天状态】');
    skel.domainSummaries.forEach(function(d) {
        lines.push('- ' + d.name + ' (owner:' + (d.owner || '无') + ', domain状态:' + d.statusLabel +
        (d.startDate || d.endDate ? ', 执行: ' + (d.startDate || '?') + ' ~ ' + (d.endDate || '?') : '') + ')');
        if (d.dayProgress && d.dayProgress.length) {
            d.dayProgress.forEach(function(p) {
                if (p.workDone) lines.push('  今日完成: ' + p.workDone.substring(0, 200));
                if (p.nextSteps) lines.push('  下一步: ' + p.nextSteps.substring(0, 150));
                if (p.blockers) lines.push('  阻塞: ' + p.blockers.substring(0, 150));
            });
        } else {
            lines.push('  今日无进度记录' + (d.latestProgress ? '(最近记录 ' + d.latestProgress.date + ': ' + (d.latestProgress.workDone || '').substring(0, 100) + ')' : ''));
        }
    });
    lines.push('');
    lines.push('【BU准出标准】共' + skel.criteria.total + '条: 通过' + skel.criteria.pass + ' / 不通过' + skel.criteria.fail + ' / 豁免' + skel.criteria.waiver + ' / 未就绪' + skel.criteria.notReady +
        (skel.criteria.total === 0 ? '(未配置)' : (skel.criteria.allPass ? ' → 全部通过,符合准出' : ' → 未全部通过')));
    skel.criteria.items.forEach(function(c) {
        lines.push('- [' + c.statusLabel + '] ' + c.domain + ' — ' + c.criteria.substring(0, 100) + ' (签核:' + (c.signoffOwner || '无') + ')');
    });
    lines.push('');
    lines.push('【Critical Bug (highest/high) 共' + skel.criticalBugs.length + '】');
    if (skel.criticalBugs.length === 0) {
        lines.push('- 无');
    }
    skel.criticalBugs.forEach(function(b) {
        lines.push('- ' + b.bugId + ' [' + b.domain + '] ' + (b.debugProgress ? '调试进展: ' + b.debugProgress.substring(0, maxBugProgressLen) : '(暂无调试进展)'));
    });
    lines.push('');
    lines.push('【全部Bug 共' + skel.allBugs.length + '】');
    skel.allBugs.forEach(function(b) {
        lines.push('- ' + b.bugId + ' [' + b.domain + '] severity=' + b.severity + ' status=' + b.statusLabel + ' owner=' + (b.owner || '-') + ' report=' + (b.reportDate || '-'));
    });
    return lines.join('\n');
}

// BU 第 N 天: 从项目 BU 开始日算起, 返回 'BU 第 N 天' 或 ''
// 与前端 daily-summary.js 的 buDayOf 保持一致
function buDayOf(date, project) {
    if (!project || !project.startDate || !date) return '';
    var s0 = new Date(String(project.startDate).slice(0, 10) + 'T00:00:00');
    var t0 = new Date(String(date).slice(0, 10) + 'T00:00:00');
    if (isNaN(s0.getTime()) || isNaN(t0.getTime())) return '';
    var diff = Math.round((t0.getTime() - s0.getTime()) / 86400000) + 1;
    return diff >= 1 ? 'BU 第 ' + diff + ' 天' : '';
}

// 渲染"前日增量"邮件正文 Markdown (服务端单一来源; 复刻前端 buildDaySummaryMarkdown 结构)
// 供后端 daily-summary/mail-export 与每日定时落盘复用, 避免前后端两份渲染漂移。
// @param {string} date - 'YYYY-MM-DD' 要归纳的日期(前日)
// @param {Array} snapshots - [{time, aiFailed, overall}] 该日历史快照索引
// @param {Object} summary - summarizeDayInternal 的 summary {dayOverview, highlights[], risks[], nextSteps[], perDomains[], derived}
// @param {boolean} aiFailed - LLM 是否降级
// @param {Object} skeleton - buildDailySkeleton 产物 (project/domainSummaries/criteria/criticalBugs/allBugs)
// @param {Function} [domainKeyFn] - criteria 域名别名归一函数 (如 routes 的 domainKeyOf)
function renderDaySummaryMarkdown(date, snapshots, summary, aiFailed, skeleton, domainKeyFn) {
    summary = summary || {};
    var derived = summary.derived || {};
    var project = (skeleton && skeleton.project) || {};
    var projectName = project.name || '';
    var timeline = (project.startDate) ? (' (BU: ' + project.startDate + ' ~ ' + (project.endDate || '-') + ')') : '';
    var buDay = buDayOf(date, project);
    var L = [];
    L.push('# ' + projectName + ' Daily Bring-up 状态总结 — ' + date + ' 前日增量汇总' + (buDay ? '（' + buDay + '）' : '') + timeline);
    L.push('');
    L.push('> ' + (aiFailed ? '⚠ 规则降级版（LLM归纳失败，基于实时数据）' : '✨ AI 归纳') +
        ' ｜ 前日增量 ｜ 历史快照 ' + (snapshots.length ? snapshots.length + ' 个' : '0 个（该日尚未生成总结快照，基于当前实时数据归纳）') +
        (snapshots.length ? '：' + snapshots.map(function(s) { return s.time; }).join(' / ') : ''));
    L.push('');

    // 1. 当天整体进展
    L.push('## 📌 当天整体进展');
    L.push(summary.dayOverview || derived.lastOverall || '无');
    L.push('');

    // 2. 主要进展
    L.push('## 🚀 主要进展');
    var hs = (summary.highlights && summary.highlights.length) ? summary.highlights : [];
    if (!hs.length) L.push('- 无');
    hs.forEach(function(h) { L.push('- ' + h); });
    L.push('');

    // 3. 风险与阻塞
    L.push('## ⚠️ 风险与阻塞');
    var rs = (summary.risks && summary.risks.length) ? summary.risks : [];
    if (!rs.length) L.push('- 无');
    rs.forEach(function(r) { L.push('- ' + r); });
    L.push('');

    // 4. 各 Domain 全天动态 (LLM perDomains 优先; 空则用骨架 dayProgress 规则压缩, 不逐条复制)
    var domSummaries = (skeleton && skeleton.domainSummaries) || [];
    function domInfo(nm) {
        for (var i = 0; i < domSummaries.length; i++) if (String(domSummaries[i].name).trim() === String(nm).trim()) return domSummaries[i];
        return null;
    }
    L.push('## 📋 各 Domain 全天动态');
    var perDomains = (summary && summary.perDomains) || [];
    if (perDomains.length) {
        perDomains.forEach(function(pd) {
            var dm = domInfo(pd.domain);
            L.push('### ' + pd.domain + (dm ? ' (' + (dm.owner || '无') + (dm.statusLabel ? ', ' + dm.statusLabel : '') + ')' : ''));
            L.push('- ' + (pd.summary || ''));
        });
    } else {
        var ordered = {};
        domSummaries.forEach(function(dm) {
            if (dm.dayProgress && dm.dayProgress.length) {
                var parts = dm.dayProgress.map(function(p) {
                    var s = (p.time ? p.time + ' ' : '') + p.workDone;
                    if (p.nextSteps) s += '(下一步:' + p.nextSteps + ')';
                    if (p.blockers) s += '(阻塞:' + p.blockers + ')';
                    return s;
                });
                ordered[dm.name] = { dm: dm, line: parts.join('；') };
            }
        });
        var names = Object.keys(ordered);
        if (!names.length) L.push('- 当天各Domain均无进度记录');
        names.forEach(function(nm) {
            var o = ordered[nm];
            L.push('### ' + nm + ' (' + (o.dm.owner || '无') + ', ' + o.dm.statusLabel + (o.dm.startDate || o.dm.endDate ? ', 执行: ' + (o.dm.startDate || '?') + ' ~ ' + (o.dm.endDate || '?') : '') + ')');
            L.push('- ' + o.line);
        });
    }
    L.push('');

    // 5. BU准出标准 (仅文字总结 — 明细列表用户以截图形式添加, 不再渲染表格)
    var crit = (skeleton && skeleton.criteria) ? skeleton.criteria : { total: 0, pass: 0, fail: 0, notReady: 0, allPass: false, items: [] };
    L.push('## ✅ BU准出标准 (' + (derived.totalDomains || 0) + ' 个域, ' + (derived.activeDomains || 0) + ' 个有进度)');
    if (crit.total === 0) {
        L.push('- 未配置BU准出标准');
    } else {
        var verdict = crit.allPass ? '全部通过 ✅' : '未全部通过';
        L.push('- 共 ' + crit.total + ' 条：通过 ' + crit.pass + ' / 不通过 ' + crit.fail + ' / 未就绪 ' + crit.notReady + ' → ' + verdict);
        var allFails = [];
        var dkf = (typeof domainKeyFn === 'function') ? domainKeyFn : function(s) { return String(s || '').trim(); };
        (crit.items || []).forEach(function(c) {
            var st = String(c.status || '').toLowerCase();
            if (st === 'fail') allFails.push((dkf(c.domain) || '') + ': ' + (c.criteria || c.name || ''));
        });
        if (allFails.length) {
            L.push('- ⚠ 未通过项(' + allFails.length + '): ' + allFails.join('；'));
        }
        L.push('');
        L.push('> 📎 明细判定表已省略，请在邮件中以截图形式附上各 Domain 准出明细。');
    }
    L.push('');

    // 6. Critical Bug (骨架已按 BU 周期过滤; 再排除已关闭)
    function isClosedBug(b) {
        var st = String((b && (b.status || b.statusLabel)) || '').toLowerCase();
        return st === 'closed' || st === '已关闭' || st === 'close' || st === 'resolved';
    }
    L.push('## 🔥 Critical Bug（BU 时间轴内，未关闭）');
    var cb = ((skeleton && skeleton.criticalBugs) || []).filter(function(b) { return !isClosedBug(b); });
    if (!cb.length) L.push('- 无');
    cb.forEach(function(b) {
        L.push('- **' + (b.bugId || '-') + '** [' + (b.domain || 'TBD') + '] ' + (b.statusLabel || b.status || '') + (b.owner ? ' / ' + b.owner : '') + (b.debugProgress ? ' — ' + b.debugProgress : ''));
    });
    L.push('');

    // 6.5 完整 Bug List
    var allBugs = (skeleton && skeleton.allBugs) || [];
    L.push('## 🐛 Bug List (全部 ' + allBugs.length + ' 条)');
    if (!allBugs.length) {
        L.push('- 无');
    } else {
        L.push('| Bug ID | Domain | Severity | Status | Owner |');
        L.push('| --- | --- | --- | --- | --- |');
        allBugs.forEach(function(b) {
            L.push('| ' + (b.bugId || '-') + ' | ' + (b.domain || 'TBD') + ' | ' + (b.severity || '-') + ' | ' + (b.statusLabel || b.status || '-') + ' | ' + (b.owner || '-') + ' |');
        });
    }
    L.push('');

    // 7. 快照索引
    L.push('## ⏱ 历史快照索引');
    if (!snapshots.length) L.push('- 该日暂无历史总结快照（可先"生成总结"存档，导出时会附上各时刻概览）');
    snapshots.forEach(function(s) {
        var badge = s.aiFailed ? '规则版' : 'AI版';
        L.push('- **' + s.time + '** [' + badge + ']' + (s.overall ? ': ' + s.overall : ''));
    });
    L.push('');
    return L.join('\n');
}

module.exports = {
    buildDailySkeleton: buildDailySkeleton,
    skeletonToText: skeletonToText,
    normalizeSeverity: normalizeSeverity,
    isCriticalBug: isCriticalBug,
    statusLabel: statusLabel,
    buDayOf: buDayOf,
    renderDaySummaryMarkdown: renderDaySummaryMarkdown
};
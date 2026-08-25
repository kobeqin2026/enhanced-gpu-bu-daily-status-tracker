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
        'pass': '通过', 'not-ready': '未就绪', 'fail': '不通过'
    };
    return map[status] || status || '未知';
}

// 构建规则骨架
// @param {Object} data - loadProjectData 结果 {domains, bugs, dailyProgress, buExitCriteria, lastUpdated}
// @param {string} date - 'YYYY-MM-DD'，要总结的日期
// @param {Object} projectInfo - {name, description, startDate, endDate}
// @returns {Object} skeleton
function buildDailySkeleton(data, date, projectInfo) {
    var domains = Array.isArray(data.domains) ? data.domains : [];
    var bugs = Array.isArray(data.bugs) ? data.bugs : [];
    var progress = Array.isArray(data.dailyProgress) ? data.dailyProgress : [];
    var criteria = Array.isArray(data.buExitCriteria) ? data.buExitCriteria : [];

    // BU 时间轴: 只统计 BU执行时间 (projectInfo.startDate~endDate) 内的 bug, 与前端 Bug 表口径一致
    var buStart = (projectInfo && projectInfo.startDate) || '';
    var buEnd = (projectInfo && projectInfo.endDate) || '';
    bugs = bugs.filter(function(b) {
        if (!buStart || !buEnd) return true; // 未设置BU时间 → 全部统计 (兼容老项目)
        var d = b.reportDate || '';
        if (!d) return true;                 // 缺日期保留
        return d >= buStart && d <= buEnd;   // YYYY-MM-DD 字典序比较
    });

    // 该日期所有进度记录 (同一 domain 可能多条, 保留全部)
    var dayProgress = progress.filter(function(p) { return (p.date || '') === date; });
    // 所有日期(去重降序), 用于"最近有记录的日期"提示
    var allDates = [];
    progress.forEach(function(p) {
        if (p.date && allDates.indexOf(p.date) === -1) allDates.push(p.date);
    });
    allDates.sort(function(a, b) { return b < a ? -1 : (b > a ? 1 : 0); });

    // 1. 每 domain 当天状态
    var domainSummaries = domains.map(function(d) {
        var recs = dayProgress.filter(function(p) { return (p.domain || '') === d.name; });
        // 该 domain 最近一次进度记录
        var latest = null;
        progress.filter(function(p) { return (p.domain || '') === d.name; }).forEach(function(p) {
            if (!latest || (p.date || '') > (latest.date || '')) latest = p;
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
                    date: p.date, owner: p.owner || '',
                    workDone: p.workDone || p.content || '',
                    nextSteps: p.nextSteps || '',
                    blockers: p.blockers || ''
                };
            }),
            latestProgress: latest ? { date: latest.date, workDone: latest.workDone || latest.content || '', nextSteps: latest.nextSteps || '' } : null
        };
    });
    // 记录了但不在 domains 里的 domain 也补上(防止漏)
    dayProgress.forEach(function(p) {
        if (p.domain && !domainSummaries.some(function(d) { return d.name === p.domain; })) {
            domainSummaries.push({
                name: p.domain, owner: p.owner || '', status: 'in-progress', statusLabel: '进行中', notes: '',
                dayProgress: [{ date: p.date, owner: p.owner || '', workDone: p.workDone || p.content || '', nextSteps: p.nextSteps || '', blockers: p.blockers || '' }],
                latestProgress: { date: p.date, workDone: p.workDone || p.content || '', nextSteps: p.nextSteps || '' }
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
    var notReadyCount = criteriaItems.filter(function(c) { return c.status !== 'pass' && c.status !== 'fail'; }).length;
    var criteriaInfo = {
        total: criteriaItems.length,
        pass: passCount, fail: failCount, notReady: notReadyCount,
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
    lines.push('【BU准出标准】共' + skel.criteria.total + '条: 通过' + skel.criteria.pass + ' / 不通过' + skel.criteria.fail + ' / 未就绪' + skel.criteria.notReady +
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

module.exports = {
    buildDailySkeleton: buildDailySkeleton,
    skeletonToText: skeletonToText,
    normalizeSeverity: normalizeSeverity,
    isCriticalBug: isCriticalBug,
    statusLabel: statusLabel
};
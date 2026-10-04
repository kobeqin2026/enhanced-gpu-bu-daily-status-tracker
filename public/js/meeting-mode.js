/* ============================================================
   Meeting Mode (会议投影模式) + Blocker Wall (阻塞墙)
   2026-09-04 — 替代BU同步会PPT: 阻塞墙开场 + 每域一页
   依赖全局: App, apiCall(data.js), buDayOf(daily-summary.js), CRITERIA_DOMAIN_MAP(bu-exit-criteria.js)
   ============================================================ */
var MMT = {
    open: false,
    date: '',
    slides: [],          // [{type:'wall'}, {type:'domain',...}]
    page: 0,
    overlay: null,
    content: null,
    dateInput: null,
    tc: undefined,       // 测试用例进度缓存 (undefined=未拉取, 'loading'=拉取中, null=失败, object=结果)
    keyHandler: null
};

// ---------- 基础工具 ----------
function mtEsc(s) {
    return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function mtEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
}
function mtToday() {
    var d = new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
}
function mtNorm(s) { return String(s || '').trim().toLowerCase().replace(/[\s\-\/]/g, ''); }
function mtDaysBetween(a, b) {
    if (!a || !b) return null;
    var t1 = new Date(String(a).slice(0, 10)).getTime();
    var t2 = new Date(String(b).slice(0, 10)).getTime();
    if (isNaN(t1) || isNaN(t2)) return null;
    return Math.round((t2 - t1) / 86400000);
}
function mtHasWord(text, word) {
    var t = String(text || '');
    var w = String(word || '');
    if (!w) return false;
    try {
        return new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(t);
    } catch (e) {
        return t.toLowerCase().indexOf(w.toLowerCase()) !== -1;
    }
}
var MT_STATUS_LABEL = { 'not-started': '未开始', 'in-progress': '进行中', 'blocked': '受阻', 'completed': '已完成' };
function mtStatusKind(s) { return s === 'completed' ? 'ok' : s === 'blocked' ? 'bad' : s === 'in-progress' ? 'warn' : ''; }
function mtBadge(text, kind) {
    var color = kind === 'ok' ? '#3ddc84' : kind === 'bad' ? '#ff5c5c' : kind === 'warn' ? '#ffc53d' : '#8b93a7';
    return '<span class="mt-badge" style="color:' + color + ';border-color:' + color + '55;background:' + color + '22;">' + mtEsc(text) + '</span>';
}
function mtLatest(recs) {
    if (!recs || !recs.length) return null;
    var r = recs[0];
    recs.forEach(function (p) {
        if ((p.date || '') > (r.date || '') || ((p.date || '') === (r.date || '') && (p.time || '') > (r.time || ''))) r = p;
    });
    return r;
}
function mtRecent(recs) {
    if (!recs || !recs.length) return [];
    return recs.slice().sort(function (a, b) {
        var ka = (a.date || '') + '|' + (a.time || '');
        var kb = (b.date || '') + '|' + (b.time || '');
        return ka < kb ? 1 : (ka > kb ? -1 : 0);
    });
}
// 域名(criteria侧) → 概览侧 key (走 CRITERIA_DOMAIN_MAP 别名)
function mtCriteriaKey(c) {
    var k = mtNorm(c.domain);
    if (typeof CRITERIA_DOMAIN_MAP !== 'undefined' && CRITERIA_DOMAIN_MAP && CRITERIA_DOMAIN_MAP[k]) k = mtNorm(CRITERIA_DOMAIN_MAP[k]);
    return k;
}
function mtBugDone(b) {
    var s = String(b.status || '').toLowerCase();
    return s.indexOf('done') !== -1 || s.indexOf('valid') !== -1 || s.indexOf('close') !== -1 || s.indexOf('resolve') !== -1;
}
function mtBugCritical(b) {
    var s = String(b.severity || '').toLowerCase();
    // 2026-09-30: 高优未关闭Bug 只统计真正 critical 级 (critical / highest 为最高级), 不再把 high 计入
    return s === 'critical' || s === 'highest';
}
// 高优未关闭Bug 展示口径 (2026-09-30): 同时满足 严重性为 critical 级 且 报告时间落在 BU 窗口内
function mtGetBuPeriod() {
    var p0 = (App.projectsList || []).find(function (p) { return p.id === App.currentProject; });
    return (p0 && p0.startDate && p0.endDate) ? { start: p0.startDate, end: p0.endDate } : null;
}
function mtIsHighBug(b, buPer) {
    if (!b) return false;
    if (!mtBugCritical(b) || mtBugDone(b)) return false;
    if (buPer) {
        var rb = String(b.reportDate || '').slice(0, 10);
        if (!rb || rb < buPer.start || rb > buPer.end) return false;
    }
    return true;
}

// ---------- 阻塞判定标准扩展 (2026-09-28) ----------
// 阻塞域不再只看 status=blocked:
//   ① status=blocked (原有)  ② 准出标准(buExitCriteria)有 fail  ③ 测试用例(testcase-progress)有 fail
// 阻塞记录不再只看 blockers 字段: 每日进度 content/nextSteps/debugInfo 中出现 fail/error 等关键字也算阻塞记录
var MT_BLOCK_KW = /\b(fail(ed|ure|ing|s)?|error(s)?|exception|crash|fatal|abort|timeout|hang(ing)?|reject(ed)?|mismatch|not\s*ok|lost|dropped|dead|broken|unresponsive|blocked)\b/i;
var MT_BLOCK_KW_CN = /失败|错误|异常|故障|超时|挂起|卡死|不通过|未通过|掉线|未达到|不达标|报错|挂了|挂掉|掉电|掉卡|死机|不通|丢失|无法|无效|识别不到|检测不到|未解决|待解决|需解决|还没解决|仍未解决|尚未解决|问题还在|没解决|仍存在|还存在|没通过|还没通过|尚未通过/;
// 已解决判定用"强解决词" (2026-09-30 v2 严格模式 优化): 明确"该测项已通过/恢复/解决"才标✅; 不含"正常"(避免把"单项功能正常"误判为已解决)
var MT_RESOLVE_KW = /(已解决|解决|修复|恢复|排除|不再|恢复正常|已恢复|没问题|无问题|无异常|通过|过了|pass|passed|done|已完成|resolved|fixed|recovered|no\s*issue|no\s*error)/i;
// 否定词(没有/没/未/不/否/no/not/without/none) + 基础阻塞词 → 该阻塞词被否定, 不命中(如"没有复现昨天的fail"=未复现=pass)
// 注意: "无法/无效/未通过/未达标/未解决/待解决/不通过/无异常"等短语由 MT_BLOCK_KW_CN 直接命中(肯定), 不经过否定处理
var MT_NEGATE_RE = /(?:没有|没|未|不|否|无|未再|不再|no\s|not\s|without\s|none)[^，。！？；;,.]{0,12}?(?:fail|failed|failure|failures|error|errors|exception|crash|fatal|abort|timeout|hang|hanging|reject|rejected|mismatch|lost|dropped|dead|broken|unresponsive|失败|错误|异常|故障|超时|挂起|卡死|报错|挂掉|死机|不通|丢失|掉电|掉卡)/i;
function mtHasBlockKeyword(text) {
    var t = String(text || '');
    if (!t) return false;
    // 先剔除被否定的阻塞片段, 再对剩余文本测阻塞关键字 → "没有复现fail/无报错/未复现error" 不误判为阻塞
    var s = t.replace(MT_NEGATE_RE, ' ');
    return MT_BLOCK_KW.test(s) || MT_BLOCK_KW_CN.test(s);
}
function mtHasResolveKeyword(text) {
    var t = String(text || '');
    if (!t) return false;
    // 必须命中"已解决/恢复"等强解决词, 且不含任何负向阻塞词(中文 MT_BLOCK_KW_CN 或 英文 MT_BLOCK_KW)。
    // 2026-10-01: 之前只排除中文阻塞词, 漏了英文——如 "jitter测试fail,增大vco电流后测试pass" 同时含 fail(阻塞)+pass(解决),
    // 会被误判为"含解决词(pass)=已解决"。现在同时排除英文阻塞词(fail/error/exception/...),
    // 使含 fail/error 等阻塞字的文本(即使带 pass)永不判为"已解决"。纯通过项如 "linkup pass" / "VCO Cal 过了"(无阻塞词)仍正常判已解决。
    return MT_RESOLVE_KW.test(t) && !MT_BLOCK_KW_CN.test(t) && !MT_BLOCK_KW.test(t);
}
// 阻塞记录只保留实际命中阻塞关键字的行 (如 UCIE 的 1~7 条 dump 只留 "linkup fail" 那条); 无任何命中行则整段回退, 不丢内容
function mtKeepBlockOnly(text) {
    if (!text) return text;
    var lines = String(text).split('\n');
    var kept = lines.filter(function (l) { return String(l).trim() && mtHasBlockKeyword(l); });
    return kept.length ? kept.join('\n') : text;
}
// 调试信息只保留"细节"条目: 排除命中阻塞关键字的行(如 linkup fail)与 pass/通过 等通过性说法(如 loopback pass);
// 剩下的是细节项(如 UCIE 的 VDDA 详情 3~6)。无细节项则返回空(不显示调试区)。
var MT_DETAIL_PASS_KW = /pass|passed|通过|通过了|过了|done|已完成|正常|ok\b/i;
function mtDebugDetail(text) {
    if (!text) return text;
    var lines = String(text).split('\n');
    var kept = lines.filter(function (l) {
        var t = String(l).trim();
        if (!t) return false;
        if (mtHasBlockKeyword(t)) return false;     // 阻塞项(如 linkup fail)不进调试信息
        if (MT_DETAIL_PASS_KW.test(t)) return false; // pass/通过 项(如 loopback pass)不进调试信息
        return true;                                 // 保留细节项(如 VDDA 详情)
    });
    return kept.length ? kept.join('\n') : '';
}
// 判定一条进度记录命中的阻塞来源: 优先 blockers 字段, 其次 content/nextSteps/debugInfo 中的关键字
function mtRecordBlockKind(p) {
    if (!p) return null;
    if (p.blockers && String(p.blockers).trim()) return { field: 'blockers', text: p.blockers };
    if (mtHasBlockKeyword(p.content)) return { field: 'content', text: p.content };
    if (mtHasBlockKeyword(p.nextSteps)) return { field: 'nextSteps', text: p.nextSteps };
    if (mtHasBlockKeyword(p.debugInfo)) return { field: 'debugInfo', text: p.debugInfo };
    return null;
}
// 域 → 准出标准中 fail 的条目 (无则 null)
function mtCriteriaFail(d) {
    var fs = mtCriteriaFor(d).filter(function (c) { return c.status === 'fail'; });
    return fs.length ? fs : null;
}
// 域 → 测试用例失败计数 (由Component 该域 fail>0 则返回 tc 对象, 否则 null)
function mtTcFail(d) {
    if (!MMT.tc || !MMT.tc.byComponent) return null;
    var tc = MMT.tc.byComponent[d.name];
    if (!tc || !tc.matched) return null;
    return (tc.fail || 0) > 0 ? tc : null;
}

// ---------- 数据准备 ----------
function mtBlockedInfo(d, recs) {
    if (d.status !== 'blocked') return null;
    var blockerRecs = (recs || []).filter(function (p) { return p.blockers && String(p.blockers).trim(); });
    var last = mtLatest(blockerRecs);
    var since = last ? (last.date + (last.time ? ' ' + last.time : '')) : (d.startDate || null);
    var today = MMT.date || mtToday();
    var days = since ? mtDaysBetween(String(since).slice(0, 10), today) : null;
    return {
        since: since,
        days: days !== null ? Math.max(1, days + 1) : null,
        reason: last ? last.blockers : null,
        cross: last ? mtCrossDeps(last.blockers, d.name) : [],
        rec: last
    };
}
function mtCrossDeps(text, selfName) {
    var out = [];
    var domains = (App.data && App.data.domains) || [];
    domains.forEach(function (d) {
        var n = d.name;
        if (!n || mtNorm(n) === mtNorm(selfName)) return;
        if (mtHasWord(text, n) && out.indexOf(n) === -1) out.push(n);
    });
    return out;
}
function mtCriteriaFor(d) {
    var k = mtNorm(d.name);
    return ((App.data.buExitCriteria) || []).filter(function (c) { return mtCriteriaKey(c) === k; });
}
function mtBugsFor(d) {
    var k = mtNorm(d.name);
    return ((App.data.bugs) || []).filter(function (b) { return mtNorm(b.domain) === k; });
}
function mtBuildSlides() {
    var doms = (App.data && App.data.domains) || [];
    var all = (App.data && App.data.dailyProgress) || [];
    var todayRecs = all.filter(function (p) { return p.date === MMT.date; });
    var todayBy = {}, allBy = {};
    todayRecs.forEach(function (p) { (todayBy[mtNorm(p.domain)] = todayBy[mtNorm(p.domain)] || []).push(p); });
    all.forEach(function (p) { (allBy[mtNorm(p.domain)] = allBy[mtNorm(p.domain)] || []).push(p); });
    var slides = [{ type: 'wall' }];
    var withT = [], withoutT = [];
    doms.forEach(function (d) {
        // 会议模式只显示"进行中"或"受阻(blocked)"的 domain: 排除已完成(前一天已完成的)与未开始 (用户 2026-10-04)
        // blocked 域须保留 —— 阻滞问题正是会议要讨论的(UCIE 等); 已完成/未开始不出现。
        var st = String(d.status || '').toLowerCase();
        if (st !== 'in-progress' && st !== 'blocked') return;
        var k = mtNorm(d.name);
        var today = todayBy[k] || [];
        today.sort(function (a, b) { return (a.time || '') < (b.time || '') ? -1 : 1; });
        allBy[k] = allBy[k] || [];
        var s = {
            type: 'domain',
            domain: d,
            today: today,
            latest: mtLatest(allBy[k]),
            recent: mtRecent(allBy[k]),
            criteria: mtCriteriaFor(d),
            bugs: mtBugsFor(d),
            blocked: mtBlockedInfo(d, allBy[k])
        };
        (today.length ? withT : withoutT).push(s);
    });
    withT.forEach(function (s) { slides.push(s); });
    withoutT.forEach(function (s) { slides.push(s); });
    MMT.slides = slides;
}
function mtFetchTC() {
    if (MMT.tc !== undefined) return;
    MMT.tc = 'loading';
    var url = '/api/data/testcase-progress?project=' + encodeURIComponent(App.currentProject || '');
    apiCall(url, { cache: 'no-store' })
        .then(function (r) { MMT.tc = r || null; mtRender(); })
        .catch(function () { MMT.tc = null; });
}

// ---------- 渲染 ----------
function mtRender() {
    if (!MMT.open || !MMT.content) return;
    var s = MMT.slides[MMT.page];
    MMT.content.innerHTML = '';
    if (!s) { MMT.content.appendChild(mtEl('div', 'mt-muted', '无数据')); return; }
    if (s.type === 'wall') mtRenderWall();
    else mtRenderDomain(s);
    var counter = document.getElementById('mt-page');
    if (counter) counter.textContent = (MMT.page + 1) + ' / ' + MMT.slides.length;
    MMT.content.scrollTop = 0;
}
// ===== 阻塞记录按条独立 (2026-10-01 v2: 拆分到"编号子项") =====
// 一条阻塞记录 = 一条 dailyProgress 记录里的"编号子项"(1，/2。/<index>) 中命中阻塞关键字的那条,
// 不再每条记录折叠成一条, 也不再每条记录整体算一条 —— 例如一条记录内容含 "1，...失败 2，...无法 3，...等待解决 4，...pass 5，...pass"
// 只把 1/2/3 各自作为独立阻塞记录, 4/5(pass) 不算. 适用于所有 domain.
function mtBlockRecordKey(p) {
    return p.id || (mtNorm(p.domain) + '|' + (p.date || '') + '|' + (p.time || ''));
}
// 拆"编号项": 与 fmtBlockText 同一套判定(编号前置字符是 数字/字母/汉字/换行/斜杠/横杠/等号/冒号 时不拆, 如 BU1/48/50/1.2s).
// 返回 [{key, text}]: key=编号数字串或 'P'+位置(无编号前导), 便于 per-sub-item 落库对位.
function mtSplitBlockItems(text) {
    var s = String(text || '').trim();
    if (!s) return [{ key: 'P0', text: '' }];
    var re = /(\d{1,2}[.、，,])(?![0-9])/g;
    var marks = [], m;
    while ((m = re.exec(s)) !== null) {
        var pre = s.charAt(m.index - 1);
        var isWord = /[0-9A-Za-z\u4e00-\u9fa5\r\n\/\-=:]/.test(pre);
        if (!isWord) marks.push({ start: m.index, num: String(m[0]).replace(/[^0-9]/g, '') });
    }
    if (!marks.length) return [{ key: 'P0', text: s }];
    var items = [], i;
    var preText = s.slice(0, marks[0].start).trim();
    if (preText) items.push({ key: 'P0', text: preText });   // 无编号的前导说明(若有)保留
    for (i = 0; i < marks.length; i++) {
        var st = marks[i].start;
        var en = (i + 1 < marks.length) ? marks[i + 1].start : s.length;
        var seg = s.slice(st, en).trim();
        if (seg) items.push({ key: marks[i].num || ('P' + (i + 1)), text: seg });
    }
    return items;
}
// 手动已解决(记录级) 或 子项级 或 兼容旧版域级 blockResolvedDate(回溯); 自动判定不再用于阻塞记录(避免误判)
function mtRecManualState(p, d, subKey) {
    if (p) {
        if (subKey) {
            if (p.blockResolve && p.blockResolve[subKey] && p.blockResolve[subKey].date) return p.blockResolve[subKey];
            if (p.blockResolvedDate) return { date: p.blockResolvedDate, by: p.blockResolvedBy || '' };
        } else if (p.blockResolvedDate) return { date: p.blockResolvedDate, by: p.blockResolvedBy || '' };
    }
    if (d && d.blockResolvedDate) return { date: d.blockResolvedDate, by: d.blockResolvedBy || '' };
    return null;
}
function mtWallData() {
    var domains = (App.data && App.data.domains) || [];
    var all = (App.data && App.data.dailyProgress) || [];
    var bugs = (App.data && App.data.bugs) || [];
    var today = MMT.date || mtToday();
    var buPer = mtGetBuPeriod();
    var blockedDomains = [];   // 阻塞域: status=blocked / 准出标准有fail / 测试用例有fail (域级别事实)
    var criticalBugs = [];     // 高优未关闭
    domains.forEach(function (d) {
        var recs = all.filter(function (p) { return mtNorm(p.domain) === mtNorm(d.name); });
        var statusInfo = mtBlockedInfo(d, recs);
        var critFail = mtCriteriaFail(d);
        var tcFail = mtTcFail(d);
        var types = [];
        if (statusInfo) types.push('status');
        if (critFail) types.push('criteria');
        if (tcFail) types.push('tc');
        if (!types.length) return;
        blockedDomains.push({ d: d, info: statusInfo, critFail: critFail, tcFail: tcFail, types: types });
    });
    // ===== 阻塞记录按"编号子项"独立 =====
    var blockRecords = [];
    all.forEach(function (p) {
        if (mtRecordBlockKind(p) === null) return;                                   // 该记录未命中阻塞关键字 → 非阻塞记录
        var k = mtNorm(p.domain);
        var d = null;
        domains.forEach(function (x) { if (mtNorm(x.name) === k) d = x; });
        if (!d) return;
        var ago = mtDaysBetween(p.date, today);
        if (ago === null || ago > 7) return;                                          // 仅近7天
        var kind = mtRecordBlockKind(p);
        var items = mtSplitBlockItems(kind.text);
        var blockItems = items.filter(function (it) { return mtHasBlockKeyword(it.text); });
        if (!blockItems.length) return;                                               // 拆分后无命中(如仅命中在无编号混杂) → 跳过
        // 阻塞记录不再自动判定"已解决"(会导致"最新pass→全部自动✅"的误判): resolved 只由手动拨码/历史解决决定.
        blockItems.forEach(function (it) {
            var manual = mtRecManualState(p, d, it.key);
            var resolved = !!(manual && manual.date);
            var resolvedDate = manual ? manual.date : null;
            blockRecords.push({
                d: d, p: p, subKey: it.key, text: it.text,
                kind: { field: kind.field, text: it.text },
                key: mtBlockRecordKey(p) + '#' + it.key,
                cross: mtCrossDeps(it.text, d.name),
                resolved: resolved, resolvedDate: resolvedDate, resolvedBy: (manual && manual.by) || ''
            });
        });
    });
    blockRecords.sort(function (a, b) { return (a.p.date + '|' + (a.p.time || '')) < (b.p.date + '|' + (b.p.time || '')) ? 1 : -1; });
    bugs.forEach(function (b) {
        if (!mtIsHighBug(b, buPer)) return;
        var days = b.reportDate ? mtDaysBetween(String(b.reportDate).slice(0, 10), today) : null;
        criticalBugs.push({ b: b, days: days });
    });
    var sevRank = { highest: 0, high: 1, critical: 2 };
    criticalBugs.sort(function (a, b) {
        var ra = sevRank[String(a.b.severity).toLowerCase()] !== undefined ? sevRank[String(a.b.severity).toLowerCase()] : 9;
        var rb = sevRank[String(b.b.severity).toLowerCase()] !== undefined ? sevRank[String(b.b.severity).toLowerCase()] : 9;
        if (ra !== rb) return ra - rb;
        return (a.days === null ? -1 : a.days) > (b.days === null ? -1 : b.days) ? -1 : 1;
    });
    return { blockedDomains: blockedDomains, blockRecords: blockRecords, criticalBugs: criticalBugs };
}
function mtRenderAttach(p, box) {
    var atts = (p && p.attachments) || [];
    atts.forEach(function(a) {
        if (a.type === 'image' && a.url) {
            var img = document.createElement('img');
            img.className = 'mt-attach-img';
            img.src = a.url;
            img.title = a.name || '截图';
            img.onclick = function() { showImageViewer(a.url, a.name); };
            box.appendChild(img);
        } else if (a.type === 'link' && a.url) {
            var link = document.createElement('a');
            link.className = 'mt-attach-link';
            link.href = a.url;
            link.target = '_blank';
            link.textContent = '🔗 ' + (a.name || a.url);
            box.appendChild(link);
        }
    });
    if (p && p.debugInfo && String(p.debugInfo).trim()) {
        var detail = mtDebugDetail(fmtBlockText(p.debugInfo, true, p.domain));
        if (detail && String(detail).trim()) {
            var det = document.createElement('details');
            det.className = 'mt-debug-details';
            var sum = document.createElement('summary');
            sum.textContent = '🔬 调试信息';
            det.appendChild(sum);
            var pre = document.createElement('pre');
            pre.textContent = detail;
            det.appendChild(pre);
            box.appendChild(det);
        }
    }
}
// ===== 拨码切换阻塞记录 未解决/已解决 (2026-09-30; 2026-10-01 改为按条独立) =====
// 会议会话内的临时拨码状态, 退出会议时统一落库保存:
//   mtResolveMode['<domainName>']       → 域级(阻塞域 status)开关; 落库到 domain.blockResolvedDate/by
//   mtResolveMode['rec:<recordKey>']    → 记录级(该条阻塞记录)开关; 落库到 dailyProgress.blockResolvedDate/by
var mtResolveMode = {};
function mtResolveState(domain) {
    if (!domain) return false;
    if (mtResolveMode.hasOwnProperty(domain.name)) return mtResolveMode[domain.name];
    return !!domain.blockResolvedDate;   // 已有持久化已解决(如今天点过/历史) → 显示已解决
}
function mtToggleResolve(domainName) {
    var d = (App.data.domains || []).find(function (x) { return x.name === domainName; });
    if (!d) return;
    mtResolveMode[domainName] = !mtResolveState(d);
    if (typeof mtRender === 'function') mtRender();
}
function mtResolveToggle(domainName) {
    var d = (App.data.domains || []).find(function (x) { return x.name === domainName; });
    var on = mtResolveState(d);
    var wrap = mtEl('div', 'mt-resolve-toggle' + (on ? ' mt-resolve-on' : ''));
    var sw = mtEl('button', 'mt-switch' + (on ? ' on' : ''));
    sw.setAttribute('role', 'switch');
    var knob = mtEl('span', 'mt-switch-knob');
    sw.appendChild(knob);
    var label = mtEl('span', 'mt-switch-label', on ? '已解决' : '未解决');
    sw.onclick = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); mtToggleResolve(domainName); };
    wrap.appendChild(sw); wrap.appendChild(label);
    return wrap;
}
// 记录级: 该条阻塞记录当前是否"已解决" (session 拨码优先, 否则用墙内算好的 resolved)
function mtRecResolved(it) {
    var key = 'rec:' + it.key;
    if (mtResolveMode.hasOwnProperty(key)) return mtResolveMode[key];
    return !!(it && it.resolved);
}
function mtToggleRecordResolve(it) {
    mtResolveMode['rec:' + it.key] = !mtRecResolved(it);
    if (typeof mtRender === 'function') mtRender();
}
function mtResolveToggleRecord(it) {
    var on = mtRecResolved(it);
    var wrap = mtEl('div', 'mt-resolve-toggle' + (on ? ' mt-resolve-on' : ''));
    var sw = mtEl('button', 'mt-switch' + (on ? ' on' : ''));
    sw.setAttribute('role', 'switch');
    var knob = mtEl('span', 'mt-switch-knob');
    sw.appendChild(knob);
    var label = mtEl('span', 'mt-switch-label', on ? '已解决' : '未解决');
    sw.onclick = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); mtToggleRecordResolve(it); };
    wrap.appendChild(sw); wrap.appendChild(label);
    return wrap;
}
// 一条阻塞记录/域是否处于"已解决": 有 key → 走记录级; 否则走域级(blockResolvedDate) 或 自动判定(it.resolved)
function mtIsRecResolved(it) {
    if (it && it.key) return mtRecResolved(it);
    if (it && it.d && it.d.blockResolvedDate) return true;
    if (it && it.resolved) return true;
    return false;
}
// 2026-10-02: 生效的解决信息 —— 判断"今天刚解决(留在当前栏旁标✅)" vs "隔一天以上(归档到阻塞已解决栏)"。
//   today=true → 解决日在今天(含会议会话内拨码, 尚未落库也视为今日) → 当前栏标✅; today=false → 早于今天 → 归档。
//   resolved 沿用会话拨码(优先)或持久化 blockResolvedDate。记录级 key='rec:'+it.key, 域级 key=domain.name。
function mtResolveInfo(it) {
    var today = MMT.date || mtToday();
    var isRec = !!(it && it.key);
    var key = isRec ? ('rec:' + it.key) : (it && it.d ? it.d.name : null);
    var sess = (key && mtResolveMode.hasOwnProperty(key)) ? mtResolveMode[key] : null;
    var date;
    if (sess === true) date = today;                             // 会话内拨码解决 → 视为今日解决
    else if (sess === false) date = null;                        // 会话内明确解除 → 未解决
    else date = isRec ? (it.resolvedDate || null)                // 记录/子项级持久化解决日
                      : (it && it.d ? (it.d.blockResolvedDate || null) : null);
    if (!date) return { resolved: false, date: null, today: false };
    return { resolved: true, date: date, today: (date >= today) };
}
// 按 key 解析 entry + subKey, 返回 {p, subKey} (记录级/子项级解决状态落库用)
// key 格式: '<entryKey>' 或 '<entryKey>#<subKey>'
function mtFindProgressByKey(key) {
    var hash = key.indexOf('#');
    var entryKey = hash >= 0 ? key.slice(0, hash) : key;
    var subKey = hash >= 0 ? key.slice(hash + 1) : null;
    var p = ((App.data && App.data.dailyProgress) || []).find(function (x) { return mtBlockRecordKey(x) === entryKey; }) || null;
    return { p: p, subKey: subKey };
}
// 退出会议: 把拨码状态落库保存 — 域级→domain.blockResolvedDate/by;
// 记录/子项级→dailyProgress.blockResolvedDate/by (子项) 或 blockResolve[subKey]={date,by} (编号子项)
function mtApplyResolveAndSave() {
    if (!mtResolveMode || !Object.keys(mtResolveMode).length) return;
    var today = MMT.date || mtToday();
    var user = (App.currentUserUsername || App.currentUser || '');
    var changed = false;
    Object.keys(mtResolveMode).forEach(function (key) {
        var on = mtResolveMode[key];
        if (key.indexOf('rec:') === 0) {
            var found = mtFindProgressByKey(key.slice(4));
            var p = found && found.p;
            if (!p) return;
            var subKey = found.subKey;
            if (subKey) {
                p.blockResolve = p.blockResolve || {};
                if (on) {
                    if (!p.blockResolve[subKey] || !p.blockResolve[subKey].date) { p.blockResolve[subKey] = { date: today, by: user }; changed = true; }
                } else if (p.blockResolve[subKey]) { delete p.blockResolve[subKey]; changed = true; }
            } else {
                if (on && !p.blockResolvedDate) { p.blockResolvedDate = today; p.blockResolvedBy = user; changed = true; }
                else if (!on && p.blockResolvedDate) { delete p.blockResolvedDate; delete p.blockResolvedBy; changed = true; }
            }
        } else {
            var d = (App.data.domains || []).find(function (x) { return x.name === key; });
            if (!d) return;
            if (on && !d.blockResolvedDate) { d.blockResolvedDate = today; d.blockResolvedBy = user; changed = true; }
            else if (!on && d.blockResolvedDate) { delete d.blockResolvedDate; delete d.blockResolvedBy; changed = true; }
        }
    });
    if (changed && typeof saveDataToAPI === 'function') saveDataToAPI();
}
function mtRenderWall() {
    var w = mtWallData();
    // 2026-10-02 分区(隔一天归档): 已解决且解决日早于今天(隔一天) → 归档到"阻塞已解决"栏;
    //   今天/会议会话内刚解决 → 留在当前栏仅在旁边标注✅; 未解决 → 当前栏+拨码开关。
    //   不再"今天解决也立刻进阻塞已解决"(用户 2026-10-02: toggle到已解决不要马上显示到已解决栏)。
    var resBlocked = [], actBlocked = [];
    w.blockedDomains.forEach(function (it) {
        var ri = mtResolveInfo(it);
        (ri.resolved && !ri.today ? resBlocked : actBlocked).push(it);
    });
    var resRec = [], actRec = [];
    w.blockRecords.forEach(function (it) {
        var ri = mtResolveInfo(it);
        (ri.resolved && !ri.today ? resRec : actRec).push(it);
    });
    var frag = document.createDocumentFragment();
    frag.appendChild(mtEl('div', 'mt-slide-title', '⛔ 阻塞墙'));
    frag.appendChild(mtEl('div', 'mt-slide-sub', '标准: 阻塞域(status受阻 / 准出标准fail / 测试用例fail) + 近7天阻塞记录(每条独立判定) + 高优未关闭Bug · ' + (MMT.date || '')));
    // 统计
    var stats = mtEl('div', 'mt-wall-stats');
    var s1 = mtEl('div', 'mt-wall-stat'); s1.appendChild(mtEl('b', '', String(w.blockedDomains.length))); s1.appendChild(document.createTextNode('个阻塞域'));
    var s2 = mtEl('div', 'mt-wall-stat'); s2.appendChild(mtEl('b', '', String(w.blockRecords.filter(function (it) { return !mtResolveInfo(it).resolved; }).length))); s2.appendChild(document.createTextNode('条未解决阻塞记录'));
    var s4 = mtEl('div', 'mt-wall-stat'); s4.appendChild(mtEl('b', '', String(
        w.blockedDomains.filter(function (it) { return mtResolveInfo(it).resolved; }).length +
        w.blockRecords.filter(function (it) { return mtResolveInfo(it).resolved; }).length
    ))); s4.appendChild(document.createTextNode('个阻塞已解决'));
    var s3 = mtEl('div', 'mt-wall-stat'); s3.appendChild(mtEl('b', '', String(w.criticalBugs.length))); s3.appendChild(document.createTextNode('个高优未关闭Bug'));
    stats.appendChild(s1); stats.appendChild(s2); stats.appendChild(s4); stats.appendChild(s3);
    frag.appendChild(stats);
    // A: 阻塞中的域 (域级别 fact)
    frag.appendChild(mtEl('div', 'mt-section-title', '⛔ 阻塞中的域 (' + actBlocked.length + ')'));
    if (!actBlocked.length) frag.appendChild(mtEl('div', 'mt-muted', '无阻塞域 ✅'));
    actBlocked.forEach(function (it) {
        var box = mtEl('div', 'mt-wall-item');
        var head = mtEl('div', 'mt-wi-head');
        head.appendChild(document.createTextNode(it.d.name + ' · ' + (it.d.owner || '—')));
        head.appendChild(mtEl('span', '', ' '));
        if (it.types.indexOf('status') !== -1) head.innerHTML += mtBadge('已阻塞 ' + (it.info.days !== null ? it.info.days + ' 天' : '—'), 'bad');
        if (it.types.indexOf('criteria') !== -1) head.innerHTML += ' ' + mtBadge('准出未达标 ' + it.critFail.length + '条', 'bad');
        if (it.types.indexOf('tc') !== -1) head.innerHTML += ' ' + mtBadge('用例失败 ' + it.tcFail.fail + '条', 'bad');
        box.appendChild(head);
        if (it.types.indexOf('status') !== -1) {
            if (it.info.reason) box.appendChild(mtEl('div', 'mt-wi-reason', '💬 ' + it.info.reason));
            if (it.info.rec) mtRenderAttach(it.info.rec, box);
            var meta = mtEl('div', 'mt-wi-meta');
            meta.appendChild(document.createTextNode('起于 ' + (it.info.since || '—')));
            (it.info.cross || []).forEach(function (c) { meta.innerHTML += '<span class="mt-cross-chip">↔ 依赖 ' + mtEsc(c) + '</span>'; });
            box.appendChild(meta);
        }
        if (it.types.indexOf('criteria') !== -1) {
            it.critFail.forEach(function (c) {
                box.appendChild(mtEl('div', 'mt-wi-reason', '❌ ' + c.criteria + ' (signoff: ' + (c.signoffOwner || c.owner || '—') + ')' ));
            });
        }
        if (it.types.indexOf('tc') !== -1) {
            box.appendChild(mtEl('div', 'mt-wi-reason', '🧪 测试用例失败 ' + it.tcFail.fail + ' · 执行中 ' + (it.tcFail.inprogress || 0) + ' · 豁免 ' + (it.tcFail.waived || 0)));
        }
        if (mtResolveState(it.d)) head.innerHTML += ' ' + mtBadge('✅ 已解决', 'ok');
        else box.appendChild(mtResolveToggle(it.d.name));
        frag.appendChild(box);
    });
    // B: 近期阻塞记录 · 每条独立判定
    frag.appendChild(mtEl('div', 'mt-section-title', '📝 近期阻塞记录 · 每条独立判定 (' + actRec.length + ')'));
    if (!actRec.length) frag.appendChild(mtEl('div', 'mt-muted', '无近期阻塞记录'));
    actRec.forEach(function (it) {
        var box = mtEl('div', 'mt-wall-item nonblock');
        var head = mtEl('div', 'mt-wi-head');
        head.appendChild(document.createTextNode(it.d.name + ' · ' + (it.d.owner || '—')));
        head.appendChild(mtEl('span', '', ' '));
        head.innerHTML += mtBadge(it.p.date + ' ' + (it.p.time || ''), 'warn');
        if (mtRecResolved(it)) head.innerHTML += ' ' + mtBadge('✅ 已解决', 'ok');
        box.appendChild(head);
        var reason;
        if (it.kind && it.kind.field !== 'blockers') {
            // 只保留实际命中阻塞关键字的编号项(如 UCIE 1~7 条只留 linkup fail 那条)
            reason = mtKeepBlockOnly(fmtBlockText(it.kind.text, it.kind.field === 'debugInfo', it.d.name));
        } else {
            reason = it.p.blockers || (it.kind && it.kind.text) || '阻塞记录';
        }
        box.appendChild(mtEl('div', 'mt-wi-reason', reason));
        mtRenderAttach(it.p, box);
        var meta = mtEl('div', 'mt-wi-meta');
        (it.cross || []).forEach(function (c) { meta.innerHTML += '<span class="mt-cross-chip">↔ 依赖 ' + mtEsc(c) + '</span>'; });
        box.appendChild(meta);
        if (!mtRecResolved(it)) box.appendChild(mtResolveToggleRecord(it));
        frag.appendChild(box);
    });
    // C: 高优 Bug
    frag.appendChild(mtEl('div', 'mt-section-title', '🔥 高优未关闭 Bug (' + w.criticalBugs.length + ')'));
    if (!w.criticalBugs.length) frag.appendChild(mtEl('div', 'mt-muted', '无高优未关闭Bug 🎉'));
    w.criticalBugs.forEach(function (it) {
        var line = mtEl('div', 'mt-bug-line');
        line.appendChild(document.createTextNode(it.b.bugId || it.b.jiraKey || '—'));
        line.appendChild(mtEl('span', '', '  '));
        line.innerHTML += mtBadge(it.b.severity || '-', 'bad') + ' ';
        line.appendChild(document.createTextNode((it.b.domain || 'TBD') + ' · ' + (it.b.owner || '—') + ' · ' + (it.b.status || '—')));
        if (it.days !== null) line.appendChild(mtEl('span', 'mt-muted', ' · 已开 ' + (it.days + 1) + ' 天'));
        frag.appendChild(line);
    });
    // D: 阻塞已解决 (所有已解决记录/域 → 归入本栏; 记录级与域级按 key 去重)
    var resolvedAll = resBlocked.concat(resRec);
    var seenR = {};
    resolvedAll = resolvedAll.filter(function (it) {
        var k = it.key || ('dom:' + it.d.name);
        if (seenR[k]) return false; seenR[k] = true; return true;
    });
    frag.appendChild(mtEl('div', 'mt-section-title', '✅ 阻塞已解决 (' + resolvedAll.length + ')'));
    if (!resolvedAll.length) frag.appendChild(mtEl('div', 'mt-muted', '暂无'));
    resolvedAll.forEach(function (it) {
        var box = mtEl('div', 'mt-wall-item resolved');
        var head = mtEl('div', 'mt-wi-head');
        head.appendChild(document.createTextNode(it.d.name + ' · ' + (it.d.owner || '—')));
        var rd = it.resolvedDate || it.d.blockResolvedDate || '—';
        head.innerHTML += ' ' + mtBadge('✅ 解决于 ' + rd, 'ok');
        box.appendChild(head);
        var rr = '';
        if (it.kind && it.kind.field) rr = mtKeepBlockOnly(fmtBlockText(it.kind.text, it.kind.field === 'debugInfo', it.d.name));
        else if (it.info && it.info.reason) rr = it.info.reason;
        else if (it.p && (it.p.blockers || it.p.content)) rr = it.p.blockers || it.p.content;
        if (rr) box.appendChild(mtEl('div', 'mt-wi-reason', rr));
        frag.appendChild(box);
    });
    MMT.content.appendChild(frag);
}
function mtRenderDomain(s) {
    var d = s.domain;
    var frag = document.createDocumentFragment();
    // 标题
    var title = mtEl('div', 'mt-slide-title');
    title.appendChild(document.createTextNode(d.name));
    title.appendChild(mtEl('span', '', ' '));
    title.innerHTML += mtBadge(MT_STATUS_LABEL[d.status] || d.status || '-', mtStatusKind(d.status));
    frag.appendChild(title);
    var sub = mtEl('div', 'mt-slide-sub');
    sub.appendChild(document.createTextNode('👤 ' + (d.owner || '—') + ' · BU窗口: ' + (d.startDate || '—') + ' ~ ' + (d.endDate || '—')));
    if (d.notes) sub.appendChild(document.createTextNode(' · 📝 ' + d.notes));
    frag.appendChild(sub);
    // 阻塞横幅
    if (s.blocked) {
        var banner = mtEl('div', 'mt-warning-banner');
        banner.textContent = '⛔ 阻塞中 ' + (s.blocked.days !== null ? '已 ' + s.blocked.days + ' 天' : '') + (s.blocked.since ? ' (起于 ' + s.blocked.since + ')' : '');
        if (s.blocked.reason) banner.textContent += ' — ' + s.blocked.reason;
        (s.blocked.cross || []).forEach(function (c) { banner.innerHTML += '<span class="mt-cross-chip">↔ 依赖 ' + mtEsc(c) + '</span>'; });
        frag.appendChild(banner);
    }
    // 今日进度
    frag.appendChild(mtEl('div', 'mt-section-title', '🕐 今日进度 (' + (MMT.date || '') + ')'));
    if (!s.today.length) {
        if (s.latest) {
            var nb = mtEl('div', 'mt-yellow-banner');
            nb.textContent = '⚠ 今日未更新 (最近记录: ' + s.latest.date + ' ' + (s.latest.time || '') + ' — ' + (s.latest.content || s.latest.workDone || '(无内容)') + ')';
            frag.appendChild(nb);
            // 域今日未更新时, 会议投屏仍要能看到该域最近证据(截图/链接/调试信息) —— 展示最近 3 条记录
            s.recent.slice(0, 3).forEach(function (p) {
                var box = mtEl('div', 'mt-prog-item');
                var line1 = mtEl('div');
                line1.appendChild(mtEl('span', 'mt-prog-time', p.date.slice(5) + ' ' + (p.time || '--:--')));
                line1.appendChild(document.createTextNode(fmtBlockText(p.content || p.workDone || '(记录无内容)', false, p.domain)));
                box.appendChild(line1);
                if (p.nextSteps) box.appendChild(mtEl('div', 'mt-prog-next', '➡️ 下一步: ' + p.nextSteps));
                if (p.blockers) box.appendChild(mtEl('div', 'mt-prog-block', '⛔ 阻塞: ' + p.blockers));
                mtRenderAttach(p, box);
                frag.appendChild(box);
            });
        } else {
            frag.appendChild(mtEl('div', 'mt-muted', '⚠ 今日未更新, 且无历史记录'));
        }
    } else {
        s.today.forEach(function (p) {
            var box = mtEl('div', 'mt-prog-item');
            var line1 = mtEl('div');
            var timeBadge = mtEl('span', 'mt-prog-time', p.time || '--:--');
            line1.appendChild(timeBadge);
            line1.appendChild(document.createTextNode(fmtBlockText(p.content || p.workDone || '(记录无内容)', false, p.domain)));
            box.appendChild(line1);
            if (p.nextSteps) box.appendChild(mtEl('div', 'mt-prog-next', '➡️ 下一步: ' + p.nextSteps));
            if (p.blockers) box.appendChild(mtEl('div', 'mt-prog-block', '⛔ 阻塞: ' + p.blockers));
            mtRenderAttach(p, box);
            frag.appendChild(box);
        });
    }
    // 三卡: 准出 / 用例 / Bug
    var grid = mtEl('div', 'mt-grid');
    // 准出标准
    var cCard = mtEl('div', 'mt-card');
    var passN = 0, failN = 0, readyN = 0;
    s.criteria.forEach(function (c) { if (c.status === 'pass') passN++; else if (c.status === 'fail') failN++; else readyN++; });
    var verdict;
    if (!s.criteria.length) { verdict = mtEl('span', 'mt-muted', '未配置准出标准'); }
    else if (failN > 0) { verdict = mtEl('span', 'mt-verdict-bad', '❌ 未达标 (通过' + passN + ' / 不通过' + failN + ' / 未就绪' + readyN + ')'); }
    else if (passN === s.criteria.length) { verdict = mtEl('span', 'mt-verdict-ok', '✅ 全部达标'); }
    else { verdict = mtEl('span', 'mt-verdict-wait', '⏳ 进行中 (通过' + passN + ' / 未就绪' + readyN + ')'); }
    cCard.appendChild(mtEl('h3', '', '✅ 准出标准 (' + s.criteria.length + ')'));
    cCard.appendChild(verdict);
    s.criteria.forEach(function (c) {
        var line = mtEl('div', 'mt-cri-line');
        line.innerHTML += (c.status === 'pass' ? mtBadge('通过', 'ok') : c.status === 'fail' ? mtBadge('不通过', 'bad') : mtBadge('未就绪', 'warn')) + ' ';
        line.appendChild(document.createTextNode(c.criteria));
        frag.appendChild(line);
        cCard.appendChild(line);
    });
    grid.appendChild(cCard);
    // 测试用例进度
    var tCard = mtEl('div', 'mt-card');
    tCard.appendChild(mtEl('h3', '', '🧪 测试用例进度'));
    var tc = (MMT.tc && MMT.tc.byComponent) ? MMT.tc.byComponent[d.name] : undefined;
    if (MMT.tc === 'loading') tCard.appendChild(mtEl('div', 'mt-muted', '加载中...'));
    else if (tc === undefined) tCard.appendChild(mtEl('div', 'mt-muted', '—'));
    else if (!tc.matched) tCard.appendChild(mtEl('div', 'mt-muted', '— (JIRA树内无该域组件)'));
    else {
        var wrap = mtEl('div', 'mt-tc-wrap');
        var bar = mtEl('div', 'mt-tc-bar');
        var total = tc.total || 0;
        if (total > 0) {
            var segs = [[tc.done || 0, '#2ecc71'], [tc.fail || 0, '#e74c3c'], [tc.todo || 0, '#6b7280']];
            segs.forEach(function (sg) {
                if (!sg[0]) return;
                var seg = mtEl('div', 'mt-tc-seg');
                seg.style.width = (sg[0] / total * 100) + '%';
                seg.style.background = sg[1];
                bar.appendChild(seg);
            });
        }
        wrap.appendChild(bar);
        wrap.appendChild(mtEl('span', 'mt-tc-label', (tc.done || 0) + '/' + total));
        tCard.appendChild(wrap);
        var tMeta = mtEl('div', 'mt-muted', '失败 ' + (tc.fail || 0) + ' · 执行中 ' + (tc.inprogress || 0) + ' · 豁免 ' + (tc.waived || 0));
        tCard.appendChild(tMeta);
    }
    grid.appendChild(tCard);
    // 高优Bug
    var bCard = mtEl('div', 'mt-card');
    var highBugs = s.bugs.filter(function (b) { return mtIsHighBug(b, mtGetBuPeriod()); });
    bCard.appendChild(mtEl('h3', '', '🔥 高优未关闭Bug (' + highBugs.length + ')'));
    if (!highBugs.length) bCard.appendChild(mtEl('div', 'mt-muted', '无'));
    highBugs.forEach(function (b) {
        var line = mtEl('div', 'mt-cri-line');
        line.appendChild(document.createTextNode((b.bugId || b.jiraKey || '—') + ' · ' + (b.owner || '—') + ' · ' + (b.status || '—')));
        line.innerHTML = mtBadge(b.severity || '-', 'bad') + ' ' + mtEsc((b.bugId || b.jiraKey || '—')) + ' · ' + mtEsc(b.owner || '—') + ' · ' + mtEsc(b.status || '—');
        bCard.appendChild(line);
    });
    grid.appendChild(bCard);
    frag.appendChild(grid);
    MMT.content.appendChild(frag);
}

// ---------- 打开 / 关闭 / 翻页 ----------
function mtShow(page) {
    if (!MMT.open || !MMT.slides.length) return;
    if (page < 0) page = 0;
    if (page >= MMT.slides.length) page = MMT.slides.length - 1;
    MMT.page = page;
    mtRender();
}
function mtNext() { mtShow(MMT.page + 1); }
function mtPrev() { mtShow(MMT.page - 1); }
function mtGoWall() { mtShow(0); }
function mtClose() {
    // 退出会议: 把拨码选择的 未解决/已解决 状态落库保存
    if (typeof mtApplyResolveAndSave === 'function') mtApplyResolveAndSave();
    if (!MMT.open) return;
    MMT.open = false;
    if (MMT.keyHandler) {
        document.removeEventListener('keydown', MMT.keyHandler, true);
        MMT.keyHandler = null;
    }
    if (MMT.overlay && MMT.overlay.parentNode) MMT.overlay.parentNode.removeChild(MMT.overlay);
    MMT.overlay = null;
    MMT.content = null;
    MMT.dateInput = null;
    document.body.style.overflow = '';
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { }
}
function openMeetingMode(opts) {
    opts = opts || {};
    if (MMT.open) return;
    MMT.open = true;
    mtResolveMode = {};        // 每次开会重置临时拨码状态, 避免跨会议残留
    MMT.date = opts.date || mtToday();
    MMT.tc = undefined;
    mtBuildSlides();
    // 覆盖层
    var ov = document.createElement('div');
    ov.id = 'mt-overlay';
    var header = mtEl('div');
    header.id = 'mt-header';
    header.appendChild(mtEl('span', 'mt-title', '🎬 BU同步会 · 会议模式'));
    var dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'mt-date-input';
    dateInput.id = 'mt-date';
    dateInput.value = MMT.date;
    dateInput.onchange = function () {
        MMT.date = this.value || mtToday();
        mtBuildSlides();
        MMT.tc = undefined;
        mtFetchTC();
        mtShow(0);
    };
    MMT.dateInput = dateInput;
    header.appendChild(dateInput);
    // BU 第 N 天
    var proj = (App.projectsList || []).find(function (p) { return p.id === App.currentProject; });
    var day = (typeof buDayOf === 'function' && proj) ? buDayOf(MMT.date, proj) : null;
    if (day) header.appendChild(mtEl('span', 'mt-bu-day', day));
    header.appendChild(mtEl('span', 'mt-spacer', ''));
    var wallLink = mtEl('button', 'mt-link', '⛔ 阻塞墙');
    wallLink.onclick = mtGoWall;
    header.appendChild(wallLink);
    var prevBtn = mtEl('button', 'mt-btn', '◀ 上一域');
    prevBtn.onclick = mtPrev;
    header.appendChild(prevBtn);
    var counter = mtEl('span', '', '');
    counter.id = 'mt-page';
    header.appendChild(counter);
    var nextBtn = mtEl('button', 'mt-btn', '下一域 ▶');
    nextBtn.onclick = mtNext;
    header.appendChild(nextBtn);
    var closeBtn = mtEl('button', 'mt-btn-red mt-btn', '✕ 退出会议');
    closeBtn.onclick = mtClose;
    header.appendChild(closeBtn);
    ov.appendChild(header);
    var content = mtEl('div');
    content.id = 'mt-content';
    ov.appendChild(content);
    var hint = mtEl('div', '', '← → / 空格 = 翻页 · Home = 阻塞墙 · Esc = 退出');
    hint.id = 'mt-hint';
    ov.appendChild(hint);
    document.body.appendChild(ov);
    MMT.overlay = ov;
    MMT.content = content;
    document.body.style.overflow = 'hidden';
    // 键盘
    MMT.keyHandler = function (e) {
        if (!MMT.open) return;
        if (window.__ivOpen) return; // 图片查看器打开时冻结翻页 (Esc 由查看器处理)
        var k = e.key;
        if (k === 'Escape') { e.preventDefault(); mtClose(); }
        else if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'Enter') { e.preventDefault(); mtNext(); }
        else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); mtPrev(); }
        else if (k === 'Home') { e.preventDefault(); mtGoWall(); }
    };
    document.addEventListener('keydown', MMT.keyHandler, true);
    // 全屏 (投影)
    try { if (ov.requestFullscreen) ov.requestFullscreen().catch(function () { }); } catch (e) { }
    mtFetchTC();
    mtShow(opts.startPage || 0);
}
// 对外入口 (index.html onclick)
if (typeof window !== 'undefined') {
    window.openMeetingMode = openMeetingMode;
    window.openMeetingBlocked = function () { openMeetingMode({ startPage: 0 }); };
}
// Domain rendering and management

function renderDomains(domains) {
    var tbody = getTableBody('domains-body');
    
    domains.forEach(function(domain) {
        var row = document.createElement('tr');
        row.setAttribute('data-domain-id', domain.id);
        
        var statusDisplay = App.statusText[domain.status] || domain.status;
        var statusColor = App.statusColors[domain.status] || '#999';
        
        // Name cell (safe)
        var nameCell = document.createElement('td');
        nameCell.textContent = domain.name || '';
        row.appendChild(nameCell);
        
        // Owner cell (safe)
        var ownerCell = document.createElement('td');
        ownerCell.textContent = domain.owner || '';
        row.appendChild(ownerCell);
        
        // Status cell
        var statusCell = document.createElement('td');
        if (isAdmin()) {
            var select = document.createElement('select');
            select.className = 'status-select';
            select.style.backgroundColor = statusColor;
            select.style.color = 'white';
            select.setAttribute('data-domain-id', domain.id);
            select.addEventListener('change', function() {
                updateDomainStatus(domain.id, this.value);
            });
            ['not-started', 'in-progress', 'blocked', 'completed'].forEach(function(s) {
                var opt = document.createElement('option');
                opt.value = s;
                opt.textContent = App.statusText[s];
                if (domain.status === s) opt.selected = true;
                select.appendChild(opt);
            });
            statusCell.appendChild(select);
        } else {
            var span = document.createElement('span');
            span.className = 'status-display';
            span.style.backgroundColor = statusColor;
            span.style.color = 'white';
            span.style.padding = '4px 8px';
            span.style.borderRadius = '4px';
            span.textContent = statusDisplay;
            statusCell.appendChild(span);
        }
        row.appendChild(statusCell);
        
        // 执行开始时间 cell (admin: date input 即时保存; 其他: 只读文本)
        var startCell = document.createElement('td');
        if (isAdmin()) {
            var startInput = document.createElement('input');
            startInput.type = 'date';
            startInput.className = 'domain-date-input';
            startInput.value = domain.startDate || '';
            startInput.addEventListener('change', function() {
                updateDomainTime(domain.id, 'startDate', this.value);
            });
            startCell.appendChild(startInput);
        } else {
            startCell.textContent = domain.startDate || '';
        }
        row.appendChild(startCell);
        
        // 执行结束时间 cell
        var endCell = document.createElement('td');
        if (isAdmin()) {
            var endInput = document.createElement('input');
            endInput.type = 'date';
            endInput.className = 'domain-date-input';
            endInput.value = domain.endDate || '';
            endInput.addEventListener('change', function() {
                updateDomainTime(domain.id, 'endDate', this.value);
            });
            endCell.appendChild(endInput);
        } else {
            endCell.textContent = domain.endDate || '';
        }
        row.appendChild(endCell);
        
        // 满足准出标准 cell: 从 BU Exit Criteria 按 domain 聚合, 进度条 绿=pass/红=fail/灰=未执行
        var criteriaCell = document.createElement('td');
        criteriaCell.appendChild(buildCriteriaProgress(domain.name));
        row.appendChild(criteriaCell);
        
        // Notes cell (safe)
        var notesCell = document.createElement('td');
        notesCell.textContent = domain.notes || '';
        row.appendChild(notesCell);
        
        // Actions cell
        var actionsCell = document.createElement('td');
        var editBtn = document.createElement('button');
        editBtn.className = 'edit-btn admin-only ' + adminVisibleClass();
        editBtn.textContent = '编辑';
        editBtn.addEventListener('click', function() { editDomain(domain.id); });
        actionsCell.appendChild(editBtn);
        
        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn admin-only ' + adminVisibleClass();
        deleteBtn.textContent = '删除';
        deleteBtn.addEventListener('click', function() { deleteDomain(domain.id); });
        actionsCell.appendChild(deleteBtn);
        
        row.appendChild(actionsCell);
        tbody.appendChild(row);
    });
    
    populateDomainDropdowns();
}

// 🔍 搜索 JIRA 用户补全负责人候选
function searchJiraOwner() {
    var domain = App.data.domains.find(function(d) { return d.id === App.currentEditDomainId; });
    if (!domain) return;
    var q = window.prompt('输入 JIRA 用户关键字(姓名或工号, 如 Feng 或 E00272):', '');
    if (q === null) return;  // 取消
    q = q.trim();
    if (!q) return;
    loadJiraOwnerOptions(domain.jiraProject || 'BR200', q);
}

function editDomain(domainId) {
    var domain = App.data.domains.find(function(d) { return d.id === domainId; });
    if (!domain) return;
    
    App.currentEditDomainId = domainId;
    document.getElementById('edit-domain-name').value = domain.name;
    document.getElementById('edit-domain-owner').value = domain.owner;
    document.getElementById('edit-domain-status').value = domain.status;
    document.getElementById('edit-domain-start-date').value = domain.startDate || '';
    document.getElementById('edit-domain-end-date').value = domain.endDate || '';
    document.getElementById('edit-domain-notes').value = domain.notes;
    
    // 负责人从 JIRA 用户列表选择(按 domain.jiraProject, 缺省 BR200)
    loadJiraOwnerOptions(domain.jiraProject || 'BR200');
    
    openModal('edit-domain-modal');
}

// 加载 JIRA 用户填充负责人 datalist(组件 lead 全集; 带 q 时追加搜索)
async function loadJiraOwnerOptions(jiraProject, q) {
    var dl = document.getElementById('jira-owner-options');
    var hint = document.getElementById('owner-source-hint');
    if (!dl) return;
    var url = '/api/data/domain-source/users?jiraProject=' + encodeURIComponent(jiraProject);
    if (q) url += '&q=' + encodeURIComponent(q);
    if (q && hint) hint.textContent = '搜索中...';
    try {
        var resp = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store'
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var j = await resp.json();
        if (!j.success) throw new Error(j.error || '拉取失败');
        var frag = document.createDocumentFragment();
        (j.users || []).forEach(function(u) {
            var opt = document.createElement('option');
            opt.value = u.displayName;
            opt.label = u.displayName + ' (' + u.name + (u.source === 'component-lead' ? ', 组件负责人' : '') + ')';
            frag.appendChild(opt);
        });
        dl.innerHTML = '';
        dl.appendChild(frag);
        if (hint) {
            var leadCount = (j.users || []).filter(function(u) { return u.source === 'component-lead'; }).length;
            hint.textContent = q
                ? '共 ' + (j.users || []).length + ' 个候选(项目 ' + j.project + '), 含搜索补全'
                : leadCount + ' 位组件负责人(项目 ' + j.project + ')';
        }
    } catch (e) {
        if (!q) {
            dl.innerHTML = '';
            if (hint) hint.textContent = 'JIRA 用户加载失败: ' + e.message;
        }
        console.error('loadJiraOwnerOptions:', e.message);
    }
}

function closeEditDomainModal() {
    closeModal('edit-domain-modal');
    App.currentEditDomainId = null;
}

function saveEditedDomain() {
    if (!App.currentEditDomainId) return;
    
    var domain = App.data.domains.find(function(d) { return d.id === App.currentEditDomainId; });
    if (!domain) return;
    
    domain.name = document.getElementById('edit-domain-name').value.trim();
    domain.owner = document.getElementById('edit-domain-owner').value.trim();
    domain.status = document.getElementById('edit-domain-status').value;
    domain.startDate = document.getElementById('edit-domain-start-date').value || '';
    domain.endDate = document.getElementById('edit-domain-end-date').value || '';
    if (domain.startDate && domain.endDate && domain.startDate > domain.endDate) {
        alert('执行开始时间不能晚于执行结束时间');
        return;
    }
    domain.notes = document.getElementById('edit-domain-notes').value.trim();
    
    saveAndRefresh('edit-domain-modal', renderDomains, 'domains', function() { App.currentEditDomainId = null; });
}

function deleteDomainFromModal() {
    if (confirm('确定要删除这个Domain吗？')) {
        deleteDomain(App.currentEditDomainId);
        closeEditDomainModal();
    }
}

function updateDomainStatus(domainId, newStatus) {
    var domain = App.data.domains.find(function(d) { return d.id === domainId; });
    if (domain) {
        domain.status = newStatus;
        persistData();
        renderDomains(App.data.domains);
    }
}

// inline 更新 domain 执行时间 (startDate/endDate), 带先后关系校验
function updateDomainTime(domainId, field, value) {
    var domain = App.data.domains.find(function(d) { return d.id === domainId; });
    if (!domain) return;
    if (value) {
        var other = field === 'startDate' ? 'endDate' : 'startDate';
        if (domain[other] && ((field === 'startDate' && value > domain[other]) || (field === 'endDate' && value < domain[other]))) {
            alert('执行开始时间不能晚于执行结束时间');
            renderDomains(App.data.domains); // 回滚重渲染
            return;
        }
    }
    domain[field] = value;
    persistData();
    renderDomains(App.data.domains);
}

function deleteDomain(domainId) {
    if (confirm('确定要删除这个Domain吗？')) {
        App.data.domains = App.data.domains.filter(function(domain) { return domain.id !== domainId; });
        renderDomains(App.data.domains);
        persistData();
    }
}

function addNewDomain() {
    var newDomainName = document.getElementById('new-domain-name').value.trim();
    var newDomainOwner = document.getElementById('new-domain-owner').value.trim();
    
    if (!newDomainName) {
        alert('请输入Domain名称');
        return;
    }
    
    var newDomain = {
        id: 'domain-' + Date.now(),
        name: newDomainName,
        owner: newDomainOwner || 'TBD',
        status: 'not-started',
        startDate: '',
        endDate: '',
        notes: ''
    };
    
    App.data.domains.push(newDomain);
    renderDomains(App.data.domains);
    document.getElementById('new-domain-name').value = '';
    document.getElementById('new-domain-owner').value = '';
    persistData();
}

// ===== 满足准出标准 进度条 =====
// 从 BU Exit Criteria 按 domain 聚合 (复用 bu-exit-criteria.js 的域名别名映射)
function criteriaDomainKey(name) {
    var norm = function(s) { return String(s || '').trim().toLowerCase().replace(/[\s\-/]/g, ''); };
    var map = (typeof CRITERIA_DOMAIN_MAP !== 'undefined') ? CRITERIA_DOMAIN_MAP : {};
    return norm(map[norm(name)] || name);
}

// @param {string} domainName - 域概览中的域名
// @returns {HTMLElement} 进度条容器 (绿=pass / 红=fail / 灰=not-ready)
function buildCriteriaProgress(domainName) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; align-items:center; gap:6px; min-width:140px;';

    var cList = (App.data.buExitCriteria || []).filter(function(c) {
        return criteriaDomainKey(c.domain) === criteriaDomainKey(domainName);
    });
    var total = cList.length;
    var pass = cList.filter(function(c) { return c.status === 'pass'; }).length;
    var fail = cList.filter(function(c) { return c.status === 'fail'; }).length;
    var notReady = total - pass - fail;

    if (total === 0) {
        wrap.textContent = '—';
        wrap.title = '该域无准出标准';
        return wrap;
    }

    var bar = document.createElement('div');
    bar.style.cssText = 'flex:1; height:8px; border-radius:4px; background:#3a4157; overflow:hidden; display:flex;';
    var segs = [
        { n: pass, color: '#2ecc71' },      // 绿: 通过
        { n: fail, color: '#e74c3c' },      // 红: 不通过
        { n: notReady, color: '#6b7280' }   // 灰: 未执行
    ];
    segs.forEach(function(seg) {
        if (seg.n > 0) {
            var el = document.createElement('div');
            el.style.cssText = 'height:100%; background:' + seg.color + ';';
            el.style.width = (seg.n / total * 100) + '%';
            bar.appendChild(el);
        }
    });
    wrap.appendChild(bar);

    var label = document.createElement('span');
    label.textContent = pass + '/' + total;
    label.style.cssText = 'font-size:12px; color:#8b93a7; white-space:nowrap;';
    wrap.appendChild(label);
    wrap.title = '准出标准共 ' + total + ' 条: 通过 ' + pass + ' / 不通过 ' + fail + ' / 未执行 ' + notReady;
    return wrap;
}

// ===== JIRA 组件同步(组件 = Domain, lead = owner) =====
// JIRA 组件页: https://jira01.birentech.com/projects/BR200?selectedItem=...:components-page

// 加载 JIRA 项目下拉(供选择从哪个项目导组件)
async function loadJiraDomainProjects() {
    var sel = document.getElementById('jira-domain-source-select');
    if (!sel) return;
    try {
        var resp = await fetch('/api/data/domain-source/projects', {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store'
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var j = await resp.json();
        if (!j.success) throw new Error(j.error || '拉取失败');
        var saved = localStorage.getItem('domainSourceJiraProject') || 'BR200';
        var frag = document.createDocumentFragment();
        (j.projects || []).forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.key;
            opt.textContent = p.key + ' - ' + p.name;
            if (p.key === saved) opt.selected = true;
            frag.appendChild(opt);
        });
        sel.innerHTML = '';
        sel.appendChild(frag);
        if (!saved || !(j.projects || []).some(function(p) { return p.key === saved; })) {
            sel.selectedIndex = 0;
        }
    } catch (e) {
        sel.innerHTML = '<option value="">项目加载失败</option>';
        console.error('loadJiraDomainProjects:', e.message);
    }
}

function getSelectedJiraProject() {
    var sel = document.getElementById('jira-domain-source-select');
    var proj = (sel && sel.value) || '';
    if (!proj) { alert('请先选择JIRA项目'); return ''; }
    localStorage.setItem('domainSourceJiraProject', proj);
    return proj;
}

async function syncDomainsFromJira() {
    if (!App.currentProject) { alert('请先选择项目'); return; }
    var jiraProj = getSelectedJiraProject();
    if (!jiraProj) return;
    var btn = document.getElementById('sync-domains-btn');
    var oldText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '同步中...'; }
    try {
        var resp = await fetch('/api/data/domain-source/sync?project=' + encodeURIComponent(App.currentProject) + '&jiraProject=' + encodeURIComponent(jiraProj), {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store'
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var j = await resp.json();
        if (!j.success) throw new Error(j.error || '同步失败');
        var s = j.summary;
        var msg = '从 JIRA [' + jiraProj + '] 同步完成: 新建 ' + (s.created || []).length + ' 个, 更新 ' + (s.updated || []).length + ' 个';
        if (s.errors && s.errors.length) msg += ', 错误 ' + s.errors.length + ': ' + s.errors.join('; ');
        alert(msg);
        await loadDataFromAPI();
        renderDomains(App.data.domains);
    } catch (e) {
        alert('同步失败: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
    }
}

async function previewJiraDomains() {
    var jiraProj = getSelectedJiraProject();
    if (!jiraProj) return;
    try {
        var resp = await fetch('/api/data/domain-source?jiraProject=' + encodeURIComponent(jiraProj), {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store'
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var j = await resp.json();
        if (!j.success) throw new Error(j.error || '拉取失败');
        var list = (j.components || []).map(function(c) {
            var lead = (c.lead && (c.lead.displayName || c.lead.name)) || '(无负责人)';
            return c.name + ' → ' + lead;
        }).join('\n');
        alert('JIRA 项目 [' + jiraProj + '] 组件(' + (j.components || []).length + ' 个):\n\n' + list);
    } catch (e) {
        alert('拉取失败: ' + e.message);
    }
}

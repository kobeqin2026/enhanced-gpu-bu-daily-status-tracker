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

function editDomain(domainId) {
    var domain = App.data.domains.find(function(d) { return d.id === domainId; });
    if (!domain) return;
    
    App.currentEditDomainId = domainId;
    document.getElementById('edit-domain-name').value = domain.name;
    document.getElementById('edit-domain-owner').value = domain.owner;
    document.getElementById('edit-domain-status').value = domain.status;
    document.getElementById('edit-domain-notes').value = domain.notes;
    
    openModal('edit-domain-modal');
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
        notes: ''
    };
    
    App.data.domains.push(newDomain);
    renderDomains(App.data.domains);
    document.getElementById('new-domain-name').value = '';
    document.getElementById('new-domain-owner').value = '';
    persistData();
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

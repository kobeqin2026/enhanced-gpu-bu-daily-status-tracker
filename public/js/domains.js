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

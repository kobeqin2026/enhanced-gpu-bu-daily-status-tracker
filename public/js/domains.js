function renderDomains(domains) {
    const tbody = getTableBody('domains-body');
    
    domains.forEach(domain => {
        const row = document.createElement('tr');
        row.setAttribute('data-domain-id', domain.id);
        
        const statusDisplay = statusText[domain.status] || domain.status;
        const isAdminUser = isAdmin();
        const statusDisplayOnly = isAdminUser ? 
            `<select class="status-select" onchange="updateDomainStatus('${domain.id}', this.value)" style="background-color: ${statusColors[domain.status]}; color: white;">
                <option value="not-started" ${domain.status === 'not-started' ? 'selected' : ''}>未开始</option>
                <option value="in-progress" ${domain.status === 'in-progress' ? 'selected' : ''}>进行中</option>
                <option value="blocked" ${domain.status === 'blocked' ? 'selected' : ''}>受阻</option>
                <option value="completed" ${domain.status === 'completed' ? 'selected' : ''}>已完成</option>
            </select>` :
            `<span class="status-display" style="background-color: ${statusColors[domain.status]}; color: white; padding: 4px 8px; border-radius: 4px;">${statusDisplay}</span>`;
        
        row.innerHTML = `
            <td>${escapeHtml(domain.name)}</td>
            <td>${escapeHtml(domain.owner)}</td>
            <td>${statusDisplayOnly}</td>
            <td>${escapeHtml(domain.notes)}</td>
            <td>
                <button class="edit-btn admin-only ${adminVisibleClass()}" onclick="editDomain('${domain.id}')">编辑</button>
                <button class="delete-btn admin-only ${adminVisibleClass()}" onclick="deleteDomain('${domain.id}')">删除</button>
            </td>
        `;
        
        tbody.appendChild(row);
    });
    
    // Update domain dropdowns
    populateDomainDropdowns();
}

// Open edit domain modal
function editDomain(domainId) {
    const domain = currentData.domains.find(d => d.id === domainId);
    if (!domain) return;
    
    currentEditDomainId = domainId;
    document.getElementById('edit-domain-name').value = domain.name;
    document.getElementById('edit-domain-owner').value = domain.owner;
    document.getElementById('edit-domain-status').value = domain.status;
    document.getElementById('edit-domain-notes').value = domain.notes;
    
    openModal('edit-domain-modal');
}

// Close edit domain modal
function closeEditDomainModal() {
    closeModal('edit-domain-modal');
    currentEditDomainId = null;
}

// Save edited domain
function saveEditedDomain() {
    if (!currentEditDomainId) return;
    
    const domain = currentData.domains.find(d => d.id === currentEditDomainId);
    if (!domain) return;
    
    domain.name = document.getElementById('edit-domain-name').value.trim();
    domain.owner = document.getElementById('edit-domain-owner').value.trim();
    domain.status = document.getElementById('edit-domain-status').value;
    domain.notes = document.getElementById('edit-domain-notes').value.trim();
    
    saveAndRefresh('edit-domain-modal', renderDomains, 'domains', () => { currentEditDomainId = null; });
}

// Delete domain from modal
function deleteDomainFromModal() {
    if (confirm('确定要删除这个Domain吗？')) {
        deleteDomain(currentEditDomainId);
        closeEditDomainModal();
    }
}

// Update domain status
function updateDomainStatus(domainId, newStatus) {
    const domain = currentData.domains.find(d => d.id === domainId);
    if (domain) {
        domain.status = newStatus;
        persistData();
        renderDomains(currentData.domains);
    }
}

// Delete domain
function deleteDomain(domainId) {
    if (confirm('确定要删除这个Domain吗？')) {
        currentData.domains = currentData.domains.filter(domain => domain.id !== domainId);
        renderDomains(currentData.domains);
        persistData();
    }
}

// Add new domain with owner field
function addNewDomain() {
    const newDomainName = document.getElementById('new-domain-name').value.trim();
    const newDomainOwner = document.getElementById('new-domain-owner').value.trim();
    
    if (!newDomainName) {
        alert('请输入Domain名称');
        return;
    }
    
    const newDomain = {
        id: 'domain-' + Date.now(),
        name: newDomainName,
        owner: newDomainOwner || 'TBD',
        status: 'not-started',
        notes: ''
    };
    
    currentData.domains.push(newDomain);
    renderDomains(currentData.domains);
    document.getElementById('new-domain-name').value = '';
    document.getElementById('new-domain-owner').value = '';
    persistData();
}
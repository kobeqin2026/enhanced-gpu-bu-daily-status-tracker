function addNewBUExitCriteriaRow() {
    const currentIndex = currentData.buExitCriteria.length + 1;
    
    // Auto-get owner from first domain if available
    let defaultOwner = '';
    let defaultDomain = '';
    if (currentData.domains.length > 0) {
        defaultDomain = currentData.domains[0].name;
        defaultOwner = currentData.domains[0].owner || '';
    }
    
    const newCriteria = {
        id: 'criteria-' + Date.now(),
        index: currentIndex,
        domain: defaultDomain,
        criteria: '',
        owner: defaultOwner,
        status: 'not-ready'
    };
    
    currentData.buExitCriteria.push(newCriteria);
    renderBUExitCriteria(currentData.buExitCriteria);
    persistData();
}

// Delete BU Exit Criteria entry
function deleteBUExitCriteria(criteriaId) {
    if (confirm('确定要删除这个准出标准吗？')) {
        currentData.buExitCriteria = currentData.buExitCriteria.filter(criteria => criteria.id !== criteriaId);
        reindexBUExitCriteria();
        renderBUExitCriteria(currentData.buExitCriteria);
        persistData();
    }
}

// Re-index BU Exit Criteria after deletion
function reindexBUExitCriteria() {
    currentData.buExitCriteria.forEach((criteria, index) => {
        criteria.index = index + 1;
    });
}

// Populate Domain and Owner dropdowns
function populateDomainOwnerDropdowns() {
    const domainSelect = document.getElementById('edit-bu-criteria-domain');
    const ownerSelect = document.getElementById('edit-bu-criteria-owner');
    
    domainSelect.innerHTML = '';
    ownerSelect.innerHTML = '';
    
    const defaultDomainOption = document.createElement('option');
    defaultDomainOption.value = '';
    defaultDomainOption.textContent = '请选择Domain';
    domainSelect.appendChild(defaultDomainOption);
    
    const defaultOwnerOption = document.createElement('option');
    defaultOwnerOption.value = '';
    defaultOwnerOption.textContent = '请选择Owner';
    ownerSelect.appendChild(defaultOwnerOption);
    
    currentData.domains.forEach(domain => {
        const domainOption = document.createElement('option');
        domainOption.value = domain.name;
        domainOption.textContent = domain.name;
        domainSelect.appendChild(domainOption);
    });
    
    const uniqueOwners = [...new Set(currentData.domains.map(domain => domain.owner))];
    uniqueOwners.forEach(owner => {
        if (owner) {
            const ownerOption = document.createElement('option');
            ownerOption.value = owner;
            ownerOption.textContent = owner;
            ownerSelect.appendChild(ownerOption);
        }
    });
}

// Render BU Exit Criteria table
function renderBUExitCriteria(criteriaList) {
    const tbody = getTableBody('bu-exit-criteria-body');
    
    if (criteriaList.length === 0) {
        tbody.appendChild(emptyTableRow(6, '暂无准出标准记录'));
        return;
    }
    
    criteriaList.forEach((criteria, idx) => {
        const statusDisplay = criteria.status === 'not-ready' ? 'Not ready' : 
                           criteria.status === 'fail' ? 'Fail' : 'Pass';
        const statusClass = criteria.status === 'not-ready' ? '' : 
                          criteria.status === 'fail' ? 'severity-highest' : 'status-completed';
        
        // Auto-get owner from domain
        const domainEntry = currentData.domains.find(d => d.name === criteria.domain);
        const displayOwner = domainEntry ? domainEntry.owner : (criteria.owner || '-');
        
        const displayIndex = criteria.index !== undefined ? criteria.index : (idx + 1);
        
        const row = document.createElement('tr');
        row.setAttribute('data-criteria-id', criteria.id);
        row.innerHTML = `
            <td>${displayIndex}</td>
            <td>${criteria.domain}</td>
            <td class="bu-criteria-content">${criteria.criteria}</td>
            <td>${displayOwner}</td>
            <td class="${statusClass}">${statusDisplay}</td>
            <td>
                <button class="edit-btn user-only ${userVisibleClass()}" onclick="editBUExitCriteria('${criteria.id}')">编辑</button>
                <button class="delete-btn user-only ${userVisibleClass()}" onclick="deleteBUExitCriteria('${criteria.id}')">删除</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Open edit BU Exit Criteria modal
function editBUExitCriteria(criteriaId) {
    const criteria = currentData.buExitCriteria.find(c => c.id === criteriaId);
    if (!criteria) return;
    
    currentEditBUExitCriteriaId = criteriaId;
    populateDomainOwnerDropdowns();
    
    document.getElementById('edit-bu-criteria-domain').value = criteria.domain;
    document.getElementById('edit-bu-criteria-content').value = criteria.criteria;
    document.getElementById('edit-bu-criteria-status').value = criteria.status;
    
    updateOwnerDropdown();
    openModal('edit-bu-exit-criteria-modal');
}

// Update owner dropdown based on selected domain
function updateOwnerDropdown() {
    const domainSelect = document.getElementById('edit-bu-criteria-domain');
    const ownerSelect = document.getElementById('edit-bu-criteria-owner');
    const selectedDomain = domainSelect.value;
    
    ownerSelect.innerHTML = '';
    
    const domainEntry = currentData.domains.find(d => d.name === selectedDomain);
    if (domainEntry) {
        const option = document.createElement('option');
        option.value = domainEntry.owner;
        option.textContent = domainEntry.owner;
        ownerSelect.appendChild(option);
        ownerSelect.value = domainEntry.owner;
    } else {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '';
        ownerSelect.appendChild(option);
    }
}

// Add event listener to domain dropdown
document.addEventListener('DOMContentLoaded', function() {
    const domainSelect = document.getElementById('edit-bu-criteria-domain');
    if (domainSelect) {
        domainSelect.addEventListener('change', updateOwnerDropdown);
    }
});

// Close edit BU Exit Criteria modal
function closeEditBUExitCriteriaModal() {
    closeModal('edit-bu-exit-criteria-modal');
    currentEditBUExitCriteriaId = null;
}

// Save edited BU Exit Criteria
function saveEditedBUExitCriteria() {
    if (!currentEditBUExitCriteriaId) return;
    
    const criteria = currentData.buExitCriteria.find(c => c.id === currentEditBUExitCriteriaId);
    if (!criteria) return;
    
    criteria.domain = document.getElementById('edit-bu-criteria-domain').value;
    criteria.criteria = document.getElementById('edit-bu-criteria-content').value.trim();
    criteria.owner = document.getElementById('edit-bu-criteria-owner').value;
    criteria.status = document.getElementById('edit-bu-criteria-status').value;
    
    saveAndRefresh('edit-bu-exit-criteria-modal', renderBUExitCriteria, 'buExitCriteria', () => { currentEditBUExitCriteriaId = null; });
}

// Delete BU Exit Criteria from modal
function deleteBUExitCriteriaFromModal() {
    if (confirm('确定要删除这个准出标准吗？')) {
        deleteBUExitCriteria(currentEditBUExitCriteriaId);
        closeEditBUExitCriteriaModal();
    }
}

// Bulk Upload BU Exit Criteria Functions
function showBulkUploadBUModal() {
    document.getElementById('bulk-upload-text').value = '';
    document.getElementById('bulk-separator').value = 'tab';
    document.getElementById('bulk-clear-existing').checked = false;
    openModal('bulk-upload-bu-modal');
}

function closeBulkUploadBUModal() {
    closeModal('bulk-upload-bu-modal');
}

function processBulkUploadBU() {
    const text = document.getElementById('bulk-upload-text').value.trim();
    const separatorType = document.getElementById('bulk-separator').value;
    const clearExisting = document.getElementById('bulk-clear-existing').checked;
    
    if (!text) {
        alert('请输入要导入的数据');
        return;
    }
    
    const separator = separatorType === 'tab' ? '\t' : ',';
    const lines = text.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
        alert('没有检测到有效数据');
        return;
    }
    
    if (clearExisting) {
        currentData.buExitCriteria = [];
    }
    
    let successCount = 0;
    let errorLines = [];
    
    lines.forEach((line, index) => {
        const parts = line.split(separator).map(p => p.trim());
        
        if (parts.length < 2) {
            errorLines.push(index + 1);
            return;
        }
        
        const domainName = parts[0] || '';
        const criteria = parts[1] || '';
        
        if (!domainName || !criteria) {
            errorLines.push(index + 1);
            return;
        }
        
        // Auto-find owner from domains table
        let owner = '';
        const matchedDomain = currentData.domains.find(d => 
            d.name === domainName || 
            d.name.includes(domainName) || 
            domainName.includes(d.name)
        );
        if (matchedDomain) {
            owner = matchedDomain.owner || '';
        }
        
        const newIndex = currentData.buExitCriteria.length + 1;
        
        const newCriteria = {
            id: 'criteria-' + Date.now() + '-' + index,
            index: newIndex,
            domain: domainName,
            criteria: criteria,
            owner: owner,
            status: 'not-ready'
        };
        
        currentData.buExitCriteria.push(newCriteria);
        successCount++;
    });
    
    renderBUExitCriteria(currentData.buExitCriteria);
    persistData();
    closeBulkUploadBUModal();
    
    let message = `成功导入 ${successCount} 条记录`;
    if (errorLines.length > 0) {
        message += `\n第 ${errorLines.join(', ')} 行格式错误已跳过`;
    }
    alert(message);
}
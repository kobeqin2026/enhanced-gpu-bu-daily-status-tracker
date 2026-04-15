// BU Exit Criteria management

function addNewBUExitCriteriaRow() {
    var currentIndex = App.data.buExitCriteria.length + 1;
    
    var defaultOwner = '';
    var defaultDomain = '';
    if (App.data.domains.length > 0) {
        defaultDomain = App.data.domains[0].name;
        defaultOwner = App.data.domains[0].owner || '';
    }
    
    var newCriteria = {
        id: 'criteria-' + Date.now(),
        index: currentIndex,
        domain: defaultDomain,
        criteria: '',
        owner: defaultOwner,
        status: 'not-ready'
    };
    
    App.data.buExitCriteria.push(newCriteria);
    renderBUExitCriteria(App.data.buExitCriteria);
    persistData();
}

function deleteBUExitCriteria(criteriaId) {
    if (confirm('确定要删除这个准出标准吗？')) {
        App.data.buExitCriteria = App.data.buExitCriteria.filter(function(criteria) { return criteria.id !== criteriaId; });
        reindexBUExitCriteria();
        renderBUExitCriteria(App.data.buExitCriteria);
        persistData();
    }
}

function reindexBUExitCriteria() {
    App.data.buExitCriteria.forEach(function(criteria, index) {
        criteria.index = index + 1;
    });
}

function populateDomainOwnerDropdowns() {
    var domainSelect = document.getElementById('edit-bu-criteria-domain');
    var ownerSelect = document.getElementById('edit-bu-criteria-owner');
    
    domainSelect.innerHTML = '';
    ownerSelect.innerHTML = '';
    
    var defaultDomainOption = document.createElement('option');
    defaultDomainOption.value = '';
    defaultDomainOption.textContent = '请选择Domain';
    domainSelect.appendChild(defaultDomainOption);
    
    var defaultOwnerOption = document.createElement('option');
    defaultOwnerOption.value = '';
    defaultOwnerOption.textContent = '请选择Owner';
    ownerSelect.appendChild(defaultOwnerOption);
    
    App.data.domains.forEach(function(domain) {
        var option = document.createElement('option');
        option.value = domain.name;
        option.textContent = domain.name;
        domainSelect.appendChild(option);
    });
    
    var uniqueOwners = Array.from(new Set(App.data.domains.map(function(d) { return d.owner; })));
    uniqueOwners.forEach(function(owner) {
        if (owner) {
            var option = document.createElement('option');
            option.value = owner;
            option.textContent = owner;
            ownerSelect.appendChild(option);
        }
    });
}

function renderBUExitCriteria(criteriaList) {
    var tbody = getTableBody('bu-exit-criteria-body');
    
    if (criteriaList.length === 0) {
        tbody.appendChild(emptyTableRow(6, '暂无准出标准记录'));
        return;
    }
    
    criteriaList.forEach(function(criteria, idx) {
        var statusDisplay = criteria.status === 'not-ready' ? 'Not ready' :
                           criteria.status === 'fail' ? 'Fail' : 'Pass';
        var statusClass = criteria.status === 'not-ready' ? '' :
                         criteria.status === 'fail' ? 'severity-highest' : 'status-completed';
        
        var domainEntry = App.data.domains.find(function(d) { return d.name === criteria.domain; });
        var displayOwner = domainEntry ? domainEntry.owner : (criteria.owner || '-');
        
        var displayIndex = criteria.index !== undefined ? criteria.index : (idx + 1);
        
        var row = document.createElement('tr');
        row.setAttribute('data-criteria-id', criteria.id);
        
        // Index (safe)
        var indexCell = document.createElement('td');
        indexCell.textContent = String(displayIndex);
        row.appendChild(indexCell);
        
        // Domain (safe)
        var domainCell = document.createElement('td');
        domainCell.textContent = criteria.domain || '';
        row.appendChild(domainCell);
        
        // Criteria content (safe)
        var criteriaCell = document.createElement('td');
        criteriaCell.className = 'bu-criteria-content';
        criteriaCell.textContent = criteria.criteria || '';
        row.appendChild(criteriaCell);
        
        // Owner (safe)
        var ownerCell = document.createElement('td');
        ownerCell.textContent = displayOwner || '';
        row.appendChild(ownerCell);
        
        // Status (safe)
        var statusCell = document.createElement('td');
        statusCell.className = statusClass;
        statusCell.textContent = statusDisplay;
        row.appendChild(statusCell);
        
        // Actions
        var actionsCell = document.createElement('td');
        var editBtn = document.createElement('button');
        editBtn.className = 'edit-btn user-only ' + userVisibleClass();
        editBtn.textContent = '编辑';
        editBtn.addEventListener('click', function() { editBUExitCriteria(criteria.id); });
        actionsCell.appendChild(editBtn);
        
        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn user-only ' + userVisibleClass();
        deleteBtn.textContent = '删除';
        deleteBtn.addEventListener('click', function() { deleteBUExitCriteria(criteria.id); });
        actionsCell.appendChild(deleteBtn);
        
        row.appendChild(actionsCell);
        tbody.appendChild(row);
    });
}

function editBUExitCriteria(criteriaId) {
    var criteria = App.data.buExitCriteria.find(function(c) { return c.id === criteriaId; });
    if (!criteria) return;
    
    App.currentEditBUExitCriteriaId = criteriaId;
    populateDomainOwnerDropdowns();
    
    document.getElementById('edit-bu-criteria-domain').value = criteria.domain;
    document.getElementById('edit-bu-criteria-content').value = criteria.criteria;
    document.getElementById('edit-bu-criteria-status').value = criteria.status;
    
    updateOwnerDropdown();
    openModal('edit-bu-exit-criteria-modal');
}

function updateOwnerDropdown() {
    var domainSelect = document.getElementById('edit-bu-criteria-domain');
    var ownerSelect = document.getElementById('edit-bu-criteria-owner');
    var selectedDomain = domainSelect.value;
    
    ownerSelect.innerHTML = '';
    
    var domainEntry = App.data.domains.find(function(d) { return d.name === selectedDomain; });
    if (domainEntry) {
        var option = document.createElement('option');
        option.value = domainEntry.owner;
        option.textContent = domainEntry.owner;
        ownerSelect.appendChild(option);
        ownerSelect.value = domainEntry.owner;
    } else {
        var option = document.createElement('option');
        option.value = '';
        option.textContent = '';
        ownerSelect.appendChild(option);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    var domainSelect = document.getElementById('edit-bu-criteria-domain');
    if (domainSelect) {
        domainSelect.addEventListener('change', updateOwnerDropdown);
    }
});

function closeEditBUExitCriteriaModal() {
    closeModal('edit-bu-exit-criteria-modal');
    App.currentEditBUExitCriteriaId = null;
}

function saveEditedBUExitCriteria() {
    if (!App.currentEditBUExitCriteriaId) return;
    
    var criteria = App.data.buExitCriteria.find(function(c) { return c.id === App.currentEditBUExitCriteriaId; });
    if (!criteria) return;
    
    criteria.domain = document.getElementById('edit-bu-criteria-domain').value;
    criteria.criteria = document.getElementById('edit-bu-criteria-content').value.trim();
    criteria.owner = document.getElementById('edit-bu-criteria-owner').value;
    criteria.status = document.getElementById('edit-bu-criteria-status').value;
    
    saveAndRefresh('edit-bu-exit-criteria-modal', renderBUExitCriteria, 'buExitCriteria', function() { App.currentEditBUExitCriteriaId = null; });
}

function deleteBUExitCriteriaFromModal() {
    if (confirm('确定要删除这个准出标准吗？')) {
        deleteBUExitCriteria(App.currentEditBUExitCriteriaId);
        closeEditBUExitCriteriaModal();
    }
}

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
    var text = document.getElementById('bulk-upload-text').value.trim();
    var separatorType = document.getElementById('bulk-separator').value;
    var clearExisting = document.getElementById('bulk-clear-existing').checked;
    
    if (!text) {
        alert('请输入要导入的数据');
        return;
    }
    
    var separator = separatorType === 'tab' ? '\t' : ',';
    var lines = text.split('\n').filter(function(line) { return line.trim(); });
    
    if (lines.length === 0) {
        alert('没有检测到有效数据');
        return;
    }
    
    if (clearExisting) {
        App.data.buExitCriteria = [];
    }
    
    var successCount = 0;
    var errorLines = [];
    
    lines.forEach(function(line, index) {
        var parts = line.split(separator).map(function(p) { return p.trim(); });
        
        if (parts.length < 2) {
            errorLines.push(index + 1);
            return;
        }
        
        var domainName = parts[0] || '';
        var criteriaText = parts[1] || '';
        
        if (!domainName || !criteriaText) {
            errorLines.push(index + 1);
            return;
        }
        
        var owner = '';
        var matchedDomain = App.data.domains.find(function(d) {
            return d.name === domainName || d.name.indexOf(domainName) !== -1 || domainName.indexOf(d.name) !== -1;
        });
        if (matchedDomain) {
            owner = matchedDomain.owner || '';
        }
        
        var newIndex = App.data.buExitCriteria.length + 1;
        
        var newCriteria = {
            id: 'criteria-' + Date.now() + '-' + index,
            index: newIndex,
            domain: domainName,
            criteria: criteriaText,
            owner: owner,
            status: 'not-ready'
        };
        
        App.data.buExitCriteria.push(newCriteria);
        successCount++;
    });
    
    renderBUExitCriteria(App.data.buExitCriteria);
    persistData();
    closeBulkUploadBUModal();
    
    var message = '成功导入 ' + successCount + ' 条记录';
    if (errorLines.length > 0) {
        message += '\n第 ' + errorLines.join(', ') + ' 行格式错误已跳过';
    }
    alert(message);
}

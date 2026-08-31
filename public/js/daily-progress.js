// Daily progress tracking

// 当前时刻 HH:MM (自动时间戳)
function nowHHMM() {
    var now = new Date();
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}

function addDailyProgress() {
    var date = document.getElementById('daily-date-input').value;
    var time = document.getElementById('daily-time-input').value;
    var domain = document.getElementById('daily-domain-select').value;
    var content = document.getElementById('daily-content-input').value.trim();
    
    if (!date || !domain || !content) {
        alert('请填写日期、Domain和工作内容');
        return;
    }
    // 未填时间则取当前时刻 (自动打时间戳: 同一天多次更新每次记录 HH:MM)
    if (!time) {
        time = nowHHMM();
    }
    
    var domainEntry = App.data.domains.find(function(d) { return d.name === domain; });
    var owner = domainEntry ? domainEntry.owner : '';
    
    var newProgress = {
        id: 'progress-' + Date.now(),
        date: date,
        time: time,
        domain: domain,
        content: content,
        owner: owner
    };
    
    App.data.dailyProgress.push(newProgress);
    renderDailyProgress(App.data.dailyProgress);

    document.getElementById('daily-date-input').value = '';
    // 自动打时间戳: 添加后重置为当前时刻, 连续添加多条记录时时刻自动前进
    document.getElementById('daily-time-input').value = nowHHMM();
    document.getElementById('daily-domain-select').value = '';
    document.getElementById('daily-content-input').value = '';
    
    persistData();
}

function deleteDailyProgress(progressId) {
    var record = App.data.dailyProgress.find(function(p) { return p.id === progressId; });
    if (record && !canEditDomain(record.domain)) { alert('您只能编辑自己Domain的进度记录'); return; }
    if (confirm('确定要删除这个进度记录吗？')) {
        App.data.dailyProgress = App.data.dailyProgress.filter(function(progress) { return progress.id !== progressId; });
        renderDailyProgress(App.data.dailyProgress);
        persistData();
    }
}

function applyFiltersToDailyProgress(progressList) {
    return progressList.filter(function(progress) {
        if (App.currentDailyProgressFilters.date && progress.date !== App.currentDailyProgressFilters.date) return false;
        if (App.currentDailyProgressFilters.domain && progress.domain !== App.currentDailyProgressFilters.domain) return false;
        return true;
    });
}

function groupAndRenderDailyProgress(progressList) {
    var container = document.getElementById('daily-progress-list');
    container.innerHTML = '';
    
    if (progressList.length === 0) {
        var emptyP = document.createElement('p');
        emptyP.style.textAlign = 'center';
        emptyP.style.fontStyle = 'italic';
        emptyP.style.color = 'var(--muted, #8b93a7)';
        emptyP.textContent = '暂无每日进度记录';
        container.appendChild(emptyP);
        return;
    }
    
    var filteredProgress = applyFiltersToDailyProgress(progressList);
    
    var grouped = {};
    filteredProgress.forEach(function(progress) {
        var key = progress.date + '|' + progress.domain;
        if (!grouped[key]) {
            var domainEntry = App.data.domains.find(function(d) { return d.name === progress.domain; });
            grouped[key] = {
                date: progress.date,
                domain: progress.domain,
                owner: progress.owner || (domainEntry ? domainEntry.owner : ''),
                contents: []
            };
        }
        grouped[key].contents.push({ id: progress.id, content: progress.content, time: progress.time || '' });
    });
    
    var groupedArray = Object.values(grouped).sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    
    groupedArray.forEach(function(group) {
        var groupDiv = document.createElement('div');
        groupDiv.className = 'daily-progress-item';
        
        var infoDiv = document.createElement('div');
        infoDiv.className = 'daily-progress-info';
        
        var dateDiv = document.createElement('div');
        dateDiv.className = 'daily-date-display';
        dateDiv.textContent = group.date;
        infoDiv.appendChild(dateDiv);
        
        var domainDiv = document.createElement('div');
        domainDiv.className = 'daily-domain-display';
        domainDiv.textContent = group.domain;
        infoDiv.appendChild(domainDiv);
        
        var ownerDiv = document.createElement('div');
        ownerDiv.className = 'daily-owner-display';
        ownerDiv.textContent = '\u{1F464} ' + (group.owner || '-');
        infoDiv.appendChild(ownerDiv);
        
        group.contents.forEach(function(item) {
            var contentDiv = document.createElement('div');
            contentDiv.className = 'daily-content-display';
            // 同一天多次更新: 每条内容前缀时刻 (HH:MM) 便于区分先后
            contentDiv.textContent = (item.time ? '🕐 ' + item.time + ' ' : '') + item.content;
            
            // 编辑/删除: 仅 CHANGE_ME 或该 domain 的 owner (其他 domain 只读)
            var itemEditable = canEditDomain(group.domain);
            var editBtn = document.createElement('button');
            editBtn.className = 'edit-btn' + (itemEditable ? ' visible' : '');
            editBtn.textContent = '编辑';
            editBtn.addEventListener('click', function() { editDailyProgress(item.id); });
            if (itemEditable) contentDiv.appendChild(editBtn);
            
            var delBtn = document.createElement('button');
            delBtn.className = 'delete-btn' + (itemEditable ? ' visible' : '');
            delBtn.textContent = '删除';
            delBtn.addEventListener('click', function() { deleteDailyProgress(item.id); });
            if (itemEditable) contentDiv.appendChild(delBtn);
            
            infoDiv.appendChild(contentDiv);
        });
        
        groupDiv.appendChild(infoDiv);
        container.appendChild(groupDiv);
    });
}

function renderDailyProgress(progressList) {
    groupAndRenderDailyProgress(progressList);
}

function editDailyProgress(progressId) {
    var progress = App.data.dailyProgress.find(function(p) { return p.id === progressId; });
    if (!progress) return;
    if (!canEditDomain(progress.domain)) { alert('您只能编辑自己Domain的进度记录'); return; }
    
    App.currentEditDailyProgressId = progressId;
    document.getElementById('edit-daily-date').value = progress.date;
    document.getElementById('edit-daily-domain').value = progress.domain;
    document.getElementById('edit-daily-content').value = progress.content;
    
    openModal('edit-daily-progress-modal');
}

function closeEditDailyProgressModal() {
    closeModal('edit-daily-progress-modal');
    App.currentEditDailyProgressId = null;
}

function saveEditedDailyProgress() {
    if (!App.currentEditDailyProgressId) return;
    
    var progress = App.data.dailyProgress.find(function(p) { return p.id === App.currentEditDailyProgressId; });
    if (!progress) return;
    
    var newDomain = document.getElementById('edit-daily-domain').value;
    progress.date = document.getElementById('edit-daily-date').value;
    progress.domain = newDomain;
    progress.content = document.getElementById('edit-daily-content').value.trim();
    
    var domainEntry = App.data.domains.find(function(d) { return d.name === newDomain; });
    progress.owner = domainEntry ? domainEntry.owner : '';
    
    saveAndRefresh('edit-daily-progress-modal', renderDailyProgress, 'dailyProgress', function() { App.currentEditDailyProgressId = null; });
}

function deleteDailyProgressFromModal() {
    if (confirm('确定要删除这个进度记录吗？')) {
        deleteDailyProgress(App.currentEditDailyProgressId);
        closeEditDailyProgressModal();
    }
}

function applyDailyProgressFilters() {
    App.currentDailyProgressFilters = {
        date: document.getElementById('filter-daily-date').value,
        domain: document.getElementById('filter-daily-domain').value
    };
    renderDailyProgress(App.data.dailyProgress);
}

function resetDailyProgressFilters() {
    document.getElementById('filter-daily-date').value = '';
    document.getElementById('filter-daily-domain').value = '';
    
    App.currentDailyProgressFilters = {};
    renderDailyProgress(App.data.dailyProgress);
}

// 页面加载即自动打上当前时间戳 (脚本位于 body 末尾, DOM 已就绪)
(function() {
    var t = document.getElementById('daily-time-input');
    if (t && !t.value) t.value = nowHHMM();
})();

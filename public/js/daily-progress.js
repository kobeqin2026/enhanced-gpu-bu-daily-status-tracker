function addDailyProgress() {
    const date = document.getElementById('daily-date-input').value;
    const domain = document.getElementById('daily-domain-select').value;
    const content = document.getElementById('daily-content-input').value.trim();
    
    if (!date || !domain || !content) {
        alert('请填写日期、Domain和工作内容');
        return;
    }
    
    // Auto-get owner from domain
    const domainEntry = currentData.domains.find(d => d.name === domain);
    const owner = domainEntry ? domainEntry.owner : '';
    
    const newProgress = {
        id: 'progress-' + Date.now(),
        date: date,
        domain: domain,
        content: content,
        owner: owner
    };
    
    currentData.dailyProgress.push(newProgress);
    renderDailyProgress(currentData.dailyProgress);
    
    // Clear inputs
    document.getElementById('daily-date-input').value = '';
    document.getElementById('daily-domain-select').value = '';
    document.getElementById('daily-content-input').value = '';
    
    persistData();
}

// Delete daily progress entry
function deleteDailyProgress(progressId) {
    if (confirm('确定要删除这个进度记录吗？')) {
        currentData.dailyProgress = currentData.dailyProgress.filter(progress => progress.id !== progressId);
        renderDailyProgress(currentData.dailyProgress);
        persistData();
    }
}

// Apply filters to daily progress
function applyFiltersToDailyProgress(progressList) {
    return progressList.filter(progress => {
        if (currentDailyProgressFilters.date && progress.date !== currentDailyProgressFilters.date) return false;
        if (currentDailyProgressFilters.domain && progress.domain !== currentDailyProgressFilters.domain) return false;
        return true;
    });
}

// Group and sort daily progress for merged display
function groupAndRenderDailyProgress(progressList) {
    const container = document.getElementById('daily-progress-list');
    container.innerHTML = '';
    
    if (progressList.length === 0) {
        container.innerHTML = '<p style="text-align: center; font-style: italic; color: #7f8c8d;">暂无每日进度记录</p>';
        return;
    }
    
    const filteredProgress = applyFiltersToDailyProgress(progressList);
    
    // Group by date and domain
    const grouped = {};
    filteredProgress.forEach(progress => {
        const key = `${progress.date}|${progress.domain}`;
        if (!grouped[key]) {
            const domainEntry = currentData.domains.find(d => d.name === progress.domain);
            grouped[key] = {
                date: progress.date,
                domain: progress.domain,
                owner: progress.owner || (domainEntry ? domainEntry.owner : ''),
                contents: []
            };
        }
        grouped[key].contents.push({ id: progress.id, content: progress.content });
    });
    
    // Sort by date (newest first)
    const groupedArray = Object.values(grouped).sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Render grouped progress
    groupedArray.forEach(group => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'daily-progress-item';
        
        let contentsHtml = '';
        group.contents.forEach(item => {
            contentsHtml += `
                <div class="daily-content-display">
                    ${escapeHtml(item.content)}
                    <button class="edit-btn user-only ${userVisibleClass()}" onclick="editDailyProgress('${item.id}')">编辑</button>
                    <button class="delete-btn user-only ${userVisibleClass()}" onclick="deleteDailyProgress('${item.id}')">删除</button>
                </div>
            `;
        });
        
        groupDiv.innerHTML = `
            <div class="daily-progress-info">
                <div class="daily-date-display">${escapeHtml(group.date)}</div>
                <div class="daily-domain-display">${escapeHtml(group.domain)}</div>
                <div class="daily-owner-display">👤 ${escapeHtml(group.owner || '-')}</div>
                ${contentsHtml}
            </div>
        `;
        
        container.appendChild(groupDiv);
    });
}

// Render daily progress list (using merged grouping)
function renderDailyProgress(progressList) {
    groupAndRenderDailyProgress(progressList);
}

// Open edit daily progress modal
function editDailyProgress(progressId) {
    const progress = currentData.dailyProgress.find(p => p.id === progressId);
    if (!progress) return;
    
    currentEditDailyProgressId = progressId;
    document.getElementById('edit-daily-date').value = progress.date;
    document.getElementById('edit-daily-domain').value = progress.domain;
    document.getElementById('edit-daily-content').value = progress.content;
    
    openModal('edit-daily-progress-modal');
}

// Close edit daily progress modal
function closeEditDailyProgressModal() {
    closeModal('edit-daily-progress-modal');
    currentEditDailyProgressId = null;
}

// Save edited daily progress (auto-update owner from domain)
function saveEditedDailyProgress() {
    if (!currentEditDailyProgressId) return;
    
    const progress = currentData.dailyProgress.find(p => p.id === currentEditDailyProgressId);
    if (!progress) return;
    
    const newDomain = document.getElementById('edit-daily-domain').value;
    progress.date = document.getElementById('edit-daily-date').value;
    progress.domain = newDomain;
    progress.content = document.getElementById('edit-daily-content').value.trim();
    
    // Auto-update owner from domain
    const domainEntry = currentData.domains.find(d => d.name === newDomain);
    progress.owner = domainEntry ? domainEntry.owner : '';
    
    saveAndRefresh('edit-daily-progress-modal', renderDailyProgress, 'dailyProgress', () => { currentEditDailyProgressId = null; });
}

// Delete daily progress from modal
function deleteDailyProgressFromModal() {
    if (confirm('确定要删除这个进度记录吗？')) {
        deleteDailyProgress(currentEditDailyProgressId);
        closeEditDailyProgressModal();
    }
}

// Apply daily progress filters from UI
function applyDailyProgressFilters() {
    currentDailyProgressFilters = {
        date: document.getElementById('filter-daily-date').value,
        domain: document.getElementById('filter-daily-domain').value
    };
    renderDailyProgress(currentData.dailyProgress);
}

// Reset daily progress filters
function resetDailyProgressFilters() {
    document.getElementById('filter-daily-date').value = '';
    document.getElementById('filter-daily-domain').value = '';
    
    currentDailyProgressFilters = {};
    renderDailyProgress(currentData.dailyProgress);
}
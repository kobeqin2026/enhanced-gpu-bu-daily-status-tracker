// Daily progress tracking

// 当前时刻 HH:MM (自动时间戳)
function nowHHMM() {
    var now = new Date();
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}

// ---------- 附件 (截图/链接) 待提交状态 ----------
// DP_ATTACH.add  = 添加表单待提交附件; DP_ATTACH.edit = 编辑弹窗待保存附件
var DP_ATTACH = { add: [], edit: [] };
var DP_UPLOADING = { add: false, edit: false };

function dpUploadFiles(fileList, mode) {
    if (!fileList || !fileList.length) return;
    if (DP_UPLOADING[mode]) { alert('正在上传, 请稍候'); return; }
    DP_UPLOADING[mode] = true;
    var files = Array.prototype.slice.call(fileList);
    var pending = files.length;
    files.forEach(function(f) {
        if (!f.type || f.type.indexOf('image/') !== 0) { pending--; alert('仅支持图片文件: ' + (f.name || '')); return; }
        var fd = new FormData();
        fd.append('file', f);
        fd.append('project', App.currentProject || '');
        fd.append('date', dpAttachDate(mode));
        fetch('/api/data/progress-attachment', { method: 'POST', body: fd, credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(res) {
                pending--;
                if (res && res.success) {
                    DP_ATTACH[mode].push({ type: 'image', url: res.url, name: res.name || f.name });
                    dpRenderAttachPreview(mode);
                } else {
                    alert('上传失败: ' + (res && res.error ? res.error : '未知错误'));
                }
                if (pending <= 0) DP_UPLOADING[mode] = false;
            })
            .catch(function(err) {
                pending--;
                alert('上传失败: ' + err.message);
                if (pending <= 0) DP_UPLOADING[mode] = false;
            });
    });
}

function dpAttachDate(mode) {
    var el = mode === 'add' ? document.getElementById('daily-date-input') : document.getElementById('edit-daily-date');
    var v = el && el.value ? el.value : '';
    if (v) return v;
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function dpPromptLink(mode) {
    var url = prompt('请输入链接地址 (JIRA Bug / wiki / 文档):');
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    DP_ATTACH[mode].push({ type: 'link', url: url, name: url });
    dpRenderAttachPreview(mode);
}

function dpRemoveAttach(mode, idx) {
    DP_ATTACH[mode].splice(idx, 1);
    dpRenderAttachPreview(mode);
}

function dpRenderAttachPreview(mode) {
    var container = document.getElementById(mode === 'add' ? 'daily-attach-preview' : 'edit-daily-attach-preview');
    if (!container) return;
    container.innerHTML = '';
    DP_ATTACH[mode].forEach(function(a, i) {
        var chip = document.createElement('span');
        chip.className = 'dp-attach-chip';
        if (a.type === 'image' && a.url) {
            var img = document.createElement('img');
            img.src = a.url;
            img.title = a.name || '截图';
            img.onclick = function() { showImageViewer(a.url, a.name); };
            chip.appendChild(img);
        } else {
            var link = document.createElement('a');
            link.className = 'dp-attach-link';
            link.href = a.url;
            link.target = '_blank';
            link.textContent = '🔗 ' + (a.name || a.url);
            chip.appendChild(link);
        }
        var x = document.createElement('span');
        x.className = 'dp-chip-x';
        x.textContent = '✕';
        x.onclick = function() { dpRemoveAttach(mode, i); };
        chip.appendChild(x);
        container.appendChild(chip);
    });
}

function dpResetAttach(mode) {
    DP_ATTACH[mode] = [];
    dpRenderAttachPreview(mode);
}

// ---------- 进度条渲染辅助 (列表 + 会议模式共用) ----------
function dpAttachHtml(attachments) {
    // 返回安全 HTML 片段 (url 来自后端生成的路径或用户输入, 需转义)
    if (!attachments || !attachments.length) return '';
    var out = '';
    attachments.forEach(function(a) {
        if (a.type === 'image' && a.url) {
            out += '<img class="dp-thumb" src="' + escapeHtml(a.url) + '" title="' + escapeHtml(a.name || '截图') + '" onclick="showImageViewer(this.src, this.title)">';
        } else if (a.type === 'link' && a.url) {
            out += '<a class="dp-attach-link" href="' + escapeHtml(a.url) + '" target="_blank">🔗 ' + escapeHtml(a.name || a.url) + '</a>';
        }
    });
    return out;
}

function dpDebugHtml(debugInfo, domain) {
    if (!debugInfo || !String(debugInfo).trim()) return '';
    return '<details class="dp-debug-details"><summary>🔬 调试信息</summary><pre>' + escapeHtml(fmtBlockText(debugInfo, true, domain)) + '</pre></details>';
}

// ---------- 添加进度对话框 ----------
function openAddDailyProgressModal() {
    var d = new Date();
    document.getElementById('daily-date-input').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    document.getElementById('daily-time-input').value = nowHHMM();
    // domain_owner: 添加进度时 domain 默认选当前登录的 domain(自有域); admin(owned=null)/普通用户(owned=[])保持空选
    var domSel = document.getElementById('daily-domain-select');
    var dnOwned = (typeof ownedDomainNames === 'function') ? ownedDomainNames() : [];
    domSel.value = (dnOwned && dnOwned.length > 0) ? dnOwned[0] : '';
    document.getElementById('daily-content-input').value = '';
    document.getElementById('daily-debug-input').value = '';
    dpResetAttach('add');
    openModal('add-daily-progress-modal');
}
function closeAddDailyProgressModal() {
    closeModal('add-daily-progress-modal');
    dpResetAttach('add');
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
    var debugInfo = document.getElementById('daily-debug-input').value.trim();
    if (debugInfo) newProgress.debugInfo = debugInfo;
    if (DP_ATTACH.add.length) {
        newProgress.attachments = DP_ATTACH.add.slice();
        DP_ATTACH.add.forEach(function(a) {
            // 附件记录属于本记录, 从待提交池移除
        });
    }
    
    App.data.dailyProgress.push(newProgress);
    renderDailyProgress(App.data.dailyProgress);

    closeAddDailyProgressModal();
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
        grouped[key].contents.push({
            id: progress.id, content: progress.content, time: progress.time || '',
            attachments: progress.attachments || null, debugInfo: progress.debugInfo || null
        });
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
            contentDiv.textContent = (item.time ? '🕐 ' + item.time + ' ' : '') + fmtBlockText(item.content, false, group.domain);
            
            // 附件 (截图缩略图 + 链接)
            if (item.attachments && item.attachments.length) {
                var attachSpan = document.createElement('span');
                attachSpan.innerHTML = dpAttachHtml(item.attachments);
                contentDiv.appendChild(attachSpan);
            }
            // 调试信息 (折叠)
            if (item.debugInfo) {
                var debugSpan = document.createElement('span');
                debugSpan.innerHTML = dpDebugHtml(item.debugInfo, group.domain);
                contentDiv.appendChild(debugSpan);
            }
            
            // 编辑/删除: 仅 admin 或该 domain 的 owner (其他 domain 只读)
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
    document.getElementById('edit-daily-debug').value = progress.debugInfo || '';
    DP_ATTACH.edit = (progress.attachments || []).slice();
    dpRenderAttachPreview('edit');
    
    openModal('edit-daily-progress-modal');
}

function closeEditDailyProgressModal() {
    closeModal('edit-daily-progress-modal');
    App.currentEditDailyProgressId = null;
    dpResetAttach('edit');
}

function saveEditedDailyProgress() {
    if (!App.currentEditDailyProgressId) return;
    
    var progress = App.data.dailyProgress.find(function(p) { return p.id === App.currentEditDailyProgressId; });
    if (!progress) return;
    
    var newDomain = document.getElementById('edit-daily-domain').value;
    progress.date = document.getElementById('edit-daily-date').value;
    progress.domain = newDomain;
    progress.content = document.getElementById('edit-daily-content').value.trim();
    var debugInfo = document.getElementById('edit-daily-debug').value.trim();
    if (debugInfo) progress.debugInfo = debugInfo; else delete progress.debugInfo;
    if (DP_ATTACH.edit.length) progress.attachments = DP_ATTACH.edit.slice(); else delete progress.attachments;
    
    var domainEntry = App.data.domains.find(function(d) { return d.name === newDomain; });
    progress.owner = domainEntry ? domainEntry.owner : '';
    
    saveAndRefresh('edit-daily-progress-modal', renderDailyProgress, 'dailyProgress', function() {
        App.currentEditDailyProgressId = null;
        dpResetAttach('edit');
    });
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

// ---------- 粘贴截图 / 拖拽上传 事件绑定 ----------
function dpBindEvents() {
    // 文件选择
    var addInput = document.getElementById('daily-attach-input');
    if (addInput) addInput.addEventListener('change', function() { dpUploadFiles(this.files, 'add'); this.value = ''; });
    var editInput = document.getElementById('edit-daily-attach-input');
    if (editInput) editInput.addEventListener('change', function() { dpUploadFiles(this.files, 'edit'); this.value = ''; });
    // 粘贴截图 (仅当目标在进度录入区/编辑弹窗内)
    document.addEventListener('paste', function(e) {
        var t = e.target;
        var inZone = t && (t.id === 'daily-content-input' || t.id === 'daily-debug-input' ||
            (t.closest && t.closest('#daily-attach-zone')) ||
            t.id === 'edit-daily-content' || t.id === 'edit-daily-debug' ||
            (t.closest && t.closest('#edit-daily-attach-zone')));
        if (!inZone) return;
        var items = (e.clipboardData && e.clipboardData.items) || [];
        var imgs = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].type && items[i].type.indexOf('image/') === 0) {
                var f = items[i].getAsFile();
                if (f) imgs.push(f);
            }
        }
        if (imgs.length) {
            e.preventDefault();
            var mode = t.closest && t.closest('#edit-daily-attach-zone') ? 'edit' : 'add';
            if (t.id === 'edit-daily-content' || t.id === 'edit-daily-debug') mode = 'edit';
            dpUploadFiles(imgs, mode);
        }
    });
    // 拖拽
    ['daily-attach-zone', 'edit-daily-attach-zone'].forEach(function(zid) {
        var zone = document.getElementById(zid);
        if (!zone) return;
        zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', function() { zone.classList.remove('dragover'); });
        zone.addEventListener('drop', function(e) {
            e.preventDefault();
            zone.classList.remove('dragover');
            var files = e.dataTransfer && e.dataTransfer.files;
            var mode = zid === 'daily-attach-zone' ? 'add' : 'edit';
            dpUploadFiles(files, mode);
        });
    });
}

// 页面加载即自动打上当前时间戳 (脚本位于 body 末尾, DOM 已就绪)
(function() {
    var t = document.getElementById('daily-time-input');
    if (t && !t.value) t.value = nowHHMM();
    dpBindEvents();
})();
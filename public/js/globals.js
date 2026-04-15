// Global state - encapsulated in App namespace to reduce global pollution
var App = {
    // === Data ===
    data: {
        domains: [
            { id: 'domain-1', name: '硅验证 (Silicon Validation)', owner: 'TBD', status: 'not-started', notes: '' },
            { id: 'domain-2', name: '电源管理 (Power Management)', owner: 'TBD', status: 'not-started', notes: '' },
            { id: 'domain-3', name: '热管理 (Thermal Management)', owner: 'TBD', status: 'not-started', notes: '' },
            { id: 'domain-4', name: '时钟与复位 (Clock & Reset)', owner: 'TBD', status: 'not-started', notes: '' },
            { id: 'domain-5', name: '内存子系统 (Memory Subsystem)', owner: 'TBD', status: 'not-started', notes: '' },
            { id: 'domain-6', name: 'PCIe接口 (PCIe Interface)', owner: 'TBD', status: 'not-started', notes: '' },
            { id: 'domain-7', name: '计算单元 (Compute Units)', owner: 'TBD', status: 'not-started', notes: '' },
            { id: 'domain-8', name: '互连 (Interconnect)', owner: 'TBD', status: 'not-started', notes: '' },
            { id: 'domain-9', name: '调试与跟踪 (Debug & Trace)', owner: 'TBD', status: 'not-started', notes: '' },
            { id: 'domain-10', name: '安全 (Security)', owner: 'TBD', status: 'not-started', notes: '' },
            { id: 'domain-11', name: '固件/BIOS (Firmware/BIOS)', owner: 'TBD', status: 'not-started', notes: '' },
            { id: 'domain-12', name: '驱动栈 (Driver Stack)', owner: 'TBD', status: 'not-started', notes: '' },
            { id: 'domain-13', name: '系统集成 (System Integration)', owner: 'TBD', status: 'not-started', notes: '' }
        ],
        tasks: [],
        bugs: [],
        dailyProgress: [],
        buExitCriteria: [
            { id: 'bu-1', index: 1, domain: '硅验证 (Silicon Validation)', criteria: '所有基本功能测试通过，无critical bug', owner: '张三', status: 'not-ready' },
            { id: 'bu-2', index: 2, domain: '电源管理 (Power Management)', criteria: '功耗测试符合规格要求，温度控制正常', owner: '李四', status: 'fail' },
            { id: 'bu-3', index: 3, domain: 'PCIe接口 (PCIe Interface)', criteria: 'PCIe链路稳定性测试通过，带宽达标', owner: '王五', status: 'pass' },
            { id: 'bu-4', index: 4, domain: '内存子系统 (Memory Subsystem)', criteria: '内存读写性能测试通过，ECC功能正常', owner: '赵六', status: 'not-ready' },
            { id: 'bu-5', index: 5, domain: '计算单元 (Compute Units)', criteria: '计算精度和性能基准测试通过', owner: '钱七', status: 'fail' }
        ],
        lastUpdated: '2026年3月3日 22:46'
    },

    // === Project ===
    currentProject: 'gpu-bringup',
    projectsList: [],

    // === Auth ===
    currentUser: null,
    userRole: null,
    authToken: null,

    // === Edit state ===
    currentEditDomainId: null,
    currentEditBugId: null,
    currentEditDailyProgressId: null,
    currentEditBUExitCriteriaId: null,

    // === Sorting ===
    currentTaskSort: { field: null, direction: 'asc' },
    currentBugSort: { field: null, direction: 'asc' },

    // === Filters ===
    currentTaskFilters: {},
    currentBugFilters: {},
    currentDailyProgressFilters: {},

    // === Constants ===
    statusColors: {
        'not-started': '#95a5a6',
        'in-progress': '#3498db',
        'blocked': '#e74c3c',
        'completed': '#27ae60'
    },
    statusText: {
        'not-started': '未开始',
        'in-progress': '进行中',
        'blocked': '受阻',
        'completed': '已完成'
    },
    severityText: {
        'highest': 'Highest', 'High': 'High',
        'high': 'High', 'medium': 'Medium', 'Medium': 'Medium',
        'low': 'Low', 'Low': 'Low',
        'lowest': 'Lowest', 'Lowest': 'Lowest'
    },
    bugStatusText: {
        'open': 'Open', 'triage': 'Triage', 'implement': 'Implement',
        'closed': 'Closed', 'rejected': 'Rejected'
    },
    severityColorClasses: {
        'highest': 'severity-highest', 'Highest': 'severity-highest',
        'high': 'severity-high', 'High': 'severity-high',
        'medium': 'severity-medium', 'Medium': 'severity-medium',
        'low': 'severity-low', 'Low': 'severity-low',
        'lowest': 'severity-lowest', 'Lowest': 'severity-lowest'
    },
    priorityText: { 'high': '高优先级', 'medium': '中优先级', 'low': '低优先级' },
    priorityColorClasses: {
        'high': 'priority-high-cell', 'medium': 'priority-medium-cell', 'low': 'priority-low-cell'
    },
    jiraBaseUrl: 'https://jira01.birentech.com/browse/',

    // Get default data structure
    getDefaultData: function() {
        return {
            domains: [
                { id: 'domain-1', name: '硅验证 (Silicon Validation)', owner: 'TBD', status: 'not-started', notes: '' },
                { id: 'domain-2', name: '电源管理 (Power Management)', owner: 'TBD', status: 'not-started', notes: '' },
                { id: 'domain-3', name: '热管理 (Thermal Management)', owner: 'TBD', status: 'not-started', notes: '' },
                { id: 'domain-4', name: '时钟与复位 (Clock & Reset)', owner: 'TBD', status: 'not-started', notes: '' },
                { id: 'domain-5', name: '内存子系统 (Memory Subsystem)', owner: 'TBD', status: 'not-started', notes: '' },
                { id: 'domain-6', name: 'PCIe接口 (PCIe Interface)', owner: 'TBD', status: 'not-started', notes: '' },
                { id: 'domain-7', name: '计算单元 (Compute Units)', owner: 'TBD', status: 'not-started', notes: '' },
                { id: 'domain-8', name: '互连 (Interconnect)', owner: 'TBD', status: 'not-started', notes: '' },
                { id: 'domain-9', name: '调试与跟踪 (Debug & Trace)', owner: 'TBD', status: 'not-started', notes: '' },
                { id: 'domain-10', name: '安全 (Security)', owner: 'TBD', status: 'not-started', notes: '' },
                { id: 'domain-11', name: '固件/BIOS (Firmware/BIOS)', owner: 'TBD', status: 'not-started', notes: '' },
                { id: 'domain-12', name: '驱动栈 (Driver Stack)', owner: 'TBD', status: 'not-started', notes: '' },
                { id: 'domain-13', name: '系统集成 (System Integration)', owner: 'TBD', status: 'not-started', notes: '' }
            ],
            tasks: [],
            bugs: [],
            dailyProgress: [],
            buExitCriteria: [],
            lastUpdated: new Date().toLocaleString('zh-CN')
        };
    },

    // Render all data sections
    renderAll: function() {
        renderDomains(App.data.domains);
        renderBugs(App.data.bugs);
        renderDailyProgress(App.data.dailyProgress);
        renderBUExitCriteria(App.data.buExitCriteria);
        updateUIBasedOnRole();
    }
};

// Backward compatibility aliases (will be removed in future)
// These let existing code work during transition
Object.defineProperty(window, 'currentData', {
    get: function() { return App.data; },
    set: function(v) { App.data = v; }
});
Object.defineProperty(window, 'currentProject', {
    get: function() { return App.currentProject; },
    set: function(v) { App.currentProject = v; }
});
Object.defineProperty(window, 'projectsList', {
    get: function() { return App.projectsList; },
    set: function(v) { App.projectsList = v; }
});
Object.defineProperty(window, 'currentUser', {
    get: function() { return App.currentUser; },
    set: function(v) { App.currentUser = v; }
});
Object.defineProperty(window, 'userRole', {
    get: function() { return App.userRole; },
    set: function(v) { App.userRole = v; }
});
Object.defineProperty(window, 'authToken', {
    get: function() { return App.authToken; },
    set: function(v) { App.authToken = v; }
});
Object.defineProperty(window, 'currentEditDomainId', {
    get: function() { return App.currentEditDomainId; },
    set: function(v) { App.currentEditDomainId = v; }
});
Object.defineProperty(window, 'currentEditBugId', {
    get: function() { return App.currentEditBugId; },
    set: function(v) { App.currentEditBugId = v; }
});
Object.defineProperty(window, 'currentEditDailyProgressId', {
    get: function() { return App.currentEditDailyProgressId; },
    set: function(v) { App.currentEditDailyProgressId = v; }
});
Object.defineProperty(window, 'currentEditBUExitCriteriaId', {
    get: function() { return App.currentEditBUExitCriteriaId; },
    set: function(v) { App.currentEditBUExitCriteriaId = v; }
});
Object.defineProperty(window, 'currentBugSort', {
    get: function() { return App.currentBugSort; },
    set: function(v) { App.currentBugSort = v; }
});
Object.defineProperty(window, 'currentTaskSort', {
    get: function() { return App.currentTaskSort; },
    set: function(v) { App.currentTaskSort = v; }
});
Object.defineProperty(window, 'currentBugFilters', {
    get: function() { return App.currentBugFilters; },
    set: function(v) { App.currentBugFilters = v; }
});
Object.defineProperty(window, 'currentTaskFilters', {
    get: function() { return App.currentTaskFilters; },
    set: function(v) { App.currentTaskFilters = v; }
});
Object.defineProperty(window, 'currentDailyProgressFilters', {
    get: function() { return App.currentDailyProgressFilters; },
    set: function(v) { App.currentDailyProgressFilters = v; }
});

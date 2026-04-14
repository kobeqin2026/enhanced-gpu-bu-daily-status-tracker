// Global data storage
let currentData = {
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
    dailyProgress: [], // New: daily progress tracking
    buExitCriteria: [
        { id: 'bu-1', index: 1, domain: '硅验证 (Silicon Validation)', criteria: '所有基本功能测试通过，无critical bug', owner: '张三', status: 'not-ready' },
        { id: 'bu-2', index: 2, domain: '电源管理 (Power Management)', criteria: '功耗测试符合规格要求，温度控制正常', owner: '李四', status: 'fail' },
        { id: 'bu-3', index: 3, domain: 'PCIe接口 (PCIe Interface)', criteria: 'PCIe链路稳定性测试通过，带宽达标', owner: '王五', status: 'pass' },
        { id: 'bu-4', index: 4, domain: '内存子系统 (Memory Subsystem)', criteria: '内存读写性能测试通过，ECC功能正常', owner: '赵六', status: 'not-ready' },
        { id: 'bu-5', index: 5, domain: '计算单元 (Compute Units)', criteria: '计算精度和性能基准测试通过', owner: '钱七', status: 'fail' }
    ], // NEW: BU Exit Criteria with test data
    lastUpdated: '2026年3月3日 22:46'
};

// Current project
let currentProject = 'gpu-bringup';
let projectsList = [];

// User authentication
let currentUser = null;
let userRole = null; // 'admin' or 'user'
let authToken = null; // 认证token（仅存内存，httpOnly cookie由后端管理）

// Current edit IDs
let currentEditDomainId = null;
let currentEditBugId = null;
let currentEditDailyProgressId = null;
let currentEditBUExitCriteriaId = null; // NEW

// Sorting states
let currentTaskSort = { field: null, direction: 'asc' };
let currentBugSort = { field: null, direction: 'asc' };

// Filter states
let currentTaskFilters = {};
let currentBugFilters = {};
let currentDailyProgressFilters = {}; // New: daily progress filters

// Status colors mapping
const statusColors = {
    'not-started': '#95a5a6', // 灰色
    'in-progress': '#3498db', // 蓝色
    'blocked': '#e74c3c',     // 红色
    'completed': '#27ae60'    // 绿色
};

// Status text mapping
const statusText = {
    'not-started': '未开始',
    'in-progress': '进行中',
    'blocked': '受阻',
    'completed': '已完成'
};

// Severity text mapping (support both lowercase and uppercase)
const severityText = {
    'highest': 'Highest',
    'Highest': 'Highest',
    'high': 'High',
    'High': 'High',
    'medium': 'Medium',
    'Medium': 'Medium',
    'low': 'Low',
    'Low': 'Low',
    'lowest': 'Lowest',
    'Lowest': 'Lowest'
};

// Bug status text mapping
const bugStatusText = {
    'open': 'Open',
    'triage': 'Triage',
    'implement': 'Implement',
    'closed': 'Closed',
    'rejected': 'Rejected'
};

// Severity color classes (support both lowercase and uppercase)
const severityColorClasses = {
    'highest': 'severity-highest',
    'Highest': 'severity-highest',
    'high': 'severity-high',
    'High': 'severity-high',
    'medium': 'severity-medium',
    'Medium': 'severity-medium',
    'low': 'severity-low',
    'Low': 'severity-low',
    'lowest': 'severity-lowest',
    'Lowest': 'severity-lowest'
};

// Priority text mapping
const priorityText = {
    'high': '高优先级',
    'medium': '中优先级',
    'low': '低优先级'
};

// Priority color classes
const priorityColorClasses = {
    'high': 'priority-high-cell',
    'medium': 'priority-medium-cell',
    'low': 'priority-low-cell'
};

// JIRA base URL
const jiraBaseUrl = 'https://jira01.birentech.com/browse/';

// Get default data structure (used when no project data exists)
function getDefaultData() {
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
}

// Render all data sections
function renderAll() {
    renderDomains(currentData.domains);
    renderBugs(currentData.bugs);
    renderDailyProgress(currentData.dailyProgress);
    renderBUExitCriteria(currentData.buExitCriteria);
    updateUIBasedOnRole();
}

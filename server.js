const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const LOG_DIR = path.join(__dirname, 'logs');

// 安全配置
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 小时

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ============ 文件锁机制 ============
const locks = new Map();

async function acquireLock(filePath, timeout = 5000) {
    const lockId = filePath;
    const startTime = Date.now();
    
    while (locks.has(lockId)) {
        if (Date.now() - startTime > timeout) {
            throw new Error(`获取文件锁超时：${filePath}`);
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    locks.set(lockId, true);
    return true;
}

function releaseLock(filePath) {
    locks.delete(filePath);
}

// ============ 自动备份机制 ============
function backupFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    
    const backupPath = filePath + '.bak';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const versionedBackup = `${filePath}.${timestamp}.bak`;
    
    try {
        // 保留最新备份
        if (fs.existsSync(backupPath)) {
            fs.renameSync(backupPath, versionedBackup);
        }
        // 创建新备份
        fs.copyFileSync(filePath, backupPath);
        console.log(`备份完成：${filePath} -> ${backupPath}`);
    } catch (error) {
        console.error(`备份失败：${filePath}`, error);
    }
}

// ============ 数据校验 ============
function validateUserData(user) {
    if (!user.username || !user.password || !user.role || !user.name) {
        throw new Error('用户数据缺少必需字段');
    }
    if (!['admin', 'user'].includes(user.role)) {
        throw new Error(`无效的角色：${user.role}`);
    }
    return true;
}

function validateProjectData(data) {
    const required = ['domains', 'bugs', 'dailyProgress', 'buExitCriteria'];
    for (const field of required) {
        if (!Array.isArray(data[field])) {
            throw new Error(`项目数据缺少必需字段或类型错误：${field}`);
        }
    }
    return true;
}

function validateProject(project) {
    if (!project.id || !project.name) {
        throw new Error('项目缺少必需字段：id 或 name');
    }
    return true;
}

// ============ 操作日志 ============
function logOperation(user, action, resource, details = {}) {
    const logFile = path.join(LOG_DIR, `operations-${new Date().toISOString().split('T')[0]}.log`);
    const logEntry = {
        timestamp: new Date().toISOString(),
        user: user || 'system',
        action,
        resource,
        details,
        ip: details.ip || 'unknown'
    };
    
    const logLine = JSON.stringify(logEntry) + '\n';
    
    try {
        fs.appendFileSync(logFile, logLine);
    } catch (error) {
        console.error('写入操作日志失败:', error);
    }
}

// ============ 安全写入 JSON（带锁 + 备份 + 校验） ============
async function safeWriteJSON(filePath, data, validateFn = null) {
    await acquireLock(filePath);
    
    try {
        // 数据校验
        if (validateFn) {
            validateFn(data);
        }
        
        // 备份原文件
        backupFile(filePath);
        
        // 写入新数据
        await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
        
        console.log(`写入成功：${filePath}`);
        return true;
    } catch (error) {
        console.error(`写入失败：${filePath}`, error);
        throw error;
    } finally {
        releaseLock(filePath);
    }
}

// ============ 用户数据 ============
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// 密码处理函数 - 明文存储
function hashPassword(password) {
    return password;
}

// 验证密码
function verifyPassword(password, storedPassword) {
    return password === storedPassword;
}

// 默认用户列表（明文密码）
function getDefaultUsers() {
    return [
        { id: 'admin', username: 'admin', password: 'admin123', role: 'admin', name: '管理员', createdAt: new Date().toISOString() },
        { id: 'user', username: 'user', password: 'user123', role: 'user', name: '普通用户', createdAt: new Date().toISOString() }
    ];
}

async function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading users:', e);
    }
    // 如果用户文件不存在，创建默认用户
    const defaultUsers = getDefaultUsers();
    await safeWriteJSON(USERS_FILE, defaultUsers, validateUserData);
    return defaultUsers;
}

async function saveUsers(users) {
    // 验证每个用户
    for (const user of users) {
        validateUserData(user);
    }
    await safeWriteJSON(USERS_FILE, users, null);
}

// ============ Token 生成 ============
function generateToken(username) {
    const timestamp = Date.now();
    const random = crypto.randomBytes(16).toString('hex');
    return crypto.createHash('sha256').update(`${username}:${timestamp}:${random}`).digest('hex').substring(0, 32);
}

// ============ Session 存储 ============
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
let sessions = {};

// 加载 sessions
function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            sessions = JSON.parse(data);
            console.log(`Loaded ${Object.keys(sessions).length} sessions from file`);
        }
    } catch (error) {
        console.error('Failed to load sessions:', error);
        sessions = {};
    }
}

// 保存 sessions
async function saveSessions() {
    try {
        await safeWriteJSON(SESSIONS_FILE, sessions, null);
    } catch (error) {
        console.error('Failed to save sessions:', error);
    }
}

// 启动时加载 sessions
loadSessions();

// 定期保存 sessions (每 30 秒)
setInterval(saveSessions, 30000);

// 进程退出时保存
process.on('exit', () => {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    } catch (e) {}
});
process.on('SIGINT', () => {
    saveSessions().then(() => process.exit());
});
process.on('SIGTERM', () => {
    saveSessions().then(() => process.exit());
});

// ============ 认证中间件 ============
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: '未登录或登录已过期' });
    }
    
    const session = Object.values(sessions).find(s => s.token === token);
    if (!session) {
        return res.status(401).json({ success: false, message: '无效的 token' });
    }
    
    // 检查 token 过期 (24 小时)
    if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
        delete sessions[session.username];
        saveSessions();
        return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
    }
    
    req.user = session;
    next();
}

// 管理员检查中间件
function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        logOperation(req.user?.username, 'DENIED', 'admin-access', { reason: 'non-admin' });
        res.status(403).json({ success: false, message: '需要管理员权限' });
    }
}

// ============ 项目数据管理 ============
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

function getDefaultProjects() {
    return [
        { id: 'gpu-bringup', name: 'GPU Bring Up', description: '国产 GPU 芯片 bring up 每日追踪', createdAt: new Date().toISOString() },
        { id: 'project-2', name: '项目二', description: '第二个项目', createdAt: new Date().toISOString() }
    ];
}

async function loadProjects() {
    try {
        if (fs.existsSync(PROJECTS_FILE)) {
            return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading projects:', e);
    }
    const defaultProjects = getDefaultProjects();
    await safeWriteJSON(PROJECTS_FILE, defaultProjects, null);
    return defaultProjects;
}

async function saveProjects(projects) {
    for (const project of projects) {
        validateProject(project);
    }
    await safeWriteJSON(PROJECTS_FILE, projects, null);
}

function getProjectDataFile(projectId) {
    const sanitizedId = projectId.replace(/[^a-zA-Z0-9\-_]/g, '');
    if (sanitizedId !== projectId) {
        console.warn(`Potential path traversal attempt detected: ${projectId}`);
        return null;
    }
    const filePath = path.join(DATA_DIR, `${sanitizedId}.json`);
    if (!filePath.startsWith(DATA_DIR)) {
        return null;
    }
    return filePath;
}

async function loadProjectData(projectId) {
    const filePath = getProjectDataFile(projectId);
    try {
        if (filePath && fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`Error loading project ${projectId}:`, e);
    }
    return {
        domains: [],
        bugs: [],
        dailyProgress: [],
        buExitCriteria: [],
        lastUpdated: new Date().toLocaleString('zh-CN')
    };
}

async function saveProjectData(projectId, data) {
    const filePath = getProjectDataFile(projectId);
    validateProjectData(data);
    data.lastUpdated = new Date().toLocaleString('zh-CN');
    await safeWriteJSON(filePath, data, null);
}

// ============ Middleware ============
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ============ API Routes ============

// API: 获取项目列表
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await loadProjects();
        res.json(projects);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 获取项目数据
app.get('/api/data', async (req, res) => {
    try {
        const projectId = req.query.project || 'gpu-bringup';
        const data = await loadProjectData(projectId);
        res.json(data);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 保存项目数据（需要认证）
app.post('/api/data', authenticateToken, async (req, res) => {
    try {
        const projectId = req.body.projectId || req.query.project || 'gpu-bringup';
        const { domains, bugs, dailyProgress, buExitCriteria } = req.body;
        
        const data = {
            domains: domains || [],
            bugs: bugs || [],
            dailyProgress: dailyProgress || [],
            buExitCriteria: buExitCriteria || [],
            lastUpdated: new Date().toLocaleString('zh-CN')
        };
        
        await saveProjectData(projectId, data);
        logOperation(req.user.username, 'UPDATE', 'project-data', { projectId });
        console.log(`Saved data for project: ${projectId}`);
        res.json({ success: true, message: 'Data saved successfully' });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'project-data', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ 用户管理 API ============

// API: 用户登录
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
        }
        
        const users = await loadUsers();
        const user = users.find(u => u.username === username);
        
        if (!user || !verifyPassword(password, user.password)) {
            logOperation(username, 'LOGIN_FAILED', 'users', { reason: 'invalid-credentials' });
            return res.status(401).json({ success: false, message: '用户名或密码错误' });
        }
        
        const token = generateToken(username);
        
        sessions[username] = {
            username: user.username,
            role: user.role,
            name: user.name,
            token: token,
            createdAt: Date.now()
        };
        
        logOperation(username, 'LOGIN', 'users', { role: user.role });
        console.log(`User logged in: ${username}, role: ${user.role}`);
        await saveSessions();
        
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: TOKEN_EXPIRY,
            sameSite: 'strict'
        });
        
        res.json({ 
            success: true, 
            user: { 
                username: user.username, 
                role: user.role, 
                name: user.name 
            },
            token: token
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 用户登出
app.post('/api/auth/logout', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        if (token) {
            const session = Object.values(sessions).find(s => s.token === token);
            if (session) {
                logOperation(session.username, 'LOGOUT', 'users');
                delete sessions[session.username];
                console.log(`User logged out: ${session.username}`);
                await saveSessions();
            }
        }
        
        res.json({ success: true, message: '登出成功' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 验证 token
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ 
        success: true, 
        user: {
            username: req.user.username,
            role: req.user.role,
            name: req.user.name
        }
    });
});

// API: 获取用户列表 (仅管理员)
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await loadUsers();
        const safeUsers = users.map(u => ({
            id: u.id,
            username: u.username,
            role: u.role,
            name: u.name,
            createdAt: u.createdAt
        }));
        res.json(safeUsers);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 添加用户 (仅管理员)
app.post('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { username, password, role, name } = req.body;
        
        if (!username || !password || !role || !name) {
            return res.status(400).json({ success: false, message: '所有字段都不能为空' });
        }
        
        if (!['admin', 'user'].includes(role)) {
            return res.status(400).json({ success: false, message: '无效的角色' });
        }
        
        const users = await loadUsers();
        
        if (users.find(u => u.username === username)) {
            return res.status(400).json({ success: false, message: '用户名已存在' });
        }
        
        const newUser = {
            id: username,
            username: username,
            password: password,
            role: role,
            name: name,
            createdAt: new Date().toISOString()
        };
        
        users.push(newUser);
        await saveUsers(users);
        
        logOperation(req.user.username, 'CREATE', 'users', { targetUser: username, role });
        console.log(`User created: ${username} by ${req.user.username}`);
        
        res.json({ 
            success: true, 
            message: '用户创建成功',
            user: { id: newUser.id, username: newUser.username, role: newUser.role, name: newUser.name }
        });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'users', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 修改用户密码 (仅管理员或本人)
app.put('/api/users/:id/password', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        const { newPassword } = req.body;
        
        if (!newPassword || newPassword.length < 4) {
            return res.status(400).json({ success: false, message: '密码至少 4 个字符' });
        }
        
        if (req.user.role !== 'admin' && req.user.username !== userId) {
            return res.status(403).json({ success: false, message: '没有权限修改此用户密码' });
        }
        
        const users = await loadUsers();
        const userIndex = users.findIndex(u => u.username === userId);
        
        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        users[userIndex].password = newPassword;
        await saveUsers(users);
        
        logOperation(req.user.username, 'PASSWORD_CHANGE', 'users', { targetUser: userId });
        console.log(`Password changed for: ${userId} by ${req.user.username}`);
        
        res.json({ success: true, message: '密码修改成功' });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'users', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 删除用户 (仅管理员)
app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        
        if (userId === req.user.username) {
            return res.status(400).json({ success: false, message: '不能删除自己的账号' });
        }
        
        const users = await loadUsers();
        const userIndex = users.findIndex(u => u.username === userId);
        
        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        const targetUser = users[userIndex];
        if (targetUser.role === 'admin') {
            return res.status(400).json({ success: false, message: '不能删除管理员账号' });
        }
        
        const deletedUser = users[userIndex];
        users.splice(userIndex, 1);
        await saveUsers(users);
        
        if (sessions[userId]) {
            delete sessions[userId];
        }
        
        logOperation(req.user.username, 'DELETE', 'users', { targetUser: userId, role: deletedUser.role });
        console.log(`User deleted: ${userId} by ${req.user.username}`);
        
        res.json({ success: true, message: '用户已删除', user: deletedUser });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'users', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 修改用户信息 (管理员或本人)
app.put('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        const { name, role } = req.body;
        const currentUser = req.user;
        
        const isAdmin = currentUser.role === 'admin';
        const isSelf = currentUser.username === userId;
        
        const users = await loadUsers();
        const targetUser = users.find(u => u.username === userId);
        
        if (!targetUser) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        if (!isAdmin && !isSelf) {
            return res.status(403).json({ success: false, message: '没有权限修改此用户信息' });
        }
        
        if (!isAdmin && targetUser.role === 'admin') {
            return res.status(403).json({ success: false, message: '没有权限修改管理员信息' });
        }
        
        if (role) {
            if (isAdmin) {
                if (['admin', 'user'].includes(role)) {
                    users.find(u => u.username === userId).role = role;
                }
            } else {
                return res.status(403).json({ success: false, message: '普通用户不能修改角色' });
            }
        }
        
        if (name) {
            users.find(u => u.username === userId).name = name;
        }
        
        await saveUsers(users);
        
        if (sessions[userId]) {
            sessions[userId].role = users.find(u => u.username === userId).role;
        }
        
        logOperation(req.user.username, 'UPDATE', 'users', { targetUser: userId, changes: { name, role } });
        console.log(`User updated: ${userId} by ${currentUser.username}`);
        
        res.json({ 
            success: true, 
            message: '用户信息已更新',
            user: { 
                username: users.find(u => u.username === userId).username, 
                role: users.find(u => u.username === userId).role, 
                name: users.find(u => u.username === userId).name 
            }
        });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'users', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ 项目管理 API ============

// API: 创建新项目 (需要管理员)
app.post('/api/projects', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: '项目名称不能为空' });
        }
        
        const projects = await loadProjects();
        const newProject = {
            id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            name: name,
            description: description || '',
            createdAt: new Date().toISOString()
        };
        
        projects.push(newProject);
        await saveProjects(projects);
        
        await saveProjectData(newProject.id, {
            domains: [],
            bugs: [],
            dailyProgress: [],
            buExitCriteria: [],
            lastUpdated: new Date().toLocaleString('zh-CN')
        });
        
        logOperation(req.user.username, 'CREATE', 'projects', { projectId: newProject.id, name });
        res.json({ success: true, project: newProject });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'projects', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 修改项目 (需要管理员)
app.put('/api/projects/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const projectId = req.params.id;
        const { name, description, startDate, endDate } = req.body;
        
        if (!name) {
            return res.status(400).json({ success: false, message: '项目名称不能为空' });
        }
        
        const projects = await loadProjects();
        const projectIndex = projects.findIndex(p => p.id === projectId);
        
        if (projectIndex === -1) {
            return res.status(404).json({ success: false, message: '项目不存在' });
        }
        
        projects[projectIndex].name = name;
        projects[projectIndex].description = description || '';
        if (startDate) projects[projectIndex].startDate = startDate;
        if (endDate) projects[projectIndex].endDate = endDate;
        
        await saveProjects(projects);
        
        logOperation(req.user.username, 'UPDATE', 'projects', { projectId, changes: { name, description } });
        res.json({ success: true, project: projects[projectIndex] });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'projects', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 删除项目 (需要管理员)
app.delete('/api/projects/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const projectId = req.params.id;
        
        const projects = await loadProjects();
        const projectIndex = projects.findIndex(p => p.id === projectId);
        
        if (projectIndex === -1) {
            return res.status(404).json({ success: false, message: '项目不存在' });
        }
        
        const deletedProject = projects[projectIndex];
        projects.splice(projectIndex, 1);
        await saveProjects(projects);
        
        const dataFile = getProjectDataFile(projectId);
        if (dataFile && fs.existsSync(dataFile)) {
            fs.unlinkSync(dataFile);
        }
        
        logOperation(req.user.username, 'DELETE', 'projects', { projectId, name: deletedProject.name });
        res.json({ success: true, message: '项目已删除', project: deletedProject });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'projects', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ 数据导出 API ============

// API: 导出项目数据为 JSON
app.get('/api/export/:projectId', authenticateToken, async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const data = await loadProjectData(projectId);
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${projectId}-${Date.now()}.json"`);
        
        logOperation(req.user.username, 'EXPORT', 'projects', { projectId });
        res.json(data);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 获取操作日志 (仅管理员)
app.get('/api/logs/:date?', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const date = req.params.date || new Date().toISOString().split('T')[0];
        const logFile = path.join(LOG_DIR, `operations-${date}.log`);
        
        if (!fs.existsSync(logFile)) {
            return res.json([]);
        }
        
        const logContent = fs.readFileSync(logFile, 'utf8');
        const logs = logContent.trim().split('\n').filter(line => line).map(line => JSON.parse(line));
        
        res.json(logs);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Static files are served by express.static from public/ directory above

app.listen(PORT, '0.0.0.0', () => {
    console.log(`国产 GPU 芯片 bring up Web Server running on http://0.0.0.0:${PORT}`);
    console.log(`数据目录：${DATA_DIR}`);
    console.log(`日志目录：${LOG_DIR}`);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`Access from company network: http://47.77.221.23:${PORT}`);
    }
});

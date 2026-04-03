const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// 确保data目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 用户数据文件
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// 默认用户列表
function getDefaultUsers() {
    return [
        { id: 'admin', username: 'admin', password: 'admin123', role: 'admin', name: '管理员', createdAt: new Date().toISOString() },
        { id: 'user', username: 'user', password: 'user123', role: 'user', name: '普通用户', createdAt: new Date().toISOString() }
    ];
}

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading users:', e);
    }
    // 如果用户文件不存在，创建默认用户
    const defaultUsers = getDefaultUsers();
    saveUsers(defaultUsers);
    return defaultUsers;
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// 简单的token生成
function generateToken(username) {
    const timestamp = Date.now();
    const random = crypto.randomBytes(16).toString('hex');
    return crypto.createHash('sha256').update(`${username}:${timestamp}:${random}`).digest('hex').substring(0, 32);
}

// Session存储 (生产环境应该用Redis)
const sessions = {};

// 中间件：解析token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        // 对于需要认证的API，检查是否有token
        return res.status(401).json({ success: false, message: '未登录或登录已过期' });
    }
    
    // 查找session
    const session = Object.values(sessions).find(s => s.token === token);
    if (!session) {
        return res.status(401).json({ success: false, message: '无效的token' });
    }
    
    // 检查token过期 (24小时)
    if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
        delete sessions[session.username];
        return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
    }
    
    req.user = session;
    next();
}

// 中间件：检查是否为管理员
function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ success: false, message: '需要管理员权限' });
    }
}

// 默认项目列表
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
function getDefaultProjects() {
    return [
        { id: 'gpu-bringup', name: 'GPU Bring Up', description: '国产GPU芯片bring up每日追踪', createdAt: new Date().toISOString() },
        { id: 'project-2', name: '项目二', description: '第二个项目', createdAt: new Date().toISOString() }
    ];
}

function loadProjects() {
    try {
        if (fs.existsSync(PROJECTS_FILE)) {
            return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading projects:', e);
    }
    return getDefaultProjects();
}

function saveProjects(projects) {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

function getProjectDataFile(projectId) {
    return path.join(DATA_DIR, `${projectId}.json`);
}

function loadProjectData(projectId) {
    const filePath = getProjectDataFile(projectId);
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`Error loading project ${projectId}:`, e);
    }
    // 返回空数据
    return {
        domains: [],
        bugs: [],
        dailyProgress: [],
        buExitCriteria: [],
        lastUpdated: new Date().toLocaleString('zh-CN')
    };
}

function saveProjectData(projectId, data) {
    const filePath = getProjectDataFile(projectId);
    data.lastUpdated = new Date().toLocaleString('zh-CN');
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Middleware to parse JSON
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: 获取项目列表
app.get('/api/projects', (req, res) => {
    const projects = loadProjects();
    res.json(projects);
});

// API: 创建新项目
app.post('/api/projects', (req, res) => {
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ success: false, message: '项目名称不能为空' });
    }
    
    const projects = loadProjects();
    const newProject = {
        id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        name: name,
        description: description || '',
        createdAt: new Date().toISOString()
    };
    projects.push(newProject);
    saveProjects(projects);
    
    // 创建空的初始数据文件
    saveProjectData(newProject.id, {
        domains: [],
        bugs: [],
        dailyProgress: [],
        buExitCriteria: [],
        lastUpdated: new Date().toLocaleString('zh-CN')
    });
    
    res.json({ success: true, project: newProject });
});

// API: 修改项目
app.put('/api/projects/:id', (req, res) => {
    const projectId = req.params.id;
    const { name, description } = req.body;
    
    if (!name) {
        return res.status(400).json({ success: false, message: '项目名称不能为空' });
    }
    
    const projects = loadProjects();
    const projectIndex = projects.findIndex(p => p.id === projectId);
    
    if (projectIndex === -1) {
        return res.status(404).json({ success: false, message: '项目不存在' });
    }
    
    // 更新项目信息
    projects[projectIndex].name = name;
    projects[projectIndex].description = description || '';
    saveProjects(projects);
    
    res.json({ success: true, project: projects[projectIndex] });
});

// API: 删除项目
app.delete('/api/projects/:id', (req, res) => {
    const projectId = req.params.id;
    
    const projects = loadProjects();
    const projectIndex = projects.findIndex(p => p.id === projectId);
    
    if (projectIndex === -1) {
        return res.status(404).json({ success: false, message: '项目不存在' });
    }
    
    const deletedProject = projects[projectIndex];
    
    // 从列表中移除
    projects.splice(projectIndex, 1);
    saveProjects(projects);
    
    // 删除项目数据文件
    const dataFile = getProjectDataFile(projectId);
    if (fs.existsSync(dataFile)) {
        fs.unlinkSync(dataFile);
    }
    
    res.json({ success: true, message: '项目已删除', project: deletedProject });
});

// API: 获取项目数据
app.get('/api/data', (req, res) => {
    const projectId = req.query.project || 'gpu-bringup';
    const data = loadProjectData(projectId);
    res.json(data);
});

// API: 保存项目数据
app.post('/api/data', (req, res) => {
    const projectId = req.body.projectId || req.query.project || 'gpu-bringup';
    const { domains, bugs, dailyProgress, buExitCriteria } = req.body;
    
    const data = {
        domains: domains || [],
        bugs: bugs || [],
        dailyProgress: dailyProgress || [],
        buExitCriteria: buExitCriteria || [],
        lastUpdated: new Date().toLocaleString('zh-CN')
    };
    
    saveProjectData(projectId, data);
    console.log(`Saved data for project: ${projectId}`);
    res.json({ success: true, message: 'Data saved successfully' });
});

// ============ 用户管理 API ============

// API: 用户登录
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    
    const users = loadUsers();
    const user = users.find(u => u.username === username && u.password === password);
    
    if (!user) {
        return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    
    // 生成token
    const token = generateToken(username);
    
    // 存储session
    sessions[username] = {
        username: user.username,
        role: user.role,
        name: user.name,
        token: token,
        createdAt: Date.now()
    };
    
    console.log(`User logged in: ${username}, role: ${user.role}`);
    
    res.json({ 
        success: true, 
        user: { 
            username: user.username, 
            role: user.role, 
            name: user.name 
        },
        token: token
    });
});

// API: 用户登出
app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
        const session = Object.values(sessions).find(s => s.token === token);
        if (session) {
            delete sessions[session.username];
            console.log(`User logged out: ${session.username}`);
        }
    }
    
    res.json({ success: true, message: '登出成功' });
});

// API: 验证token
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
app.get('/api/users', authenticateToken, requireAdmin, (req, res) => {
    const users = loadUsers();
    // 不返回密码
    const safeUsers = users.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        name: u.name,
        createdAt: u.createdAt
    }));
    res.json(safeUsers);
});

// API: 添加用户 (仅管理员)
app.post('/api/users', authenticateToken, requireAdmin, (req, res) => {
    const { username, password, role, name } = req.body;
    
    if (!username || !password || !role || !name) {
        return res.status(400).json({ success: false, message: '所有字段都不能为空' });
    }
    
    if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ success: false, message: '无效的角色' });
    }
    
    const users = loadUsers();
    
    // 检查用户名是否已存在
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
    saveUsers(users);
    
    console.log(`User created: ${username} by ${req.user.username}`);
    
    res.json({ 
        success: true, 
        message: '用户创建成功',
        user: { id: newUser.id, username: newUser.username, role: newUser.role, name: newUser.name }
    });
});

// API: 修改用户密码 (仅管理员或本人)
app.put('/api/users/:id/password', authenticateToken, (req, res) => {
    const userId = req.params.id;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ success: false, message: '密码至少4个字符' });
    }
    
    // 只有管理员或本人可以修改密码
    if (req.user.role !== 'admin' && req.user.username !== userId) {
        return res.status(403).json({ success: false, message: '没有权限修改此用户密码' });
    }
    
    const users = loadUsers();
    const userIndex = users.findIndex(u => u.username === userId);
    
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    users[userIndex].password = newPassword;
    saveUsers(users);
    
    console.log(`Password changed for: ${userId} by ${req.user.username}`);
    
    res.json({ success: true, message: '密码修改成功' });
});

// API: 删除用户 (仅管理员)
app.delete('/api/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const userId = req.params.id;
    
    // 不允许删除自己
    if (userId === req.user.username) {
        return res.status(400).json({ success: false, message: '不能删除自己的账号' });
    }
    
    const users = loadUsers();
    const userIndex = users.findIndex(u => u.username === userId);
    
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    // 不允许删除管理员账户
    const targetUser = users[userIndex];
    if (targetUser.role === 'admin') {
        return res.status(400).json({ success: false, message: '不能删除管理员账号' });
    }
    
    const deletedUser = users[userIndex];
    users.splice(userIndex, 1);
    saveUsers(users);
    
    // 如果该用户有session，删除
    if (sessions[userId]) {
        delete sessions[userId];
    }
    
    console.log(`User deleted: ${userId} by ${req.user.username}`);
    
    res.json({ success: true, message: '用户已删除', user: deletedUser });
});

// API: 修改用户信息 (管理员或本人)
app.put('/api/users/:id', authenticateToken, (req, res) => {
    const userId = req.params.id;
    const { name, role } = req.body;
    const currentUser = req.user;
    
    // 权限检查：
    // - 管理员可以修改任何用户的信息和角色
    // - 普通用户只能修改自己的信息，不能修改角色
    const isAdmin = currentUser.role === 'admin';
    const isSelf = currentUser.username === userId;
    
    // 获取目标用户信息
    const users = loadUsers();
    const targetUser = users.find(u => u.username === userId);
    
    if (!targetUser) {
        return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    // 权限验证
    if (!isAdmin && !isSelf) {
        return res.status(403).json({ success: false, message: '没有权限修改此用户信息' });
    }
    
    // 管理员不能被普通用户修改角色
    if (!isAdmin && targetUser.role === 'admin') {
        return res.status(403).json({ success: false, message: '没有权限修改管理员信息' });
    }
    
    // 只有管理员可以修改角色
    if (role) {
        if (isAdmin) {
            if (['admin', 'user'].includes(role)) {
                users.find(u => u.username === userId).role = role;
            }
        } else {
            // 普通用户不能修改角色
            return res.status(403).json({ success: false, message: '普通用户不能修改角色' });
        }
    }
    
    // 更新显示名称
    if (name) {
        users.find(u => u.username === userId).name = name;
    }
    
    saveUsers(users);
    
    // 如果修改了角色，更新session
    if (sessions[userId]) {
        sessions[userId].role = users.find(u => u.username === userId).role;
    }
    
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
});

// ============ 数据修改API需要认证 ============

// API: 创建新项目 (需要管理员)
app.post('/api/projects', authenticateToken, requireAdmin, (req, res) => {
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ success: false, message: '项目名称不能为空' });
    }
    
    const projects = loadProjects();
    const newProject = {
        id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        name: name,
        description: description || '',
        createdAt: new Date().toISOString()
    };
    projects.push(newProject);
    saveProjects(projects);
    
    saveProjectData(newProject.id, {
        domains: [],
        bugs: [],
        dailyProgress: [],
        buExitCriteria: [],
        lastUpdated: new Date().toLocaleString('zh-CN')
    });
    
    res.json({ success: true, project: newProject });
});

// API: 修改项目 (需要管理员)
app.put('/api/projects/:id', authenticateToken, requireAdmin, (req, res) => {
    const projectId = req.params.id;
    const { name, description } = req.body;
    
    if (!name) {
        return res.status(400).json({ success: false, message: '项目名称不能为空' });
    }
    
    const projects = loadProjects();
    const projectIndex = projects.findIndex(p => p.id === projectId);
    
    if (projectIndex === -1) {
        return res.status(404).json({ success: false, message: '项目不存在' });
    }
    
    projects[projectIndex].name = name;
    projects[projectIndex].description = description || '';
    saveProjects(projects);
    
    res.json({ success: true, project: projects[projectIndex] });
});

// API: 删除项目 (需要管理员)
app.delete('/api/projects/:id', authenticateToken, requireAdmin, (req, res) => {
    const projectId = req.params.id;
    
    const projects = loadProjects();
    const projectIndex = projects.findIndex(p => p.id === projectId);
    
    if (projectIndex === -1) {
        return res.status(404).json({ success: false, message: '项目不存在' });
    }
    
    const deletedProject = projects[projectIndex];
    projects.splice(projectIndex, 1);
    saveProjects(projects);
    
    const dataFile = getProjectDataFile(projectId);
    if (fs.existsSync(dataFile)) {
        fs.unlinkSync(dataFile);
    }
    
    res.json({ success: true, message: '项目已删除', project: deletedProject });
});

// API: 保存项目数据 (需要登录)
app.post('/api/data', authenticateToken, (req, res) => {
    const projectId = req.body.projectId || req.query.project || 'gpu-bringup';
    const { domains, bugs, dailyProgress, buExitCriteria } = req.body;
    
    const data = {
        domains: domains || [],
        bugs: bugs || [],
        dailyProgress: dailyProgress || [],
        buExitCriteria: buExitCriteria || [],
        lastUpdated: new Date().toLocaleString('zh-CN')
    };
    
    saveProjectData(projectId, data);
    console.log(`Saved data for project: ${projectId} by ${req.user.username}`);
    res.json({ success: true, message: '数据保存成功' });
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`国产GPU芯片bring up Web Server running on http://0.0.0.0:${PORT}`);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`Access from company network: http://47.77.221.23:${PORT}`);
    }
});
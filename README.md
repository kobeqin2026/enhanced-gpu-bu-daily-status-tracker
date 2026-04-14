# GPU Bring-up Daily Status Tracker

![GPU Bring-up Tracker](https://img.shields.io/badge/GPU-BuD-Tracker-blue)
![Version](https://img.shields.io/badge/version-v2.0-green)

一个用于追踪GPU芯片Bring-up进度的Web应用，支持多项目切换、用户权限管理和实时协作。

## 功能特性

### 用户权限系统
- **管理员 (Admin)**: 
  - 管理项目（创建、编辑、删除）
  - 管理所有数据（Domain、Bug、进度、BU准出）
  - 用户管理（添加、编辑、删除普通用户）
  - 无法删除管理员账号
  
- **普通用户 (User)**:
  - 管理Bug、每日进度、BU准出数据
  - Domain表格只读（状态无法修改）
  - 用户管理中只能查看

### 核心功能
- **多项目切换**: 支持创建和切换多个项目
- **域概览 (Domain Overview)**: 管理所有技术领域，支持状态更新（仅管理员可编辑）
- **Bug跟踪 (Bug Tracking)**: 完整的Bug生命周期管理，支持严重性分级
- **每日进度跟踪 (Daily Progress Tracking)**: 按日期和Domain记录每日工作进展
- **BU准出标准 (BU Exit Criteria)**: 定义和管理每个Domain的准出标准

### 技术特性
- **模块化前端架构**: JS/CSS按功能模块拆分为独立文件，便于维护和协作
- **混合数据架构**: 优先从服务器加载数据，API失败时自动使用本地缓存
- **JWT认证**: 基于Token的用户认证
- **数据持久化**: 服务器JSON文件 + 浏览器localStorage
- **响应式设计**: 适配桌面、平板和移动设备
- **nginx反向代理**: 生产环境部署配置

## 快速开始

### 前置要求
- Node.js (v14.0.0 或更高版本)
- npm
- Nginx

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/kobeqin2026/enhanced-gpu-bu-daily-status-tracker.git
cd enhanced-gpu-bu-daily-status-tracker

# 安装依赖
npm install

# 启动服务器
node server.js

# 访问应用
http://localhost:8088
```

### 默认账号
- **管理员**: admin / admin123
- **普通用户**: user / user123

## 项目结构

```
enhanced-gpu-bu-daily-status-tracker/
├── public/
│   ├── index.html              # 前端HTML骨架（569行，无内联JS/CSS）
│   ├── js/                     # JavaScript模块
│   │   ├── globals.js          # 全局变量与数据存储 (164行)
│   │   ├── utils.js            # 工具函数 (85行)
│   │   ├── data.js             # 数据加载/保存/API交互 (221行)
│   │   ├── auth.js             # 认证与权限管理 (458行)
│   │   ├── projects.js         # 项目切换与管理 (242行)
│   │   ├── domains.js          # Domain模块渲染与交互 (121行)
│   │   ├── bugs.js             # Bug跟踪模块 (187行)
│   │   ├── daily-progress.js   # 每日进度模块 (178行)
│   │   ├── bu-exit-criteria.js # BU准出标准模块 (280行)
│   │   └── app.js              # 主入口/初始化 (206行)
│   └── css/                    # CSS模块
│       ├── base.css            # 基础布局与排版 (72行)
│       ├── header.css          # 头部导航样式 (159行)
│       ├── components.css      # 通用组件（按钮/模态框等） (269行)
│       ├── tables.css          # 共享表格样式 (86行)
│       ├── domains.css         # Domain状态颜色 (34行)
│       ├── bugs.css            # Bug严重性颜色 (27行)
│       ├── daily-progress.css  # 每日进度样式 (51行)
│       ├── bu-exit-criteria.css# BU准出标准样式 (20行)
│       ├── responsive.css      # 响应式布局 (104行)
│       └── styles.css          # 主样式/历史遗留 (851行)
├── data/                       # 数据存储目录
│   ├── gpu-bringup.json        # 项目数据
│   ├── project-2.json          # 第二个项目数据
│   ├── projects.json           # 项目元数据
│   ├── sessions.json           # 会话数据
│   └── users.json              # 用户数据
├── server.js                   # Express服务器
├── nginx.conf                  # Nginx配置
├── ecosystem.config.js         # PM2配置
├── package.json                # 依赖配置
└── README.md                   # 项目文档
```

## API接口

### 用户认证
- `POST /api/auth/login` - 用户登录
- `POST /api/auth/logout` - 用户登出
- `GET /api/auth/verify` - 验证Token

### 数据操作
- `GET /api/projects` - 获取项目列表
- `POST /api/projects` - 创建项目
- `GET /api/data/:projectId` - 获取项目数据
- `POST /api/data/:projectId` - 保存项目数据

### 用户管理 (仅管理员)
- `GET /api/users` - 获取用户列表
- `POST /api/users` - 添加用户
- `PUT /api/users/:id` - 编辑用户
- `DELETE /api/users/:id` - 删除用户

## 版本历史

### v2.0 (2026-04-14)
**前端代码模块化重构**

本次版本是迄今为止最大的架构重构，将原3600+行的单文件前端拆分为模块化结构，大幅提升代码可维护性和协作效率。

#### JavaScript 模块化拆分（10个文件，共2142行）

| 模块 | 行数 | 职责 |
|---|---|---|
| `globals.js` | 164 | 全局变量、数据结构、状态枚举（如statusText、severityText等） |
| `utils.js` | 85 | 通用工具函数（createJiraLink、escapeHTML、getTableBody等） |
| `data.js` | 221 | 数据持久化层：localStorage读写、API交互、混合数据加载策略 |
| `auth.js` | 458 | 完整的认证系统：登录/登出、权限判断、角色管理、用户CRUD |
| `projects.js` | 242 | 项目管理：项目列表渲染、项目切换、项目时间线显示与编辑 |
| `domains.js` | 121 | Domain模块：域表格渲染、状态更新、内联编辑 |
| `bugs.js` | 187 | Bug模块：Bug CRUD、筛选过滤、JIRA链接、严重性管理 |
| `daily-progress.js` | 178 | 每日进度模块：进度CRUD、按日期/域展示 |
| `bu-exit-criteria.js` | 280 | BU准出标准模块：准出标准CRUD、状态管理 |
| `app.js` | 206 | 主入口：初始化流程、事件绑定、DOMContentLoaded处理 |

**JS加载顺序**（按依赖关系排列）：
`globals.js` → `utils.js` → `data.js` → `auth.js` → `projects.js` → `domains.js` → `bugs.js` → `daily-progress.js` → `bu-exit-criteria.js` → `app.js`

#### CSS 模块化拆分（10个文件，共1673行）

| 模块 | 行数 | 职责 |
|---|---|---|
| `base.css` | 72 | 基础布局：body、字体、全局间距 |
| `header.css` | 159 | 头部区域：项目切换器、标题、用户信息栏 |
| `components.css` | 269 | 通用组件：按钮、模态框、表单、Tab导航 |
| `tables.css` | 86 | 共享表格样式：边框、行高、表头 |
| `domains.css` | 34 | Domain状态颜色（未开始/进行中/完成等） |
| `bugs.css` | 27 | Bug严重性颜色（Highest/High/Medium/Low） |
| `daily-progress.css` | 51 | 每日进度输入区和时间线样式 |
| `bu-exit-criteria.css` | 20 | BU准出标准专属样式 |
| `responsive.css` | 104 | 响应式布局（768px断点适配） |
| `styles.css` | 851 | 主样式/历史遗留样式（待逐步迁移） |

**CSS加载顺序**（按层叠优先级排列）：
`base.css` → `header.css` → `components.css` → `tables.css` → `domains.css` → `bugs.css` → `daily-progress.css` → `bu-exit-criteria.css` → `responsive.css`

#### index.html 变化
- **之前**: 单文件约3600行，包含所有HTML + 内联JS + 内联CSS
- **之后**: 569行纯HTML骨架，无任何内联`<script>`或`<style>`
- 通过10个`<script src="js/...">` 引用JS模块
- 通过9个`<link rel="stylesheet" href="css/...">` 引用CSS模块

#### 重构收益
- **可维护性**: 每个文件职责单一，修改某功能只需编辑对应模块
- **协作效率**: 多人可并行开发不同模块，减少合并冲突
- **代码复用**: 工具函数和数据层集中管理，消除重复代码
- **调试便利**: 浏览器DevTools中按文件名定位问题，而非在3600行中搜索
- **加载性能**: CSS按功能拆分，浏览器可并行下载；JS模块化后便于未来做懒加载

#### Bug修复
- 修复动态按钮权限问题：`admin-only`类按钮在数据渲染后正确获取`visible`类
- 修复`loadSavedUser()`未使用`await`导致的角色判断时序问题
- 确保`updateUIBasedOnRole()`在数据渲染完成后调用

---

### v1.85 (2026-04-07)
**项目时间线编辑优化**

#### 功能优化
- 简化项目编辑对话框，仅保留时间线编辑功能
- 移除项目名称和描述输入框（项目名称在创建时设定，不再允许修改）
- 页面标题固定为"国产GPU芯片bring up每日追踪"，不随项目变化

#### 用户体验改进
- 编辑项目时只显示开始日期和结束日期选择
- 保留项目原有名称和描述，仅更新时间线
- 更清晰的操作提示

---

### v1.8 (2026-04-07)
**权限系统优化 + 项目时间线编辑**

#### 权限调整
- **Bug跟踪**: 普通用户和管理员都可以编辑和删除Bug记录
- **每日进度跟踪**: 普通用户和管理员都可以编辑和删除进度记录
- **BU准出标准**: 普通用户和管理员都可以编辑和删除准出标准记录
- **Domain表格**: 仅管理员可以编辑，普通用户只读（保持不变）

#### 新功能：项目时间线编辑
- 管理员可以在编辑项目时设置项目开始日期和结束日期
- 项目时间线动态显示，根据当前项目自动更新
- 切换项目时自动更新时间线显示
- 支持中文日期格式显示

#### 代码改进
- 统一使用 `user-only` 类控制Bug、进度、BU准出的按钮可见性
- Domain表格继续使用 `admin-only` 类控制管理员专属权限
- 新增 `updateProjectTimeline()` 函数处理时间线显示
- 服务器端API支持保存项目时间线（startDate, endDate）

---

### v1.5 (2026-04-03)
**GPU Bring-up Daily Tracker 优化版本**

#### 用户权限管理系统
- 实现完整的登录/登出认证机制（基于JWT Token）
- 支持管理员(Admin)和普通用户(User)两种角色
- Token过期时间：24小时
- 密码明文存储（简化内部使用）

#### 安全增强
- 添加路径遍历攻击防护（projectId sanitization）
- XSS防护：添加escapeHTML转义函数
- Cookie解析中间件
- 服务器端输入验证

#### 项目管理增强
- 项目列表API (`GET /api/projects`)
- 项目创建/编辑/删除功能
- 项目数据隔离存储（按项目ID分离JSON文件）
- 新增 `data/projects.json` 存储项目元数据

#### 前端UI优化
- 登录面板UI（固定在右上角）
- 用户角色标签显示
- 管理员/普通用户按钮权限控制
- 用户管理面板增强（用户列表展示、搜索功能）
- 响应式CSS样式（分离到 `public/css/styles.css`）

#### 技术依赖更新
- 添加 `bcrypt` 密码处理库（预留）
- 添加 `cookie-parser` 中间件

---

### v1.0
- 多项目切换支持
- 用户认证系统（admin/user角色）
- 权限管理：
  - Domain表格仅管理员可编辑
  - Bug/进度/BU准出普通用户可操作
- 用户管理：
  - 管理员可添加/编辑/删除用户
  - 新用户固定为普通用户
  - 禁止删除管理员账号
- 登录界面显示用户名和角色

### v0.1 (Initial Release)
- 基础管理员模式
- 完整的CRUD操作
- LocalStorage持久化

## 部署

### Nginx配置参考
```nginx
server {
    listen 8088;
    server_name _;
    
    root /var/www/gpu-tracker;
    index index.html;
    
    location / {
        try_files $uri $uri/ =404;
    }
    
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 部署命令
```bash
# 复制前端文件
sudo cp -r public/* /var/www/gpu-tracker/

# 重启API服务
pm2 restart gpu-tracker
```

### 使用PM2运行
```bash
pm2 start ecosystem.config.js
```

## 贡献指南

欢迎贡献！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

MIT License

---

**最后更新**: 2026年4月14日  
**版本**: 2.0

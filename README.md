# GPU Bring-up Daily Status Tracker

![GPU Bring-up Tracker](https://img.shields.io/badge/GPU-BuD-Tracker-blue)

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
│   └── index.html          # 前端应用
├── data/                   # 数据存储目录
│   ├── gpu-bringup.json    # 项目数据
│   ├── project-2.json      # 第二个项目数据
│   └── users.json          # 用户数据
├── server.js               # Express服务器
├── nginx.conf              # Nginx配置
├── package.json            # 依赖配置
└── README.md               # 项目文档
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
        proxy_pass http://localhost:8088;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 使用PM2运行
```bash
pm2 start server.js --name gpu-tracker
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

**最后更新**: 2026年4月3日  
**版本**: 1.0
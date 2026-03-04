# 国产GPU芯片Bring-up每日追踪系统

![国产GPU芯片Bring-up每日追踪](https://img.shields.io/badge/GPU-Bring--up-Tracker-blue)

一个用于追踪国产GPU芯片Bring-up进度的Web应用，支持多维度数据管理、实时协作和进度可视化。

## 📋 功能特性

### 核心功能
- **域概览 (Domain Overview)**: 管理所有技术领域，支持状态更新（未开始/进行中/受阻/已完成）
- **Bug跟踪 (Bug Tracking)**: 完整的Bug生命周期管理，支持严重性分级和JIRA集成
- **每日进度跟踪 (Daily Progress Tracking)**: 按日期和Domain记录每日工作进展
- **BU准出标准 (BU Exit Criteria)**: 定义和管理每个Domain的准出标准，支持状态跟踪

### 高级特性
- **混合数据架构**: 优先从服务器加载数据，API失败时自动使用本地缓存
- **完整CRUD操作**: 所有数据都支持创建、读取、更新、删除操作
- **实时保存**: 支持Ctrl+S快捷键保存，数据自动同步到服务器和本地存储
- **响应式设计**: 适配桌面、平板和移动设备
- **数据筛选和排序**: 支持多维度数据筛选和排序功能
- **JIRA集成**: Bug ID自动链接到JIRA系统

### 用户体验
- **直观的界面**: 清晰的颜色编码和状态指示
- **模态编辑**: 弹窗式编辑界面，操作便捷
- **自动索引**: 删除条目后自动重新编号
- **离线支持**: 本地缓存确保离线时仍可访问数据

## 🚀 快速开始

### 前置要求
- Node.js (v14.0.0 或更高版本)
- npm (通常随Node.js一起安装)

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/your-username/gpu-bringup-tracker.git
   cd gpu-bringup-tracker
   ```

2. **安装依赖**
   ```bash
   npm install express
   ```

3. **启动服务器**
   ```bash
   node server.js
   ```

4. **访问应用**
   - 本地访问: `http://localhost:80`
   - 网络访问: `http://47.77.221.23` (根据实际部署IP)

### Docker部署（可选）

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY . .
RUN npm install express
EXPOSE 80
CMD ["node", "server.js"]
```

```bash
# 构建镜像
docker build -t gpu-bringup-tracker .

# 运行容器
docker run -d -p 80:80 --name gpu-tracker gpu-bringup-tracker
```

## 📂 项目结构

```
gpu-bringup-tracker/
├── BU-daily-tracker.html          # 主要HTML文件，包含所有前端逻辑
├── server.js                     # Web服务器，提供静态文件服务
├── README.md                     # 项目文档
└── package.json                  # 项目依赖配置
```

## 🔧 API接口

当前版本使用简单的REST API进行数据交互：

### GET `/api/data`
- **描述**: 获取所有追踪数据
- **响应**: 
  ```json
  {
    "domains": [...],
    "bugs": [...],
    "dailyProgress": [...],
    "buExitCriteria": [...],
    "lastUpdated": "2026年3月4日 21:00"
  }
  ```

### POST `/api/data`
- **描述**: 保存所有追踪数据
- **请求体**: 同GET响应格式
- **响应**: 
  ```json
  { "success": true, "message": "Data saved successfully" }
  ```

> **注意**: 当前API实现为内存存储，重启服务器后数据会丢失。生产环境建议集成数据库。

## 🎨 界面说明

### 域概览 (Domain Overview)
- **状态颜色**: 
  - 灰色: 未开始
  - 蓝色: 进行中  
  - 红色: 受阻
  - 绿色: 已完成

### Bug跟踪 (Bug Tracking)
- **严重性颜色**:
  - 红色: Highest
  - 黄色: High/Medium
  - 灰色: Low/Lowest

### BU准出标准 (BU Exit Criteria)
- **状态显示**:
  - Not ready: 未就绪
  - Fail: 失败
  - Pass: 通过

## 💾 数据持久化

应用采用双重数据持久化策略：

1. **服务器存储**: 通过API保存到服务器内存
2. **本地存储**: 自动保存到浏览器localStorage作为备份

当服务器不可用时，应用会自动从本地缓存加载数据，确保用户体验不中断。

## 🛠️ 自定义配置

### 修改域名列表
在 `BU-daily-tracker.html` 文件中找到 `currentData.domains` 数组，添加或修改Domain条目：

```javascript
domains: [
    { id: 'domain-1', name: '硅验证 (Silicon Validation)', owner: 'TBD', status: 'not-started', notes: '' },
    // 添加更多Domain...
]
```

### 修改默认测试数据
BU准出标准的测试数据位于 `currentData.buExitCriteria` 数组中，可以根据实际需求修改。

## 📱 移动端适配

应用完全响应式设计，支持：
- **手机**: 单列布局，水平滚动表格
- **平板**: 优化的字体大小和间距
- **桌面**: 完整功能布局

## 🚨 注意事项

1. **数据安全**: 当前版本的数据存储在服务器内存中，重启后会丢失。生产环境请集成持久化存储。
2. **网络要求**: 需要公司内网访问权限才能访问 `47.77.221.23`
3. **浏览器兼容性**: 推荐使用现代浏览器（Chrome, Firefox, Edge最新版本）

## 🤝 贡献指南

欢迎贡献！请遵循以下步骤：

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 [MIT License](LICENSE)。

## 📞 联系方式

- **项目维护者**: Kobe
- **工作邮箱**: [your-email@company.com](mailto:your-email@company.com)
- **项目地址**: 国内GPU芯片Bring-up团队

---

**最后更新**: 2026年3月4日  
**版本**: 1.0.0
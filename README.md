# GPU Bring-up Daily Status Tracker

![GPU Bring-up Tracker](https://img.shields.io/badge/GPU-BuD-Tracker-blue)
![Version](https://img.shields.io/badge/version-v4.5-blue)

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
- **Bug跟踪 (Bug Tracking)**: 完整的Bug生命周期管理，支持严重性分级、CSV批量导入、JIRA集成导入
- **JIRA集成 (JIRA Integration)**: 从 JIRA Server/Cloud/Data Center 自动拉取 Bug，支持项目选择、字段映射、智能合并
- **每日进度跟踪 (Daily Progress Tracking)**: 按日期和Domain记录每日工作进展
- **BU准出标准 (BU Exit Criteria)**: 定义和管理每个Domain的准出标准
- **JIRA Bug Dashboard**: 独立可视化页面（`/jira-dashboard.html`），提供JIRA Bug统计与分析

### 技术特性
- [API 文档](API.md)
- **模块化后端架构**: 后端拆分为 lib/（共享库）、middleware/（中间件）、routes/（路由），职责清晰
- **模块化前端架构**: JS/CSS按功能模块拆分为独立文件，便于维护和协作
- **XSS防护**: 全面使用 DOM API 构建元素，所有用户输入通过 textContent 安全渲染
- **全局变量封装**: 前端状态统一封装到 App 命名空间，减少全局污染
- **并发安全**: 文件锁机制、自动备份（含旧备份清理）、数据校验，支持10-20人并发
- **混合数据架构**: 优先从服务器加载数据，API失败时自动使用本地缓存
- **JWT认证**: 基于Token的用户认证，httpOnly Cookie安全传输
- **数据持久化**: 服务器 JSON文件 + 浏览器localStorage
- **响应式设计**: 适配桌面、平板和移动设备
- **nginx反向代理**: 生产环境部署配置
- **JIRA REST API 集成**: 支持 PAT (Bearer)、Cloud (Email + API Token)、Server (Username + Password) 三种认证方式

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

# 配置环境变量
cp .env.example .env

# 配置JIRA集成（可选）
# 在 ecosystem.config.js 或系统环境变量中设置:
#   JIRA_BASE_URL=https://jira.your-company.com
#   JIRA_PAT=your-personal-access-token

# 启动服务器
npm start

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
│   ├── jira-dashboard.html     # JIRA Bug Dashboard 独立可视化分析页面 (231行)
│   ├── js/                     # JavaScript模块
│   │   ├── globals.js          # 全局变量封装到App命名空间 (190行)
│   │   ├── utils.js            # 工具函数 + XSS安全DOM辅助 (113行)
│   │   ├── data.js             # 数据加载/保存/API交互 (210行)
│   │   ├── auth.js             # 认证与权限管理 (375行)
│   │   ├── projects.js         # 项目切换与管理 (209行)
│   │   ├── domains.js          # Domain模块渲染与交互 (158行)
│   │   ├── bugs.js             # Bug跟踪模块 (217行)
│   │   ├── daily-progress.js   # 每日进度模块 (184行)
│   │   ├── bu-exit-criteria.js # BU准出标准模块 (299行)
│   │   ├── import.js           # CSV批量导入 + JIRA导入模块 (600行)
│   │   ├── jira-dashboard.js   # JIRA Bug Dashboard 前端逻辑 (870行)
│   │   └── app.js              # 主入口/初始化 (161行)
│   └── css/                    # CSS模块
│       ├── base.css            # 基础布局与排版
│       ├── header.css          # 头部导航样式
│       ├── components.css      # 通用组件（按钮/模态框等）
│       ├── tables.css          # 共享表格样式
│       ├── domains.css         # Domain状态颜色
│       ├── bugs.css            # Bug严重性颜色
│       ├── daily-progress.css  # 每日进度样式
│       ├── bu-exit-criteria.css# BU准出标准样式
│       ├── jira-dashboard.css  # JIRA Bug Dashboard 专属样式
│       ├── responsive.css      # 响应式布局
│       └── styles.css          # 主样式/历史遗留
├── lib/                        # 后端共享库（v2.3新增）
│   ├── fileLock.js             # 文件锁机制 (23行)
│   ├── backup.js               # 自动备份 + 旧备份清理 (41行)
│   ├── validation.js           # 数据校验 (30行)
│   ├── logger.js               # 操作日志读写 (47行)
│   ├── sessions.js             # 会话管理 + 自动保存 (62行)
│   ├── dataStore.js            # 文件I/O + 路径遍历防护 (55行)
│   ├── users.js                # 用户数据CRUD (49行)
│   ├── projects.js             # 项目数据CRUD (82行)
│   └── jiraConfig.js           # JIRA连接配置（认证方式、JQL、字段映射）
├── middleware/                   # Express中间件（v2.3新增）
│   └── auth.js                 # 认证 + 管理员检查中间件 (52行)
├── routes/                     # API路由（v2.3新增）
│   ├── auth.js                 # 登录/登出/验证 (112行)
│   ├── users.js                # 用户管理CRUD (217行)
│   ├── projects.js             # 项目管理CRUD + 导出 (132行)
│   ├── data.js                 # 项目数据读写 (48行)
│   └── jira.js                 # JIRA集成: 项目列表获取 + Bug导入 + Dashboard API (~610行)
├── data/                       # 数据存储目录
│   ├── gpu-bringup.json        # 项目数据
│   ├── projects.json           # 项目元数据
│   ├── sessions.json           # 会话数据
│   ├── users.json              # 用户数据
│   └── jira-cache/             # JIRA Dashboard 历史快照缓存
├── logs/                       # 操作日志目录
├── server.js                   # Express入口（47行，仅路由组装）
├── nginx.conf                  # Nginx配置
├── ecosystem.config.js         # PM2配置
├── .env.example                # 环境变量配置模板
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
- `PUT /api/projects/:id` - 修改项目
- `DELETE /api/projects/:id` - 删除项目
- `GET /api/data?project=:projectId` - 获取项目数据
- `POST /api/data?project=:projectId` - 保存项目数据
- `GET /api/export/:projectId` - 导出项目数据为JSON（需认证）

### 用户管理 (仅管理员)
- `GET /api/users` - 获取用户列表
- `POST /api/users` - 添加用户
- `PUT /api/users/:id` - 编辑用户信息
- `PUT /api/users/:id/password` - 修改用户密码
- `DELETE /api/users/:id` - 删除用户

### 操作日志 (仅管理员)
- `GET /api/logs/:date` - 查看操作日志

### JIRA 集成 (需认证)
- `GET /api/data/jira-projects` - 获取 JIRA 项目列表
- `POST /api/data/import-jira` - 从 JIRA 导入 Bug（body: `{project, includeClosed, maxResults, jql}`）
- `POST /api/data/sync-jira-status` - 同步已导入 Bug 的 JIRA 状态（body: `{jiraKeys: ["KEY-1", "KEY-2"]}`）

### JIRA Bug Dashboard (需认证)
- `POST /api/data/jira-dashboard` - 获取 Dashboard 聚合数据（stats + charts + bugs 数组，自动缓存快照）
- `GET /api/data/jira-dashboard-history/:project` - 获取历史快照数据用于趋势分析

## 版本历史

### v4.5 (2026-04-28)
**智能诊断全面增强 + Dashboard 图表与列表优化**

#### 智能诊断 (Bug AI Diagnosis)
- **评论中的显式引用自动提取**：后端自动获取当前 Bug 的所有评论，从评论中提取显式引用的 JIRA Key，即使该 Bug 不在 `statusCategory = Done` 状态也能被检索到
- **评分归一化到 100 分**：重构成 8 维度评分体系，总分严格 0-100：
  - 标题关键词匹配（20分）+ 主关键词加成（10分）
  - 描述关键词匹配（15分）+ 评论关键词匹配（10分）
  - 问题模式重叠（15分）+ N-gram 摘要重叠（10分）
  - Jaccard 描述相似度（10分）+ 错误术语共现（10分）
  - 同芯片家族加成（5分）
- **评分分档**：显式引用 Bug 基础 90 分 + 内容加分（90-100 分）；关键词匹配 Bug 上限 85 分
- **显示格式优化**：相关 Bug 列表改为表头+数据行格式：`[匹配度%] | [Key 链接] | [标题]`
  - 匹配度带颜色：≥80 绿色，60-80 黄色，<60 红色
  - Bug Key 可点击跳转 JIRA
  - 标题自适应宽度，超出省略号
- **诊断弹窗优化**：关闭按钮改为「返回」文字；修复 `null reference` 报错，所有 DOM 操作增加空值检查
- **Bug 描述映射修复**：相关 Bug 的 `summary` 字段优先使用 JIRA 标题而非描述内容

#### JIRA Dashboard 图表优化
- **柱状图数字标签**：Bug 严重性分布和未关闭 Bug 年龄分布柱状图顶部显示数值，使用自定义 `barDataLabelPlugin` 渲染（Chart.js `afterDatasetsDraw` 钩子）
- **Y 轴自适应 padding**：添加 `suggestedMax: max + 2`，防止高柱子数字标签被截断
- **历史趋势移除**：删除历史趋势图（HTML/JS/CSS），简化页面布局
- **诊断弹窗返回按钮**：`u00d7` 改为「返回」

#### Bug 明细列表
- **第二列改为标题**：从 `bug.description` 改为 `bug.summary`，表头从「描述」改为「标题」

---

### v4.4 (2026-04-27)
**Bug 智能诊断增强 - 跨项目类似 Bug 检索**

- **跨项目 Bug 自动检索**：
  - 根据 Bug 描述自动提取硬件关键词（PCIE/PHY/I2C/GPIO/Clock 等）和错误模式（fail/timeout/hang 等）
  - 通过 JIRA API 搜索其他项目中类似 Bug（排除当前项目）
  - 最多返回 3 个最相关的历史 Bug，包含标题、状态、描述、最近评论
- **LLM 综合分析**：
  - 将当前 Bug 描述 + 评论 + 日志 + 跨项目历史 Bug 一起发送给 qwen3.6-plus
  - LLM 参考历史解决方案，给出更有针对性的调试建议
  - 诊断结果新增"相关历史Bug"区域，显示检索到的跨项目 Bug，点击可跳转 JIRA
- **超时优化**：LLM 请求超时从 60s 提升到 120s

---

### v4.3 (2026-04-27)
**Bug 智能诊断 - 基于 Bailian LLM 的 Bug 自动分析**

- 新增"智能诊断"按钮（🔍），点击后自动分析 Bug 并给出调试建议
- 分析内容：问题摘要、可能原因、建议操作、需要收集的数据、置信度
- 使用 qwen3.6-plus 模型，24 小时缓存避免重复调用
- 诊断弹窗支持查看完整分析结果

---

### v4.2 (2026-04-27)
**JIRA Bug Dashboard - 图表增强**

- **饼图/环形图标签增强**：
  - 扇区内部显示状态名 + 百分比，两行居中排列
  - 标签字号根据环形宽度自适应，避免文字重叠
  - Domain 图改为 doughnut 类型 (cutout 45%)，与状态图风格统一
- **趋势图数据标签**：折线图每个数据点上方显示具体数值（0 值不显示）
- **趋势图时间轴缩放/拖动**：
  - 鼠标滚轮缩放横轴时间范围
  - 鼠标拖拽左右平移
  - 支持触屏手势
  - 新增「重置缩放」按钮一键恢复默认视图
  - 依赖：hammerjs + chartjs-plugin-zoom@2.2.0

---

### v4.0 (2026-04-27)
**JIRA Bug Dashboard - 独立 Bug 统计分析可视化页面**

- **JIRA Bug Dashboard 独立页面** (`/jira-dashboard.html`)：一键从主页进入，完整的 Bug 统计分析可视化
- **7 个 KPI 指标卡片**：总 Bug 数、未关闭、已关闭、今日新增、本周关闭、平均修复天数、超期未关闭 (>14天)
- **6 种可视化图表**（Chart.js）：
  - Bug 状态分布（环形图）：Open / Triage / Implement / Closed / Rejected 占比
  - Bug 严重性分布（柱状图）：Highest / High / Medium / Low / Lowest
  - Bug 趋势（折线图）：每日新增 vs 每日关闭趋势线
  - 按负责人分布（水平条形图）：识别工作负载
  - 按 Domain 分布（饼图）：按 JIRA Label 分类
  - Bug 年龄分布（柱象图）：未关闭 Bug 的存在天数分布（0-3天 / 3-7天 / 7-14天 / 14-30天 / 30天+）
- **历史趋势图**：缓存每日快照数据，展示长期的未关闭/已关闭变化趋势
- **Bug 明细列表**：可排序、可筛选、点击 Key 直接跳转 JIRA、超期 Bug 红色高亮
- **项目多选**：支持单选或多项目对比模式
- **自动刷新**：可选 5 / 15 / 30 分钟间隔自动拉取最新数据
- **Bug 明细默认隐藏已关闭**：增加"显示已关闭"复选框

**后端新增 API**：
- `POST /api/data/jira-dashboard`：聚合查询，返回 stats + charts + bugs 数组，自动缓存快照到 `data/jira-cache/`
- `GET /api/data/jira-dashboard-history/:project`：返回历史快照数据用于趋势分析

**新增文件**：`public/jira-dashboard.html`、`public/css/jira-dashboard.css`、`public/js/jira-dashboard.js`

**其他改动**：
- 主页新增 "JIRA Bug Dashboard" 入口链接
- 所有 fetch 调用添加 `credentials: 'same-origin'` 修复认证问题
- 修复错误显示：同时检查 `data.error` 和 `data.message` 字段

---

### v3.3 (2026-04-20)
**JIRA Bug 集成导入 + 一键同步状态**

- **JIRA REST API 集成**: 新增 `routes/jira.js` 独立路由模块，支持从 JIRA Server / Data Center / Cloud 自动拉取 Bug 数据
- **三种认证方式**: 
  - PAT (Bearer Token) — JIRA Server/Data Center 推荐
  - Cloud Auth (Email + API Token) — JIRA Cloud
  - Basic Auth (Username + Password) — JIRA Server
- **JIRA 项目选择器**: 前端新增 Modal 弹窗，动态获取项目列表（Key + 名称 + 负责人），支持搜索过滤
- **字段智能映射**:
  - 优先级映射: blocker→highest, major→high, normal/medium→medium, low→low, trivial→lowest
  - 状态映射:
    - Opened / Open / New / To Do → **open**
    - Triaged / Review / Test / Verify / QA / 开发中 / In Progress → **triage**
    - Implemented → **implement**
    - Closed / Done / Resolved → **closed**
    - Reject / Won't Fix → **rejected**
- **可选项**: 支持选择是否包含已关闭的 Bug（默认仅 Open/Triage/Implement 中）
- **一键同步状态**: 新增「同步JIRA状态」按钮，一键从 JIRA 批量拉取所有已导入 Bug 的最新状态和负责人，自动更新本地数据
- **Bug 智能合并**: 按 Bug ID 自动匹配 — 已有 Bug 更新字段，新 Bug 追加，避免重复
- **导入预览**: 导入前展示前 5 条 Bug 预览和统计信息，需用户确认后才执行
- **清空 Bug 功能**: 新增一键清空所有 Bug 数据按钮，双重确认防误操作
- **配置管理**: `lib/jiraConfig.js` 统一配置（baseUrl、认证、JQL、字段、maxResults），支持环境变量注入
- **安全**: JIRA PAT 不再硬编码，通过 `JIRA_PAT` 和 `JIRA_BASE_URL` 环境变量配置

---

### v3.0 (2026-04-16)
**工程化重构与文档完善**

- **JSDoc 文档化**: `lib/` 目录下所有模块（backup, dataStore, fileLock, logger, projects, sessions, users, validation）添加完整 JSDoc 注释，提升代码可读性与维护性。
- **API 文档**: 新增 `API.md`，详细记录所有 REST 接口、数据模型及错误码。
- **冒烟测试**: 新增 `smoke_test.sh` 脚本，自动化验证前端加载、API 健康及数据完整性。
- **Bug 管理优化**:
    - 默认隐藏 `closed` 和 `rejected` Bug，保持列表整洁。
    - 新增筛选复选框，支持查看历史 Bug。
    - `closed/rejected` 行置底并深灰色显示。
- **批量导入增强**:
    - CSV 导入支持按 Bug ID 自动更新，避免重复。
    - 支持多种状态映射 (`opened`, `triaged`, `开发中` 等)。
    - 支持报告日期字段导入。

---

### v2.58 (2026-04-16)
**Bug跟踪优化：默认隐藏Closed/Rejected，筛选修复**

- **默认折叠**：列表默认隐藏状态为 `closed` 和 `rejected` 的Bug，保持页面整洁。
- **智能筛选**：
    - 在状态筛选器中明确选择 `Closed` 或 `Rejected` 时，会正确显示对应Bug。
    - 勾选"显示已关闭/已拒绝Bug"复选框可查看历史Bug。
    - 修复了筛选器失效的问题。

---

### v2.56 (2026-04-16)
**Bug表格UI优化：Closed/Rejected行置底并深灰色显示**

- **自动排序**：默认将状态为 `closed` 和 `rejected` 的Bug自动排序至列表最后。
- **视觉区分**：已关闭的Bug行使用深灰色背景 (`#cccccc`) 和深灰色文字 (`#444444`)，边框同步加深，便于区分活跃Bug。
- **状态映射**：Bug导入功能增强，支持 `opened`, `triaged`, `implemented`, `开发中` 等状态自动映射。
- **Bug导入**：CSV批量导入支持按Bug ID自动更新已有记录，不再重复创建。

---

### v2.55 (2026-04-16)
**Bug批量导入增强：支持按Bug ID自动更新，支持多种状态导入**

- **自动去重**：导入时自动检测已存在的Bug ID
- **智能更新**：已存在的Bug将自动更新所有字段（描述、状态、负责人等），不再创建重复记录
- **导入统计**：完成后显示"新增X条，更新Y条"的详细统计
- **状态兼容**：支持 `open`, `opened`, `triage`, `triaged`, `implement`, `implemented`, `开发中`, `closed`, `rejected` 等多种状态自动映射
- **字段顺序调整**：报告日期移至状态字段之后

---

### v2.53 (2026-04-16)
**Bug批量导入：CSV格式批量上传Bug**

本次版本为Bug跟踪模块增加了CSV批量导入功能，与Domain和BU准出标准的导入方式保持一致。

#### 新增功能: Bug CSV批量导入

- **入口**: Bug跟踪区域的"添加Bug"按钮旁新增"CSV批量导入"按钮
- **CSV格式**: `Bug ID, Domain, 描述, 严重性, 状态, 负责人`
  - 必填字段: Bug ID、Domain、描述
  - 可选字段: 严重性(默认medium)、状态(默认open)、负责人(默认从Domain表格自动匹配，否则TBD)
  - 支持GBK/GB2312编码（Windows Excel导出）
- **功能**:
  - 下载CSV模板按钮
  - 文件预览（前10行）
  - 自动跳过无效行（缺少必填字段）
  - 严重性自动校验（仅接受highest/high/medium/low/lowest，无效值回退到medium）
  - 状态自动校验（仅接受open/triage/implement/closed/rejected，无效值回退到open）
  - 自动从Domain表格匹配负责人
  - 支持"清除现有Bug数据"选项
  - 报告日期自动设置为今天

#### 改动文件

| 文件 | 改动 |
|---|---|
| `public/index.html` | 新增Bug CSV导入按钮、Bug导入弹窗HTML |
| `public/js/import.js` | 新增 `downloadBugTemplate()`, `showBugImportModal()`, `closeBugImportModal()`, `previewBugFile()`, `importBugsFromCSV()` |

#### CSV模板示例

```csv
Bug ID,Domain,描述,严重性,状态,报告日期,负责人
MPW2-77,PCIe接口 (PCIe Interface),PCIe链路训练失败，卡在Gen1,High,open,2026-04-15,Ge Qiang
MPW2-78,HBM,HBM初始化报错ECC failure,Highest,open,2026-04-16,Xiaoming
MPW2-79,FW,Bootrom启动超时,Medium,open,,Haiping
```

---

### v2.52 (2026-04-16)
**权限控制与数据持久化修复**

本次版本修复了三个功能问题：未登录用户可见保存按钮、persistData异步保存不完整、以及CSS块级元素布局异常。

#### 修复1: 保存按钮权限控制

**问题**: 未登录用户（只读模式）可以看到并点击"保存数据"按钮，点击后显示令人困惑的"数据已保存到本地缓存"消息，但实际服务器保存失败。

**改动**: `public/index.html` 第354行
- 修改前: `<button class="save-btn" onclick="saveData()">保存数据</button>`
- 修改后: `<button class="save-btn user-only" onclick="saveData()">保存数据</button>`

未登录用户不再看到保存按钮，权限逻辑与其他操作按钮保持一致。

#### 修复2: persistData() 异步保存

**问题**: `persistData()` 调用 `saveDataToAPI()` 时未使用 `await`，属于 "fire-and-forget" 模式。如果API保存失败，用户只看到localStorage保存成功提示，不知道服务器保存失败。

**改动**: `public/js/utils.js` 第74-77行
- 修改前: `function persistData() { saveToLocalStorage(App.data); saveDataToAPI(); }`
- 修改后: `async function persistData() { saveToLocalStorage(App.data); await saveDataToAPI(); }`

现在数据保存会等待API响应完成，与 `saveData()` 函数行为一致。

#### 修复3: CSS块级元素布局修复

**问题**: `.admin-only.visible` 和 `.user-only.visible` 使用 `display: inline-block`，导致 `div` 元素（如用户管理弹窗中的"添加新用户"区域）显示为行内元素，布局异常。

**改动**: `public/css/header.css` 新增块级元素规则
```css
div.admin-only.visible,
section.admin-only.visible,
div.user-only.visible,
section.user-only.visible {
    display: block;
}
```

块级元素（div/section）在显示时保持正确的块级布局。

---

### v2.51 (2026-04-15)
**XSS防护强化：消除所有innerHTML动态渲染**

本次版本进一步收紧前端XSS防护，将最后两个使用innerHTML动态渲染的代码段改为纯DOM API实现，彻底消除用户数据通过innerHTML渲染的风险。

#### 改动1: auth.js -- loadUserList() 重构为DOM API

**改动前**: `loadUserList()` 使用字符串拼接构建整个用户管理表格HTML，包含内联 `onclick` handler：
```javascript
var html = '<table>...';
html += '<button onclick="showEditUserModal(\'' + escapeHtml(user.username) + '\', ...)">编辑</button>';
userListEl.innerHTML = html;
```

虽然使用了 `escapeHtml()` 转义，但字符串拼接 + 内联 `onclick` 仍是潜在的攻击面，特别是当转义逻辑遗漏或用户数据包含特殊字符时。

**改动后**: 全面使用 `document.createElement()` + `textContent` + `addEventListener` 构建：
```javascript
var editBtn = document.createElement('button');
editBtn.textContent = '编辑';
(function(u) {
    editBtn.addEventListener('click', function() {
        showEditUserModal(u.username, u.name, u.role);
    });
})(user);
```

具体改进：
- 表格每一行、每个单元格都通过 `createElement()` 创建
- 用户名、名称等用户数据通过 `textContent` 设置（不经过HTML解析器）
- 按钮事件通过 `addEventListener` + IIFE 闭包绑定，彻底消除内联 `onclick`
- 所有错误状态、空状态提示同样使用 DOM API 构建
- 保留 `innerHTML = ''` 仅用于清空容器内容（无数据渲染）

#### 改动2: daily-progress.js -- 空状态消息改为DOM API

**改动前**:
```javascript
container.innerHTML = '<p style="...">暂无每日进度记录</p>';
```

**改动后**:
```javascript
var emptyP = document.createElement('p');
emptyP.textContent = '暂无每日进度记录';
container.appendChild(emptyP);
```

#### 剩余innerHTML使用情况

代码中剩余的 `innerHTML` 调用全部符合安全规范：
- `auth.js` 第30/38/45行：`loginStatus.innerHTML` 仅将 `escapeHtml(App.currentUser)` 作为唯一动态值，其余为固定模板字符串
- `utils.js` `getTableBody()`: `innerHTML = ''` 仅用于清空表格体
- `daily-progress.js` 第52行：`container.innerHTML = ''` 仅用于清空容器

这些用例不涉及用户数据动态拼接，安全可控。

#### 安全收益

| 模块 | 改动前 | 改动后 |
|---|---|---|
| `loadUserList()` | innerHTML + escapeHtml + onclick拼接 | createElement + textContent + addEventListener |
| 空状态提示 | innerHTML拼接 | createElement + textContent |
| 用户数据渲染面 | 2处innerHTML | 0处（仅保留清空操作） |

---

### v2.5 (2026-04-15)
**独立项目URL路由：每个项目拥有专属网址**

本次版本实现了项目独立URL路由，每个项目可以通过专属URL直接访问，不再依赖项目切换器。

#### URL路由方案

| URL | 行为 |
|---|---|
| `http://host:8088/` | 项目列表页，显示所有项目 + 切换器（管理员可创建/删除项目） |
| `http://host:8088/gpu-bringup/` | 直接进入 GPU Bring Up 项目，隐藏切换器 |
| `http://host:8088/project-2/` | 直接进入项目二，隐藏切换器 |

#### 核心特性
- **直接URL访问**: 每个项目可通过 `/:projectId/` 直接访问，无需先登录再切换
- **独立视图**: 直接项目URL上隐藏项目切换器，专注单个项目内容
- **页面标题自动更新**: 页面标题自动包含当前项目名称（如 "GPU Bring Up - GPU Bring Up Tracker"）
- **返回项目列表**: 直接项目URL页面顶部显示 "← 返回项目列表" 链接
- **浏览器前进/后退**: 完整的 history.pushState 支持
- **向后兼容**: 保留 `/project/:id` 旧URL格式兼容

#### 技术实现

**Nginx SPA路由**
- `try_files $uri $uri/ =404` 改为 `try_files $uri $uri/ /index.html`
- 任何不存在的路径都回退到 index.html，由前端JS路由处理
- 静态资源（/css/, /js/）仍正常返回，不受影响

**前端路由改造** (`public/js/app.js`)
- `getProjectIdFromURL()`: 新增直接路径解析（`/gpu-bringup/`），保留 `/project/:id` 兼容
- `updateProjectURL()`: URL格式从 `/project/:id` 改为 `/:id/`
- 新增 `setProjectSwitcherVisibility()`: 控制项目切换器和返回链接的显示/隐藏
- `initProjects()`: 根据URL模式自动切换显示模式（列表页 vs 项目页）
- `switchProjectById()`: 切换时同步更新标题和切换器可见性
- 内置保留路径白名单（api, js, css, images, fonts），避免与静态资源冲突

**HTML改造** (`public/index.html`)
- 新增 "返回项目列表" 链接元素，默认隐藏，仅在直接项目URL上显示

**Bug修复** (`public/js/projects.js`)
- `switchProject()`、`createNewProject()`、`confirmDeleteProject()` 中补充缺失的 `updateProjectURL()` 调用，确保URL同步

---

### v2.4 (2026-04-15)
**CSV批量导入：Domain + BU准出标准**

本次版本新增CSV文件批量导入功能，支持Domain和BU准出标准两个模块的快速数据录入。

#### Domain CSV批量导入

- **入口**: Domain添加区域新增"CSV批量导入"按钮
- **CSV模板**: 两列 — `Domain名称`, `负责人`
  ```
  Domain名称,负责人
  硅验证 (Silicon Validation),张三
  电源管理 (Power Management),李四
  内存子系统 (Memory Subsystem),王五
  ```
- **功能**:
  - 下载CSV模板（UTF-8 BOM编码，Excel直接打开不乱码）
  - 支持UTF-8、GBK、GB2312三种编码（适配Windows Excel导出的CSV）
  - 文件选择后自动预览前10条数据
  - 自动检测首行是否为表头
  - 可选"清除现有Domain数据"
  - 自动去重（基于Domain名称）
  - 导入结果显示成功/跳过统计

#### BU准出标准CSV批量导入

- **入口**: BU准出标准区域"批量上传"按钮升级为"CSV批量导入"
- **CSV模板**: 两列 — `Domain`, `准出标准内容`
  ```
  Domain,准出标准内容
  硅验证 (Silicon Validation),所有基本功能测试通过，无critical bug
  电源管理 (Power Management),功耗测试符合规格要求，温度控制正常
  PCIe接口 (PCIe Interface),PCIe链路稳定性测试通过，带宽达标
  ```
- **功能**:
  - 下载CSV模板
  - 支持UTF-8、GBK、GB2312编码
  - 文件选择后自动预览
  - 自动匹配Domain表格中的Owner
  - 自动重新编号Index
  - 可选"清除现有准出标准数据"

#### 技术实现

- 新增 `import.js` 模块（~400行），纯前端CSV解析
- 内置CSV解析器：支持引号字段、转义引号、BOM检测、不同行结束符
- 使用浏览器 `TextDecoder` API 处理 GBK/GB2312 编码
- 保留旧版 `processBulkUploadBU` 函数名向后兼容
- 数据通过现有 `persistData()` 流程保存（localStorage + API）

| 特性 | 旧版（粘贴文本） | 新版（CSV文件） |
|---|---|---|
| 数据来源 | 手动粘贴 | 上传CSV文件 |
| 分隔符 | 需手动选择Tab/逗号 | CSV标准解析（自动处理引号/转义） |
| 编码支持 | UTF-8 only | UTF-8 + GBK + GB2312 |
| 预览 | 无 | 导入前预览前10条 |
| 模板 | 无 | 一键下载CSV模板 |
| 去重 | 无 | 自动检测重复Domain |
| Owner关联 | 手动 | BU准出自动匹配Domain表格Owner |

---

### v2.3 (2026-04-15)
**三大重构：后端模块化 + 前端全局变量封装 + XSS全面防护**

本次版本是架构级重构，解决后端单文件过大、前端全局变量污染、XSS防护不完整三大问题。

#### 1. 后端模块化拆分（834行 -> 47行入口 + 14个模块）

**拆分前**: `server.js` 单文件 834 行，所有逻辑（文件锁、备份、校验、用户管理、会话、项目、路由）混在一起。

**拆分后**: 三层架构，职责清晰：

```
server.js (47行)          -- 仅负责Express应用组装和路由挂载
lib/ (8个文件, 389行)     -- 可复用的共享库
  fileLock.js             -- 文件并发锁
  backup.js               -- 自动备份 + cleanupOldBackups()清理旧备份
  validation.js           -- 用户/项目/数据校验
  logger.js               -- 操作日志写入 + readLogByDate()读取
  sessions.js             -- 会话管理 + token生成 + 自动保存 + 优雅退出
  dataStore.js            -- 统一文件I/O + 路径遍历防护
  users.js                -- 用户数据CRUD
  projects.js             -- 项目 + 项目数据CRUD
middleware/ (1个文件, 52行)
  auth.js                 -- authenticateToken + requireAdmin 中间件
routes/ (4个文件, 509行)  -- RESTful API路由
  auth.js                 -- POST /api/auth/login|logout, GET /api/auth/verify
  users.js                -- GET|POST|PUT|DELETE /api/users/*
  projects.js             -- GET|POST|PUT|DELETE /api/projects/*, GET /api/export/*
  data.js                 -- GET|POST /api/data
```

**API 路径完全不变**，前端零修改即可兼容。

#### 2. 前端全局变量封装（App 命名空间）

**拆分前**: 15+ 个全局 `let` 变量（currentData, currentProject, currentUser, userRole, authToken 等）直接暴露在全局作用域，易产生命名冲突。

**拆分后**: 统一封装到 `App` 命名空间：
```javascript
App.data              // 所有业务数据
App.currentProject    // 当前项目ID
App.projectsList      // 项目列表
App.currentUser       // 当前用户名
App.userRole          // 当前角色
App.authToken         // 认证token（仅存内存）
App.currentBugSort    // 排序状态
App.currentBugFilters // 筛选状态
App.statusColors      // 常量映射
// ... 更多
```

使用 `Object.defineProperty` 设置向后兼容的全局别名（如 `currentData` -> `App.data`），现有代码无需修改即可工作。

#### 3. XSS 全面防护（innerHTML -> DOM API）

**拆分前**: 大量使用 `row.innerHTML = \`<td>${escapeHtml(x)}</td>\`` 模式，在动态生成HTML时容易遗漏 `escapeHtml()`，特别是 `onclick` handler 中的参数拼接。

**拆分后**: 全面使用 DOM API 构建元素，彻底杜绝 XSS：
- 所有文本内容通过 `document.createElement()` + `textContent` 设置（非 innerHTML）
- `createJiraLink()` 返回 DOM 元素而非 HTML 字符串
- `emptyTableRow()` 使用 createElement 构建
- `utils.js` 新增 `createTextElement()` 和 `safeSetText()` 辅助函数
- 受影响的文件：`domains.js`, `bugs.js`, `daily-progress.js`, `bu-exit-criteria.js`, `utils.js`, `auth.js`

#### 4. 其他改进
- `backup.js`: 新增 `cleanupOldBackups()` 函数，自动清理每个数据文件的最旧备份（默认保留5个）
- `dataStore.js`: 集中实现路径遍历防护，所有项目数据文件读写都经过安全检查
- `sessions.js`: 集中管理会话生命周期，包含 graceful shutdown 和 auto-save

#### 重构收益

| 指标 | 重构前 | 重构后 |
|---|---|---|
| server.js 行数 | 834 | 47 |
| 后端文件数 | 1 | 15 |
| 全局变量数量 | 15+ | 1 (App) |
| XSS 攻击面 | 高（innerHTML + onclick拼接） | 极低（纯DOM API + textContent） |
| 代码可测试性 | 低（所有逻辑耦合） | 高（模块可独立测试） |
| 新开发者上手时间 | 长（834行单文件） | 短（职责明确的模块） |

---

### v2.2 (2026-04-14)
**认证安全加固：httpOnly Cookie + 401 自动处理**

本次版本重点加固认证安全性，消除 XSS 窃取 Token 的风险，并完善 Token 过期的自动处理机制。

#### 安全改进：httpOnly Cookie 替代 localStorage Token

| 项目 | 改动前 | 改动后 |
|---|---|---|
| Token 存储 | `localStorage.setItem('authToken', token)` | 仅存内存变量 `authToken`，不再写入 localStorage |
| Token 传输 | 手动在请求头添加 `Authorization: Bearer ***` | 浏览器自动携带 httpOnly Cookie（`credentials: 'same-origin'`） |
| XSS 防护 | Token 可被 XSS 脚本读取 `localStorage.getItem('authToken')` | httpOnly Cookie 对 JavaScript 不可见，XSS 无法窃取 |
| CSRF 防护 | 无 | `SameSite=Strict` Cookie 属性阻止跨站请求 |

#### 后端改动

- **登录接口** `/api/auth/login`: 登录成功后通过 `res.cookie()` 设置 httpOnly Cookie
- **认证中间件** `authenticateToken`: 优先从 Cookie 取 Token，其次从 Authorization Header 取（兼容旧方式）
- **登出接口** `/api/auth/logout`: 从 Cookie 获取 Token，登出时 `res.clearCookie('token')` 清除
- **Token 过期处理**: 返回 401 时同步清除 Cookie

#### 前端改动

- **`apiCall()`** 核心改造：移除手动 `Authorization` Header，改用 `credentials: 'same-origin'` 自动携带 Cookie
- 新增 401 自动处理：检测到 401 时清除内存状态 + 弹出登录框
- 新增 `handleTokenExpired()` 函数
- **`doLogin()`**: Token 只存内存变量，不再写入 localStorage
- **`loadSavedUser()`**: 通过 httpOnly Cookie 调用 `/api/auth/verify`
- 用户管理函数全部从手动 `fetch` 改为 `apiCall()`

#### 安全提升总结

| 攻击类型 | 防护措施 |
|---|---|
| XSS Token 窃取 | httpOnly Cookie，JavaScript 无法读取 |
| CSRF 攻击 | SameSite=Strict Cookie 属性 |
| Token 过期滥用 | 401 自动清除状态 + 弹出登录框 |
| 网络错误信任缓存 | 验证失败时清除 localStorage 缓存，安全优先 |

---

### v2.0 (2026-04-14)
**前端代码模块化重构**

本次版本是迄今为止最大的架构重构，将原3600+行的单文件前端拆分为模块化结构，大幅提升代码可维护性和协作效率。

#### JavaScript 模块化拆分（10个文件，共2116行）

| 模块 | 行数 | 职责 |
|---|---|---|
| `globals.js` | 190 | 全局变量封装到App命名空间、数据结构、状态枚举 |
| `utils.js` | 113 | 通用工具函数 + XSS安全DOM辅助 |
| `data.js` | 210 | 数据持久化层：localStorage读写、API交互、混合数据加载 |
| `auth.js` | 375 | 完整的认证系统：登录/登出、权限判断、角色管理、用户CRUD |
| `projects.js` | 209 | 项目管理：项目列表渲染、切换、时间线显示与编辑 |
| `domains.js` | 158 | Domain模块：域表格渲染、状态更新、内联编辑 |
| `bugs.js` | 217 | Bug模块：Bug CRUD、筛选过滤、JIRA链接、严重性管理 |
| `daily-progress.js` | 184 | 每日进度模块：进度CRUD、按日期/域展示 |
| `bu-exit-criteria.js` | 299 | BU准出标准模块：准出标准CRUD、状态管理、批量上传 |
| `app.js` | 161 | 主入口：初始化流程、事件绑定、DOMContentLoaded处理 |

#### CSS 模块化拆分（10个文件）

| 模块 | 职责 |
|---|---|
| `base.css` | 基础布局：body、字体、全局间距 |
| `header.css` | 头部区域：项目切换器、标题、用户信息栏 |
| `components.css` | 通用组件：按钮、模态框、表单、Tab导航 |
| `tables.css` | 共享表格样式：边框、行高、表头 |
| `domains.css` | Domain状态颜色 |
| `bugs.css` | Bug严重性颜色 |
| `daily-progress.css` | 每日进度输入区和时间线样式 |
| `bu-exit-criteria.css` | BU准出标准专属样式 |
| `responsive.css` | 响应式布局（768px断点适配） |
| `styles.css` | 主样式/历史遗留样式（待逐步迁移） |

#### index.html 变化
- **之前**: 单文件约3600行，包含所有HTML + 内联JS + 内联CSS
- **之后**: 569行纯HTML骨架，无任何内联`<script>`或`<style>`

---

### v1.9 (2026-04-10)
**10-20 人并发安全增强**

- **文件锁机制**: 防止并发写入冲突，5秒超时保护
- **自动备份**: 每次写入前自动备份（`.bak` + 时间戳版本化）
- **数据校验**: 用户/项目/数据完整性验证
- **操作日志**: 记录所有关键操作
- **新增 API**: `GET /api/export/:projectId`, `GET /api/logs/:date`

---

### v1.0 ~ v1.85
完整版本历史请参阅之前的发布说明。

## 部署

### Nginx配置参考
```nginx
server {
    listen 8088;
    server_name _;
    
    root /var/www/gpu-tracker;
    index index.html;
    
    location / {
        # SPA routing: serve index.html for unknown paths
        try_files $uri $uri/ /index.html;
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

# 重启API服务（新后端结构需重新部署）
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

**最后更新**: 2026年4月27日  
**版本**: 4.0

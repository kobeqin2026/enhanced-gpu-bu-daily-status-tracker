# GPU Bringup 每日状态追踪系统 - 安全改进说明

## 📋 改进内容（方案一：JSON 文件存储增强版）

### 针对 10-20 人并发场景的优化

---

## 🔒 新增安全特性

### 1. 文件锁机制
- **目的**：防止多人同时写入导致数据损坏
- **实现**：内存锁 + 超时机制（5 秒超时）
- **适用**：所有 JSON 文件写入操作

```javascript
// 自动获取锁，写入完成后释放
await safeWriteJSON(filePath, data);
```

### 2. 自动备份机制
- **备份策略**：每次写入前自动备份
- **备份文件**：`*.bak`（最新备份）+ `*.timestamp.bak`（版本化备份）
- **备份位置**：与源文件同目录

示例：
```
data/users.json
data/users.json.bak          # 最新备份
data/users.json.2026-04-10T10-30-00.bak  # 历史版本
```

### 3. 数据校验
- **用户数据校验**：验证 username, password, role, name 字段
- **角色校验**：仅限 `admin` 或 `user`
- **项目数据校验**：验证 domains, bugs, dailyProgress, buExitCriteria 数组

### 4. 操作日志
- **日志位置**：`logs/operations-YYYY-MM-DD.log`
- **记录内容**：
  - 时间戳
  - 操作用户
  - 操作类型（LOGIN, CREATE, UPDATE, DELETE, EXPORT 等）
  - 操作资源
  - 详细信息（JSON 格式）

示例日志：
```json
{"timestamp":"2026-04-10T10:30:00.000Z","user":"admin","action":"LOGIN","resource":"users","details":{"role":"admin"},"ip":"unknown"}
{"timestamp":"2026-04-10T10:35:00.000Z","user":"admin","action":"CREATE","resource":"users","details":{"targetUser":"zhangsan","role":"user"},"ip":"unknown"}
```

---

## 📁 目录结构

```
enhanced-gpu-bu-daily-status-tracker/
├── data/                    # 数据目录（不提交到 Git）
│   ├── users.json          # 用户账户
│   ├── sessions.json       # 登录会话
│   ├── projects.json       # 项目列表
│   ├── gpu-bringup.json    # 主项目数据
│   └── *.bak               # 自动备份文件
├── logs/                    # 日志目录（不提交到 Git）
│   └── operations-YYYY-MM-DD.log
├── .env.example            # 环境变量模板
├── .gitignore              # Git 忽略规则
├── server.js               # 服务器主程序（已增强）
└── README.md
```

---

## 🚀 部署步骤

### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env 文件，修改端口等配置
```

### 3. 启动服务
```bash
# 开发环境
npm start

# 生产环境（使用 PM2）
pm2 start ecosystem.config.js
```

### 4. 设置日志目录权限
```bash
mkdir -p logs
chmod 755 logs
```

---

## 🔧 维护指南

### 查看操作日志
```bash
# 查看今日日志
cat logs/operations-$(date +%Y-%m-%d).log | jq

# 查看特定用户的操作
cat logs/operations-*.log | grep '"user":"admin"' | jq

# 查看所有删除操作
cat logs/operations-*.log | grep '"action":"DELETE"' | jq
```

### 数据恢复
```bash
# 从备份恢复
cp data/users.json.bak data/users.json

# 从历史版本恢复
cp data/users.json.2026-04-10T10-30-00.bak data/users.json
```

### 日志清理（建议保留 30 天）
```bash
# 清理 30 天前的日志
find logs/ -name "operations-*.log" -mtime +30 -delete
```

---

## ⚠️ 注意事项

### 1. 并发限制
- 当前实现适合 10-20 人并发
- 文件锁超时时间：5 秒
- 如果频繁出现"获取文件锁超时"，考虑升级到 SQLite 方案

### 2. 备份空间
- 每次写入都会创建备份
- 建议定期清理 `.bak` 文件（保留最近 7 天）
- 生产环境建议配置日志轮转

### 3. 数据安全
- 密码为明文存储（内部系统，建议配合网络隔离）
- 敏感数据不提交到 Git（已配置 `.gitignore`）
- 建议定期导出备份到外部存储

### 4. 监控建议
```bash
# 监控日志文件大小
du -sh logs/

# 监控数据文件大小
du -sh data/

# 监控进程内存
pm2 monit
```

---

## 📈 升级到 SQLite 的时机

当出现以下情况时，建议升级到方案二（SQLite）：

1. 并发用户 > 20 人
2. 频繁出现文件锁超时错误
3. 需要复杂查询（如多条件筛选 bug）
4. 需要事务支持（批量操作原子性）
5. 数据量 > 100MB

---

## 🆘 故障排查

### 问题 1：无法写入数据
```bash
# 检查目录权限
ls -la data/
chmod 755 data/

# 检查是否有残留锁文件
ls -la data/*.lock
```

### 问题 2：日志文件过大
```bash
# 查看日志大小
du -sh logs/

# 清理旧日志
find logs/ -mtime +30 -delete
```

### 问题 3：数据损坏
```bash
# 检查备份文件
ls -la data/*.bak

# 恢复最新备份
cp data/gpu-bringup.json.bak data/gpu-bringup.json

# 重启服务
pm2 restart gpu-bringup-api
```

---

## 📞 技术支持

如有问题，请联系 bringup 团队技术支持。

# v1.9 Release Notes

## 📅 发布日期
2026 年 4 月 10 日

## 🎯 版本主题
**10-20 人并发安全增强（方案一）**

针对国产 GPGPU bringup 团队（10-20 人并发）的 JSON 文件存储安全增强方案。

---

## ✨ 核心特性

### 🔒 文件锁机制
- 防止多人同时写入导致数据损坏
- 内存锁实现，无需额外依赖
- 超时保护（5 秒超时）
- 适用于所有 JSON 文件写入操作

### 💾 自动备份机制
- 每次写入前自动备份
- 最新备份：`*.bak`
- 版本化备份：`*.timestamp.bak`
- 备份位置：与源文件同目录

### ✅ 数据校验
- **用户数据校验**: username, password, role, name 字段完整性
- **角色校验**: 仅限 `admin` 或 `user`
- **项目数据校验**: domains, bugs, dailyProgress, buExitCriteria 数组
- **项目信息校验**: id, name 必需字段

### 📝 操作日志
- 日志位置：`logs/operations-YYYY-MM-DD.log`
- 记录内容：时间戳、用户、操作类型、资源、详细信息
- 操作类型：LOGIN, LOGOUT, CREATE, UPDATE, DELETE, EXPORT, ERROR
- API 接口：`GET /api/logs/:date`（仅管理员）

---

## 🔌 新增 API

### 导出项目数据
```
GET /api/export/:projectId
```
- **权限**: 认证用户
- **返回**: JSON 格式项目数据
- **用途**: 数据备份、离线分析

### 查看操作日志
```
GET /api/logs/:date
```
- **权限**: 管理员
- **参数**: date (可选，默认今日，格式：YYYY-MM-DD)
- **返回**: 操作日志数组（JSON 格式）
- **用途**: 审计、故障排查

---

## 📁 新增文件

| 文件 | 说明 |
|------|------|
| `.env.example` | 环境变量配置模板 |
| `SECURITY_IMPROVEMENTS.md` | 安全改进详细文档 |
| `IMPLEMENTATION_SUMMARY.md` | 实施总结与维护指南 |
| `test.sh` | 功能测试脚本 |
| `push-to-github.sh` | GitHub 推送辅助脚本 |
| `RELEASE_NOTES_v1.9.md` | 本文件 |

---

## 🔧 技术改进

### server.js 重写
- 新增 900+ 行安全代码
- 异步文件操作（`fs.promises`）
- 文件锁管理（`acquireLock` / `releaseLock`）
- 安全写入函数（`safeWriteJSON`）
- 操作日志函数（`logOperation`）
- 备份函数（`backupFile`）
- 数据校验函数（`validateUserData`, `validateProjectData`, `validateProject`）

### 目录结构更新
```
enhanced-gpu-bu-daily-status-tracker/
├── data/                    # 数据目录（不提交到 Git）
│   ├── *.json              # 项目数据
│   └── *.bak               # 自动备份文件
├── logs/                    # 日志目录（不提交到 Git）
│   └── operations-YYYY-MM-DD.log
├── .env.example            # 环境变量模板（新增）
├── .gitignore              # 更新：排除 data/, logs/
├── server.js               # 重写安全层
└── test.sh                 # 测试脚本（新增）
```

### .gitignore 更新
```
# 数据文件（敏感数据）
data/*.json
data/*.bak
data/*.lock

# 日志文件
logs/

# 临时文件
*.tmp
*.temp
```

---

## 📊 性能指标

### 适用场景
- ✅ 并发用户：10-20 人
- ✅ 数据量：< 100MB
- ✅ 写入频率：< 10 次/分钟

### 升级时机
当出现以下情况时，建议升级到 SQLite（方案二）：
- ❌ 频繁出现"获取文件锁超时"错误
- ❌ 并发用户 > 20 人
- ❌ 需要复杂查询（多条件筛选、联表查询）
- ❌ 数据量 > 100MB

---

## 🚀 部署指南

### 快速部署
```bash
# 1. 拉取代码
git pull origin master

# 2. 安装依赖
npm install

# 3. 创建目录
mkdir -p logs data
chmod 755 logs data

# 4. 配置环境变量
cp .env.example .env

# 5. 启动服务
npm start
# 或生产环境
pm2 restart gpu-bringup-api

# 6. 验证功能
./test.sh
```

### 默认账号（首次启动自动创建）
- 管理员：`admin / admin123`
- 普通用户：`user / user123`

⚠️ **注意**: 密码为明文存储，建议配合公司内网使用

---

## 🔍 维护命令

### 查看操作日志
```bash
# 今日日志
cat logs/operations-$(date +%Y-%m-%d).log | jq

# 查看所有登录操作
cat logs/operations-*.log | grep '"action":"LOGIN"' | jq

# 查看特定用户的操作
cat logs/operations-*.log | grep '"user":"admin"' | jq

# 查看所有删除操作
cat logs/operations-*.log | grep '"action":"DELETE"' | jq
```

### 数据备份管理
```bash
# 查看备份文件
ls -lh data/*.bak

# 恢复最新备份
cp data/gpu-bringup.json.bak data/gpu-bringup.json

# 从历史版本恢复
cp data/gpu-bringup.json.2026-04-10T*.bak data/gpu-bringup.json

# 清理 7 天前的备份
find data/ -name "*.bak" -mtime +7 -delete
```

### 日志清理
```bash
# 清理 30 天前的日志
find logs/ -name "operations-*.log" -mtime +30 -delete

# 查看日志目录大小
du -sh logs/
```

### 监控命令
```bash
# PM2 监控
pm2 monit

# 查看进程日志
pm2 logs gpu-bringup-api

# 检查文件锁状态
ls -la data/*.lock 2>/dev/null || echo "无残留锁文件"
```

---

## ⚠️ 注意事项

### 1. 首次启动
- 确保 `data/` 和 `logs/` 目录存在
- 检查目录权限（PM2 运行用户需要有写权限）
- 首次启动会自动创建默认用户

### 2. 密码安全
- 当前为明文存储（内部系统）
- 建议配合网络隔离使用
- 定期修改管理员密码

### 3. 备份策略
- 自动备份已启用
- 建议额外配置：
  - 每日定时备份到外部存储
  - 每周导出完整数据（使用 `/api/export`）
  - 每月归档旧日志

### 4. 监控告警
建议配置以下监控：
- 磁盘空间（data/ 和 logs/ 目录）
- 进程状态（PM2）
- 文件锁超时错误（日志关键字："获取文件锁超时"）

---

## 🐛 已知问题

### 问题 1：文件锁超时
**现象**: 频繁出现"获取文件锁超时"错误

**原因**: 并发写入过于频繁

**解决方案**:
1. 检查是否有异常频繁的写入操作
2. 考虑升级到 SQLite 方案
3. 优化前端减少不必要的保存操作

### 问题 2：备份文件过多
**现象**: `data/` 目录备份文件占用大量空间

**解决方案**:
```bash
# 定期清理 7 天前的备份
find data/ -name "*.bak" -mtime +7 -delete

# 或配置 cron 任务
0 2 * * * find /path/to/data/ -name "*.bak" -mtime +7 -delete
```

---

## 📈 版本对比

| 特性 | v1.85 | v1.9 |
|------|-------|------|
| 并发安全 | ❌ | ✅ 文件锁 |
| 自动备份 | ❌ | ✅ 每次写入前 |
| 数据校验 | 部分 | ✅ 完整 |
| 操作日志 | ❌ | ✅ 完整 |
| 导出 API | ❌ | ✅ |
| 日志 API | ❌ | ✅ |
| 测试脚本 | ❌ | ✅ |
| 适用并发 | < 10 人 | 10-20 人 |

---

## 🙏 致谢

感谢 GPGPU Bringup 团队的需求反馈和测试支持！

---

## 📞 技术支持

- 详细文档：`SECURITY_IMPROVEMENTS.md`
- 实施总结：`IMPLEMENTATION_SUMMARY.md`
- 测试脚本：`./test.sh`

---

**发布版本**: v1.9  
**发布日期**: 2026-04-10  
**适用团队**: GPGPU Bringup 团队（10-20 人）

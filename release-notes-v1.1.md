## v1.1.0 Release Notes

### 🚀 新增功能
- **持久化数据存储**：所有数据保存在 `data.json` 文件，服务器重启后数据不丢失
- **完整测试数据**：预置 PCIe/HBM/Ethernet 三大Domain的完整测试数据
- **数据备份脚本**：支持手动执行 `backup-data.sh` 将数据备份到GitHub

### 🐛 问题修复
- **Nginx代理配置**：修正API代理端口从3000→80，解决网页无法加载数据的问题
- **目录结构调整**：前端文件移至 `public/` 目录，符合标准Web项目规范

### 📄 文档更新
- 更新README.md，包含v1.1新功能说明
- 优化部署指南和项目结构说明

### 📦 文件变更
- `data.json`：新增测试数据
- `nginx.conf`：修正代理配置
- `README.md`：全面更新文档
- `public/index.html`：目录结构调整
- `backup-data.sh`：新增备份脚本

---
**发布日期**: 2026-03-07  
**兼容性**: 需要Node.js v14+
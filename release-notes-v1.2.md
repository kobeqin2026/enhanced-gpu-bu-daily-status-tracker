## v1.2.0 Release Notes

### 🐛 问题修复
- **BU准出标准下拉框数据关联**：修复Domain和Sign-off owner下拉框无数据的问题
- **动态联动功能**：确保Owner下拉框根据选中的Domain自动匹配对应负责人
- **初始化逻辑**：在编辑模态框打开时正确加载Domain和Owner选项

### 🔗 数据关联
- Domain下拉框 ↔ Domain表格中的Domain名称
- Owner下拉框 ↔ Domain表格中对应Domain的Owner
- 支持PCIe/HBM/Ethernet三大Domain的完整联动

### 📦 文件变更
- `public/index.html`：修改BU准出标准编辑模态框，实现下拉框数据关联

---
**发布日期**: 2026-03-07  
**兼容性**: 需要Node.js v14+
# GPU Bring-up Daily Tracker

国产GPU芯片bring up每日追踪系统

## 功能特性

- **域概览 (Domain Overview)**: 管理各个功能域的状态和负责人
- **Bug跟踪 (Bug Tracking)**: 跟踪各域的bug状态和严重性
- **每日进度跟踪 (Daily Progress Tracking)**: 记录每日工作进展
- **Bringup准出标准 (BU Exit Criteria)**: 定义各域的准出标准和签核状态

## 技术特点

- 纯前端实现，使用localStorage存储数据
- 响应式设计，支持桌面和移动设备
- 管理员模式支持完整的CRUD操作
- Domain和Sign-off owner自动关联
- 自动更新最后修改时间

## 部署说明

1. 将项目文件部署到web服务器
2. 配置nginx（或其他web服务器）指向index.html
3. 访问 http://your-server:port/ 即可使用

## 版本信息

- **v0.1**: 初始版本，包含完整的GPU bring-up追踪功能

## 使用说明

- 普通用户模式：查看数据和状态
- 管理员模式：点击右上角"切换到管理员模式"按钮，可以编辑、添加、删除所有数据
- 支持Ctrl+S快捷键保存数据
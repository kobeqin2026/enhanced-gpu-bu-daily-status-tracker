#!/bin/bash

# 国产GPU芯片Bring-up追踪系统 - 服务器启动脚本
# Author: Kobe
# Date: 2026-03-04

# 设置工作目录
cd "$(dirname "$0")"

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "错误: Node.js未安装"
    echo "请先安装Node.js (建议版本: 14.x 或更高)"
    exit 1
fi

# 检查npm依赖是否已安装
if [ ! -d "node_modules" ]; then
    echo "检测到缺少node_modules目录，正在安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "错误: 依赖安装失败"
        exit 1
    fi
fi

# 启动服务器
echo "启动国产GPU芯片Bring-up追踪系统..."
echo "服务器将在 http://localhost:8080 运行"
echo "在公司网络中访问: http://47.77.221.23:8080"
echo "按 Ctrl+C 停止服务器"

# 使用forever保持进程运行（可选）
# 如果没有安装forever，直接使用node
if command -v forever &> /dev/null; then
    forever start server.js
    echo "服务器已通过forever启动 (使用 'forever stop server.js' 停止)"
else
    node server.js
fi
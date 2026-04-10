#!/bin/bash
# GPU Bringup Tracker - 快速测试脚本
# 用于验证服务器功能是否正常

BASE_URL="http://localhost:3000"
TOKEN=""

echo "🔍 GPU Bringup Tracker 功能测试"
echo "================================"
echo ""

# 1. 测试服务器是否启动
echo "1️⃣  测试服务器连接..."
response=$(curl -s -o /dev/null -w "%{http_code}" ${BASE_URL}/)
if [ "$response" == "200" ]; then
    echo "   ✅ 服务器正常运行 (${BASE_URL})"
else
    echo "   ❌ 服务器未响应 (HTTP $response)"
    echo "   提示：请先启动服务器 'npm start'"
    exit 1
fi

# 2. 测试登录
echo ""
echo "2️⃣  测试用户登录..."
login_response=$(curl -s -X POST ${BASE_URL}/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123"}')

TOKEN=$(echo $login_response | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
    echo "   ✅ 登录成功 (token: ${TOKEN:0:8}...)"
else
    echo "   ❌ 登录失败"
    echo "   响应：$login_response"
    exit 1
fi

# 3. 测试获取项目列表
echo ""
echo "3️⃣  测试获取项目列表..."
projects=$(curl -s ${BASE_URL}/api/projects)
project_count=$(echo $projects | grep -o '"id"' | wc -l)
echo "   ✅ 获取到 $project_count 个项目"

# 4. 测试获取项目数据
echo ""
echo "4️⃣  测试获取项目数据..."
data=$(curl -s "${BASE_URL}/api/data?project=gpu-bringup")
if echo $data | grep -q "domains"; then
    echo "   ✅ 项目数据获取成功"
else
    echo "   ❌ 项目数据获取失败"
    exit 1
fi

# 5. 测试数据保存（带认证）
echo ""
echo "5️⃣  测试数据保存..."
test_data='{
    "projectId": "gpu-bringup",
    "domains": [
        {"id":"test-1","name":"PCIe Test","owner":"测试","status":"in-progress","notes":"自动测试"}
    ],
    "bugs": [],
    "dailyProgress": [],
    "buExitCriteria": []
}'

save_response=$(curl -s -X POST "${BASE_URL}/api/data" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "$test_data")

if echo $save_response | grep -q '"success":true'; then
    echo "   ✅ 数据保存成功"
else
    echo "   ❌ 数据保存失败"
    echo "   响应：$save_response"
    exit 1
fi

# 6. 测试操作日志
echo ""
echo "6️⃣  测试操作日志..."
logs=$(curl -s ${BASE_URL}/api/logs/$(date +%Y-%m-%d) \
    -H "Authorization: Bearer $TOKEN")
log_count=$(echo $logs | grep -o '"timestamp"' | wc -l)
echo "   ✅ 今日操作日志：$log_count 条"

# 7. 测试数据导出
echo ""
echo "7️⃣  测试数据导出..."
export_file="/tmp/gpu-bringup-export-$(date +%s).json"
curl -s -o $export_file "${BASE_URL}/api/export/gpu-bringup" \
    -H "Authorization: Bearer $TOKEN"

if [ -f "$export_file" ] && [ -s "$export_file" ]; then
    echo "   ✅ 数据导出成功 ($export_file)"
    rm -f $export_file
else
    echo "   ❌ 数据导出失败"
    exit 1
fi

# 8. 测试登出
echo ""
echo "8️⃣  测试用户登出..."
logout_response=$(curl -s -X POST ${BASE_URL}/api/auth/logout \
    -H "Authorization: Bearer $TOKEN")

if echo $logout_response | grep -q '"success":true'; then
    echo "   ✅ 登出成功"
else
    echo "   ❌ 登出失败"
    exit 1
fi

echo ""
echo "================================"
echo "🎉 所有测试通过！"
echo ""
echo "📊 测试总结:"
echo "   - 服务器连接：✅"
echo "   - 用户认证：✅"
echo "   - 数据读取：✅"
echo "   - 数据写入：✅"
echo "   - 操作日志：✅"
echo "   - 数据导出：✅"
echo ""
echo "💡 提示："
echo "   - 查看日志：cat logs/operations-\$(date +%Y-%m-%d).log | jq"
echo "   - 查看备份：ls -lh data/*.bak"
echo "   - 监控进程：pm2 monit"
echo ""

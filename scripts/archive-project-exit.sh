#!/bin/bash
# 项目退出数据固化归档脚本 (参数化: 传入项目 id, 仓内不绑定具体项目)
# 用途: 把当前全部有效运行时数据只读归档到 archives/<项目id>-stage-exit-<日期>.tar.gz,
#       为下个项目做准备。归档前强制校验主数据全 pass / 全 completed, 半途数据拒绝打包。

set -euo pipefail

# 用法: ./archive-project-exit.sh <project-id> [stamp]
PROJECT_ID="${1:?用法: $0 <project-id> [stamp]}"
STAMP="${2:-$(date +%Y%m%d)}"
ARCHIVE_NAME="${PROJECT_ID}-stage-exit-${STAMP}"
ARCHIVE_DIR=archives
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_DIR}"

mkdir -p "${ARCHIVE_DIR}"

# 归档内容:
#   data/ 主数据 + 每日总结快照 + 项目定义 + 会话/用户(固化时刻现场)
#   data/jira-cache/  JIRA 同步缓存
#   data/mail-report/ 每日邮件正文 .md
#   data/uploads/     附件 (若有)
# 不含: *.bak 备份文件 (会话自动保存的历史残留, 无归档价值)

INCLUDE=(
    "data/${PROJECT_ID}.json"
    "data/${PROJECT_ID}.daily-summaries.json"
    data/projects.json
    data/sessions.json
    data/users.json
)

# 缺失文件提前剔除(旧项目迁移场景可能只有部分文件)
MISSING=0
for f in "${INCLUDE[@]}"; do
    if [ ! -f "$f" ]; then
        echo "!! 缺少 $f, 跳过该文件"
        MISSING=$((MISSING+1))
    fi
done

# 1. 快照落盘之前先校验主数据完整性
node - <<EOF
const ds = require('${REPO_DIR}/lib/dataStore');
const d = ds.readJSONSync('data/${PROJECT_ID}.json');
const domains = d.domains || [];
const pass = (d.buExitCriteria || []).filter(c => c.status === 'pass').length;
const total = (d.buExitCriteria || []).length;
const completed = domains.filter(x => x.status === 'completed').length;
console.log(\`  域总数=\${domains.length} 已完成=\${completed} 准出pass=\${pass}/\${total} version=\${d.version}\`);
if (domains.length !== completed || pass !== total || total === 0) {
    console.error('!! 主数据不是全 pass / 全 completed 状态, 拒绝归档');
    process.exit(1);
}
EOF

# 2. 打 tar 包 (相对路径, 排除 *.bak; sessions/users 只做现场快照)
tar czf "${ARCHIVE_DIR}/${ARCHIVE_NAME}.tar.gz" \
    "${INCLUDE[@]}" \
    data/jira-cache \
    data/mail-report \
    $( [ -d data/uploads ] && echo data/uploads ) \
    --exclude='*.bak' --exclude='*.data' \
    2>/dev/null || true

# 3. 校验
if [ ! -s "${ARCHIVE_DIR}/${ARCHIVE_NAME}.tar.gz" ]; then
    echo "!! 归档失败: tar.gz 为空"
    exit 1
fi

echo "=============================================="
echo "归档完成"
echo "  文件: ${REPO_DIR}/${ARCHIVE_DIR}/${ARCHIVE_NAME}.tar.gz"
du -h "${ARCHIVE_DIR}/${ARCHIVE_NAME}.tar.gz"
echo "=============================================="
tar tzf "${ARCHIVE_DIR}/${ARCHIVE_NAME}.tar.gz" | sort | awk -F/ '{print $1"/"$2}' | uniq -c | sort -rn | head -15
echo "总文件数: $(tar tzf "${ARCHIVE_DIR}/${ARCHIVE_NAME}.tar.gz" | wc -l)"

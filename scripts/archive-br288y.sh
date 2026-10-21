#!/bin/bash
# BR288Y stage1/stage2 已退出 — 项目数据固化归档 (2026-10-21)
# 用途: 把 enhanced-gpu-bu-daily-status-tracker 当前全部有效运行时数据
#       只读归档到 archives/br288y-stage-exit-20261021.tar.gz, 为下个项目做准备。

set -euo pipefail
cd /home/br188/enhanced-gpu-bu-daily-status-tracker

STAMP=20261021
ARCHIVE_NAME=br288y-stage-exit-${STAMP}
ARCHIVE_DIR=archives
mkdir -p "${ARCHIVE_DIR}"

# 归档内容:
#   data/ 主数据 + 每日总结快照 + 项目定义 + 会话/用户(固化时刻现场)
#   data/jira-cache/  JIRA 同步缓存 (BR288Y-history.json 等)
#   data/mail-report/ 每日邮件正文 .md (2026-09-XX ~ 10-14)
#   data/uploads/     附件 (若有)
# 不含: 25.5万个 .bak 备份文件 (30秒/次的会话自动保存产物, 无归档价值)

INCLUDE=(
    data/br288y.json
    data/br288y.daily-summaries.json
    data/projects.json
    data/sessions.json
    data/users.json
    data/taihu.json
    data/taihu.daily-summaries.json
)

# 1. 快照落盘之前先校验主数据完整性
node - <<'EOF'
const ds = require('/home/br188/enhanced-gpu-bu-daily-status-tracker/lib/dataStore');
const d = ds.readJSONSync('data/br288y.json');
const domains = d.domains || [];
const pass = (d.buExitCriteria || []).filter(c => c.status === 'pass').length;
const total = (d.buExitCriteria || []).length;
const completed = domains.filter(x => x.status === 'completed').length;
console.log(`  域总数=${domains.length} 已完成=${completed} 准出pass=${pass}/${total} version=${d.version}`);
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
echo "  文件: /home/br188/enhanced-gpu-bu-daily-status-tracker/${ARCHIVE_DIR}/${ARCHIVE_NAME}.tar.gz"
du -h "${ARCHIVE_DIR}/${ARCHIVE_NAME}.tar.gz"
echo "=============================================="
tar tzf "${ARCHIVE_DIR}/${ARCHIVE_NAME}.tar.gz" | sort | awk -F/ '{print $1"/"$2}' | uniq -c | sort -rn | head -15
echo "总文件数: $(tar tzf "${ARCHIVE_DIR}/${ARCHIVE_NAME}.tar.gz" | wc -l)"

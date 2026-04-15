// Backup utilities
const fs = require('fs');
const path = require('path');

function backupFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    
    const backupPath = filePath + '.bak';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const versionedBackup = filePath + '.' + timestamp + '.bak';
    
    try {
        if (fs.existsSync(backupPath)) {
            fs.renameSync(backupPath, versionedBackup);
        }
        fs.copyFileSync(filePath, backupPath);
        console.log('备份完成：' + filePath + ' -> ' + backupPath);
    } catch (error) {
        console.error('备份失败：' + filePath, error);
    }
}

function cleanupOldBackups(filePath, keep) {
    keep = keep || 5;
    try {
        const dir = path.dirname(filePath);
        const base = path.basename(filePath);
        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith(base + '.') && f.endsWith('.bak'))
            .sort()
            .reverse();
        files.slice(keep).forEach(function(f) {
            fs.unlinkSync(path.join(dir, f));
            console.log('清理旧备份：' + f);
        });
    } catch (e) {
        console.error('清理备份失败:', e);
    }
}

module.exports = { backupFile, cleanupOldBackups };

/**
 * @module backup
 * @description Backup utilities for creating versioned backups of data files and cleaning up old backups.
 */
const fs = require('fs');
const path = require('path');

/**
 * Creates a timestamped backup of the specified file.
 * If an existing .bak file is found, it is renamed to a versioned backup before creating a new one.
 *
 * @param {string} filePath - The path to the file to back up.
 * @returns {void}
 */
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

/**
 * Removes old versioned backup files, keeping only the most recent ones.
 *
 * @param {string} filePath - The path to the original file (used to locate its backups).
 * @param {number} [keep=5] - The number of most recent backups to retain.
 * @returns {void}
 */
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

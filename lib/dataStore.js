// Data file I/O with locking and backup

var fs = require('fs');
var fsp = require('fs').promises;
var path = require('path');
var acquireLock = require('./fileLock').acquireLock;
var releaseLock = require('./fileLock').releaseLock;
var backupFile = require('./backup').backupFile;

var DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    return DATA_DIR;
}

async function safeWriteJSON(filePath, data, validateFn) {
    await acquireLock(filePath);
    try {
        if (validateFn) validateFn(data);
        backupFile(filePath);
        await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
        console.log('写入成功：' + filePath);
        return true;
    } catch (error) {
        console.error('写入失败：' + filePath, error);
        throw error;
    } finally {
        releaseLock(filePath);
    }
}

function readJSONSync(filePath) {
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    return null;
}

function getProjectDataFile(projectId) {
    var sanitizedId = projectId.replace(/[^a-zA-Z0-9\-_]/g, '');
    if (sanitizedId !== projectId) {
        console.warn('Potential path traversal attempt detected: ' + projectId);
        return null;
    }
    var filePath = path.join(DATA_DIR, sanitizedId + '.json');
    if (!filePath.startsWith(DATA_DIR)) {
        return null;
    }
    return filePath;
}

module.exports = { safeWriteJSON, readJSONSync, getProjectDataFile, DATA_DIR, ensureDataDir };

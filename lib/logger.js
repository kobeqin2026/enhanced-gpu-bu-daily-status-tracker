// Operation logging

const path = require('path');
const fs = require('fs');

function getLogDir() {
    return path.join(__dirname, '..', 'logs');
}

function logOperation(user, action, resource, details) {
    details = details || {};
    var logDir = getLogDir();
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    
    var logFile = path.join(logDir, 'operations-' + new Date().toISOString().split('T')[0] + '.log');
    var logEntry = {
        timestamp: new Date().toISOString(),
        user: user || 'system',
        action: action,
        resource: resource,
        details: details,
        ip: details.ip || 'unknown'
    };
    
    var logLine = JSON.stringify(logEntry) + '\n';
    
    try {
        fs.appendFileSync(logFile, logLine);
    } catch (error) {
        console.error('写入操作日志失败:', error);
    }
}

function readLogByDate(date) {
    var logFile = path.join(getLogDir(), 'operations-' + date + '.log');
    if (!fs.existsSync(logFile)) {
        return [];
    }
    var logContent = fs.readFileSync(logFile, 'utf8');
    return logContent.trim().split('\n').filter(function(line) { return line; }).map(function(line) {
        return JSON.parse(line);
    });
}

module.exports = { logOperation, readLogByDate, getLogDir };

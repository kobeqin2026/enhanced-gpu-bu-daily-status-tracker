/**
 * @module logger
 * @description Operation logging utilities. Records user actions to dated log files
 * in the logs/ directory and provides retrieval of log entries by date.
 */

const path = require('path');
const fs = require('fs');

/**
 * Returns the path to the logs directory.
 *
 * @returns {string} The absolute path to the logs directory.
 */
function getLogDir() {
    return path.join(__dirname, '..', 'logs');
}

/**
 * Logs an operation entry to the daily operations log file.
 * Creates the log directory if it does not exist.
 *
 * @param {string} user - The username performing the action (defaults to 'system' if falsy).
 * @param {string} action - The action being performed (e.g., 'create', 'update', 'delete').
 * @param {string} resource - The resource being acted upon.
 * @param {object} [details] - Additional details about the operation, including optional 'ip' field.
 * @returns {void}
 */
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

/**
 * Reads and parses all log entries for a given date.
 *
 * @param {string} date - The date string in YYYY-MM-DD format to read logs for.
 * @returns {Array<object>} An array of parsed log entry objects for the given date, or an empty array if no log file exists.
 */
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

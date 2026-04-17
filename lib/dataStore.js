/**
 * @module dataStore
 * @description Data file I/O with locking and backup support. Provides safe JSON read/write operations
 * with file locking to prevent concurrent write corruption and automatic backup before writes.
 */

var fs = require('fs');
var fsp = require('fs').promises;
var path = require('path');
var acquireLock = require('./fileLock').acquireLock;
var releaseLock = require('./fileLock').releaseLock;
var backupFile = require('./backup').backupFile;

var DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Ensures the data directory exists, creating it recursively if necessary.
 *
 * @returns {string} The path to the data directory.
 */
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    return DATA_DIR;
}

/**
 * Safely writes JSON data to a file with file locking and backup.
 * Acquires a lock, optionally validates data, backs up the existing file, then writes.
 *
 * @param {string} filePath - The path to the file to write.
 * @param {*} data - The data to serialize and write as JSON.
 * @param {function|null} [validateFn] - An optional validation function to run against the data before writing.
 * @returns {Promise<boolean>} Resolves to true if the write succeeds.
 * @throws {Error} If validation fails or the write operation fails.
 */
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

/**
 * Synchronously reads and parses a JSON file.
 *
 * @param {string} filePath - The path to the JSON file to read.
 * @returns {object|null} The parsed JSON object, or null if the file does not exist.
 */
function readJSONSync(filePath) {
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    return null;
}

/**
 * Generates a safe file path for a project's data file within the data directory.
 * Sanitizes the project ID to prevent path traversal attacks.
 *
 * @param {string} projectId - The project identifier.
 * @returns {string|null} The resolved file path, or null if the project ID is unsafe.
 */
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

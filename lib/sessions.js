/**
 * @module sessions
 * @description Session management with file persistence. Handles generation of session tokens,
 * loading and saving sessions to disk, and provides auto-save and graceful shutdown support.
 */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var dataStore = require('./dataStore');

var SESSIONS_FILE = path.join(__dirname, '..', 'data', 'sessions.json');
var sessions = {};

/**
 * Generates a unique session token for the given username.
 * Uses the current timestamp, random bytes, and a SHA-256 hash truncated to 32 characters.
 *
 * @param {string} username - The username to generate a token for.
 * @returns {string} A 32-character hexadecimal session token.
 */
function generateToken(username) {
    var timestamp = Date.now();
    var random = crypto.randomBytes(16).toString('hex');
    return crypto.createHash('sha256').update(username + ':' + timestamp + ':' + random).digest('hex').substring(0, 32);
}

/**
 * Loads sessions from the sessions file into the in-memory sessions object.
 * If the file does not exist or fails to parse, initializes sessions to an empty object.
 *
 * @returns {object} The loaded sessions object mapping token strings to session data.
 */
function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            var data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            sessions = JSON.parse(data);
            console.log('Loaded ' + Object.keys(sessions).length + ' sessions from file');
        }
    } catch (error) {
        console.error('Failed to load sessions:', error);
        sessions = {};
    }
    return sessions;
}

/**
 * Persists the current in-memory sessions to the sessions file.
 *
 * @returns {Promise<void>} Resolves when the sessions have been saved.
 */
async function saveSessions() {
    try {
        await dataStore.safeWriteJSON(SESSIONS_FILE, sessions, null);
    } catch (error) {
        console.error('Failed to save sessions:', error);
    }
}

/**
 * Returns the current in-memory sessions object.
 *
 * @returns {object} The sessions object.
 */
function getSessions() {
    return sessions;
}

/**
 * Registers process event handlers to save sessions on process exit, SIGINT, and SIGTERM.
 * This ensures sessions are persisted during graceful shutdown.
 *
 * @returns {void}
 */
function setupGracefulShutdown() {
    process.on('exit', function() {
        try {
            fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
        } catch (e) {}
    });
    process.on('SIGINT', function() {
        saveSessions().then(function() { process.exit(); });
    });
    process.on('SIGTERM', function() {
        saveSessions().then(function() { process.exit(); });
    });
}

/**
 * Starts a periodic auto-save timer that persists sessions at a specified interval.
 *
 * @param {number} [interval=30000] - The auto-save interval in milliseconds (default: 30000ms).
 * @returns {void}
 */
function startAutoSave(interval) {
    interval = interval || 30000;
    setInterval(saveSessions, interval);
}

module.exports = { generateToken, loadSessions, saveSessions, getSessions, setupGracefulShutdown, startAutoSave, SESSIONS_FILE };

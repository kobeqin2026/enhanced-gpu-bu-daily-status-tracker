/**
 * @module sessions
 * @description Session management with file persistence. Handles generation of session tokens,
 * loading and saving sessions to disk, and provides auto-save and graceful shutdown support.
 *
 * STORAGE: keyed by SESSION TOKEN (not username). This allows MULTIPLE concurrent sessions per
 * user, so a re-login (another tab/device, or a page that re-authenticates) does NOT orphan the
 * previously issued cookie. Before the fix the store was keyed by `username`, so a second login as
 * the same user overwrote the first session → the first cookie's token no longer matched →
 * authenticateToken returned 401 "无效的 token" → frontend showed "保存失败：记录尚未写入服务器".
 * See gpu-tracker-maintenance skill (sessions keyed by username → re-login orphaning).
 */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var dataStore = require('./dataStore');

var SESSIONS_FILE = path.join(__dirname, '..', 'data', 'sessions.json');
var sessions = {};
// 上次成功落盘的序列化内容: saveSessions 每30s被定时器调一次,
// 无变化时跳过写盘, 防止空写每小时刷120个 *.bak (2026-10-21 修复, 当时已积25.5万个备份文件)
var lastSavedPayload = null;

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
 * Loads sessions from the sessions file into the in-memory sessions object,
 * normalising the legacy username-keyed format (key=username, value has .token) into the
 * token-keyed format so a username can hold multiple concurrent sessions.
 *
 * @returns {object} The loaded sessions object mapping token strings to session data.
 */
function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            var data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            var normalized = {};
            var now = Date.now();
            Object.keys(data).forEach(function(k) {
                var s = data[k];
                if (!s) return;
                // 清理已过期会话 (24h TTL, 与 authenticateToken 一致), 防止 token-keyed 存储无限增长
                if (s.createdAt && (now - s.createdAt > 24 * 60 * 60 * 1000)) return;
                // 旧格式按 username 作键, value 内含 token → 归一化为按 token 作键 (多会话, 不互相覆盖)
                var key = s.token ? s.token : k;
                if (!normalized[key]) normalized[key] = s;
            });
            sessions = normalized;
            lastSavedPayload = JSON.stringify(sessions, null, 2);
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
        var payload = JSON.stringify(sessions, null, 2);
        if (payload === lastSavedPayload) return; // 无变化不写, 停掉30s空写刷盘
        await dataStore.safeWriteJSON(SESSIONS_FILE, sessions, null);
        lastSavedPayload = payload;
    } catch (error) {
        console.error('Failed to save sessions:', error);
    }
}

/**
 * Returns the current in-memory sessions object.
 *
 * @returns {object} The sessions object (keyed by token).
 */
function getSessions() {
    return sessions;
}

/**
 * Returns the session for a given token, or null.
 *
 * @param {string} token - The session token.
 * @returns {object|null}
 */
function getSessionByToken(token) {
    return sessions[token] || null;
}

/**
 * Returns all sessions belonging to a given username (a user may have multiple concurrent sessions).
 *
 * @param {string} username - The account username.
 * @returns {Array<object>}
 */
function getSessionsByUsername(username) {
    var out = [];
    Object.keys(sessions).forEach(function(k) {
        if (sessions[k] && sessions[k].username === username) out.push(sessions[k]);
    });
    return out;
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

module.exports = {
    generateToken, loadSessions, saveSessions, getSessions,
    getSessionByToken, getSessionsByUsername,
    setupGracefulShutdown, startAutoSave, SESSIONS_FILE
};
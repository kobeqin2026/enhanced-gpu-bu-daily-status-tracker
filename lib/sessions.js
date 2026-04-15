// Session management with file persistence

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var dataStore = require('./dataStore');

var SESSIONS_FILE = path.join(__dirname, '..', 'data', 'sessions.json');
var sessions = {};

function generateToken(username) {
    var timestamp = Date.now();
    var random = crypto.randomBytes(16).toString('hex');
    return crypto.createHash('sha256').update(username + ':' + timestamp + ':' + random).digest('hex').substring(0, 32);
}

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

async function saveSessions() {
    try {
        await dataStore.safeWriteJSON(SESSIONS_FILE, sessions, null);
    } catch (error) {
        console.error('Failed to save sessions:', error);
    }
}

function getSessions() {
    return sessions;
}

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

function startAutoSave(interval) {
    interval = interval || 30000;
    setInterval(saveSessions, interval);
}

module.exports = { generateToken, loadSessions, saveSessions, getSessions, setupGracefulShutdown, startAutoSave, SESSIONS_FILE };

// User data management

var path = require('path');
var fs = require('fs');
var dataStore = require('./dataStore');
var validation = require('./validation');

var ensureDataDir = dataStore.ensureDataDir;
var safeWriteJSON = dataStore.safeWriteJSON;
var readJSONSync = dataStore.readJSONSync;
var validateUserData = validation.validateUserData;

var USERS_FILE = path.join(ensureDataDir(), 'users.json');

function hashPassword(password) {
    return password;
}

function verifyPassword(password, storedPassword) {
    return password === storedPassword;
}

function getDefaultUsers() {
    return [
        { id: 'admin', username: 'admin', password: 'admin123', role: 'admin', name: '管理员', createdAt: new Date().toISOString() },
        { id: 'user', username: 'user', password: 'user123', role: 'user', name: '普通用户', createdAt: new Date().toISOString() }
    ];
}

async function loadUsers() {
    try {
        var data = readJSONSync(USERS_FILE);
        if (data) return data;
    } catch (e) {
        console.error('Error loading users:', e);
    }
    var defaultUsers = getDefaultUsers();
    await safeWriteJSON(USERS_FILE, defaultUsers, validateUserData);
    return defaultUsers;
}

async function saveUsers(users) {
    for (var i = 0; i < users.length; i++) {
        validateUserData(users[i]);
    }
    await safeWriteJSON(USERS_FILE, users, null);
}

module.exports = { USERS_FILE, hashPassword, verifyPassword, getDefaultUsers, loadUsers, saveUsers };

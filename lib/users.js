/**
 * @module users
 * @description User data management. Provides functions to load, save, hash, and verify
 * user credentials from a JSON-backed user store.
 */

var path = require('path');
var fs = require('fs');
var dataStore = require('./dataStore');
var validation = require('./validation');

var ensureDataDir = dataStore.ensureDataDir;
var safeWriteJSON = dataStore.safeWriteJSON;
var readJSONSync = dataStore.readJSONSync;
var validateUserData = validation.validateUserData;

var USERS_FILE = path.join(ensureDataDir(), 'users.json');

/**
 * Placeholder password hashing function.
 * Currently returns the password as-is without hashing.
 *
 * @param {string} password - The plain-text password.
 * @returns {string} The password (currently unhashed; intended to be replaced with real hashing).
 */
function hashPassword(password) {
    return password;
}

/**
 * Verifies a plain-text password against a stored password.
 *
 * @param {string} password - The plain-text password to verify.
 * @param {string} storedPassword - The stored password to compare against.
 * @returns {boolean} True if the passwords match, false otherwise.
 */
function verifyPassword(password, storedPassword) {
    return password === storedPassword;
}

/**
 * Returns the default list of users used when no existing user data is found.
 *
 * @returns {Array<object>} An array of default user objects with id, username, password, role, name, and createdAt fields.
 */
function getDefaultUsers() {
    return [
        { id: 'admin', username: 'admin', password: 'admin123', role: 'admin', name: '管理员', createdAt: new Date().toISOString() },
        { id: 'user', username: 'user', password: 'user123', role: 'user', name: '普通用户', createdAt: new Date().toISOString() }
    ];
}

/**
 * Loads the list of users from the users file.
 * Returns default users and persists them if the file does not exist or fails to load.
 *
 * @returns {Promise<Array<object>>} Resolves with the array of user objects.
 */
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

/**
 * Validates and saves the list of users to the users file.
 *
 * @param {Array<object>} users - The array of user objects to save.
 * @returns {Promise<void>} Resolves when the users have been written successfully.
 * @throws {Error} If any user fails validation.
 */
async function saveUsers(users) {
    for (var i = 0; i < users.length; i++) {
        validateUserData(users[i]);
    }
    await safeWriteJSON(USERS_FILE, users, null);
}

module.exports = { USERS_FILE, hashPassword, verifyPassword, getDefaultUsers, loadUsers, saveUsers };

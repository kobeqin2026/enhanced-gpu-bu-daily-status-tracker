/**
 * @module users
 * @description User data management. Provides functions to load, save, hash, and verify
 * user credentials from a JSON-backed user store.
 */

var path = require('path');
var fs = require('fs');
var bcrypt = require('bcryptjs');
var dataStore = require('./dataStore');
var validation = require('./validation');

var ensureDataDir = dataStore.ensureDataDir;
var safeWriteJSON = dataStore.safeWriteJSON;
var readJSONSync = dataStore.readJSONSync;
var validateUserData = validation.validateUserData;

var SALT_ROUNDS = 10;

var USERS_FILE = path.join(ensureDataDir(), 'users.json');

/**
 * Hash a plain-text password using bcrypt.
 *
 * @param {string} password - The plain-text password.
 * @returns {Promise<string>} The bcrypt-hashed password.
 */
async function hashPassword(password) {
    return await bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verifies a plain-text password against a stored bcrypt hash.
 * Falls back to plain comparison for legacy unhashed passwords.
 *
 * @param {string} password - The plain-text password to verify.
 * @param {string} storedPassword - The stored (hashed) password.
 * @returns {Promise<boolean>} True if the passwords match, false otherwise.
 */
async function verifyPassword(password, storedPassword) {
    if (!storedPassword) return false;
    // If stored password looks like a bcrypt hash (starts with $2), verify with bcrypt
    if (storedPassword.startsWith('$2')) {
        return await bcrypt.compare(password, storedPassword);
    }
    // Legacy plain-text fallback: verify and auto-upgrade
    return password === storedPassword;
}

/**
 * Returns the default list of users used when no existing user data is found.
 * Passwords are read from environment variables for security.
 * If env vars are not set, random passwords are generated and printed to console.
 *
 * @returns {Array<object>} An array of default user objects with id, username, password, role, name, and createdAt fields.
 */
function getDefaultUsers() {
    var crypto = require('crypto');
    
    // Read passwords from environment variables (set in .env or ecosystem.config.js)
    var adminPassword = process.env.DEFAULT_ADMIN_PASSWORD;
    var userPassword = process.env.DEFAULT_USER_PASSWORD;
    
    // Generate random passwords if env vars not set (first run)
    if (!adminPassword) {
        adminPassword = 'Admin' + crypto.randomBytes(8).toString('hex') + '!';
        console.log('[SECURITY] DEFAULT_ADMIN_PASSWORD not set, generated random password: ' + adminPassword);
        console.log('[SECURITY] Please set DEFAULT_ADMIN_PASSWORD in .env and restart.');
    }
    if (!userPassword) {
        userPassword = 'User' + crypto.randomBytes(8).toString('hex') + '!';
        console.log('[SECURITY] DEFAULT_USER_PASSWORD not set, generated random password: ' + userPassword);
        console.log('[SECURITY] Please set DEFAULT_USER_PASSWORD in .env and restart.');
    }
    
    return [
        { id: 'admin', username: 'admin', password: adminPassword, role: 'admin', name: '管理员', createdAt: new Date().toISOString() },
        { id: 'user', username: 'user', password: userPassword, role: 'user', name: '普通用户', createdAt: new Date().toISOString() }
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

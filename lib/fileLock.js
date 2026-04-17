/**
 * @module fileLock
 * @description File locking mechanism to prevent concurrent writes.
 * Provides an in-memory mutex-style lock for file paths using a Map-based registry.
 */
const locks = new Map();

/**
 * Acquires an exclusive lock for the given file path.
 * Polls at 50ms intervals until the lock is available or the timeout is exceeded.
 *
 * @param {string} filePath - The file path to lock.
 * @param {number} [timeout=5000] - Maximum time in milliseconds to wait for the lock before throwing an error.
 * @returns {Promise<boolean>} Resolves to true when the lock is acquired.
 * @throws {Error} If the lock cannot be acquired within the timeout period.
 */
async function acquireLock(filePath, timeout = 5000) {
    const lockId = filePath;
    const startTime = Date.now();

    while (locks.has(lockId)) {
        if (Date.now() - startTime > timeout) {
            throw new Error('Lock timeout: ' + filePath);
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    locks.set(lockId, true);
    return true;
}

/**
 * Releases the lock for the given file path.
 *
 * @param {string} filePath - The file path to unlock.
 * @returns {void}
 */
function releaseLock(filePath) {
    locks.delete(filePath);
}

module.exports = { acquireLock, releaseLock };

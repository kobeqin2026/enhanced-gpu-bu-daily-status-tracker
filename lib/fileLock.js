// File locking mechanism to prevent concurrent writes
const locks = new Map();

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

function releaseLock(filePath) {
    locks.delete(filePath);
}

module.exports = { acquireLock, releaseLock };

/**
 * @module validation
 * @description Data validation functions for users and projects.
 * Throws errors when required fields are missing or have invalid values.
 */

/**
 * Validates a user data object.
 * Checks that username, password, role, and name are present and that the role is either 'admin' or 'user'.
 *
 * @param {object} user - The user object to validate.
 * @param {string} user.username - The user's username.
 * @param {string} user.password - The user's password.
 * @param {string} user.role - The user's role (must be 'admin' or 'user').
 * @param {string} user.name - The user's display name.
 * @returns {boolean} True if validation passes.
 * @throws {Error} If required fields are missing or the role is invalid.
 */
function validateUserData(user) {
    if (!user.username || !user.password || !user.role || !user.name) {
        throw new Error('用户数据缺少必需字段');
    }
    if (!['admin', 'user'].includes(user.role)) {
        throw new Error('无效的角色：' + user.role);
    }
    return true;
}

/**
 * Validates a project data object.
 * Checks that domains, bugs, dailyProgress, and buExitCriteria fields are present and are arrays.
 *
 * @param {object} data - The project data object to validate.
 * @param {Array} data.domains - Array of domain entries.
 * @param {Array} data.bugs - Array of bug entries.
 * @param {Array} data.dailyProgress - Array of daily progress entries.
 * @param {Array} data.buExitCriteria - Array of BU exit criteria entries.
 * @returns {boolean} True if validation passes.
 * @throws {Error} If required fields are missing or are not arrays.
 */
function validateProjectData(data) {
    const required = ['domains', 'bugs', 'dailyProgress', 'buExitCriteria'];
    for (const field of required) {
        if (!Array.isArray(data[field])) {
            throw new Error('项目数据缺少必需字段或类型错误：' + field);
        }
    }
    return true;
}

/**
 * Validates a project object.
 * Checks that the project has both an id and a name.
 *
 * @param {object} project - The project object to validate.
 * @param {string} project.id - The project identifier.
 * @param {string} project.name - The project name.
 * @returns {boolean} True if validation passes.
 * @throws {Error} If the id or name is missing.
 */
function validateProject(project) {
    if (!project.id || !project.name) {
        throw new Error('项目缺少必需字段：id 或 name');
    }
    return true;
}

module.exports = { validateUserData, validateProjectData, validateProject };

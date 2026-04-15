// Data validation functions

function validateUserData(user) {
    if (!user.username || !user.password || !user.role || !user.name) {
        throw new Error('用户数据缺少必需字段');
    }
    if (!['admin', 'user'].includes(user.role)) {
        throw new Error('无效的角色：' + user.role);
    }
    return true;
}

function validateProjectData(data) {
    const required = ['domains', 'bugs', 'dailyProgress', 'buExitCriteria'];
    for (const field of required) {
        if (!Array.isArray(data[field])) {
            throw new Error('项目数据缺少必需字段或类型错误：' + field);
        }
    }
    return true;
}

function validateProject(project) {
    if (!project.id || !project.name) {
        throw new Error('项目缺少必需字段：id 或 name');
    }
    return true;
}

module.exports = { validateUserData, validateProjectData, validateProject };

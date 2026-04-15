// Project data management

var path = require('path');
var fs = require('fs');
var dataStore = require('./dataStore');
var validation = require('./validation');

var safeWriteJSON = dataStore.safeWriteJSON;
var readJSONSync = dataStore.readJSONSync;
var getProjectDataFile = dataStore.getProjectDataFile;
var validateProject = validation.validateProject;
var validateProjectData = validation.validateProjectData;

var PROJECTS_FILE = path.join(dataStore.ensureDataDir(), 'projects.json');

function getDefaultProjects() {
    return [
        { id: 'gpu-bringup', name: 'GPU Bring Up', description: '国产 GPU 芯片 bring up 每日追踪', createdAt: new Date().toISOString() },
        { id: 'project-2', name: '项目二', description: '第二个项目', createdAt: new Date().toISOString() }
    ];
}

async function loadProjects() {
    try {
        var data = readJSONSync(PROJECTS_FILE);
        if (data) return data;
    } catch (e) {
        console.error('Error loading projects:', e);
    }
    var defaultProjects = getDefaultProjects();
    await safeWriteJSON(PROJECTS_FILE, defaultProjects, null);
    return defaultProjects;
}

async function saveProjects(projects) {
    for (var i = 0; i < projects.length; i++) {
        validateProject(projects[i]);
    }
    await safeWriteJSON(PROJECTS_FILE, projects, null);
}

function getDefaultProjectData() {
    return {
        domains: [],
        bugs: [],
        dailyProgress: [],
        buExitCriteria: [],
        lastUpdated: new Date().toLocaleString('zh-CN')
    };
}

async function loadProjectData(projectId) {
    var filePath = getProjectDataFile(projectId);
    try {
        if (filePath) {
            var data = readJSONSync(filePath);
            if (data) return data;
        }
    } catch (e) {
        console.error('Error loading project ' + projectId + ':', e);
    }
    return getDefaultProjectData();
}

async function saveProjectData(projectId, data) {
    var filePath = getProjectDataFile(projectId);
    validateProjectData(data);
    data.lastUpdated = new Date().toLocaleString('zh-CN');
    await safeWriteJSON(filePath, data, null);
}

async function deleteProjectData(projectId) {
    var filePath = getProjectDataFile(projectId);
    if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

module.exports = {
    PROJECTS_FILE, getDefaultProjects, loadProjects, saveProjects,
    getDefaultProjectData, loadProjectData, saveProjectData, deleteProjectData
};

/**
 * @module projects
 * @description Project data management. Provides functions to load, save, and delete
 * project definitions and project-specific data (domains, bugs, daily progress, etc.).
 */

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

/**
 * Returns the default list of projects used when no existing project data is found.
 *
 * @returns {Array<object>} An array of default project objects with id, name, description, and createdAt fields.
 */
function getDefaultProjects() {
    return [
        { id: 'gpu-bringup', name: 'GPU Bring Up', description: '国产 GPU 芯片 bring up 每日追踪', createdAt: new Date().toISOString() },
        { id: 'project-2', name: '项目二', description: '第二个项目', createdAt: new Date().toISOString() }
    ];
}

/**
 * Loads the list of projects from the projects file.
 * Returns default projects and persists them if the file does not exist or fails to load.
 *
 * @returns {Promise<Array<object>>} Resolves with the array of project objects.
 */
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

/**
 * Validates and saves the list of projects to the projects file.
 *
 * @param {Array<object>} projects - The array of project objects to save. Each must have at least an id and name.
 * @returns {Promise<void>} Resolves when the projects have been written successfully.
 * @throws {Error} If any project fails validation.
 */
async function saveProjects(projects) {
    for (var i = 0; i < projects.length; i++) {
        validateProject(projects[i]);
    }
    await safeWriteJSON(PROJECTS_FILE, projects, null);
}

/**
 * Returns a default (empty) project data structure.
 *
 * @returns {object} An object with empty arrays for domains, bugs, dailyProgress, buExitCriteria, and a lastUpdated timestamp.
 */
function getDefaultProjectData() {
    return {
        domains: [],
        bugs: [],
        dailyProgress: [],
        buExitCriteria: [],
        lastUpdated: new Date().toLocaleString('zh-CN')
    };
}

/**
 * Loads the data for a specific project.
 * Returns default project data if the file does not exist or fails to load.
 *
 * @param {string} projectId - The identifier of the project to load data for.
 * @returns {Promise<object>} Resolves with the project data object.
 */
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

/**
 * Validates and saves data for a specific project.
 *
 * @param {string} projectId - The identifier of the project to save data for.
 * @param {object} data - The project data to save. Must contain domains, bugs, dailyProgress, and buExitCriteria arrays.
 * @returns {Promise<void>} Resolves when the data has been written successfully.
 * @throws {Error} If the data fails validation.
 */
async function saveProjectData(projectId, data) {
    var filePath = getProjectDataFile(projectId);
    validateProjectData(data);
    data.lastUpdated = new Date().toLocaleString('zh-CN');
    await safeWriteJSON(filePath, data, null);
}

/**
 * Deletes the data file for a specific project.
 *
 * @param {string} projectId - The identifier of the project whose data file should be deleted.
 * @returns {void}
 */
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

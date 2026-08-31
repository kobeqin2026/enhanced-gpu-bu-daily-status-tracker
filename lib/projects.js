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
        { id: 'demo-daily', name: 'Demo Daily', description: 'daily demo project', createdAt: new Date().toISOString() },
        { id: 'demo-project', name: 'Demo Project', description: 'second demo project', createdAt: new Date().toISOString() }
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

// ===== Daily Summary 历史存储 (递增式: 按项目+日期追加/更新, 展示14天bringup进度) =====

/**
 * Resolves the daily-summaries file path for a project.
 * @param {string} projectId - The identifier of the project.
 * @returns {string|null} The resolved file path, or null if the project ID is unsafe.
 */
function getProjectSummariesFile(projectId) {
    var sanitizedId = projectId.replace(/[^a-zA-Z0-9\-_]/g, '');
    if (sanitizedId !== projectId) {
        console.warn('Potential path traversal attempt detected: ' + projectId);
        return null;
    }
    var filePath = path.join(dataStore.DATA_DIR, sanitizedId + '.daily-summaries.json');
    if (!filePath.startsWith(dataStore.DATA_DIR)) return null;
    return filePath;
}

/**
 * Loads the daily-summary history for a project, sorted by date then time ascending (递增).
 * @param {string} projectId - The identifier of the project.
 * @returns {Promise<Array<object>>} Resolves with the sorted summary records.
 */
async function loadDailySummaries(projectId) {
    var filePath = getProjectSummariesFile(projectId);
    if (!filePath || !fs.existsSync(filePath)) return [];
    try {
        var arr = readJSONSync(filePath);
        if (!Array.isArray(arr)) return [];
        return arr.sort(function(a, b) {
            var dc = String(a.date || '').localeCompare(String(b.date || ''));
            if (dc !== 0) return dc;
            return String(a.time || '').localeCompare(String(b.time || '')); // 同一天按时刻递增
        });
    } catch (e) {
        console.error('Error loading daily summaries for ' + projectId + ':', e);
        return [];
    }
}

/**
 * Upserts one daily-summary record keyed by project+date+time.
 * 同日期同时刻重新生成则覆盖更新; 不同时刻(同一天多次更新)则新增一条快照.
 * @param {string} projectId - The identifier of the project.
 * @param {object} record - { date, time, aiFailed, skeleton, ai, generatedBy, projectId }
 * @returns {Promise<{record:object, mode:string, dayCount:number}>}
 *   mode = 'created' | 'updated'; dayCount = 该日期快照总数
 */
async function upsertDailySummary(projectId, record) {
    var filePath = getProjectSummariesFile(projectId);
    if (!filePath) throw new Error('非法项目ID');
    var arr = await loadDailySummaries(projectId);
    var now = new Date().toISOString();
    var key = record.date + '|' + (record.time || '');
    var idx = arr.findIndex(function(r) { return r.date + '|' + (r.time || '') === key; });
    var mode;
    if (idx >= 0) {
        arr[idx] = Object.assign({}, arr[idx], record, { updatedAt: now });
        mode = 'updated';
    } else {
        var fresh = Object.assign({}, record, { createdAt: now, updatedAt: now });
        arr.push(fresh);
        mode = 'created';
    }
    arr.sort(function(a, b) {
        var dc = String(a.date || '').localeCompare(String(b.date || ''));
        if (dc !== 0) return dc;
        return String(a.time || '').localeCompare(String(b.time || ''));
    });
    await safeWriteJSON(filePath, arr, null);
    var stored = arr.find(function(r) { return r.date + '|' + (r.time || '') === key; }) || arr[arr.length - 1];
    var dayCount = arr.filter(function(r) { return r.date === record.date; }).length;
    return { record: stored, mode: mode, dayCount: dayCount };
}

module.exports = {
    PROJECTS_FILE, getDefaultProjects, loadProjects, saveProjects,
    getDefaultProjectData, loadProjectData, saveProjectData, deleteProjectData,
    loadDailySummaries, upsertDailySummary
};

// Project management routes

var express = require('express');
var router = express.Router();
var projects = require('../lib/projects');
var auth = require('../middleware/auth');
var logger = require('../lib/logger');

var loadProjects = projects.loadProjects;
var saveProjects = projects.saveProjects;
var loadProjectData = projects.loadProjectData;
var saveProjectData = projects.saveProjectData;
var deleteProjectData = projects.deleteProjectData;
var getDefaultProjectData = projects.getDefaultProjectData;
var logOperation = logger.logOperation;

// GET /api/projects - list projects
router.get('/', async function(req, res) {
    try {
        var allProjects = await loadProjects();
        res.json(allProjects);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/projects - create project (admin only)
router.post('/', auth.authenticateToken, auth.requireAdmin, async function(req, res) {
    try {
        var name = req.body.name;
        var description = req.body.description;
        var copyFrom = req.body.copyFrom;
        if (!name) {
            return res.status(400).json({ success: false, message: '项目名称不能为空' });
        }
        
        var allProjects = await loadProjects();
        var newProject = {
            id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            name: name,
            description: description || '',
            createdAt: new Date().toISOString()
        };
        
        if (copyFrom) {
            var src = allProjects.find(function(p) { return p.id === copyFrom; });
            if (!src) {
                return res.status(400).json({ success: false, message: '源项目不存在' });
            }
            var srcData = await loadProjectData(copyFrom);
            var copiedData = getDefaultProjectData();
            ['domains', 'bugs', 'dailyProgress', 'buExitCriteria'].forEach(function(k) {
                copiedData[k] = JSON.parse(JSON.stringify(srcData[k] || []));
            });
            // 复制 BU 时间线(如有)
            if (src.startDate) newProject.startDate = src.startDate;
            if (src.endDate) newProject.endDate = src.endDate;
            await saveProjectData(newProject.id, copiedData);
        } else {
            await saveProjectData(newProject.id, getDefaultProjectData());
        }
        
        allProjects.push(newProject);
        await saveProjects(allProjects);
        
        logOperation(req.user.username, 'CREATE', 'projects', { projectId: newProject.id, name: name, copyFrom: copyFrom || null });
        res.json({ success: true, project: newProject });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'projects', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/projects/:id - update project (admin only)
router.put('/:id', auth.authenticateToken, auth.requireAdmin, async function(req, res) {
    try {
        var projectId = req.params.id;
        var name = req.body.name;
        var description = req.body.description;
        var startDate = req.body.startDate;
        var endDate = req.body.endDate;
        
        if (!name) {
            return res.status(400).json({ success: false, message: '项目名称不能为空' });
        }
        
        var allProjects = await loadProjects();
        var projectIndex = allProjects.findIndex(function(p) { return p.id === projectId; });
        
        if (projectIndex === -1) {
            return res.status(404).json({ success: false, message: '项目不存在' });
        }
        
        allProjects[projectIndex].name = name;
        allProjects[projectIndex].description = description || '';
        if (startDate) allProjects[projectIndex].startDate = startDate;
        if (endDate) allProjects[projectIndex].endDate = endDate;
        
        await saveProjects(allProjects);
        
        logOperation(req.user.username, 'UPDATE', 'projects', { projectId: projectId, changes: { name: name, description: description } });
        res.json({ success: true, project: allProjects[projectIndex] });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'projects', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/projects/:id - delete project (admin only)
router.delete('/:id', auth.authenticateToken, auth.requireAdmin, async function(req, res) {
    try {
        var projectId = req.params.id;
        
        var allProjects = await loadProjects();
        var projectIndex = allProjects.findIndex(function(p) { return p.id === projectId; });
        
        if (projectIndex === -1) {
            return res.status(404).json({ success: false, message: '项目不存在' });
        }
        
        var deletedProject = allProjects[projectIndex];
        allProjects.splice(projectIndex, 1);
        await saveProjects(allProjects);
        await deleteProjectData(projectId);
        
        logOperation(req.user.username, 'DELETE', 'projects', { projectId: projectId, name: deletedProject.name });
        res.json({ success: true, message: '项目已删除', project: deletedProject });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'projects', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/export/:projectId - export project data
router.get('/export/:projectId', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = req.params.projectId;
        var data = await loadProjectData(projectId);
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="' + projectId + '-' + Date.now() + '.json"');
        
        logOperation(req.user.username, 'EXPORT', 'projects', { projectId: projectId });
        res.json(data);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

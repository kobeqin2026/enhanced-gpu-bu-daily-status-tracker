// Project data routes (read/write)

var express = require('express');
var router = express.Router();
var projects = require('../lib/projects');
var auth = require('../middleware/auth');
var logger = require('../lib/logger');

var loadProjectData = projects.loadProjectData;
var saveProjectData = projects.saveProjectData;
var logOperation = logger.logOperation;

// GET /api/data - get project data
router.get('/', async function(req, res) {
    try {
        var projectId = req.query.project || 'gpu-bringup';
        var data = await loadProjectData(projectId);
        res.json(data);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/data - save project data (authenticated)
router.post('/', auth.authenticateToken, async function(req, res) {
    try {
        var projectId = req.body.projectId || req.query.project || 'gpu-bringup';
        var body = req.body;
        
        var data = {
            domains: body.domains || [],
            bugs: body.bugs || [],
            dailyProgress: body.dailyProgress || [],
            buExitCriteria: body.buExitCriteria || [],
            lastUpdated: new Date().toLocaleString('zh-CN')
        };
        
        await saveProjectData(projectId, data);
        logOperation(req.user.username, 'UPDATE', 'project-data', { projectId: projectId });
        console.log('Saved data for project: ' + projectId);
        res.json({ success: true, message: 'Data saved successfully' });
    } catch (error) {
        logOperation(req.user.username, 'ERROR', 'project-data', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

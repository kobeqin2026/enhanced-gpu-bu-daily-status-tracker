// GPU Bring-up Daily Tracker - Server Entry Point
// Modular architecture: routes, middleware, lib

var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');

var sessions = require('./lib/sessions');
var dataStore = require('./lib/dataStore');

// Initialize data directory
dataStore.ensureDataDir();

// Load sessions and start auto-save
sessions.loadSessions();
sessions.startAutoSave(30000);
sessions.setupGracefulShutdown();

var app = express();
var PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/data', require('./routes/data'));

// Logs route (admin only)
app.get('/api/logs/:date?', require('./middleware/auth').authenticateToken, require('./middleware/auth').requireAdmin, async function(req, res) {
    try {
        var date = req.params.date || new Date().toISOString().split('T')[0];
        var logs = require('./lib/logger').readLogByDate(date);
        res.json(logs);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', function() {
    console.log('GPU bring-up Web Server running on http://0.0.0.0:' + PORT);
    console.log('Data directory: ' + dataStore.DATA_DIR);
});

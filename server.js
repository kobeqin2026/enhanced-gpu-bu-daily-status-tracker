const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 80;

// Middleware to parse JSON
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to get data
app.get('/api/data', (req, res) => {
    // In a real deployment, this would fetch from a database
    // For now, we'll return sample data or empty data
    const data = {
        domains: [],
        bugs: [],
        dailyProgress: [],
        buExitCriteria: [],
        lastUpdated: new Date().toLocaleString('zh-CN')
    };
    res.json(data);
});

// API endpoint to save data
app.post('/api/data', (req, res) => {
    // In a real deployment, this would save to a database
    // For now, we'll just acknowledge the request
    console.log('Received data:', req.body);
    res.json({ success: true, message: 'Data saved successfully' });
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`国产GPU芯片bring up Web Server running on http://0.0.0.0:${PORT}`);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`Access from company network: http://47.77.221.23:${PORT}`);
    }
});
// routes/uploads.js — 每日进度附件上传 (截图/图片)
// 存储: nginx root /var/www/gpu-tracker/uploads/{project}/{date}/ (nginx 直接静态服务)
// 请求: POST /api/data/progress-attachment  multipart/form-data  field=file, project, date
// 返回: { success, url, name }
var express = require('express');
var router = express.Router();
var multer = require('multer');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var auth = require('../middleware/auth');

var UPLOAD_ROOT = process.env['GPUT_UPLOAD_ROOT'] || '/var/www/gpu-tracker/uploads';

var MIME_EXT = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp'
};

var upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }  // 15MB (nginx 侧需 client_max_body_size >= 20m)
});

function sanitizeProjectId(s) {
    return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}
function sanitizeDate(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '';
}

router.post('/progress-attachment', auth.authenticateToken, upload.single('file'), function(req, res) {
    try {
        if (!req.file || !req.file.buffer || !req.file.buffer.length) {
            return res.status(400).json({ success: false, error: '未收到文件 (field=file)' });
        }
        var ext = MIME_EXT[(req.file.mimetype || '').toLowerCase()];
        if (!ext) {
            return res.status(400).json({ success: false, error: '仅支持图片类型 (png/jpg/gif/webp/bmp), 收到: ' + req.file.mimetype });
        }
        var projectId = sanitizeProjectId(req.body.project);
        var date = sanitizeDate(req.body.date);
        if (!projectId || !date) {
            return res.status(400).json({ success: false, error: '缺少 project 或 date (YYYY-MM-DD)' });
        }
        var dir = path.join(UPLOAD_ROOT, projectId, date);
        fs.mkdirSync(dir, { recursive: true });
        var fname = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + ext;
        var fpath = path.join(dir, fname);
        fs.writeFileSync(fpath, req.file.buffer);
        try { fs.chmodSync(fpath, 0o644); } catch (e) { }
        res.json({ success: true, url: '/uploads/' + projectId + '/' + date + '/' + fname, name: req.file.originalname || fname });
    } catch (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, error: '文件超过 15MB 上限' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const API_KEY = 'sk-sp-7c50502936014886a9e24be36e81adef';
const BASE_URL = 'https://coding.dashscope.aliyuncs.com/v1';
const CACHE_DIR = path.join(os.homedir(), '.hermes', 'gpu-tracker', 'image-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'analysis-cache.json');

// Remaining images (excluding 61437, 61440, 61445 which are already cached)
const images = [
    { url: 'https://jira01.birentech.com/secure/attachment/61444/image-2023-05-09-18-39-49-701.png', file: '/tmp/brhw-61444.jpg' },
    { url: 'https://jira01.birentech.com/secure/attachment/61450/image-2023-05-09-19-17-35-470.png', file: '/tmp/brhw-61450.jpg' },
    { url: 'https://jira01.birentech.com/secure/attachment/61451/image-2023-05-09-19-24-56-217.png', file: '/tmp/brhw-61451.jpg' },
    { url: 'https://jira01.birentech.com/secure/attachment/61452/image-2023-05-09-19-25-31-626.png', file: '/tmp/brhw-61452.jpg' },
    { url: 'https://jira01.birentech.com/secure/attachment/61453/image-2023-05-09-19-25-52-805.png', file: '/tmp/brhw-61453.jpg' },
    { url: 'https://jira01.birentech.com/secure/attachment/61454/image-2023-05-09-19-35-32-334.png', file: '/tmp/brhw-61454.jpg' },
    { url: 'https://jira01.birentech.com/secure/attachment/61460/image-2023-05-09-20-16-58-504.png', file: '/tmp/brhw-61460.jpg' },
    { url: 'https://jira01.birentech.com/secure/attachment/61441/screenshot-1.png', file: '/tmp/brhw-61441.jpg' },
    { url: 'https://jira01.birentech.com/secure/attachment/61442/screenshot-2.png', file: '/tmp/brhw-61442.jpg' },
    { url: 'https://jira01.birentech.com/secure/attachment/61443/screenshot-3.png', file: '/tmp/brhw-61443.jpg' },
];

function urlHash(url) {
    return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

function analyzeImage(file, url) {
    const imgBuffer = fs.readFileSync(file);
    const b64 = imgBuffer.toString('base64');
    const h = urlHash(url);

    const body = JSON.stringify({
        model: 'qwen3.6-plus',
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: '这是一张GPU芯片调试相关的截图。请：1)识别这是什么类型的截图 2)提取所有关键数据和数值 3)用中文简要描述图中信息' },
                { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } }
            ]
        }],
        max_tokens: 500
    });

    return fetch(BASE_URL.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
        body: body,
        signal: AbortSignal.timeout(90000)
    })
    .then(function(res) { return res.text(); })
    .then(function(data) {
        try {
            var json = JSON.parse(data);
            if (json.error) {
                console.log('  Error:', json.error.message || JSON.stringify(json.error));
                return { hash: h, url: url, analysis: '' };
            }
            var content = json.choices[0].message.content;
            var summary = content.substring(0, 500);
            console.log('  OK:', summary.substring(0, 80) + '...');
            return { hash: h, url: url, analysis: summary };
        } catch(e) {
            console.log('  Parse error:', data.substring(0, 100));
            return { hash: h, url: url, analysis: '' };
        }
    });
}

// Load existing cache
var cache = {};
if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
}

var idx = 0;
function next() {
    if (idx >= images.length) {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
        console.log('\n=== Done ===');
        console.log('Total cache entries:', Object.keys(cache).length);
        console.log('Saved to:', CACHE_FILE);
        return;
    }

    var img = images[idx];
    idx++;
    console.log((idx) + '/' + images.length + '  Analyzing', img.url.split('/').pop(), '...');

    analyzeImage(img.file, img.url).then(function(result) {
        if (result.analysis) {
            cache[result.hash] = {
                url: result.url,
                analysis: result.analysis,
                timestamp: Date.now()
            };
            // Save after each image to avoid losing progress
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
            console.log('  Saved cache, entries:', Object.keys(cache).length);
        }
        setTimeout(next, 1500); // Rate limit
    });
}

console.log('Starting analysis of', images.length, 'remaining images...');
console.log('Existing cache entries:', Object.keys(cache).length, '\n');
next();

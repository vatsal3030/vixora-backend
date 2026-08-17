const fs = require('fs');
const path = require('path');

const files = [
    'src/controllers/watchHistory.controller.js',
    'src/controllers/like.controller.js',
    'src/controllers/playlist.controller.js',
    'src/controllers/subscription.controller.js',
    'src/controllers/tweet.controller.js',
    'src/controllers/feed.controller.js'
];

files.forEach(relPath => {
    const fullPath = path.join(__dirname, '..', relPath);
    if (!fs.existsSync(fullPath)) return;
    let content = fs.readFileSync(fullPath, 'utf8');
    
    // Replace default string limit 10 with 20
    content = content.replace(/limit\s*=\s*["']10["']/g, 'limit = "20"');
    
    // In playlist controller
    content = content.replace(/if\s*\(isNaN\(limit\)\s*\|\|\s*limit\s*<\s*1\s*\|\|\s*limit\s*>\s*50\)\s*limit\s*=\s*10;/g,
        'if (isNaN(limit) || limit < 1 || limit > 100) limit = 20;');
        
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log('Updated:', relPath);
});

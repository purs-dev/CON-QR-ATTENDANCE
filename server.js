// Zero-dependency local test server for CON Attendance.
// Run:  node server.js   →   http://localhost:8080
// (localhost is a "secure context", so the camera scanner works here)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log('');
  console.log('  CON Attendance — local server running');
  console.log('');
  console.log(`    http://localhost:${PORT}`);
  console.log('');
  console.log('  Camera scanner works on this address (localhost is secure).');
  console.log('  For phones, deploy to GitHub Pages (HTTPS) and open that URL.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

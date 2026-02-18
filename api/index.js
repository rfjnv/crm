import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../public');

export default function handler(req, res) {
  const url = req.url.split('?')[0]; // Remove query string
  const filePath = path.join(publicDir, url === '/' ? 'index.html' : url);

  try {
    // Try to serve the exact file
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath);

      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
      };

      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      return res.end(content);
    }

    // For any other route, serve index.html (SPA routing)
    const indexPath = path.join(publicDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      console.error('[ERROR] index.html not found at:', indexPath);
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).end(JSON.stringify({ error: 'index.html not found', publicDir }));
    }

    const indexContent = fs.readFileSync(indexPath);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.end(indexContent);
  } catch (err) {
    console.error('[ERROR]', err.message);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).end(JSON.stringify({ error: err.message }));
  }
}

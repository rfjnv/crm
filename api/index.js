import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '../frontend/dist');

export default function handler(req, res) {
  const filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url);

  try {
    // Try to serve the exact file
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const ext = path.extname(filePath);

      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
      };

      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      return res.status(200).send(content);
    }

    // For any other route, serve index.html (SPA routing)
    const indexPath = path.join(distDir, 'index.html');
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(200).send(indexContent);
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

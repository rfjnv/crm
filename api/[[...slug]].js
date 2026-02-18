import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve index.html for all SPA routes
export default function handler(req, res) {
  // Skip API requests
  if (req.url?.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const indexPath = path.join(__dirname, '../frontend/dist/index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(200).send(indexHtml);
  } catch (err) {
    console.error('Error serving index.html:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

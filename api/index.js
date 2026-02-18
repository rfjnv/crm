import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../public');

export default function handler(req, res) {
  try {
    const indexPath = path.join(publicDir, 'index.html');
    const content = fs.readFileSync(indexPath);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.end(content);
  } catch (err) {
    console.error('Error serving index.html:', err);
    res.status(500).end('Error');
  }
}

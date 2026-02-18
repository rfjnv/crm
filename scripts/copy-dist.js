import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '../frontend/dist');
const destDir = path.join(__dirname, '../public');

// Create public directory if it doesn't exist
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// Copy all files from frontend/dist to public
function copyRecursive(src, dest) {
  if (fs.lstatSync(src).isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(file => {
      copyRecursive(path.join(src, file), path.join(dest, file));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

try {
  console.log(`Copying ${srcDir} to ${destDir}...`);
  copyRecursive(srcDir, destDir);
  console.log('✓ Copy completed successfully');
} catch (err) {
  console.error('✗ Copy failed:', err.message);
  process.exit(1);
}

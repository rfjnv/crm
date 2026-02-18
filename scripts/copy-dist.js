#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../frontend/dist');
const destDir = path.join(__dirname, '../public');

// Create public directory if it doesn't exist
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// Copy all files from frontend/dist to public
function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Source directory not found: ${src}`);
    process.exit(1);
  }

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

  // Create 404.html for SPA routing
  const indexPath = path.join(destDir, 'index.html');
  const notFoundPath = path.join(destDir, '404.html');
  if (fs.existsSync(indexPath)) {
    fs.copyFileSync(indexPath, notFoundPath);
    console.log('✓ Created 404.html for SPA routing');
  }

  console.log('✓ Copy completed successfully');
} catch (err) {
  console.error('✗ Copy failed:', err.message);
  process.exit(1);
}

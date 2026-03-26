// Simple script to copy compiled JS files to the root for Chrome extension loading
const fs = require('fs');
const path = require('path');

const files = ['popup.js', 'content.js', 'background.js'];
const distDir = path.join(__dirname, '../dist');
const rootDir = path.join(__dirname, '../');

files.forEach(file => {
  const src = path.join(distDir, file);
  const dest = path.join(rootDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file}`);
  }
});

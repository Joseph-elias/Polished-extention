// Copy compiled JS files from dist/ to extension root while preserving folders.
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '../dist');
const rootDir = path.join(__dirname, '../');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyDistJsFiles(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  ensureDir(dstDir);

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);

    if (entry.isDirectory()) {
      copyDistJsFiles(srcPath, dstPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      fs.copyFileSync(srcPath, dstPath);
      console.log(`Copied ${path.relative(rootDir, dstPath).replace(/\\/g, '/')}`);
    }
  }
}

copyDistJsFiles(distDir, rootDir);

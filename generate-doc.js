const fs = require('fs');
const path = require('path');
process.chdir(__dirname);
const root = process.cwd();
const outPath = path.join(root, 'doc.txt');
const excludePatterns = [
  /node_modules/,
  /\.git/,
  /\.pytest_cache/,
  /\.playwright-cli/,
  /backend[\\/]\.pytest_vendor/,
  /doc\.txt$/,
  /workspace-file-list.*\.txt$/,
];
const binaryExts = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.ttf', '.woff', '.woff2', '.eot', '.otf',
  '.mp3', '.mp4', '.zip', '.gz', '.tar', '.7z', '.exe', '.dll', '.pyc', '.class', '.pdf', '.doc',
  '.docx', '.xlsx', '.pptx', '.sqlite', '.db', '.bin', '.DS_Store', '.svg'
]);
const files = [];
function collect(dir) {
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, dirent.name);
    const relative = path.relative(root, absolute).replace(/\\/g, '/');
    if (excludePatterns.some((regex) => regex.test(relative))) {
      continue;
    }
    if (dirent.isDirectory()) {
      collect(absolute);
      continue;
    }
    if (dirent.isFile()) {
      files.push(relative);
    }
  }
}
collect(root);
files.sort();
const header = `AfroSpice Full Code Export\n=========================\n\nThis file contains the full text source of the repository, including configuration and MongoDB details.\nBinary assets are omitted, but text files and configuration are included.\n\n`;
fs.writeFileSync(outPath, header, 'utf8');
fs.appendFileSync(outPath, 'Repository file list (text files included below):\n\n', 'utf8');
for (const file of files) {
  fs.appendFileSync(outPath, `- ${file}\n`, 'utf8');
}
fs.appendFileSync(outPath, '\nMongoDB and runtime configuration details:\n\n', 'utf8');
const configFiles = [
  'backend/src/config/db.js',
  'backend/src/config/runtime.js',
  'backend/src/config/loadEnv.js',
  'backend/src/.env.example',
  'backend/src/.env',
  'backend/src/app.js',
];
for (const configFile of configFiles) {
  const configPath = path.join(root, configFile);
  if (!fs.existsSync(configPath)) continue;
  fs.appendFileSync(outPath, `=== CONFIG FILE: ${configFile} ===\n`, 'utf8');
  try {
    fs.appendFileSync(outPath, fs.readFileSync(configPath, 'utf8'), 'utf8');
    fs.appendFileSync(outPath, '\n\n', 'utf8');
  } catch (error) {
    fs.appendFileSync(outPath, `[error reading ${configFile}: ${error.message}]\n\n`, 'utf8');
  }
}
fs.appendFileSync(outPath, '=== Begin source file contents ===\n\n', 'utf8');
for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  const absolute = path.join(root, file);
  fs.appendFileSync(outPath, `=== FILE: ${file} ===\n`, 'utf8');
  if (binaryExts.has(ext)) {
    fs.appendFileSync(outPath, '[binary file omitted]\n\n', 'utf8');
    continue;
  }
  try {
    fs.appendFileSync(outPath, fs.readFileSync(absolute, 'utf8'), 'utf8');
    fs.appendFileSync(outPath, '\n\n', 'utf8');
  } catch (error) {
    fs.appendFileSync(outPath, `[error reading ${file}: ${error.message}]\n\n`, 'utf8');
  }
}
console.log('doc.txt generated successfully');

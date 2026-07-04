'use strict';
// Assembles appdeploy-dist/ — the deploy tree for the App Deploy platform —
// from the repo's canonical files. Plain scripts move under public/ (Vite
// serves them as static assets at the same relative URLs index.html uses).
// Zero dependencies. Run: node tools/pack-appdeploy.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'appdeploy-dist');

const COPIES = [
  ['index.html', 'index.html'],
  ['src/main.ts', 'src/main.ts'],
  ['backend/grove.ts', 'backend/grove.ts'],
  ['backend/index.ts', 'backend/index.ts'],
  ['tests/tests.txt', 'tests/tests.txt'],
  ['css/style.css', 'public/css/style.css'],
  ['cron.json', 'cron.json'],
  ['appdeploy.auth-login.json', 'appdeploy.auth-login.json'],
];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const manifest = [];
function copy(from, to) {
  const src = path.join(ROOT, from);
  const dest = path.join(DIST, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  manifest.push(to);
}

for (const [from, to] of COPIES) copy(from, to);
for (const file of fs.readdirSync(path.join(ROOT, 'js'))) {
  if (file.endsWith('.js')) copy('js/' + file, 'public/js/' + file);
}

manifest.sort();
console.log('appdeploy-dist assembled:');
for (const f of manifest) console.log('  ' + f);
console.log(`${manifest.length} files → ${DIST}`);

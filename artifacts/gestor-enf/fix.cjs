const fs = require('fs');
const path = 'artifacts/gestor-enf/src/game/scenes/BootScene.ts';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');
const newLines = [];
let skip = false;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("case 'low_fade': {")) {
    skip = true;
  }
  if (!skip) {
    newLines.push(lines[i]);
  }
  if (skip && lines[i].includes("// ── PORTRAITS")) {
    skip = false;
    newLines.push(lines[i]);
  }
}
fs.writeFileSync(path, newLines.join('\n'));
console.log('Fixed BootScene.ts');

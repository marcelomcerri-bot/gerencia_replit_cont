const fs = require('fs');
let content = fs.readFileSync('artifacts/gestor-enf/src/game/scenes/GameScene.ts', 'utf8');

// replace inside populateRoom only
const parts = content.split('private buildEnvironmentalDecor() {');
if (parts.length > 1) {
  parts[1] = parts[1].replace(/\(r1 \+ 1\) \* TILE_SIZE/g, '(r1 * TILE_SIZE + 6)');
}
content = parts.join('private buildEnvironmentalDecor() {');
fs.writeFileSync('artifacts/gestor-enf/src/game/scenes/GameScene.ts', content);

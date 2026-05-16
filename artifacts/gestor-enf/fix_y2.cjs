const fs = require('fs');
let content = fs.readFileSync('artifacts/gestor-enf/src/game/scenes/GameScene.ts', 'utf8');

const parts = content.split('private buildEnvironmentalDecor() {');
if (parts.length > 1) {
  parts[1] = parts[1].replace(/\(r2 - 2\) \* TILE_SIZE/g, '(r2 * TILE_SIZE)');
  parts[1] = parts[1].replace(/\(r2 - 3\) \* TILE_SIZE/g, '(r2 * TILE_SIZE - 4)');
}
content = parts.join('private buildEnvironmentalDecor() {');
fs.writeFileSync('artifacts/gestor-enf/src/game/scenes/GameScene.ts', content);

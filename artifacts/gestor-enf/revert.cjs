const fs = require('fs');
let content = fs.readFileSync('artifacts/gestor-enf/src/game/scenes/GameScene.ts', 'utf8');

// Revert breaking changes
content = content.replace(/\(r1 \* TILE_SIZE \+ 6\)/g, '(r1 + 1) * TILE_SIZE');
content = content.replace(/\(r2 \* TILE_SIZE\)/g, '(r2 - 2) * TILE_SIZE');
content = content.replace(/\(r2 \* TILE_SIZE - 4\)/g, '(r2 - 3) * TILE_SIZE');

fs.writeFileSync('artifacts/gestor-enf/src/game/scenes/GameScene.ts', content);

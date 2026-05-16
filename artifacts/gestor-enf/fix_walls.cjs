const fs = require('fs');
let content = fs.readFileSync('artifacts/gestor-enf/src/game/scenes/GameScene.ts', 'utf8');

// The wall top face is drawn as 32x32.
// Let's draw the 3D illusion starting at by + 8 instead of by + TILE_SIZE.
// So 8px top face, 24px front face.
// Since the height is 30 in the code, wait: 30 + 8 = 38 > 32 spilling slightly?
// Let's just do by + 6, and make the face 26px high.
content = content.replace(/by \+ TILE_SIZE, TILE_SIZE, 30/g, 'by + 6, TILE_SIZE, 26');
content = content.replace(/by \+ TILE_SIZE \+ 16, TILE_SIZE, 3/g, 'by + 6 + 14, TILE_SIZE, 3'); // 20
content = content.replace(/by \+ TILE_SIZE \+ 14, TILE_SIZE, 2/g, 'by + 6 + 12, TILE_SIZE, 2'); // 18
content = content.replace(/by \+ TILE_SIZE \+ 19, TILE_SIZE, 2/g, 'by + 6 + 17, TILE_SIZE, 2'); // 23
content = content.replace(/by \+ TILE_SIZE, 1, 30/g, 'by + 6, 1, 26');
content = content.replace(/by \+ TILE_SIZE \+ 28, TILE_SIZE, 3/g, 'by + 6 + 23, TILE_SIZE, 3'); // 29
content = content.replace(/by \+ TILE_SIZE \+ 31, TILE_SIZE, 4/g, 'by + 6 + 26, TILE_SIZE, 4'); // Wait, the original went 31 to 35. That means it spilled into next tile!
// If it spills into the next tile, let's keep it strictly inside 32px height.
// by to by+32 is the tile.
// The baseboard should end at `by + 32`.
// Let's rewrite that entire block.

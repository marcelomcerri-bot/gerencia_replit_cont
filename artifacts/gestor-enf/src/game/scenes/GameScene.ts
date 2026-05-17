import * as Phaser from 'phaser';
import {
  TILE_SIZE, MAP_COLS, MAP_ROWS,
  CAMERA_ZOOM, SCENES, EVENTS, EVENTS as EV,
  INTERACTION_DISTANCE, GAME_MINUTES_PER_SECOND, ROOM_NAMES, TILE_ID,
} from '../constants';
import { generateMapTiles, NPC_DEFS, MISSIONS, CRISIS_EVENTS, getLevelInfo } from '../data/gameData';
import type { GameState, CrisisEvent } from '../data/gameData';
import { Player } from '../objects/Player';
import { NPC } from '../objects/NPC';
import { loadGame, saveGame } from '../utils/save';
import { playMusic, fadeOutMusic } from '../utils/audio';

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private npcs: NPC[] = [];
  private mapData: number[][] = [];
  private wallLayer?: Phaser.Physics.Arcade.StaticGroup;
  private state!: GameState;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private mKey!: Phaser.Input.Keyboard.Key;
  private escKey!: Phaser.Input.Keyboard.Key;

  private timeAccum = 0;
  private currentRoom: number = TILE_ID.CORRIDOR;
  private nearbyNPC: NPC | null = null;
  private isDialogOpen = false;
  private isCrisisOpen = false;
  
  private energyTimer = 0;
  private energyRestoreTimer = 0;
  private stressDecayTimer = 0;
  private lastHudEmit = 0;
  private crisisTimer = 0;
  private nextCrisisTime = 0;
  private lastActivity = 'Explorando o hospital';

  // Ambient lights/decor
  private darkOverlay!: Phaser.GameObjects.RenderTexture;
  private glowBrush!: Phaser.GameObjects.Sprite;
  private additiveLightGroup!: Phaser.GameObjects.Group;
  
  private ambientGfx!: Phaser.GameObjects.Graphics;
  private propColliders: Phaser.Physics.Arcade.StaticGroup | null = null;
  public interactionPoints: Array<{ x: number; y: number; type: 'work' | 'sit' | 'inspect' | 'rest' }> = [];

  constructor() { super({ key: SCENES.GAME }); }

  create() {
    this.state = loadGame();
    this.mapData = generateMapTiles();

    this.buildTilemap();
    this.buildWalls();
    this.propColliders = this.physics.add.staticGroup();
    this.buildEnvironmentalDecor();
    this.buildRoomLabels();
    this.spawnPlayer();
    this.spawnNPCs();
    this.setupInput();
    this.setupCamera();

    this.scene.launch(SCENES.HUD);
    this.cameras.main.fadeIn(700);
    playMusic('game');

    // Auto-save every 30s
    this.time.addEvent({ delay: 30000, loop: true, callback: () => saveGame(this.state) });

    // Professor mode: broadcast state every 5s
    this.time.addEvent({ delay: 5000, loop: true, callback: () => this.broadcastState() });

    // Schedule first crisis event (1-2 game minutes = 20-40s real)
    this.scheduleCrisis();

    this.emitHudUpdate();
    this.mKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);
  }

  // ─── TILEMAP ──────────────────────────────────────────────────────────────
  private buildTilemap() {
    const map = this.make.tilemap({ data: this.mapData, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = map.addTilesetImage('tiles', 'tiles', TILE_SIZE, TILE_SIZE, 0, 0);
    if (!tileset) return;
    const layer = map.createLayer(0, tileset, 0, 0);
    if (!layer) return;
    layer.setDepth(0);
    this.physics.world.setBounds(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE);
  }

  private buildWalls() {
    this.wallLayer = this.physics.add.staticGroup();
    for (let row = 0; row < MAP_ROWS; row++) {
      let startCol = -1;
      for (let col = 0; col <= MAP_COLS; col++) {
        const isBlocked = col < MAP_COLS && (this.mapData[row][col] === TILE_ID.WALL || this.mapData[row][col] === TILE_ID.GARDEN);
        if (isBlocked && startCol === -1) {
          startCol = col;
        } else if (!isBlocked && startCol !== -1) {
          const len = col - startCol;
          const wx = (startCol + len / 2) * TILE_SIZE;
          const wy = (row + 0.5) * TILE_SIZE;
          const body = this.wallLayer.create(wx, wy, 'pixel') as Phaser.Physics.Arcade.Image;
          body.setVisible(false).setDisplaySize(len * TILE_SIZE, TILE_SIZE).refreshBody();
          startCol = -1;
        }
      }
    }
  }

  // ─── ENVIRONMENTAL DECOR & PROPS ───────────────────────────────────────────
  private buildEnvironmentalDecor() {
    this.ambientGfx = this.add.graphics().setDepth(1);
    const propsGfx = this.add.graphics().setDepth(2);

    // Deterministic room parsing
    const visited = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(false));

    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (visited[r][c] || this.mapData[r][c] === TILE_ID.WALL || this.mapData[r][c] === TILE_ID.CORRIDOR) {
          visited[r][c] = true;
          continue;
        }

        const tid = this.mapData[r][c];
        // BFS to find room bounds
        let minR = r, maxR = r, minC = c, maxC = c;
        const q: [number, number][] = [[r, c]];
        visited[r][c] = true;

        while (q.length > 0) {
          const [cr, cc] = q.shift()!;
          if (cr < minR) minR = cr; if (cr > maxR) maxR = cr;
          if (cc < minC) minC = cc; if (cc > maxC) maxC = cc;

          const neighbors = [[1,0],[-1,0],[0,1],[0,-1]];
          for (const [dr, dc] of neighbors) {
            const nr = cr + dr, nc = cc + dc;
            if (nr >= 0 && nr < MAP_ROWS && nc >= 0 && nc < MAP_COLS && !visited[nr][nc] && this.mapData[nr][nc] === tid) {
              visited[nr][nc] = true;
              q.push([nr, nc]);
            }
          }
        }

        this.populateRoom(propsGfx, tid, minR, maxR, minC, maxC);
      }
    }

    // Walls, Corridors & Gardens pass
    // We draw front-facing walls on ambientGfx so they render ABOVE the floor but BELOW props and NPCs.
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const tid = this.mapData[r][c];
        const bx = c * TILE_SIZE, by = r * TILE_SIZE;

        // Front-facing 3D wall illusion
        const isWall = tid === TILE_ID.WALL;
        // Draw the face for any non-wall, non-garden tile below — INCLUDING interior
        // hospital corridors (which get the nice teal wainscoting stripe).
        // EXCEPTION: skip courtyard/garden-zone corridors (wall at row 42 → garden
        // corridor at rows 43-47) because the face looks like a gray block on the
        // green garden background.
        const belowTid = r < MAP_ROWS - 1 ? this.mapData[r+1][c] : TILE_ID.WALL;
        const twobelowTid = r < MAP_ROWS - 2 ? this.mapData[r+2][c] : TILE_ID.WALL;
        const hasFloorBelow = isWall &&
          belowTid !== TILE_ID.WALL &&
          belowTid !== TILE_ID.GARDEN &&
          !(belowTid === TILE_ID.CORRIDOR && twobelowTid === TILE_ID.GARDEN);
        const isHorizontalIntersection = isWall && r < MAP_ROWS - 1 && this.mapData[r+1][c] === TILE_ID.WALL &&
                                         c > 0 && c < MAP_COLS - 1 && 
                                         this.mapData[r][c-1] === TILE_ID.WALL && this.mapData[r][c+1] === TILE_ID.WALL;

        if (isWall && (hasFloorBelow || isHorizontalIntersection)) {
           // Draw front face projecting downward into the tile below.
           const FACE_Y = by + TILE_SIZE;
           const FACE_H = 30; // Leave 2px as natural baseboard at bottom

           // Base wall face (darker linen white to indicate vertical shadow)
           this.ambientGfx.fillStyle(0xd2ccc1, 1);
           this.ambientGfx.fillRect(bx, FACE_Y, TILE_SIZE, FACE_H);
           
           // Blue wainscoting horizontal stripe (classic hospital)
           this.ambientGfx.fillStyle(0x0ea5e9, 1);
           this.ambientGfx.fillRect(bx, FACE_Y + 16, TILE_SIZE, 3);
           
           // White trim above and below stripe
           this.ambientGfx.fillStyle(0xffffff, 1);
           this.ambientGfx.fillRect(bx, FACE_Y + 14, TILE_SIZE, 2);
           this.ambientGfx.fillRect(bx, FACE_Y + 19, TILE_SIZE, 2);

           // Random wall details (posters, electric outlets, extinguishers)
           const wallType = c % 13; // deterministic based on column
           if (wallType === 3) {
             // Fire extinguisher
             this.ambientGfx.fillStyle(0xe74c3c, 1);
             this.ambientGfx.fillRoundedRect(bx + 12, FACE_Y + 4, 8, 12, 2);
             this.ambientGfx.fillStyle(0xc0392b, 1);
             this.ambientGfx.fillRect(bx + 14, FACE_Y + 5, 4, 3); // label
             this.ambientGfx.fillStyle(0x000000, 1);
             this.ambientGfx.fillRect(bx + 12, FACE_Y + 2, 8, 2); // nozzle/handle
           } else if (wallType === 7) {
             // Informational poster
             this.ambientGfx.fillStyle(0xffffff, 1);
             this.ambientGfx.fillRect(bx + 8, FACE_Y + 2, 16, 12);
             this.ambientGfx.fillStyle(0x3498db, 1);
             this.ambientGfx.fillRect(bx + 10, FACE_Y + 4, 12, 2);
             this.ambientGfx.fillStyle(0xbdc3c7, 1);
             this.ambientGfx.fillRect(bx + 10, FACE_Y + 7, 12, 1);
             this.ambientGfx.fillRect(bx + 10, FACE_Y + 9, 8, 1);
             this.ambientGfx.fillRect(bx + 10, FACE_Y + 11, 10, 1);
           } else if (wallType === 10) {
             // Wall electrical outlet
             this.ambientGfx.fillStyle(0xecf0f1, 1);
             this.ambientGfx.fillRect(bx + 14, FACE_Y + 24, 6, 4);
             this.ambientGfx.fillStyle(0x000000, 1);
             this.ambientGfx.fillRect(bx + 15, FACE_Y + 25, 2, 1);
             this.ambientGfx.fillRect(bx + 18, FACE_Y + 25, 2, 1);
           }

           // Wall panel seam (optional, adds detail)
           this.ambientGfx.fillStyle(0x000000, 0.03);
           this.ambientGfx.fillRect(bx, FACE_Y, 1, FACE_H);

           // Baseboard (light gray)
           this.ambientGfx.fillStyle(0x94a3b8, 1);
           this.ambientGfx.fillRect(bx, FACE_Y + 28, TILE_SIZE, 4);

           // Floor shadow
           this.ambientGfx.fillStyle(0x000000, 0.12);
           this.ambientGfx.fillRect(bx, FACE_Y + 32, TILE_SIZE, 3);
        }

        // ── Paint south-facing corridor walls to match corridor floor ──────────
        // Wall tiles that have a corridor tile directly above them appear as a
        // large gray block when the player looks south inside the corridor.
        // Painting them with the corridor floor colour (white-ish) hides the
        // gray tilemap base; the physics wall (buildWalls) still blocks movement.
        if (isWall && r > 0 && this.mapData[r-1][c] === TILE_ID.CORRIDOR) {
          this.ambientGfx.fillStyle(0xf8fafc, 1);   // corridor floor colour
          this.ambientGfx.fillRect(bx, by, TILE_SIZE, TILE_SIZE);
          // Faint grid seam so it doesn't look completely flat
          this.ambientGfx.fillStyle(0x000000, 0.04);
          this.ambientGfx.fillRect(bx, by, TILE_SIZE, 1);
          this.ambientGfx.fillRect(bx, by, 1, TILE_SIZE);
        }

        if (tid === TILE_ID.GARDEN) {
           if ((c % 4 === 0 && r % 4 === 0) && Math.random() < 0.6) {
             this.drawTree(propsGfx, bx, by);
           } else if (Math.random() < 0.05) {
             this.drawBush(propsGfx, bx, by);
           }
        } else if (tid === TILE_ID.CORRIDOR) {
           // True horizontal corridor rows (between wings) vs door-gap rows (in walls)
           const isHorizCorridor = (r >= 14 && r <= 15) || (r >= 28 && r <= 29);

           // Floor circulation routing lines — only in the actual corridor rows
           if (isHorizCorridor) {
               // Horizontal arteries run the full width of each corridor row
               this.ambientGfx.fillStyle(0xe74c3c, 0.20); // Red — Emergency
               this.ambientGfx.fillRect(bx, by + 12, TILE_SIZE, 2);
               this.ambientGfx.fillStyle(0x3498db, 0.20); // Blue — Outpatient
               this.ambientGfx.fillRect(bx, by + 16, TILE_SIZE, 2);
               this.ambientGfx.fillStyle(0x2ecc71, 0.20); // Green — Ward
               this.ambientGfx.fillRect(bx, by + 20, TILE_SIZE, 2);
           }
           // Vertical arteries only in non-horizontal-corridor tiles (avoids crossing lines)
           if ((c === 31 || c === 45) && !isHorizCorridor) {
               this.ambientGfx.fillStyle(0xe74c3c, 0.20);
               this.ambientGfx.fillRect(bx + 12, by, 2, TILE_SIZE);
               this.ambientGfx.fillStyle(0x3498db, 0.20);
               this.ambientGfx.fillRect(bx + 16, by, 2, TILE_SIZE);
               this.ambientGfx.fillStyle(0x2ecc71, 0.20);
               this.ambientGfx.fillRect(bx + 20, by, 2, TILE_SIZE);
           }

           // Automatic Doors on gaps in horizontal walls
           const hasWallLeft = c > 0 && this.mapData[r][c-1] === TILE_ID.WALL;
           const hasWallRight = c < MAP_COLS - 1 && this.mapData[r][c+1] === TILE_ID.WALL;
           const hasWallTop = r > 0 && this.mapData[r-1][c] === TILE_ID.WALL;
           const hasWallBottom = r < MAP_ROWS - 1 && this.mapData[r+1][c] === TILE_ID.WALL;

           if (hasWallLeft && hasWallRight && !hasWallTop && !hasWallBottom) {
             // Top track
             this.ambientGfx.fillStyle(0x7f8c8d, 1);
             this.ambientGfx.fillRect(bx, by, TILE_SIZE, 4);
             // Glass panes (partially opened)
             this.ambientGfx.fillStyle(0x38bdf8, 0.25);
             this.ambientGfx.fillRect(bx, by + 4, 8, 28); // left pane
             this.ambientGfx.fillRect(bx + TILE_SIZE - 8, by + 4, 8, 28); // right pane
             this.ambientGfx.fillStyle(0x38bdf8, 0.5);
             this.ambientGfx.fillRect(bx + 4, by + 4, 2, 28); // left pane edge reflection
             this.ambientGfx.fillRect(bx + TILE_SIZE - 6, by + 4, 2, 28); // right pane edge reflection
             // Bottom track on floor
             this.ambientGfx.fillStyle(0x95a5a6, 0.6);
             this.ambientGfx.fillRect(bx, by + 30, TILE_SIZE, 2);
           } else if (hasWallTop && hasWallBottom && !hasWallLeft && !hasWallRight) {
             // Horizontal gap (doorway on a vertical wall)
             this.ambientGfx.fillStyle(0x7f8c8d, 1);
             this.ambientGfx.fillRect(bx, by, 4, TILE_SIZE);
             this.ambientGfx.fillStyle(0x38bdf8, 0.25);
             this.ambientGfx.fillRect(bx + 4, by, 8, TILE_SIZE); // top pane
           }

           // Hanging sector sign — only in the first tile row of each horizontal corridor
           if (r === 14 || r === 28) {
              if (c % 15 === 0) {
                 this.ambientGfx.fillStyle(0x34495e, 1);
                 this.ambientGfx.fillRoundedRect(bx + 4, by - 16, 24, 8, 2);
                 this.ambientGfx.fillStyle(0xecf0f1, 1);
                 this.ambientGfx.fillRect(bx + 10, by - 14, 12, 1);
                 this.ambientGfx.fillRect(bx + 8, by - 12, 16, 1);
                 // hanging wires
                 this.ambientGfx.fillStyle(0xbdc3c7, 1);
                 this.ambientGfx.fillRect(bx + 6, by - 24, 1, 8);
                 this.ambientGfx.fillRect(bx + 25, by - 24, 1, 8);
              }
           }

           // Hand sanitizer on tiles immediately below a north wall
           if (this.mapData[r-1] && this.mapData[r-1][c] === TILE_ID.WALL && c % 4 === 0) {
              this.drawHandSanitizer(propsGfx, bx, by);
           }
           // Bench against south walls (tile below is wall) — only in actual corridor rows
           if (isHorizCorridor && c % 8 === 0 && r < MAP_ROWS - 1 && this.mapData[r+1][c] === TILE_ID.WALL) {
             this.drawBench(propsGfx, bx, by);
           }
           // Trash can
           if (c % 11 === 0 && (this.isNearWall(r, c) && Math.random() < 0.5)) {
             this.drawTrashCan(propsGfx, bx, by);
           }
           // Biombo — only in actual wide corridor rows
           if ((r === 14 || r === 28) && c % 18 === 0 && Math.random() < 0.4) {
             this.drawBiombo(propsGfx, bx, by);
           }
        }
      }
    }

    // Bake both static Graphics into RenderTextures so they render as a
    // single drawImage/draw call per frame instead of hundreds of shape commands.
    const worldW = MAP_COLS * TILE_SIZE;
    const worldH = MAP_ROWS * TILE_SIZE;

    const ambientRT = this.add.renderTexture(0, 0, worldW, worldH).setOrigin(0, 0).setDepth(1);
    ambientRT.draw(this.ambientGfx, 0, 0);
    this.ambientGfx.destroy();

    const propsRT = this.add.renderTexture(0, 0, worldW, worldH).setOrigin(0, 0).setDepth(2);
    propsRT.draw(propsGfx, 0, 0);
    propsGfx.destroy();
  }

  private isNearWall(r: number, c: number): boolean {
    if (r<=0 || r>=MAP_ROWS-1 || c<=0 || c>=MAP_COLS-1) return false;
    return this.mapData[r-1][c]===TILE_ID.WALL || this.mapData[r+1][c]===TILE_ID.WALL || this.mapData[r][c-1]===TILE_ID.WALL || this.mapData[r][c+1]===TILE_ID.WALL;
  }

  private addPropCollision(bx: number, by: number, w: number, h: number) {
     if (!this.propColliders) return;
     const body = this.propColliders.create(bx + w/2, by + h/2, 'pixel') as Phaser.Physics.Arcade.Image;
     body.setVisible(false).setDisplaySize(w, h).refreshBody();
  }

  // Draw enhanced props
  private populateRoom(g: Phaser.GameObjects.Graphics, tid: number, r1: number, r2: number, c1: number, c2: number) {
    const midC = Math.floor((c1 + c2) / 2);
    const midR = Math.floor((r1 + r2) / 2);

    // ── ICU — highly-monitored beds with ventilators and IV poles
    if (tid === TILE_ID.ICU) {
      let bedCol = c1 + 1;
      while (bedCol < c2 - 1) {
        const bx = bedCol * TILE_SIZE, by = (r1 + 1) * TILE_SIZE;
        this.drawHospitalBed(g, bx, by, true);
        this.interactionPoints.push({ x: bx, y: by, type: 'inspect' });
        this.drawVentilator(g, bx + 34, by - 2);
        this.drawIVPole(g, bx - 14, by + 8);
        bedCol += 4;
      }
      // Central nursing monitor strip
      const mx = midC * TILE_SIZE;
      this.drawNursingDesk(g, (c1 + 1) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      this.interactionPoints.push({ x: mx, y: (r2 - 2) * TILE_SIZE, type: 'work' });
    }

    // ── WARD — regular beds with bedside tables, IV poles
    else if (tid === TILE_ID.WARD) {
      let bedCol = c1 + 2;
      let row = r1 + 1;
      while (bedCol < c2 - 2) {
        const bx = bedCol * TILE_SIZE, by = row * TILE_SIZE;
        // Group everything into a "Room Unit"
        this.drawBiombo(g, bx - 24, by - 10);
        this.drawBiombo(g, bx - 24, by + 18);
        this.drawCabinet(g, bx - 14, by + 2);
        this.drawHospitalBed(g, bx, by, false);
        this.interactionPoints.push({ x: bx, y: by, type: 'inspect' });
        this.drawIVPole(g, bx - 12, by + 12);
        this.drawWaitingChairs(g, bx + 36, by + 16); // visitors chair
        
        bedCol += 5;
        if (bedCol >= c2 - 2 && row === r1 + 1) { bedCol = c1 + 2; row = r2 - 4; }
      }
      this.drawNursingDesk(g, midC * TILE_SIZE - 32, (r2 - 2) * TILE_SIZE);
      this.interactionPoints.push({ x: midC * TILE_SIZE, y: (r2 - 2) * TILE_SIZE, type: 'work' });
      this.drawPottedPlant(g, (c1 + 1) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
    }

    // ── MATERNITY — maternity beds + bassinets + soft decor
    else if (tid === TILE_ID.MATERNITY) {
      const TS = TILE_SIZE;
      // Split into Maternity Ward (left ~55%) and Neonatal ICU (right ~45%)
      const splitC = c1 + Math.floor((c2 - c1) * 0.55);

      // ── LEFT: Maternity Ward — two rows of beds
      // Row 1 (top): beds from c1+1 stepping every 3 tiles
      for (let bc = c1 + 1; bc + 1 <= splitC - 2; bc += 3) {
        const bx = bc * TS, by = (r1 + 1) * TS;
        this.drawMaternityBed(g, bx, by);
        this.drawBassinet(g, bx + 32, by + 10);
        this.drawWaitingChairs(g, bx, by + 48);   // companion chair below bed
        this.interactionPoints.push({ x: bx + 14, y: by + 22, type: 'inspect' });
      }
      // Row 2 (mid): stagger offset by 1.5 tiles
      for (let bc = c1 + 1; bc + 1 <= splitC - 2; bc += 3) {
        const bx = bc * TS, by = (r1 + 5) * TS;
        this.drawMaternityBed(g, bx, by);
        this.drawBassinet(g, bx + 32, by + 10);
        this.drawWaitingChairs(g, bx, by + 48);
        this.interactionPoints.push({ x: bx + 14, y: by + 22, type: 'inspect' });
      }

      // Mother resting corner (bottom-left)
      this.drawTherapySofa(g, (c1 + 1) * TS, (r2 - 3) * TS);
      this.drawBreastPumpStation(g, (c1 + 1) * TS + 42, (r2 - 3) * TS);
      this.interactionPoints.push({ x: (c1 + 1) * TS + 18, y: (r2 - 3) * TS + 9, type: 'rest' });

      // ── DIVIDER: vertical biombo column at splitC
      for (let r = r1 + 1; r <= r2 - 3; r += 1) {
        if ((r - r1) % 2 === 1) this.drawBiombo(g, splitC * TS, r * TS - 4);
      }

      // Nursing desk spanning the divider (bottom-center)
      this.drawNursingDesk(g, (splitC - 1) * TS, (r2 - 2) * TS);
      this.interactionPoints.push({ x: splitC * TS, y: (r2 - 2) * TS, type: 'work' });

      // ── RIGHT: Neonatal ICU — neat grid of incubators
      // Row 1: incubators along the top
      for (let ic = splitC + 1; ic + 1 <= c2 - 2; ic += 3) {
        const bx = ic * TS, by = (r1 + 1) * TS;
        this.drawIncubator(g, bx, by);
        this.drawIVPole(g, bx - 12, by + 4);
        this.interactionPoints.push({ x: bx + 12, y: by + 12, type: 'inspect' });
      }
      // Row 2: second incubator row below
      for (let ic = splitC + 1; ic + 1 <= c2 - 2; ic += 3) {
        const bx = ic * TS, by = (r1 + 5) * TS;
        this.drawIncubator(g, bx, by);
        this.drawIVPole(g, bx - 12, by + 4);
        this.interactionPoints.push({ x: bx + 12, y: by + 12, type: 'inspect' });
      }
      // Med supply cabinet between rows on the far right
      this.drawCabinet(g, (c2 - 2) * TS, (r1 + 2) * TS);
      this.drawCabinet(g, (c2 - 2) * TS, (r1 + 5) * TS);
    }

    // ── EMERGENCY — crash carts, trauma stretchers, defibrillators
    else if (tid === TILE_ID.EMERGENCY) {
      // Trauma bays along top wall (More beds, tighter packing)
      for (let col = c1 + 1; col < c2 - 2; col += 3) {
        this.drawTraumaStretcher(g, col * TILE_SIZE, (r1 + 1) * TILE_SIZE);
        this.interactionPoints.push({ x: col * TILE_SIZE, y: (r1 + 1) * TILE_SIZE, type: 'inspect' });
        // Crash carts between beds
        if (col < c2 - 4) {
          this.drawCrashCart(g, col * TILE_SIZE + 34, (r1 + 1) * TILE_SIZE);
        }
      }
      
      // Central Nursing/Doctors Station
      this.drawNursingDesk(g, (c1 + 3) * TILE_SIZE, midR * TILE_SIZE);
      this.interactionPoints.push({ x: (c1 + 4) * TILE_SIZE, y: midR * TILE_SIZE, type: 'work' });
      
      // Defibrillator and medical equipment on left/right walls
      this.drawDefibrillator(g, (c1 + 1) * TILE_SIZE, (r1 + 4) * TILE_SIZE);
      this.drawRefrigerator(g, (c2 - 2) * TILE_SIZE, (r1 + 4) * TILE_SIZE); // Med fridge

      // Observation beds along bottom wall
      for (let col = c1 + 2; col < c2 - 2; col += 4) {
        this.drawHospitalBed(g, col * TILE_SIZE, (r2 - 3) * TILE_SIZE, true);
        this.interactionPoints.push({ x: col * TILE_SIZE, y: (r2 - 3) * TILE_SIZE, type: 'inspect' });
      }

      // Hand sanitizer on pillars
      this.drawHandSanitizer(g, (c1 + 1) * TILE_SIZE, (r2 - 1) * TILE_SIZE);
    }

    // ── PHARMACY — tall shelving units + dispensing counter
    else if (tid === TILE_ID.PHARMACY) {
      // Dispensing counter along top
      for (let c = c1 + 1; c < c2 - 1; c += 2) {
        this.drawLabCounter(g, c * TILE_SIZE, (r1 + 1) * TILE_SIZE, TILE_SIZE * 2 - 4);
        this.interactionPoints.push({ x: c * TILE_SIZE, y: (r1 + 1) * TILE_SIZE, type: 'work' });
      }
      // Shelving units (tall cabinets)
      for (let c = c1 + 1; c < c2 - 1; c += 2) {
        this.drawShelvingUnit(g, c * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      }
      this.drawRefrigerator(g, (c2 - 2) * TILE_SIZE, (r1 + 2) * TILE_SIZE);
    }

    // ── LAB — benches with microscopes, centrifuges
    else if (tid === TILE_ID.LAB) {
      // Lab bench top
      for (let c = c1 + 1; c < c2 - 1; c += 3) {
        this.drawLabBench(g, c * TILE_SIZE, (r1 + 1) * TILE_SIZE);
        this.interactionPoints.push({ x: c * TILE_SIZE, y: (r1 + 1) * TILE_SIZE, type: 'work' });
      }
      // Centrifuge + analyzer bottom row
      this.drawCentrifuge(g, (c1 + 1) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      this.drawBioanalyzer(g, (c1 + 4) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      this.interactionPoints.push({ x: (c1 + 1) * TILE_SIZE, y: (r2 - 2) * TILE_SIZE, type: 'work' });
      this.drawFilingCabinet(g, (c2 - 2) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
    }

    // ── CME — autoclaves, sterilization counters
    else if (tid === TILE_ID.CME) {
      // Draw washing sinks along the top wall (avoid middle where door is)
      this.drawKitchenCounter(g, (c1 + 1) * TILE_SIZE, (r1 + 1) * TILE_SIZE, 2);
      this.interactionPoints.push({ x: (c1 + 1) * TILE_SIZE, y: (r1 + 1) * TILE_SIZE, type: 'work' });
      
      this.drawKitchenCounter(g, (c2 - 3) * TILE_SIZE, (r1 + 1) * TILE_SIZE, 2);
      this.interactionPoints.push({ x: (c2 - 2) * TILE_SIZE, y: (r1 + 1) * TILE_SIZE, type: 'work' });

      // Draw large industrial autoclaves (sterilizers) along the left wall
      this.drawAutoclave(g, (c1 + 1) * TILE_SIZE, midR * TILE_SIZE);
      this.drawAutoclave(g, (c1 + 1) * TILE_SIZE, (midR + 2) * TILE_SIZE);
      this.interactionPoints.push({ x: (c1 + 1) * TILE_SIZE, y: midR * TILE_SIZE, type: 'work' });

      // Draw packing and prep tables in the center
      this.drawLabCounter(g, midC * TILE_SIZE - TILE_SIZE, midR * TILE_SIZE, TILE_SIZE * 3);
      this.interactionPoints.push({ x: midC * TILE_SIZE, y: midR * TILE_SIZE, type: 'work' });

      // Draw storage shelving units along the bottom wall
      for (let c = c1 + 1; c < c2 - 1; c += 2) {
        this.drawShelvingUnit(g, c * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      }
    }

    // ── ADMIN/DIRETORIA — executive desks, filing cabinets, plants
    else if (tid === TILE_ID.ADMIN) {
      this.drawExecutiveDesk(g, midC * TILE_SIZE, midR * TILE_SIZE);
      this.interactionPoints.push({ x: midC * TILE_SIZE, y: midR * TILE_SIZE, type: 'work' });
      this.drawOfficeDesk(g, (c1 + 1) * TILE_SIZE, (r1 + 2) * TILE_SIZE);
      this.interactionPoints.push({ x: (c1 + 1) * TILE_SIZE, y: (r1 + 2) * TILE_SIZE, type: 'work' });
      this.drawFilingCabinet(g, (c2 - 2) * TILE_SIZE, (r1 + 2) * TILE_SIZE);
      this.drawFilingCabinet(g, (c2 - 2) * TILE_SIZE, (r1 + 4) * TILE_SIZE);
      this.drawPottedPlant(g, (c1 + 1) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      this.drawPottedPlant(g, (c2 - 2) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      this.drawWaitingChairs(g, midC * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      this.interactionPoints.push({ x: midC * TILE_SIZE, y: (r2 - 2) * TILE_SIZE, type: 'sit' });
    }

    // ── RECEPTION — reception counter, waiting area
    else if (tid === TILE_ID.RECEPTION) {
      this.drawReceptionCounter(g, (c1 + 1) * TILE_SIZE, (r1 + 2) * TILE_SIZE, c2 - c1 - 2);
      this.interactionPoints.push({ x: midC * TILE_SIZE, y: (r1 + 2) * TILE_SIZE, type: 'work' });
      
      // Waiting chairs in multiple rows for the busy PS queue
      for (let r = r2 - 5; r <= r2 - 2; r += 2) {
        for (let c = c1 + 1; c < c2 - 1; c += 3) {
          this.drawWaitingChairs(g, c * TILE_SIZE, r * TILE_SIZE);
          this.interactionPoints.push({ x: c * TILE_SIZE, y: r * TILE_SIZE, type: 'sit' });
        }
      }

      // TV or info board on left wall
      this.drawVendingMachine(g, (c1 + 1) * TILE_SIZE, midR * TILE_SIZE);
      
      this.drawPottedPlant(g, (c2 - 2) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      this.drawPottedPlant(g, (c1 + 1) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      this.drawPottedPlant(g, (c2 - 2) * TILE_SIZE, (r1 + 4) * TILE_SIZE);
    }

    // ── BREAK/NUTRITION — dining tables, vending, kitchenette
    else if (tid === TILE_ID.BREAK) {
      this.drawDiningTable(g, (c1 + 1) * TILE_SIZE, (r1 + 2) * TILE_SIZE);
      this.interactionPoints.push({ x: (c1 + 1) * TILE_SIZE, y: (r1 + 2) * TILE_SIZE, type: 'rest' });
      if (c2 - c1 > 5) {
        this.drawDiningTable(g, (c1 + 4) * TILE_SIZE, (r1 + 2) * TILE_SIZE);
        this.interactionPoints.push({ x: (c1 + 4) * TILE_SIZE, y: (r1 + 2) * TILE_SIZE, type: 'rest' });
      }
      this.drawVendingMachine(g, (c2 - 2) * TILE_SIZE, (r1 + 1) * TILE_SIZE);
      this.drawKitchenCounter(g, (c1 + 1) * TILE_SIZE, (r2 - 2) * TILE_SIZE, c2 - c1 - 2);
      this.drawPottedPlant(g, (c2 - 2) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
    }

    // ── NURSING STATION — long counter, monitors, filing cabinets
    else if (tid === TILE_ID.NURSING) {
      // Main central nursing island
      this.drawNursingDesk(g, midC * TILE_SIZE - 48, midR * TILE_SIZE - 32);
      this.drawNursingDesk(g, midC * TILE_SIZE + 16, midR * TILE_SIZE - 32);
      this.interactionPoints.push({ x: midC * TILE_SIZE, y: midR * TILE_SIZE - 32, type: 'work' });
      
      // Filing cabinets & crash carts along back wall
      for (let c = c1 + 1; c < c2 - 2; c += 3) {
        this.drawFilingCabinet(g, c * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      }
      this.drawCrashCart(g, (c2 - 2) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      
      // Secondary workstations
      this.drawOfficeDesk(g, (c1 + 1) * TILE_SIZE, (r1 + 1) * TILE_SIZE);
      this.interactionPoints.push({ x: (c1 + 1) * TILE_SIZE, y: (r1 + 1) * TILE_SIZE, type: 'work' });
      this.drawPottedPlant(g, (c2 - 2) * TILE_SIZE, (r1 + 1) * TILE_SIZE);
    }

    // ── RADIOLOGY — CT scanner + control room + cabinets
    else if (tid === TILE_ID.RADIOLOGY) {
      this.drawCTScanner(g, (c1 + 2) * TILE_SIZE, (r1 + 1) * TILE_SIZE);
      this.interactionPoints.push({ x: (c1 + 2) * TILE_SIZE, y: (r1 + 1) * TILE_SIZE, type: 'work' });
      this.drawXRayViewer(g, (c2 - 3) * TILE_SIZE, (r1 + 1) * TILE_SIZE);
      this.interactionPoints.push({ x: (c2 - 3) * TILE_SIZE, y: (r1 + 1) * TILE_SIZE, type: 'work' });
      this.drawOfficeDesk(g, midC * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      this.interactionPoints.push({ x: midC * TILE_SIZE, y: (r2 - 2) * TILE_SIZE, type: 'work' });
      this.drawCabinet(g, (c1 + 1) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
    }

    // ── ONCOLOGY — chemo chairs + IV poles
    else if (tid === TILE_ID.ONCOLOGY) {
      for (let c = c1 + 1; c < c2 - 1; c += 3) {
        this.drawChemoChair(g, c * TILE_SIZE, (r1 + 1) * TILE_SIZE);
        this.interactionPoints.push({ x: c * TILE_SIZE, y: (r1 + 1) * TILE_SIZE, type: 'inspect' });
        this.drawIVPole(g, c * TILE_SIZE + 24, (r1 + 1) * TILE_SIZE - 4);
        if (c + 3 < c2 - 1) {
          this.drawChemoChair(g, (c + 1) * TILE_SIZE, (r2 - 3) * TILE_SIZE);
          this.interactionPoints.push({ x: (c + 1) * TILE_SIZE, y: (r2 - 3) * TILE_SIZE, type: 'inspect' });
        }
      }
      this.drawNursingDesk(g, midC * TILE_SIZE, (r2 - 2) * TILE_SIZE);
      this.interactionPoints.push({ x: midC * TILE_SIZE, y: (r2 - 2) * TILE_SIZE, type: 'work' });
    }

    // ── REHAB — exercise equipment, parallel bars
    else if (tid === TILE_ID.REHAB) {
      this.drawParallelBars(g, (c1 + 1) * TILE_SIZE, midR * TILE_SIZE);
      this.interactionPoints.push({ x: (c1 + 1) * TILE_SIZE, y: midR * TILE_SIZE, type: 'sit' });
      this.drawExerciseMat(g, midC * TILE_SIZE, (r1 + 2) * TILE_SIZE);
      this.interactionPoints.push({ x: midC * TILE_SIZE, y: (r1 + 2) * TILE_SIZE, type: 'inspect' });
      this.drawOfficeDesk(g, (c2 - 2) * TILE_SIZE, (r1 + 2) * TILE_SIZE);
      this.interactionPoints.push({ x: (c2 - 2) * TILE_SIZE, y: (r1 + 2) * TILE_SIZE, type: 'work' });
      this.drawPottedPlant(g, (c1 + 1) * TILE_SIZE, (r2 - 2) * TILE_SIZE);
    }

    // ── OUTPATIENT — exam tables, doctor desk
    else if (tid === TILE_ID.OUTPATIENT) {
      const TS = TILE_SIZE;
      const topY = (r1 + 1) * TS;
      const bottomY = (r2 - 1) * TS;

      // ── Consultation rooms along the top wall (step 5 tiles for breathing room)
      let roomCol = c1 + 1;
      let roomCount = 0;
      while (roomCol + 3 <= c2 - 1 && roomCount < 2) {
        const bx = roomCol * TS;
        const by = topY;

        // Biombo divider before each room (except the first)
        if (roomCount > 0) {
          const divX = bx - TS;
          this.drawBiombo(g, divX, by);
          this.drawBiombo(g, divX, by + 28);
          this.drawBiombo(g, divX, by + 56);
          this.drawBiombo(g, divX, by + 84);
        }

        // Exam table against the north wall
        this.drawExamTable(g, bx + 2, by + 4);
        this.interactionPoints.push({ x: bx + 16, y: by + 20, type: 'inspect' });

        // Doctor desk below the exam table
        this.drawOfficeDesk(g, bx, by + 44);
        this.interactionPoints.push({ x: bx + 16, y: by + 56, type: 'work' });

        // Patient chair to the right of the desk
        this.drawWaitingChairs(g, bx + 36, by + 48);

        // Hand sanitizer on the top wall edge
        this.drawHandSanitizer(g, bx + 14, by);

        roomCol += 5;
        roomCount++;
      }

      // ── Waiting / reception area at the bottom
      // Reception counter on the left
      this.drawReceptionCounter(g, (c1 + 1) * TS, (r2 - 3) * TS, 3);
      this.interactionPoints.push({ x: (c1 + 2) * TS, y: (r2 - 3) * TS, type: 'work' });

      // Two rows of waiting chairs filling the rest of the bottom width
      for (let wc = c1 + 5; wc + 1 <= c2 - 1; wc += 2) {
        this.drawWaitingChairs(g, wc * TS, (r2 - 3) * TS);
        this.interactionPoints.push({ x: wc * TS + 8, y: (r2 - 3) * TS, type: 'sit' });
        this.drawWaitingChairs(g, wc * TS, (r2 - 2) * TS);
        this.interactionPoints.push({ x: wc * TS + 8, y: (r2 - 2) * TS, type: 'sit' });
      }

      // Potted plant in the bottom-right corner
      this.drawPottedPlant(g, (c2 - 2) * TS, (r2 - 4) * TS);
    }

    // ── PSYCH — therapy sofas, plants, calm decor
    else if (tid === TILE_ID.PSYCH) {
      // Group: Doctor desk + patient sofa setup
      const deskX = (c2 - 3) * TILE_SIZE;
      const deskY = (r1 + 2) * TILE_SIZE;
      this.drawOfficeDesk(g, deskX, deskY);
      this.interactionPoints.push({ x: deskX, y: deskY, type: 'work' });
      this.drawTherapySofa(g, deskX - 64, deskY); // Sofa facing desk (virtually)
      this.interactionPoints.push({ x: deskX - 64, y: deskY, type: 'sit' });
      this.drawTherapyPlant(g, deskX - 32, deskY + 32); 
      
      // Secondary group: Quiet reflection corner
      const quietX = (c1 + 1) * TILE_SIZE;
      const quietY = (r2 - 3) * TILE_SIZE;
      this.drawTherapySofa(g, quietX, quietY);
      this.interactionPoints.push({ x: quietX, y: quietY, type: 'sit' });
      this.drawPottedPlant(g, quietX + 48, quietY - 16);
      this.drawTherapyPlant(g, quietX + 16, quietY - 32);
    }
  }

  private drawSleepingPatientHead(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    const col = Math.floor(bx / 32); // hardcoded TILE_SIZE=32 to avoid import issues if any
    const row = Math.floor(by / 32);
    const patient = NPC_DEFS.find(d => d.role === 'patient' && d.startCol === col && d.startRow === row);
    if (!patient) return;

    // Head shadow
    g.fillStyle(0x000000, 0.15);
    g.beginPath(); g.arc(bx + 17, by + 15, 7, 0, Math.PI * 2); g.fill();
    
    // Skin
    g.fillStyle(patient.skinColor || 0xfcd34d, 1);
    g.beginPath(); g.arc(bx + 17, by + 14, 6.5, 0, Math.PI * 2); g.fill();
    
    // Closed calm eyes
    g.lineStyle(1.5, 0x000000, 0.4);
    g.beginPath(); g.arc(bx + 14, by + 13, 2, 0, Math.PI); g.strokePath();
    g.beginPath(); g.arc(bx + 20, by + 13, 2, 0, Math.PI); g.strokePath();

    // Hair
    if (patient.hairColor) {
      g.fillStyle(patient.hairColor, 1);
      g.beginPath(); g.arc(bx + 17, by + 10, 6, Math.PI, 0); g.fill();
      g.fillRoundedRect(bx + 10, by + 9, 14, 4, 2);
    }
  }

  private drawTraumaStretcher(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx + 2, by + 2, 28, 44);
    // Soft shadow
    g.fillStyle(0x000000, 0.2); g.fillRoundedRect(bx + 5, by + 8, 26, 42, 4);
    
    // Frame (chrome/stainless)
    g.fillStyle(0x94a3b8, 1); g.fillRoundedRect(bx + 3, by + 2, 26, 44, 4);
    g.fillStyle(0xf8fafc, 1); g.fillRoundedRect(bx + 5, by + 5, 22, 38, 3); // mattress
    
    // Red trauma blanket
    g.fillStyle(0xe11d48, 1); g.fillRoundedRect(bx + 3, by + 18, 26, 25, 4); 
    g.fillStyle(0xbe123c, 0.5); g.fillRoundedRect(bx + 5, by + 22, 22, 4, 1); // fold
    
    // Pillow
    g.fillStyle(0xffffff, 1); g.fillRoundedRect(bx + 7, by + 7, 18, 9, 4);
    g.fillStyle(0xe2e8f0, 1); g.fillRoundedRect(bx + 7, by + 13, 18, 2, 1); // crease
    
    this.drawSleepingPatientHead(g, bx, by); // NEW

    // IV pole
    g.fillStyle(0xcbd5e1, 1); g.fillRoundedRect(bx + 32, by - 6, 2, 30, 1);
    g.fillStyle(0xffffff, 0.9); g.fillRoundedRect(bx + 29, by - 12, 8, 12, 3); // bag
    g.fillStyle(0x38bdf8, 0.6); g.fillRect(bx + 31, by - 10, 4, 6); // liquid
    
    // Wheels
    g.fillStyle(0x0f172a, 1);
    g.fillCircle(bx + 6, by + 47, 2.5);
    g.fillCircle(bx + 26, by + 47, 2.5);
    g.fillStyle(0x94a3b8, 1);
    g.fillCircle(bx + 6, by + 47, 1);
    g.fillCircle(bx + 26, by + 47, 1);
  }

  private drawDefibrillator(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 24, 24);
    g.fillStyle(0x000000, 0.25); g.fillRoundedRect(bx + 2, by + 2, 24, 24, 4);
    g.fillStyle(0xf1c40f, 1); g.fillRoundedRect(bx, by, 24, 24, 4);
    // Screen
    g.fillStyle(0x2c3e50, 1); g.fillRoundedRect(bx + 4, by + 4, 16, 8, 2);
    g.fillStyle(0x00ff88, 0.7); g.fillRect(bx + 6, by + 6, 12, 4);
    // Heart icon
    g.fillStyle(0xe74c3c, 1);
    g.fillCircle(bx + 10, by + 17, 2);
    g.fillCircle(bx + 14, by + 17, 2);
    g.fillTriangle(bx + 8, by + 18, bx + 16, by + 18, bx + 12, by + 22);
    // Status LED on lid
    const led = this.add.sprite(bx + 21, by + 3, 'red_led').setDepth(3).setOrigin(0.5);
    this.tweens.add({ targets: led, alpha: 0.2, duration: 700, yoyo: true, repeat: -1 });
  }

  private drawCTScanner(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 64, 32);
    // Soft ambient shadow
    g.fillStyle(0x000000, 0.4); g.fillRoundedRect(bx + 4, by + 6, 64, 32, 8);
    // Main housing (sleek dark grey/blue)
    g.fillStyle(0x1e293b, 1); g.fillRoundedRect(bx, by, 64, 32, 8); 
    g.fillStyle(0x334155, 1); g.fillRoundedRect(bx + 2, by + 2, 60, 24, 6); // subtle panel
    // Bore (the hole)
    g.fillStyle(0x0f172a, 1); g.fillCircle(bx + 32, by + 16, 12);
    g.fillStyle(0x38bdf8, 0.4); g.fillCircle(bx + 32, by + 16, 9); // glowing inner ring
    g.fillStyle(0x0284c7, 0.8); g.fillCircle(bx + 32, by + 16, 5); // core
    // Patient table sliding out
    g.fillStyle(0x000000, 0.3); g.fillRoundedRect(bx + 24, by + 26, 16, 8, 2); // table shadow
    g.fillStyle(0xe2e8f0, 1); g.fillRoundedRect(bx + 24, by + 24, 16, 8, 2);
    g.fillStyle(0x0284c7, 1); g.fillRect(bx + 25, by + 25, 14, 5); // comfy soft table cushion
    // Branding stripe
    g.fillStyle(0x38bdf8, 1); g.fillRect(bx, by + 28, 64, 2);

    const ledG = this.add.sprite(bx + 12, by + 8, 'green_led').setDepth(3).setOrigin(0.5);
    this.tweens.add({ targets: ledG, alpha: 0.1, duration: 600, yoyo: true, repeat: -1 });

    const ledB = this.add.sprite(bx + 52, by + 24, 'blue_led').setDepth(3).setOrigin(0.5);
    this.tweens.add({ targets: ledB, alpha: 0.3, duration: 1500, yoyo: true, repeat: -1 });
  }

  private drawNursingDesk(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 70, 24);

    // ── Drop shadow
    g.fillStyle(0x000000, 0.2); g.fillRoundedRect(bx + 3, by + 6, 70, 22, 4);

    // ── High end beautiful Nurse Station (Teal + Light Wood)
    g.fillStyle(0x0f766e, 1); g.fillRoundedRect(bx, by, 70, 22, 4); // base
    g.fillStyle(0x14b8a6, 1); g.fillRect(bx + 2, by + 4, 66, 2); // accent stripe
    
    // ── Glossy Wood Top
    g.fillStyle(0xfef3c7, 1); g.fillRoundedRect(bx + 2, by + 2, 66, 14, 2); 

    // Workstations (PCs)
    for (let pos of [12, 35, 58]) {
      // Monitor
      g.fillStyle(0x1e293b, 1); g.fillRoundedRect(bx + pos - 6, by + 1, 12, 8, 2);
      g.fillStyle(0x0ea5e9, 0.6); g.fillRect(bx + pos - 5, by + 2, 10, 6);
      g.fillStyle(0x38bdf8, 0.3); g.fillRect(bx + pos - 5, by + 2, 4, 6); // reflection highlight
      // Keyboard
      g.fillStyle(0x94a3b8, 1); g.fillRoundedRect(bx + pos - 5, by + 11, 10, 3, 1);
    }
    
    // Glowing LED baseboard
    g.fillStyle(0xccfbf1, 0.3); g.fillRect(bx + 2, by + 20, 66, 2);
    
    // Small desk plant (right side, teal pot)
    g.fillStyle(0x1abc9c, 1); g.fillRoundedRect(bx + 62, by + 4, 6, 6, 1); // pot
    g.fillStyle(0x27ae60, 1);
    g.beginPath(); g.arc(bx + 65, by + 1, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle(0x2ecc71, 0.8);
    g.beginPath(); g.arc(bx + 63, by + 3, 3, 0, Math.PI * 2); g.fill();
  }

  private drawExamTable(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 28, 32);
    g.fillStyle(0x000000, 0.35); g.fillRoundedRect(bx + 3, by + 3, 28, 32, 3);
    g.fillStyle(0x95a5a6, 1); g.fillRoundedRect(bx, by, 28, 32, 3);
    g.fillStyle(0xfdebd0, 1); g.fillRoundedRect(bx + 2, by + 2, 24, 28, 3);
    // Paper roll at head end
    g.fillStyle(0xffffff, 0.95); g.fillRect(bx + 2, by + 2, 24, 5);
    g.fillStyle(0xecf0f1, 1); g.fillRect(bx + 2, by + 7, 24, 1);
    // BP cuff hanging
    g.fillStyle(0x2c3e50, 1); g.fillRoundedRect(bx + 10, by + 14, 8, 4, 1);
  }

  private drawTherapySofa(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 36, 18);
    g.fillStyle(0x000000, 0.35); g.fillRoundedRect(bx + 3, by + 3, 36, 18, 4);
    g.fillStyle(0x6c5ce7, 1); g.fillRoundedRect(bx, by, 36, 18, 4);
    g.fillStyle(0x8e7cc9, 1); g.fillRoundedRect(bx + 2, by + 2, 32, 8, 3); // backrest
    // Seat seams
    g.fillStyle(0x4a3a99, 1);
    g.fillRect(bx + 12, by + 3, 1, 12);
    g.fillRect(bx + 24, by + 3, 1, 12);
    // Throw pillow
    g.fillStyle(0xfdcb6e, 1); g.fillRoundedRect(bx + 4, by + 10, 7, 6, 2);
  }

  private drawTherapyPlant(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx + 6, by + 6, 20, 20);
    g.fillStyle(0x000000, 0.2); g.fillCircle(bx + 16, by + 18, 12);
    g.fillStyle(0x8e44ad, 1); g.fillRect(bx + 11, by + 14, 10, 10);
    // Tall fronds
    g.fillStyle(0x27ae60, 1); g.fillTriangle(bx + 16, by - 4, bx + 8, by + 16, bx + 24, by + 16);
    g.fillStyle(0x2ecc71, 0.85); g.fillTriangle(bx + 16, by, bx + 11, by + 14, bx + 21, by + 14);
  }

  private drawPottedPlant(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx + 6, by + 14, 20, 18);
    // ── Shadow
    g.fillStyle(0x000000, 0.15); g.fillEllipse(bx + 16, by + 36, 22, 6);
    // ── Pot (terracotta/brown — drawn as triangle approximation)
    g.fillStyle(0x8b5e3c, 1);
    g.fillTriangle(bx + 9, by + 24, bx + 25, by + 24, bx + 23, by + 36);
    g.fillTriangle(bx + 9, by + 24, bx + 11, by + 36, bx + 23, by + 36);
    // ── Pot rim
    g.fillStyle(0xa0704a, 1); g.fillRoundedRect(bx + 8, by + 20, 18, 4, 2);
    g.fillStyle(0xc0906a, 0.5); g.fillRect(bx + 9, by + 21, 16, 1); // highlight
    // ── Soil (visible inside rim)
    g.fillStyle(0x3a2010, 1); g.fillEllipse(bx + 17, by + 24, 14, 4);
    // ── Tall tropical leaves (like the reference image plant)
    // Main leaf left
    g.fillStyle(0x27ae60, 1);
    g.fillTriangle(bx + 16, by + 22, bx + 4, by - 2, bx + 12, by + 14);
    // Main leaf right
    g.fillTriangle(bx + 16, by + 22, bx + 28, by - 2, bx + 20, by + 14);
    // Center leaf (tallest)
    g.fillTriangle(bx + 16, by + 20, bx + 16, by - 8, bx + 20, by + 12);
    // Secondary leaves
    g.fillStyle(0x2ecc71, 1);
    g.fillTriangle(bx + 16, by + 20, bx + 6, by + 6, bx + 14, by + 16);
    g.fillTriangle(bx + 16, by + 20, bx + 26, by + 6, bx + 18, by + 16);
    // Leaf vein highlights
    g.lineStyle(0.8, 0x1a8a42, 0.5);
    g.beginPath(); g.moveTo(bx + 16, by + 20); g.lineTo(bx + 10, by + 2); g.strokePath();
    g.beginPath(); g.moveTo(bx + 16, by + 20); g.lineTo(bx + 22, by + 2); g.strokePath();
  }

  private drawFilingCabinet(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 32, 16);
    
    // Shadow
    g.fillStyle(0x000000, 0.35); 
    g.fillRoundedRect(bx + 2, by + 4, 32, 16, 2);
    
    // Premium dark steel cabinet body
    g.fillStyle(0x334155, 1); 
    g.fillRoundedRect(bx, by, 32, 14, 2);
    g.fillStyle(0x1e293b, 1); 
    g.fillRect(bx, by + 12, 32, 2);
    
    // Sleek drawers
    g.fillStyle(0x475569, 1); 
    g.fillRoundedRect(bx + 2, by + 2, 12, 10, 1); 
    g.fillRoundedRect(bx + 18, by + 2, 12, 10, 1);
    
    // Chrome handles
    g.fillStyle(0x94a3b8, 1); 
    g.fillRect(bx + 5, by + 6, 6, 2); 
    g.fillRect(bx + 21, by + 6, 6, 2);
  }

  private drawWaitingChairs(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 32, 16);
    
    g.fillStyle(0x000000, 0.35); 
    g.fillRoundedRect(bx + 2, by + 8, 32, 10, 2);
    
    // Stainless steel sleek frame
    g.fillStyle(0x94a3b8, 1); 
    g.fillRect(bx, by + 6, 32, 4);
    
    // Comfortable modern waiting chairs (cyan/blue)
    g.fillStyle(0x0284c7, 1); 
    g.fillRoundedRect(bx + 1, by, 14, 14, 4);
    g.fillRoundedRect(bx + 17, by, 14, 14, 4);
    // Dark backrests
    g.fillStyle(0x0369a1, 1);
    g.fillRect(bx + 1, by, 14, 3);
    g.fillRect(bx + 17, by, 14, 3);
  }

  private drawHandSanitizer(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    // Drawn projecting from the north wall down into the corridor
    g.fillStyle(0x000000, 0.4); 
    g.fillRect(bx + 12, by - 6, 8, 12); // shadow
    
    // Dispenser body
    g.fillStyle(0xf8fafc, 1); 
    g.fillRoundedRect(bx + 10, by - 8, 12, 14, 3); 
    // Medical cross logo
    g.fillStyle(0x38bdf8, 1);
    g.fillRect(bx + 15, by - 5, 2, 6);
    g.fillRect(bx + 13, by - 3, 6, 2);
    
    // Metallic nozzle
    g.fillStyle(0x64748b, 1); 
    g.fillRoundedRect(bx + 14, by + 6, 4, 3, 1); 
  }

  // --- Prop drawing routines (isometric-ish / top-down with shadow) ---
  private drawHospitalBed(g: Phaser.GameObjects.Graphics, bx: number, by: number, hasMonitor: boolean) {
    this.addPropCollision(bx + 2, by + 2, 28, 48);

    // ── Deep Soft Ambient Drop Shadow
    g.fillStyle(0x000000, 0.25); 
    g.fillRoundedRect(bx + 4, by + 12, 28, 42, 6);

    // ── High-Tech Smooth Bed Frame
    g.fillStyle(0xe2e8f0, 1); // very light grey/blue
    g.fillRoundedRect(bx + 2, by + 2, 30, 50, 6);
    g.fillStyle(0xcbd5e1, 1);
    g.fillRoundedRect(bx + 3, by + 3, 28, 48, 5); // inner frame
    
    // Glowing under-rail 
    g.fillStyle(0x38bdf8, 0.6);
    g.fillRect(bx + 4, by + 47, 26, 2);

    // ── Mattress (Bright, ergonomic memory foam)
    g.fillStyle(0xffffff, 1); 
    g.fillRoundedRect(bx + 4, by + 6, 26, 42, 6);
    g.fillStyle(0xf1f5f9, 1);
    g.fillRect(bx + 26, by + 10, 3, 36); // Edge shading

    // ── Pillow
    g.fillStyle(0xf8fafc, 1); 
    g.fillRoundedRect(bx + 7, by + 8, 20, 12, 4);
    // Soft crease
    g.fillStyle(0x000000, 0.05); 
    g.fillRoundedRect(bx + 16, by + 9, 2, 10, 1);

    this.drawSleepingPatientHead(g, bx, by + 1); // NEW

    // ── Medical Blanket
    const blanketColor = hasMonitor ? 0x0284c7 : 0x0ea5e9; // premium blues
    g.fillStyle(blanketColor, 1); 
    g.fillRoundedRect(bx + 3, by + 28, 28, 22, 6);
    
    // Blanket folds (soft lighting)
    g.fillStyle(0x0369a1, 0.4); // darker blue folds
    g.fillRoundedRect(bx + 5, by + 34, 24, 4, 2);
    g.fillRoundedRect(bx + 5, by + 42, 24, 4, 2);
    g.fillStyle(0xffffff, 0.25); // highlights
    g.fillRoundedRect(bx + 5, by + 31, 24, 3, 2);
    g.fillRoundedRect(bx + 5, by + 39, 24, 3, 2);

    // removed random patient so that NPC patients can be placed on beds

    // ── Sleek Footboard
    g.fillStyle(0x94a3b8, 1); 
    g.fillRoundedRect(bx + 2, by + 48, 30, 4, 2);

    // ── Smart Holographic Monitor
    if (hasMonitor) {
      // Sleek Stand
      g.fillStyle(0x475569, 1); 
      g.fillRect(bx + 34, by - 2, 8, 8);
      
      // Monitor Screen Border
      g.fillStyle(0x1e293b, 1); 
      g.fillRoundedRect(bx + 32, by - 6, 12, 10, 2);
      
      // Glass Screen
      g.fillStyle(0x020617, 1); 
      g.fillRoundedRect(bx + 33, by - 5, 10, 8, 1);
      
      // Sine wave EKG animation effect
      g.fillStyle(0x10b981, 1); // bright green
      g.fillRect(bx + 34, by - 1, 2, 1);
      g.fillRect(bx + 36, by - 3, 1, 4);
      g.fillRect(bx + 37, by + 1, 2, 1);
      g.fillRect(bx + 39, by - 2, 1, 3);
      g.fillRect(bx + 40, by - 1, 2, 1);

      // Screen glow cast on blanket
      g.fillStyle(0x10b981, 0.25);
      g.fillRoundedRect(bx + 26, by + 28, 6, 12, 2);

      const led = this.add.sprite(bx + 42, by - 7, 'red_led').setDepth(3).setOrigin(0.5);
      this.tweens.add({ targets: led, alpha: 0.1, duration: 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const ledG2 = this.add.sprite(bx + 34, by + 1, 'green_led').setDepth(3).setOrigin(0.5);
      this.tweens.add({ targets: ledG2, alpha: 0.1, duration: 800, yoyo: true, repeat: -1 });
    }
  }

  private drawOfficeDesk(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 32, 24);
    
    // Drop shadow
    g.fillStyle(0x000000, 0.35); 
    g.fillRoundedRect(bx + 3, by + 4, 32, 24, 2);
    
    // Desk top (Premium dark wood / sleek metal)
    g.fillStyle(0x3e2723, 1); 
    g.fillRoundedRect(bx, by, 32, 16, 2); 
    g.fillStyle(0x2d1a16, 1); 
    g.fillRoundedRect(bx, by+14, 32, 4, 2); // desk edge shadow

    // PC setup (ultra-wide curved monitor)
    g.fillStyle(0x020617, 1); // Darker bezel
    g.fillRoundedRect(bx + 4, by + 2, 18, 10, 2); 
    g.fillStyle(0x000000, 1); // Darker screen
    g.fillRoundedRect(bx + 5, by + 3, 16, 8, 1); 
    // Screen glow (blue/cyan)
    g.fillStyle(0x38bdf8, 0.4); // stronger glow
    g.fillRect(bx + 5, by + 3, 16, 8);
    // Keyboard
    g.fillStyle(0x7f8c8d, 1); 
    g.fillRoundedRect(bx + 4, by + 13, 12, 3, 1); 
    // Mouse
    g.fillStyle(0xbdc3c7, 1); 
    g.fillRoundedRect(bx + 18, by + 13, 3, 4, 1);

    // Ergonomic Chair
    g.fillStyle(0x111827, 0.4); 
    g.beginPath(); g.arc(bx + 14, by + 24, 6, 0, Math.PI*2); g.fill(); // caster wheels shadow
    g.fillStyle(0x1e293b, 1); 
    g.fillRoundedRect(bx + 9, by + 18, 10, 8, 3); // seat
    g.fillStyle(0x0f172a, 1); 
    g.fillRoundedRect(bx + 10, by + 17, 8, 2, 1); // backrest
  }

  private drawLabCounter(g: Phaser.GameObjects.Graphics, bx: number, by: number, width: number) {
    this.addPropCollision(bx, by, width, 18);
    g.fillStyle(0x000000, 0.25); g.fillRoundedRect(bx + 2, by + 4, width, 18, 2);
    // Stainless steel sleek counter
    g.fillStyle(0xe2e8f0, 1); g.fillRoundedRect(bx, by, width, 14, 2);
    g.fillStyle(0xcbd5e1, 1); g.fillRect(bx, by+12, width, 2); // edge
    
    // Microscope/Equipment (high tech)
    g.fillStyle(0x334155, 1); g.fillRoundedRect(bx + 6, by + 2, 8, 10, 2);
    g.fillStyle(0x38bdf8, 0.6); g.fillCircle(bx + 10, by + 6, 3); // glowing lens
    // Centrifuge
    g.fillStyle(0x94a3b8, 1); g.fillRoundedRect(bx + 20, by + 3, 6, 8, 1);
    g.fillStyle(0x10b981, 1); g.fillRect(bx + 21, by + 5, 2, 1); // green led
  }

  private drawCabinet(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 24, 16);
    g.fillStyle(0x000000, 0.35); g.fillRoundedRect(bx + 2, by + 4, 24, 16, 2);
    // Modern sleek medical cabinet
    g.fillStyle(0xf8fafc, 1); g.fillRoundedRect(bx, by, 24, 14, 2); // top
    g.fillStyle(0x94a3b8, 1); g.fillRect(bx, by + 12, 24, 2); // shadow/edge
    
    // Glass doors showing supplies
    g.fillStyle(0x0ea5e9, 0.15); g.fillRect(bx + 2, by + 2, 9, 10); 
    g.fillStyle(0x0ea5e9, 0.15); g.fillRect(bx + 13, by + 2, 9, 10);
    // Supplies inside
    g.fillStyle(0xfca5a5, 0.6); g.fillRect(bx + 4, by + 4, 2, 3);
    g.fillStyle(0x6ee7b7, 0.6); g.fillRect(bx + 7, by + 4, 2, 3);
  }

  private drawDiningTable(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 32, 24);
    
    // Smooth drop shadow
    g.fillStyle(0x000000, 0.35); 
    g.fillRoundedRect(bx + 2, by + 4, 32, 24, 4);
    
    // Cozy modern wooden table
    g.fillStyle(0x854d0e, 1); 
    g.fillRoundedRect(bx, by, 32, 24, 4);
    g.fillStyle(0x713f12, 1); 
    g.fillRect(bx + 4, by + 4, 24, 16); // inner grain
    // Center bowl or placemats
    g.fillStyle(0xfef08a, 0.8);
    g.fillCircle(bx + 16, by + 12, 4);
    
    // Ergonomic modern Chairs
    g.fillStyle(0x0f172a, 1);
    g.fillRoundedRect(bx + 6, by - 4, 6, 8, 2);
    g.fillRoundedRect(bx + 20, by - 4, 6, 8, 2);
    g.fillRoundedRect(bx + 6, by + 20, 6, 8, 2);
    g.fillRoundedRect(bx + 20, by + 20, 6, 8, 2);
  }

  private drawVendingMachine(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 16, 24);
    
    // Shadow
    g.fillStyle(0x000000, 0.35); 
    g.fillRoundedRect(bx + 2, by + 4, 16, 24, 2);
    
    // Vibrant frame (Red)
    g.fillStyle(0xe11d48, 1); 
    g.fillRoundedRect(bx, by, 16, 24, 2);
    
    // Glowing glass panel
    g.fillStyle(0x0284c7, 0.4); 
    g.fillRect(bx + 2, by + 2, 12, 12); 
    g.fillStyle(0x38bdf8, 0.2); 
    g.fillRect(bx + 2, by + 2, 6, 12); // spec reflection
    
    // Items
    g.fillStyle(0xfcd34d, 1); g.fillRect(bx + 4, by + 4, 3, 3);
    g.fillStyle(0xf43f5e, 1); g.fillRect(bx + 9, by + 4, 3, 3);
    g.fillStyle(0x34d399, 1); g.fillRect(bx + 4, by + 9, 3, 3);
    g.fillStyle(0x60a5fa, 1); g.fillRect(bx + 9, by + 9, 3, 3);

    // Coin slot and delivery port
    g.fillStyle(0x1e293b, 1); 
    g.fillRect(bx + 10, by + 16, 4, 6);
    g.fillRect(bx + 2, by + 18, 6, 4);
  }

  private drawChemoChair(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 20, 24);
    // Shadow
    g.fillStyle(0x000000, 0.35); 
    g.fillRoundedRect(bx + 2, by + 2, 20, 24, 5);
    
    // Premium medical chair (Teal / Sage)
    g.fillStyle(0x115e59, 1); 
    g.fillRoundedRect(bx, by, 20, 20, 5); // seat
    g.fillStyle(0x0f766e, 1); 
    g.fillRoundedRect(bx + 2, by + 2, 16, 16, 3); // cushion highlight
    
    // Footrest extended
    g.fillStyle(0x134e4a, 1); 
    g.fillRoundedRect(bx + 2, by+14, 16, 10, 3); 

    // Heavy duty IV Pole
    g.fillStyle(0x64748b, 1); 
    g.fillRect(bx + 22, by - 6, 4, 30);
    g.fillStyle(0x94a3b8, 1); 
    g.fillRect(bx + 23, by - 6, 2, 30); // highlight
    
    // Fluid Bag (Glowing)
    g.fillStyle(0xbae6fd, 0.8); 
    g.fillRoundedRect(bx + 19, by - 10, 8, 14, 2); 
    g.fillStyle(0x0ea5e9, 0.4); 
    g.fillRect(bx + 20, by - 4, 6, 6); // fluid level
  }

  private drawTree(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
     this.addPropCollision(bx + 10, by + 10, 12, 12);
     
     // Soft organic shadow
     g.fillStyle(0x000000, 0.25); 
     g.fillCircle(bx + 16, by + 20, 14);
     
     // Trunk
     g.fillStyle(0x7c2d12, 1);
     g.fillRect(bx + 14, by + 16, 4, 10);
     
     // Lush layered foliage (Ghibli vibe)
     g.fillStyle(0x064e3b, 1); g.fillCircle(bx + 16, by + 10, 16);
     g.fillStyle(0x059669, 1); g.fillCircle(bx + 16, by + 6, 14);
     g.fillStyle(0x10b981, 1); g.fillCircle(bx + 12, by + 2, 10);
     g.fillStyle(0x34d399, 1); g.fillCircle(bx + 20, by + 4, 8);
  }

  private drawBush(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
     // Soft organic shadow
     g.fillStyle(0x000000, 0.25); g.fillCircle(bx + 16, by + 20, 12);
     // Lush layered foliage
     g.fillStyle(0x064e3b, 1); g.fillCircle(bx + 16, by + 14, 12);
     g.fillStyle(0x059669, 1); g.fillCircle(bx + 14, by + 12, 10);
     g.fillStyle(0x10b981, 1); g.fillCircle(bx + 12, by + 10, 6);
  }

  private drawTrashCan(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx + 8, by + 8, 16, 16);
    // Shadow
    g.fillStyle(0x000000, 0.35); g.fillEllipse(bx + 16, by + 26, 16, 6);
    // Bin body
    g.fillStyle(0x95a5a6, 1);
    g.fillRoundedRect(bx + 10, by + 12, 12, 14, 2);
    // Highlights
    g.fillStyle(0xbdc3c7, 1);
    g.fillRect(bx + 11, by + 13, 10, 1);
    // Lid
    g.fillStyle(0x7f8c8d, 1);
    g.fillRoundedRect(bx + 8, by + 10, 16, 4, 1);
    // Pedal
    g.fillStyle(0x34495e, 1);
    g.fillRect(bx + 14, by + 24, 4, 2);
  }

  private drawBiombo(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by + 10, 32, 12);
    // Shadow
    g.fillStyle(0x000000, 0.35); g.fillRoundedRect(bx + 2, by + 22, 28, 4, 2);
    
    // Frames
    g.fillStyle(0xbdc3c7, 1);
    g.fillRect(bx + 4, by + 6, 2, 18);
    g.fillRect(bx + 15, by + 6, 2, 18);
    g.fillRect(bx + 26, by + 6, 2, 18);
    // Wheels
    g.fillStyle(0x2c3e50, 1);
    g.fillRect(bx + 3, by + 24, 4, 2);
    g.fillRect(bx + 14, by + 24, 4, 2);
    g.fillRect(bx + 25, by + 24, 4, 2);

    // Curtains (soft blue/green)
    g.fillStyle(0xa7f3d0, 0.9);
    g.fillRect(bx + 6, by + 8, 9, 14);
    g.fillRect(bx + 17, by + 8, 9, 14);
    
    // Curtain folds
    g.fillStyle(0x34d399, 0.5);
    g.fillRect(bx + 8, by + 8, 1, 14);
    g.fillRect(bx + 11, by + 8, 1, 14);
    g.fillRect(bx + 19, by + 8, 1, 14);
    g.fillRect(bx + 22, by + 8, 1, 14);

    // Top rail
    g.fillStyle(0x95a5a6, 1);
    g.fillRect(bx + 4, by + 6, 24, 2);
  }

  private drawBench(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
     g.fillStyle(0x000000, 0.35); g.fillRoundedRect(bx + 2, by + 6, 28, 10, 2);
     // Bench frame
     g.fillStyle(0x1e293b, 1); g.fillRect(bx + 2, by - 2, 24, 12);
     // Warm mahogany planks
     g.fillStyle(0x7c2d12, 1); 
     g.fillRoundedRect(bx, by, 28, 4, 1); // armrest
     g.fillRoundedRect(bx, by + 6, 28, 4, 1); // seat
     g.fillRoundedRect(bx, by + 12, 28, 4, 1); // foot rest?
  }

  // ─── NEW SPECIALISED PROPS ──────────────────────────────────────────────────

  private drawVentilator(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 24, 28);
    // Shadow
    g.fillStyle(0x000000, 0.35); g.fillRoundedRect(bx + 2, by + 4, 24, 28, 4);
    
    // Sleek white and dark gray medical chassis
    g.fillStyle(0x94a3b8, 1); g.fillRoundedRect(bx, by, 24, 28, 4);
    g.fillStyle(0xf8fafc, 1); g.fillRoundedRect(bx + 1, by + 1, 22, 26, 3);
    
    // Glossy Screen panel
    g.fillStyle(0x1e293b, 1); g.fillRoundedRect(bx + 3, by + 3, 18, 12, 2);
    g.fillStyle(0x0f172a, 1); g.fillRect(bx + 4, by + 4, 16, 10);
    
    // High tech UI
    g.lineStyle(1, 0x38bdf8, 1);
    g.beginPath(); g.moveTo(bx + 4, by + 8); g.lineTo(bx + 8, by + 8);
    g.lineTo(bx + 9, by + 5); g.lineTo(bx + 10, by + 11); g.lineTo(bx + 11, by + 8);
    g.lineTo(bx + 20, by + 8); g.strokePath();
    // Screen glow
    g.fillStyle(0x38bdf8, 0.15); g.fillRect(bx + 4, by + 4, 16, 10);

    // Glowing dials and readouts
    g.fillStyle(0xfca5a5, 1); g.fillCircle(bx + 8, by + 21, 3); // red alert light
    g.fillStyle(0x38bdf8, 1); g.fillRect(bx + 16, by + 19, 4, 4); // blue readout

    // Tube outlet
    g.fillStyle(0xbdc3c7, 1); g.fillRect(bx + 10, by + 27, 4, 6);
    g.fillStyle(0xecf0f1, 0.8); g.fillRoundedRect(bx + 8, by + 32, 8, 4, 2);
  }

  private drawIVPole(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    // Slim IV pole with bag
    g.fillStyle(0xbdc3c7, 1); g.fillRect(bx + 5, by - 2, 3, 36);
    // Bag
    g.fillStyle(0x000000, 0.2); g.fillRoundedRect(bx + 2, by - 14, 9, 14, 3);
    g.fillStyle(0xd6eaf8, 0.9); g.fillRoundedRect(bx + 1, by - 15, 9, 14, 3);
    g.fillStyle(0xaed6f1, 0.7); g.fillRect(bx + 3, by - 13, 5, 8);
    // Base
    g.fillStyle(0x95a5a6, 1); g.fillRect(bx + 1, by + 33, 11, 3);
    g.fillCircle(bx + 6, by + 36, 4);
  }

  private drawMaternityBed(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx + 2, by + 2, 28, 44);
    // Shadow
    g.fillStyle(0x000000, 0.35); g.fillRoundedRect(bx + 5, by + 5, 26, 42, 4);
    // Frame — soft pink/beige
    g.fillStyle(0xf8c8d0, 1); g.fillRoundedRect(bx + 3, by + 2, 26, 44, 3);
    // Mattress
    g.fillStyle(0xfef9f0, 1); g.fillRoundedRect(bx + 5, by + 5, 22, 38, 2);
    // Blanket — rose pink
    g.fillStyle(0xf48fb1, 0.8); g.fillRoundedRect(bx + 5, by + 20, 22, 23, 2);
    // Pillow
    g.fillStyle(0xffffff, 1); g.fillRoundedRect(bx + 7, by + 7, 18, 10, 3);
    // Patient head
    g.fillStyle(0xf5c5a3, 1); g.beginPath(); g.arc(bx + 16, by + 12, 6, 0, Math.PI * 2); g.fill();
    // Side rail (safety)
    g.lineStyle(2, 0xf8bbd0, 1);
    g.strokeRect(bx + 5, by + 5, 22, 38);
    // IV hook on footboard
    g.fillStyle(0xbdc3c7, 1); g.fillRect(bx + 30, by + 2, 2, 20);
  }

  private drawBassinet(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 20, 22);
    g.fillStyle(0x000000, 0.35); g.fillRoundedRect(bx + 2, by + 2, 20, 22, 5);
    // Base — white with blue trim
    g.fillStyle(0xffffff, 1); g.fillRoundedRect(bx, by, 20, 22, 5);
    g.lineStyle(2, 0x90caf9, 1); g.strokeRoundedRect(bx, by, 20, 22, 5);
    // Mattress
    g.fillStyle(0xe3f2fd, 1); g.fillRoundedRect(bx + 2, by + 2, 16, 18, 3);
    // Baby
    g.fillStyle(0xfce4ec, 1); g.fillRoundedRect(bx + 5, by + 5, 10, 8, 3);
    // Legs
    g.fillStyle(0xbdc3c7, 1); g.fillRect(bx + 3, by + 20, 3, 8);
    g.fillRect(bx + 14, by + 20, 3, 8);
  }

  private drawBreastPumpStation(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 28, 20);
    g.fillStyle(0x000000, 0.2); g.fillRoundedRect(bx + 2, by + 2, 28, 20, 3);
    g.fillStyle(0xecf0f1, 1); g.fillRoundedRect(bx, by, 28, 20, 3);
    // Device box
    g.fillStyle(0xd0e8f5, 1); g.fillRoundedRect(bx + 4, by + 3, 12, 10, 2);
    // Screen
    g.fillStyle(0x2c3e50, 1); g.fillRoundedRect(bx + 5, by + 4, 8, 6, 1);
    g.fillStyle(0x00ccff, 0.5); g.fillRect(bx + 6, by + 5, 6, 4);
    // Tube coil
    g.lineStyle(2, 0xaed6f1, 1);
    g.beginPath(); g.arc(bx + 22, by + 10, 5, 0, Math.PI * 2); g.strokePath();
    // Label
    g.fillStyle(0x7f8c8d, 1); g.fillRect(bx + 4, by + 15, 20, 3);
  }

  private drawCrashCart(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 20, 28);
    g.fillStyle(0x000000, 0.25); g.fillRoundedRect(bx + 2, by + 2, 20, 28, 3);
    g.fillStyle(0xe74c3c, 1); g.fillRoundedRect(bx, by, 20, 28, 3);
    // Drawers
    g.fillStyle(0xc0392b, 1);
    g.fillRect(bx + 2, by + 6, 16, 5);
    g.fillRect(bx + 2, by + 13, 16, 5);
    g.fillRect(bx + 2, by + 20, 16, 5);
    // Drawer handles
    g.fillStyle(0xecf0f1, 1);
    g.fillRect(bx + 8, by + 8, 4, 2);
    g.fillRect(bx + 8, by + 15, 4, 2);
    g.fillRect(bx + 8, by + 22, 4, 2);
    // Top tray
    g.fillStyle(0xbdc3c7, 1); g.fillRect(bx, by, 20, 4);
    // Wheels
    g.fillStyle(0x2c3e50, 1);
    g.fillCircle(bx + 4, by + 28, 3);
    g.fillCircle(bx + 16, by + 28, 3);
    // Lock indicator
    const locked = this.add.sprite(bx + 17, by + 2, 'red_led').setDepth(3).setOrigin(0.5);
    this.tweens.add({ targets: locked, alpha: 0.15, duration: 900, yoyo: true, repeat: -1 });
  }

  private drawShelvingUnit(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 32, 24);
    g.fillStyle(0x000000, 0.2); g.fillRect(bx + 2, by + 2, 32, 24);
    g.fillStyle(0xd5d8dc, 1); g.fillRect(bx, by, 32, 24);
    // Shelf dividers
    g.fillStyle(0xaab7b8, 1);
    g.fillRect(bx, by + 8, 32, 2);
    g.fillRect(bx, by + 16, 32, 2);
    // Items on shelves (coloured blocks = medicine boxes)
    const colors = [0x3498db, 0xe74c3c, 0x2ecc71, 0xf39c12, 0x9b59b6];
    for (let i = 0; i < 5; i++) {
      g.fillStyle(colors[i % colors.length], 0.9); g.fillRect(bx + 2 + i * 6, by + 2, 5, 5);
    }
    for (let i = 0; i < 4; i++) {
      g.fillStyle(colors[(i + 2) % colors.length], 0.85); g.fillRect(bx + 2 + i * 7, by + 10, 6, 5);
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle(colors[(i + 1) % colors.length], 0.9); g.fillRect(bx + 2 + i * 6, by + 18, 5, 5);
    }
  }

  private drawRefrigerator(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 20, 28);
    g.fillStyle(0x000000, 0.2); g.fillRoundedRect(bx + 2, by + 2, 20, 28, 3);
    g.fillStyle(0xecf0f1, 1); g.fillRoundedRect(bx, by, 20, 28, 3);
    // Blue tint = medicine fridge
    g.fillStyle(0xd6eaf8, 0.5); g.fillRect(bx + 2, by + 2, 16, 24);
    // Handle
    g.fillStyle(0xbdc3c7, 1); g.fillRect(bx + 16, by + 8, 3, 8);
    // Temp readout
    g.fillStyle(0x2c3e50, 1); g.fillRoundedRect(bx + 3, by + 18, 12, 6, 1);
    g.fillStyle(0x00ff88, 0.8); g.fillRect(bx + 4, by + 19, 10, 4);
    // Split line
    g.lineStyle(1, 0xbdc3c7, 1); g.strokeRect(bx + 2, by + 13, 16, 1);
  }

  private drawLabBench(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, TILE_SIZE * 3 - 4, 18);
    const w = TILE_SIZE * 3 - 4;
    g.fillStyle(0x000000, 0.15); g.fillRect(bx + 2, by + 2, w, 18);
    g.fillStyle(0xd5e8c8, 1); g.fillRect(bx, by, w, 14); // counter
    g.fillStyle(0xaec6a3, 1); g.fillRect(bx, by + 14, w, 4); // edge
    // Microscope
    g.fillStyle(0x2c3e50, 1); g.fillRect(bx + 6, by + 2, 10, 10);
    g.fillStyle(0x95a5a6, 1); g.fillCircle(bx + 11, by + 6, 3);
    g.fillStyle(0x3498db, 0.6); g.fillCircle(bx + 11, by + 6, 2);
    // Test tube rack
    g.fillStyle(0xecf0f1, 1); g.fillRect(bx + 24, by + 4, 18, 7);
    for (let i = 0; i < 4; i++) {
      const tc = [0xe74c3c, 0xf39c12, 0x3498db, 0x2ecc71][i];
      g.fillStyle(tc, 0.9); g.fillRoundedRect(bx + 26 + i * 4, by + 5, 3, 6, 1);
    }
    // Beaker
    g.fillStyle(0xd6eaf8, 0.7); g.fillRoundedRect(bx + 50, by + 3, 8, 9, 2);
    g.lineStyle(1, 0x85c1e9, 1); g.strokeRoundedRect(bx + 50, by + 3, 8, 9, 2);

    const ledR = this.add.sprite(bx + 20, by + 8, 'red_led').setDepth(3).setOrigin(0.5);
    this.tweens.add({ targets: ledR, alpha: 0.1, duration: 250, yoyo: true, repeat: -1 });
  }

  private drawCentrifuge(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 24, 20);
    g.fillStyle(0x000000, 0.2); g.fillRoundedRect(bx + 2, by + 2, 24, 20, 5);
    g.fillStyle(0xecf0f1, 1); g.fillRoundedRect(bx, by, 24, 20, 5);
    // Lid with circular rotor
    g.fillStyle(0xbdc3c7, 1); g.fillCircle(bx + 12, by + 10, 8);
    g.fillStyle(0x95a5a6, 1); g.fillCircle(bx + 12, by + 10, 5);
    g.fillStyle(0x7f8c8d, 1); g.fillCircle(bx + 12, by + 10, 2);
    // Spokes
    g.lineStyle(1, 0x7f8c8d, 1);
    for (let a = 0; a < 6; a++) {
      const angle = (a / 6) * Math.PI * 2;
      g.beginPath(); g.moveTo(bx + 12, by + 10);
      g.lineTo(bx + 12 + Math.cos(angle) * 5, by + 10 + Math.sin(angle) * 5);
      g.strokePath();
    }
    // Power button
    g.fillStyle(0x2ecc71, 1); g.fillCircle(bx + 20, by + 3, 2);
  }

  private drawBioanalyzer(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 28, 20);
    g.fillStyle(0x000000, 0.2); g.fillRoundedRect(bx + 2, by + 2, 28, 20, 3);
    g.fillStyle(0xd6eaf8, 1); g.fillRoundedRect(bx, by, 28, 20, 3);
    // Screen
    g.fillStyle(0x2c3e50, 1); g.fillRoundedRect(bx + 3, by + 3, 14, 10, 2);
    g.fillStyle(0x1abc9c, 0.6); g.fillRect(bx + 4, by + 4, 12, 8);
    // Bar chart on screen
    g.fillStyle(0x1abc9c, 1);
    g.fillRect(bx + 5, by + 9, 2, 3);
    g.fillRect(bx + 8, by + 7, 2, 5);
    g.fillRect(bx + 11, by + 8, 2, 4);
    g.fillRect(bx + 14, by + 6, 2, 6);
    // Sample slot
    g.fillStyle(0x7f8c8d, 1); g.fillRect(bx + 20, by + 6, 6, 6);
    g.fillStyle(0xe74c3c, 0.7); g.fillRect(bx + 21, by + 7, 4, 4);
  }

  private drawAutoclave(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 30, 28);
    g.fillStyle(0x000000, 0.25); g.fillRoundedRect(bx + 2, by + 2, 30, 28, 5);
    g.fillStyle(0xecf0f1, 1); g.fillRoundedRect(bx, by, 30, 28, 5);
    // Cylindrical door
    g.fillStyle(0xbdc3c7, 1); g.fillCircle(bx + 15, by + 13, 10);
    g.fillStyle(0x7f8c8d, 1); g.fillCircle(bx + 15, by + 13, 7);
    g.fillStyle(0x95a5a6, 1); g.fillCircle(bx + 15, by + 13, 4);
    // Handle
    g.fillStyle(0x34495e, 1); g.fillRect(bx + 25, by + 10, 4, 6);
    // Status panel
    g.fillStyle(0x2c3e50, 1); g.fillRoundedRect(bx + 2, by + 23, 20, 4, 1);
    g.fillStyle(0x2ecc71, 1); g.fillCircle(bx + 5, by + 25, 1);
    g.fillStyle(0xf39c12, 1); g.fillCircle(bx + 10, by + 25, 1);
    // Pressure gauge
    g.fillStyle(0xecf0f1, 1); g.fillCircle(bx + 25, by + 22, 4);
    g.lineStyle(1, 0x7f8c8d, 1); g.strokeCircle(bx + 25, by + 22, 4);
    g.lineStyle(2, 0xe74c3c, 1);
    g.beginPath(); g.moveTo(bx + 25, by + 22); g.lineTo(bx + 27, by + 20); g.strokePath();
  }

  private drawExecutiveDesk(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 48, 28);
    g.fillStyle(0x000000, 0.2); g.fillRect(bx + 2, by + 2, 48, 28);
    g.fillStyle(0x7d4f1e, 1); g.fillRoundedRect(bx, by, 48, 18, 4); // rich mahogany top
    g.fillStyle(0x5d3a13, 1); g.fillRect(bx, by + 18, 48, 4); // edge
    // Monitor
    g.fillStyle(0x2c3e50, 1); g.fillRect(bx + 16, by + 2, 16, 10);
    g.fillStyle(0x3498db, 0.8); g.fillRect(bx + 17, by + 3, 14, 8);
    g.fillStyle(0x2c3e50, 1); g.fillRect(bx + 22, by + 13, 4, 3);
    // Name plate
    g.fillStyle(0xd4ac0d, 1); g.fillRect(bx + 4, by + 7, 10, 3);
    // Pen holder
    g.fillStyle(0x5d3a13, 1); g.fillRect(bx + 38, by + 3, 6, 8);
    g.fillStyle(0x2c3e50, 1); g.fillRect(bx + 40, by + 1, 2, 3);
    g.fillRect(bx + 42, by + 2, 2, 2);
    // Chair
    g.fillStyle(0x2c3e50, 1); g.fillRoundedRect(bx + 12, by + 22, 24, 12, 5);
    g.fillStyle(0x1a252f, 1); g.fillRoundedRect(bx + 14, by + 24, 20, 8, 4);
  }

  private drawReceptionCounter(g: Phaser.GameObjects.Graphics, bx: number, by: number, widthTiles: number) {
    const w = widthTiles * TILE_SIZE;
    this.addPropCollision(bx, by, w, 20);
    g.fillStyle(0x000000, 0.15); g.fillRect(bx + 2, by + 2, w, 20);
    g.fillStyle(0xfdebd0, 1); g.fillRoundedRect(bx, by, w, 15, 4); // warm counter
    g.fillStyle(0xe8c4a0, 1); g.fillRect(bx, by + 15, w, 4);
    // Monitors
    const numMonitors = Math.min(3, Math.floor(widthTiles / 3));
    for (let i = 0; i < numMonitors; i++) {
      const mx = bx + 10 + i * (w / numMonitors);
      g.fillStyle(0x2c3e50, 1); g.fillRect(mx, by + 2, 14, 9);
      g.fillStyle(0x27ae60, 0.7); g.fillRect(mx + 1, by + 3, 12, 7);
    }
    // Bell
    g.fillStyle(0xf39c12, 1); g.fillCircle(bx + w - 14, by + 8, 5);
    g.fillStyle(0xe67e22, 1); g.fillRect(bx + w - 17, by + 12, 6, 2);
  }

  private drawKitchenCounter(g: Phaser.GameObjects.Graphics, bx: number, by: number, widthTiles: number) {
    const w = widthTiles * TILE_SIZE;
    this.addPropCollision(bx, by, w, 16);
    g.fillStyle(0x000000, 0.12); g.fillRect(bx + 2, by + 2, w, 16);
    g.fillStyle(0x717d7e, 1); g.fillRect(bx, by, w, 12);
    g.fillStyle(0x5d6d7e, 1); g.fillRect(bx, by + 12, w, 4);
    // Sink
    g.fillStyle(0x85c1e9, 0.5); g.fillRoundedRect(bx + 4, by + 2, 14, 8, 2);
    g.lineStyle(1, 0x7fb3d3, 1); g.strokeRoundedRect(bx + 4, by + 2, 14, 8, 2);
    g.fillStyle(0xbdc3c7, 1); g.fillRect(bx + 10, by + 1, 2, 3); // faucet
    // Microwave
    if (w > 48) {
      g.fillStyle(0x2c3e50, 1); g.fillRoundedRect(bx + 24, by + 2, 18, 8, 2);
      g.fillStyle(0x34495e, 1); g.fillRoundedRect(bx + 25, by + 3, 12, 6, 1);
      g.fillStyle(0x1abc9c, 0.5); g.fillRect(bx + 26, by + 4, 10, 4);
    }
  }

  private drawIncubator(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx + 4, by + 4, 24, 24);
    // Shadow
    g.fillStyle(0x000000, 0.4); g.fillRoundedRect(bx + 6, by + 26, 20, 6, 2);
    // Stand
    g.fillStyle(0xbdc3c7, 1);
    g.fillRect(bx + 10, by + 20, 4, 8);
    g.fillRect(bx + 18, by + 20, 4, 8);
    // Wheels
    g.fillStyle(0x2c3e50, 1);
    g.fillCircle(bx + 12, by + 28, 3);
    g.fillCircle(bx + 20, by + 28, 3);
    // Base unit
    g.fillStyle(0xecf0f1, 1);
    g.fillRoundedRect(bx + 4, by + 12, 24, 10, 2);
    // Monitor screen
    g.fillStyle(0x0f172a, 1);
    g.fillRect(bx + 6, by + 14, 6, 4);
    
    const ledG = this.add.sprite(bx + 8, by + 16, 'green_led').setDepth(3).setOrigin(0.5);
    this.tweens.add({ targets: ledG, alpha: 0.2, duration: 500, yoyo: true, repeat: -1 });
    
    // Glass dome
    g.fillStyle(0x38bdf8, 0.25);
    g.fillRoundedRect(bx + 4, by + 2, 24, 10, 4);
    // Highlights
    g.fillStyle(0xffffff, 0.5);
    g.fillRect(bx + 6, by + 4, 4, 2);
    // Baby inside
    g.fillStyle(0xfcd34d, 1);
    g.fillCircle(bx + 16, by + 8, 3.5); // head
    g.fillStyle(0xffe4e6, 1);
    g.fillRect(bx + 10, by + 7, 6, 4); // blanket
  }

  private drawXRayViewer(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 32, 24);
    g.fillStyle(0x000000, 0.2); g.fillRoundedRect(bx + 2, by + 2, 32, 24, 3);
    g.fillStyle(0x1a252f, 1); g.fillRoundedRect(bx, by, 32, 24, 3);
    // Light box
    g.fillStyle(0xe8f8ff, 0.85); g.fillRoundedRect(bx + 2, by + 2, 28, 18, 2);
    // X-ray silhouette
    g.fillStyle(0xaed6f1, 0.4); g.fillRoundedRect(bx + 8, by + 4, 16, 14, 2);
    // Ribcage lines
    g.lineStyle(1, 0x2c3e50, 0.5);
    for (let i = 0; i < 4; i++) {
      g.beginPath(); g.moveTo(bx + 10, by + 5 + i * 3); g.lineTo(bx + 22, by + 5 + i * 3); g.strokePath();
    }
    // Controls
    g.fillStyle(0x34495e, 1); g.fillRect(bx + 2, by + 20, 28, 3);
    g.fillStyle(0x3498db, 0.8); g.fillCircle(bx + 6, by + 21, 2);
    g.fillStyle(0xf39c12, 0.8); g.fillCircle(bx + 12, by + 21, 2);
  }

  private drawParallelBars(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 48, 32);
    // Two rails
    g.fillStyle(0x7f8c8d, 1);
    g.fillRoundedRect(bx, by + 12, 48, 4, 2);
    g.fillRoundedRect(bx, by + 24, 48, 4, 2);
    // Vertical posts
    g.fillStyle(0x95a5a6, 1);
    g.fillRect(bx + 2, by + 12, 4, 16);
    g.fillRect(bx + 20, by + 12, 4, 16);
    g.fillRect(bx + 42, by + 12, 4, 16);
    // Floor mats
    g.fillStyle(0x27ae60, 0.6); g.fillRoundedRect(bx + 4, by + 28, 40, 6, 2);
    // Height labels
    g.fillStyle(0xaab7b8, 1); g.fillRect(bx, by + 6, 4, 6);
    g.fillStyle(0xaab7b8, 1); g.fillRect(bx, by + 28, 4, 6);
  }

  private drawExerciseMat(g: Phaser.GameObjects.Graphics, bx: number, by: number) {
    this.addPropCollision(bx, by, 40, 24);
    g.fillStyle(0x000000, 0.15); g.fillRoundedRect(bx + 2, by + 2, 40, 24, 4);
    g.fillStyle(0x27ae60, 0.85); g.fillRoundedRect(bx, by, 40, 24, 4);
    // Stripes
    g.lineStyle(2, 0x1e8449, 0.6);
    for (let i = 4; i < 40; i += 8) {
      g.beginPath(); g.moveTo(bx + i, by); g.lineTo(bx + i, by + 24); g.strokePath();
    }
    // Center cross
    g.lineStyle(2, 0x1abc9c, 0.4);
    g.beginPath(); g.moveTo(bx + 20, by); g.lineTo(bx + 20, by + 24); g.strokePath();
    g.beginPath(); g.moveTo(bx, by + 12); g.lineTo(bx + 40, by + 12); g.strokePath();
  }

  // ─── LIGHTING OVERLAY ──────────────────────────────────────────────────────
  // Lighting overlay
  private buildLighting() {
    const w = this.scale.width;
    const h = this.scale.height;
    
    // Create the dark screen overlay
    this.darkOverlay = this.add.renderTexture(0, 0, w, h);
    this.darkOverlay.setOrigin(0, 0);
    this.darkOverlay.setDepth(90).setScrollFactor(0); // Fixed to camera

    // Create a brush for erasing
    this.glowBrush = this.make.sprite({ key: 'light_glow', add: false });
    this.glowBrush.setOrigin(0.5, 0.5);

    // Create the additive group for colored ambient lights
    this.additiveLightGroup = this.add.group();
  }

  // ─── ROOM LABELS ─────────────────────────────────────────────────────────
  private buildRoomLabels() {
    const labels: { col: number; row: number; text: string }[] = [
      { col: 6, row: 3,   text: 'RECEPÇÃO E TRIAGEM' },
      { col: 18, row: 3,  text: 'PRONTO-SOCORRO' },
      { col: 31, row: 3,  text: 'FARMÁCIA' },
      { col: 43, row: 3,  text: 'LABORATÓRIO' },
      { col: 56, row: 3,  text: 'IMAGEM' },
      { col: 68, row: 3,  text: 'DIRETORIA' },
      { col: 6, row: 18,  text: 'CME' },
      { col: 17, row: 18, text: 'COPA E NUTRIÇÃO' },
      { col: 30, row: 18, text: 'ENFERMARIA' },
      { col: 45, row: 18, text: 'UTI ADULTO' },
      { col: 63, row: 18, text: 'POSTO DE ENFERMAGEM' },
      { col: 7, row: 32,  text: 'AMBULATÓRIO' },
      { col: 20, row: 32, text: 'MATERNIDADE' },
      { col: 34, row: 32, text: 'ONCOLOGIA' },
      { col: 49, row: 32, text: 'REABILITAÇÃO' },
      { col: 65, row: 32, text: 'SAÚDE MENTAL' },
    ];

    for (const lbl of labels) {
      const x = (lbl.col + 0.5) * TILE_SIZE;
      const y = lbl.row * TILE_SIZE;
      
      this.add.text(x, y + 16, lbl.text, {
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#94a3b8',
        stroke: '#f8fafc',
        strokeThickness: 3,
      }).setOrigin(0.5, 0.5).setDepth(0.6).setAlpha(0.6);
    }
  }

  // ─── SPAWN ────────────────────────────────────────────────────────────────
  private spawnPlayer() {
    const startX = (7 + 0.5) * TILE_SIZE;
    const startY = (14 + 0.5) * TILE_SIZE;
    this.player = new Player(this, startX, startY);
    if (this.wallLayer) this.physics.add.collider(this.player, this.wallLayer);
    if (this.propColliders) this.physics.add.collider(this.player, this.propColliders);
  }

  private spawnNPCs() {
    for (const def of NPC_DEFS) {
      const npc = new NPC(this, def);
      if (this.wallLayer) this.physics.add.collider(npc, this.wallLayer);
      if (this.propColliders && def.role !== 'patient') this.physics.add.collider(npc, this.propColliders);
      if (def.role === 'patient') {
        npc.setVisible(false); // Rendered in the bed graphic instead
      }
      npc.updateMissionStatus(this.state);
      this.npcs.push(npc);
    }
  }

  // ─── INPUT ────────────────────────────────────────────────────────────────
  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up:    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.mKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    this.escKey.on('down', () => this.pauseGame());
  }

  public pauseGame() {
    if (this.isDialogOpen || this.isCrisisOpen) return;
    saveGame(this.state);
    
    // Navigate to Pause Menu via React and pause the scenes
    if ((window as any).reactNavigate) {
       (window as any).reactNavigate('/pause');
       this.scene.pause('HUDScene');
       this.scene.pause('GameScene');
    }
  }

  // ─── CAMERA ───────────────────────────────────────────────────────────────
  private setupCamera() {
    // lerpX/Y=1 snaps camera to player each frame — correct for pixel-art and
    // avoids sub-pixel interpolation math on every update.
    this.cameras.main
      .startFollow(this.player, true, 1, 1)
      .setZoom(CAMERA_ZOOM)
      .setBounds(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE)
      .setRoundPixels(true);
  }

  // ─── CRISIS SYSTEM ────────────────────────────────────────────────────────
  private scheduleCrisis() {
    // Next crisis in 60-120 game minutes (= 20-40 real seconds at 3 min/sec)
    this.nextCrisisTime = this.state.gameTime + Phaser.Math.Between(60, 120);
  }

  private triggerCrisis() {
    if (this.isCrisisOpen || this.isDialogOpen) {
      this.scheduleCrisis(); return;
    }

    const available = CRISIS_EVENTS.filter(e => {
      const lvl = getLevelInfo(this.state.prestige).level;
      return e.minCareerLevel <= lvl;
    });
    if (available.length === 0) { this.scheduleCrisis(); return; }

    const event = available[Phaser.Math.Between(0, available.length - 1)];
    
    this.isCrisisOpen = true;
    this.lastActivity = `Respondendo a uma crise: ${event.title}`;
    const hud = this.scene.get('HUDScene') as any;
    if (hud) {
      hud.showCrisisOverlay(event, (choiceIdx: number) => {
        this.resolveCrisis(event, choiceIdx);
      });
    }

    this.state.crisisCount = (this.state.crisisCount || 0) + 1;
    this.scheduleCrisis();
  }

  public resolveCrisis(event: CrisisEvent, choiceIdx: number) {
    if (!this.isCrisisOpen) return;
    this.isCrisisOpen = false;

    const choice = event.choices[choiceIdx];

    // Apply effects
    this.state.prestige = Math.max(0, this.state.prestige + choice.prestigeEffect);
    this.state.energy = Math.max(0, Math.min(100, this.state.energy + choice.energyEffect));
    this.state.stress = Math.max(0, Math.min(100, (this.state.stress || 0) + choice.stressEffect));
    this.state.decisionLog = [...(this.state.decisionLog || []), `${event.id}:${choiceIdx}`].slice(-20);

    const hud = this.scene.get('HUDScene') as any;
    if (hud) {
       hud.showCrisisFeedback(choice.feedback, choice.correct, choice.prestigeEffect);
    }

    // Show prestige change
    const colorStr = choice.prestigeEffect >= 0 ? '#2ecc71' : '#e74c3c';
    this.showFloatingText(this.player.x, this.player.y - 40, `${choice.prestigeEffect >= 0 ? '+' : ''}${choice.prestigeEffect} pts`, colorStr, 28);
    this.emitHudUpdate();
  }


  private getVPad() {
    const hud = this.scene.get('HUDScene') as any;
    const h = hud?.virtualPad ?? {};
    const w = (window as any).virtualPad ?? {};
    const pad = {
      up:                 !!(h.up   || w.up),
      down:               !!(h.down || w.down),
      left:               !!(h.left || w.left),
      right:              !!(h.right || w.right),
      sprint:             !!(h.sprint || w.sprint),
      actionJustPressed:  !!(h.actionJustPressed  || w.actionJustPressed),
      missionJustPressed: !!(h.missionJustPressed || w.missionJustPressed),
      menuJustPressed:    !!(h.menuJustPressed    || w.menuJustPressed),
    };
    // Proxy: writing "false" on a JustPressed key also clears the original sources
    const clearJust = (key: 'actionJustPressed' | 'missionJustPressed' | 'menuJustPressed') => {
      if (h[key]) h[key] = false;
      if ((window as any).virtualPad?.[key]) (window as any).virtualPad[key] = false;
    };
    return new Proxy(pad, {
      set(target, prop, value) {
        (target as any)[prop] = value;
        if (value === false && (prop === 'actionJustPressed' || prop === 'missionJustPressed' || prop === 'menuJustPressed')) {
          clearJust(prop as any);
        }
        return true;
      }
    });
  }

  // ─── UPDATE ───────────────────────────────────────────────────────────────
  update(time: number, rawDelta: number) {
    // Cap delta to 40ms (25fps minimum) to prevent startup stutter / speed ramp
    const delta = Math.min(rawDelta, 40);
    const vpad = this.getVPad();

    // Check menu key early (even if dialog/crisis is open, though pause usually blocks this, let's keep it safe)
    if (Phaser.Input.Keyboard.JustDown(this.escKey) || vpad.menuJustPressed) {
      if (vpad.menuJustPressed) vpad.menuJustPressed = false;
      this.pauseGame();
    }

    if (this.isDialogOpen || this.isCrisisOpen) {
       // Stop player movement completely while dialog/crisis is open
       this.player.move(false, false, false, false, delta);
       if (vpad.actionJustPressed) vpad.actionJustPressed = false;
       return;
    }

    // Movement
    const up    = this.cursors.up.isDown    || this.wasd.up.isDown || vpad.up;
    const down  = this.cursors.down.isDown  || this.wasd.down.isDown || vpad.down;
    const left  = this.cursors.left.isDown  || this.wasd.left.isDown || vpad.left;
    const right = this.cursors.right.isDown || this.wasd.right.isDown || vpad.right;
    const sprint = (this.shiftKey.isDown || vpad.sprint) && this.state.energy > 10;
    this.player.move(up, down, left, right, delta, sprint);

    // NPC AI update
    for (const npc of this.npcs) npc.update(delta);

    // Detect nearby NPC
    this.detectNearbyNPC();

    // Interaction
    if ((Phaser.Input.Keyboard.JustDown(this.eKey) || vpad.actionJustPressed) && this.nearbyNPC) {
      if (vpad.actionJustPressed) vpad.actionJustPressed = false;
      this.openDialog(this.nearbyNPC);
    } else {
       if (vpad.actionJustPressed) vpad.actionJustPressed = false;
    }

    // Mission overlay toggle
    if (Phaser.Input.Keyboard.JustDown(this.mKey) || vpad.missionJustPressed) {
      if (vpad.missionJustPressed) vpad.missionJustPressed = false;
      this.toggleMissionOverlay();
    }

    // Game time advance
    this.timeAccum += delta;
    if (this.timeAccum >= 1000) {
      this.timeAccum -= 1000;
      this.state.gameTime += GAME_MINUTES_PER_SECOND;
      if (this.state.gameTime >= 1440) {
        this.state.gameTime -= 1440;
        this.state.day = (this.state.day || 1) + 1;
      }
    }

    // Crisis timer
    this.crisisTimer += delta;
    if (this.crisisTimer >= 1000) {
      this.crisisTimer -= 1000;
      if (this.state.gameTime >= this.nextCrisisTime) {
        this.triggerCrisis();
      }
    }

    // Energy depletion (every 6s = 1 point; sprint costs more)
    this.energyTimer += delta;
    const energyDrain = sprint ? 3000 : 7000;
    if (this.energyTimer >= energyDrain && this.state.energy > 0) {
      this.energyTimer = 0;
      this.state.energy = Math.max(0, this.state.energy - 1);
    }

    // Room detection
    const col = Math.floor(this.player.x / TILE_SIZE);
    const row = Math.floor(this.player.y / TILE_SIZE);
    const tileId = (row >= 0 && row < MAP_ROWS && col >= 0 && col < MAP_COLS)
      ? this.mapData[row][col] : TILE_ID.CORRIDOR;

    // Break room: restore energy and reduce stress
    if (tileId === TILE_ID.BREAK) {
      this.energyRestoreTimer += delta;
      if (this.energyRestoreTimer >= 1500 && this.state.energy < 100) {
        this.energyRestoreTimer = 0;
        this.state.energy = Math.min(100, this.state.energy + 6);
        this.showFloatingText(this.player.x, this.player.y - 30, '+6 NRG', '#f1c40f');
      }
      // Also reduce stress
      this.stressDecayTimer += delta;
      if (this.stressDecayTimer >= 3000 && this.state.stress > 0) {
        this.stressDecayTimer = 0;
        this.state.stress = Math.max(0, this.state.stress - 3);
      }
    } else {
      this.energyRestoreTimer = 0;
      this.stressDecayTimer = 0;
    }

    // Garden: gentle stress reduction
    if (tileId === TILE_ID.GARDEN) {
      this.stressDecayTimer += delta;
      if (this.stressDecayTimer >= 5000 && this.state.stress > 0) {
        this.stressDecayTimer = 0;
        this.state.stress = Math.max(0, this.state.stress - 1);
      }
    }

    // Room change event
    if (tileId !== this.currentRoom) {
      this.currentRoom = tileId;
      const roomName = ROOM_NAMES[tileId] || '';
      if (roomName) {
        this.events.emit(EV.ROOM_CHANGE, roomName);
        this.lastActivity = `Entrou em ${roomName}`;
      }
    }

    // HUD update (throttled)
    if (time - this.lastHudEmit > 300) {
      this.lastHudEmit = time;
      this.emitHudUpdate();
    }
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  private detectNearbyNPC() {
    let closest: NPC | null = null, minDist = INTERACTION_DISTANCE;
    for (const npc of this.npcs) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, npc.x, npc.y);
      if (d < minDist) { minDist = d; closest = npc; }
    }
    if (closest !== this.nearbyNPC) {
      this.nearbyNPC = closest;
      if (closest) {
        this.events.emit(EV.INTERACTION_HINT, `[E] Falar com ${closest.def.name}`);
      } else {
        this.events.emit(EV.INTERACTION_HINT, 'WASD/Setas: Mover  |  SHIFT: Correr  |  E: Interagir  |  M: Missões  |  ESC: Menu');
      }
    }
  }

  private async broadcastState() {
    const room = (window as any).sessionRoom as { code: string; playerId: string } | undefined;
    if (!room?.code || !room?.playerId) return;
    const levelInfo = getLevelInfo(this.state.prestige);
    const roomName = ROOM_NAMES[this.currentRoom] || 'Corredor';
    try {
      await fetch(`/api/rooms/${encodeURIComponent(room.code)}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: room.playerId,
          currentRoom: roomName,
          prestige: this.state.prestige,
          energy: Math.round(this.state.energy),
          stress: Math.round(this.state.stress || 0),
          level: levelInfo.title ?? `Nível ${levelInfo.level}`,
          completedMissions: this.state.completedMissions.length,
          lastActivity: this.lastActivity,
          shiftTime: Math.floor(this.state.gameTime / 60),
        }),
      });
    } catch { /* silent — never interrupt gameplay */ }
  }

  private openDialog(npc: NPC) {
    this.isDialogOpen = true;
    this.lastActivity = `Falando com ${npc.def.name}`;
    const dialogue = npc.getDialogue(this.state);
    const prevProgress = { ...this.state.missionProgress };
    const prevCompleted = [...this.state.completedMissions];

    this.scene.launch(SCENES.DIALOG, {
      npcDef: npc.def,
      dialogue,
      state: this.state,
      onClose: (updates: Partial<GameState>) => {
        this.state = { ...this.state, ...updates };
        this.isDialogOpen = false;
        for (const n of this.npcs) n.updateMissionStatus(this.state);
        saveGame(this.state);
        this.emitHudUpdate();
        this.events.emit(EV.INTERACTION_HINT, '');
        this.checkMilestones();

        // Surface mission acceptance/completion right in the world so it never feels silent
        for (const id of npc.def.missionIds) {
          const wasInProgress = !!prevProgress[id];
          const isInProgress = !!this.state.missionProgress[id];
          const wasCompleted = prevCompleted.includes(id);
          const isCompleted = this.state.completedMissions.includes(id);
          const mission = MISSIONS.find(m => m.id === id);
          if (!mission) continue;
          if (!wasInProgress && isInProgress && !isCompleted) {
            this.showFloatingText(this.player.x, this.player.y - 60, `[+] Nova missao: ${mission.title}`, '#1abc9c', 18);
          } else if (!wasCompleted && isCompleted) {
            this.showFloatingText(this.player.x, this.player.y - 60, `[OK] Concluida: ${mission.title}`, '#2ecc71', 18);
          }
        }
      },
    });
  }

  private checkMilestones() {
    if (this.state.completedMissions.length === MISSIONS.length) {
      this.showFloatingText(this.player.x, this.player.y - 60, '[PARABENS] TODAS AS MISSOES CONCLUIDAS!', '#f1c40f', 24);
    }
  }

  private toggleMissionOverlay() {
    const hud = this.scene.get('HUDScene') as any;
    if (hud) {
      hud.toggleMissionOverlay(this.state);
    }
  }

  private emitHudUpdate() {
    const activeMission = MISSIONS.find(m =>
      this.state.missionProgress[m.id] && !this.state.completedMissions.includes(m.id)
    );
    this.events.emit(EVENTS.HUD_UPDATE, {
      state: this.state,
      playerX: this.player.x,
      playerY: this.player.y,
      activeMission: activeMission?.title,
    });
  }

  private showFloatingText(x: number, y: number, msg: string, color: string, size = 22) {
    const txt = this.add.text(x, y, msg, {
      fontFamily: "'VT323', monospace",
      fontSize: `${size}px`,
      color,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({
      targets: txt, y: y - 50, alpha: 0, duration: 1800,
      ease: 'Power2', onComplete: () => txt.destroy(),
    });
  }
}

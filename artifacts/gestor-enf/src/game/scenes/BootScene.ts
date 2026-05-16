import * as Phaser from 'phaser';
import { TILE_SIZE, SCENES } from '../constants';
import { createTilesetTexture, NPC_DEFS } from '../data/gameData';

const SPR_W = 44;
const SPR_H = 128;
const FRAMES = 24; // 6 frames × 4 directions (down, up, right, left)

// Size at which the sprite is drawn inside the 44×128 canvas.
// groundY=72 → DRAW_H must be ≥72 so feet from the sheet align with the physics body (offset 65).
const DRAW_W = 40;  // visual width (centered in 44px canvas → 2px padding each side)
const DRAW_H = 76;  // visual height — feet of source image land at ≈y=76, physics body offset=65
const DRAW_X_OFF = Math.round((SPR_W - DRAW_W) / 2); // horizontal centering offset

// New sprite sheet pixel coordinates (measured from 1704×923 source image)
const FRAME_COLS = [
  { x1: 168, x2: 233 },
  { x1: 276, x2: 344 },
  { x1: 386, x2: 457 },
  { x1: 498, x2: 567 },
  { x1: 611, x2: 678 },
  { x1: 719, x2: 787 },
];
const CHAR_ROWS = {
  female: {
    front: [14, 160] as [number, number],
    side:  [173, 307] as [number, number],
    back:  [321, 457] as [number, number],
  },
  male: {
    front: [496, 628] as [number, number],
    side:  [645, 770] as [number, number],
    back:  [784, 908] as [number, number],
  },
};

function rrFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w < 1 || h < 1) return;
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}

function rrStroke(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w < 1 || h < 1) return;
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.stroke();
}

function darken(hex: string, amount = 0.2): string {
  let r: number, g: number, b: number;
  if (hex.startsWith('rgb')) {
    const m = hex.match(/\d+/g)!;
    r = +m[0]; g = +m[1]; b = +m[2];
  } else {
    const n = parseInt(hex.replace('#', ''), 16);
    r = (n >> 16) & 0xff; g = (n >> 8) & 0xff; b = n & 0xff;
  }
  r = Math.max(0, Math.min(255, r * (1 - amount))) | 0;
  g = Math.max(0, Math.min(255, g * (1 - amount))) | 0;
  b = Math.max(0, Math.min(255, b * (1 - amount))) | 0;
  return `rgb(${r},${g},${b})`;
}

// ── CHARACTER VISUAL PROFILES ─────────────────────────────────────────────────
interface CharVisual {
  gender: 'male' | 'female';
  hairStyle: string;
  build: 'slim' | 'medium' | 'stocky';
  groundYOff: number;
  age: 'young' | 'adult' | 'senior';
  accessory: 'none' | 'glasses' | 'surgical_cap' | 'mask';
  nurseCap: boolean;
}

const DEFAULT_VISUAL: CharVisual = {
  gender: 'male', hairStyle: 'short_neat', build: 'medium', groundYOff: 0,
  age: 'adult', accessory: 'none', nurseCap: false,
};

const CHAR_VISUALS: Record<string, CharVisual> = {
  player:        { gender: 'female', hairStyle: 'bun',              build: 'medium', groundYOff:  0, age: 'adult',  accessory: 'none',         nurseCap: true  },
  npc_ana:       { gender: 'female', hairStyle: 'bob',              build: 'medium', groundYOff:  3, age: 'adult',  accessory: 'none',         nurseCap: false },
  npc_carlos:    { gender: 'male',   hairStyle: 'low_fade',         build: 'medium', groundYOff: -2, age: 'adult',  accessory: 'none',         nurseCap: false },
  npc_joao:      { gender: 'male',   hairStyle: 'curly_top',        build: 'slim',   groundYOff:  0, age: 'young',  accessory: 'glasses',      nurseCap: false },
  npc_renata:    { gender: 'female', hairStyle: 'ponytail',         build: 'medium', groundYOff:  0, age: 'adult',  accessory: 'none',         nurseCap: false },
  npc_farias:    { gender: 'male',   hairStyle: 'receding',         build: 'stocky', groundYOff: -4, age: 'senior', accessory: 'none',         nurseCap: false },
  npc_diretora:  { gender: 'female', hairStyle: 'updo',             build: 'medium', groundYOff:  0, age: 'senior', accessory: 'glasses',      nurseCap: false },
  npc_rosa:      { gender: 'female', hairStyle: 'afro_short',       build: 'stocky', groundYOff:  4, age: 'adult',  accessory: 'surgical_cap', nurseCap: false },
  npc_clara:     { gender: 'female', hairStyle: 'loose_long',       build: 'slim',   groundYOff:  0, age: 'young',  accessory: 'none',         nurseCap: false },
  npc_maria:     { gender: 'female', hairStyle: 'high_pony',        build: 'medium', groundYOff:  2, age: 'adult',  accessory: 'none',         nurseCap: false },
  npc_dr:        { gender: 'male',   hairStyle: 'business',         build: 'medium', groundYOff: -4, age: 'adult',  accessory: 'none',         nurseCap: false },
  npc_santos:    { gender: 'female', hairStyle: 'long_tied',        build: 'slim',   groundYOff: -2, age: 'adult',  accessory: 'none',         nurseCap: false },
  npc_pedro:     { gender: 'male',   hairStyle: 'short_wavy',       build: 'slim',   groundYOff:  0, age: 'young',  accessory: 'none',         nurseCap: false },
  npc_patient_1: { gender: 'male',   hairStyle: 'bald',             build: 'stocky', groundYOff:  2, age: 'senior', accessory: 'none',         nurseCap: false },
  npc_patient_2: { gender: 'female', hairStyle: 'short_curly_gray', build: 'stocky', groundYOff:  3, age: 'senior', accessory: 'none',         nurseCap: false },
  npc_patient_3: { gender: 'male',   hairStyle: 'short_neat',       build: 'medium', groundYOff:  0, age: 'adult',  accessory: 'none',         nurseCap: false },
  
  // Generic visuals for diverse NPCs
  npc_doctor_m:  { gender: 'male',   hairStyle: 'business',         build: 'medium', groundYOff: -4, age: 'adult',  accessory: 'none',         nurseCap: false },
  npc_doctor_f:  { gender: 'female', hairStyle: 'bun',              build: 'slim',   groundYOff: -2, age: 'adult',  accessory: 'none',         nurseCap: false },
  npc_nurse_m:   { gender: 'male',   hairStyle: 'short_wavy',       build: 'medium', groundYOff:  0, age: 'adult',  accessory: 'none',         nurseCap: false },
  npc_nurse_f:   { gender: 'female', hairStyle: 'ponytail',         build: 'medium', groundYOff:  2, age: 'young',  accessory: 'none',         nurseCap: false },
  npc_tech_m:    { gender: 'male',   hairStyle: 'curly_top',        build: 'medium', groundYOff: -2, age: 'adult',  accessory: 'none',         nurseCap: false },
  npc_tech_f:    { gender: 'female', hairStyle: 'bob',              build: 'slim',   groundYOff:  2, age: 'adult',  accessory: 'none',         nurseCap: false },
  npc_guard:     { gender: 'male',   hairStyle: 'low_fade',         build: 'stocky', groundYOff:  0, age: 'adult',  accessory: 'none',         nurseCap: false },
  npc_cleaner:   { gender: 'female', hairStyle: 'updo',             build: 'stocky', groundYOff:  4, age: 'adult',  accessory: 'mask',         nurseCap: false },
  npc_pat_gest:  { gender: 'female', hairStyle: 'loose_long',       build: 'stocky', groundYOff:  4, age: 'young',  accessory: 'none',         nurseCap: false },
  npc_pat_boy:   { gender: 'male',   hairStyle: 'afro_short',       build: 'slim',   groundYOff:  0, age: 'young',  accessory: 'none',         nurseCap: false },
  npc_pat_girl:  { gender: 'female', hairStyle: 'long_tied',        build: 'slim',   groundYOff:  0, age: 'young',  accessory: 'none',         nurseCap: false },
  npc_pat_old_m: { gender: 'male',   hairStyle: 'receding',         build: 'stocky', groundYOff:  2, age: 'senior', accessory: 'none',         nurseCap: false },
};

export class BootScene extends Phaser.Scene {
  constructor() { super({ key: SCENES.BOOT }); }

  preload() {
    const W = this.scale.width, H = this.scale.height;
    const barBg = this.add.graphics();
    barBg.fillStyle(0x2c3e50, 1);
    barBg.fillRoundedRect(W / 2 - 250, H / 2 - 15, 500, 30, 8);
    const barFill = this.add.graphics();
    const loadLabel = this.add.text(W / 2, H / 2 - 40, 'CARREGANDO HUAP...', {
      fontFamily: 'monospace', fontSize: '14px', color: '#1abc9c',
    }).setOrigin(0.5);
    this.load.on('progress', (v: number) => {
      barFill.clear();
      barFill.fillStyle(0x1abc9c, 1);
      barFill.fillRoundedRect(W / 2 - 248, H / 2 - 13, 496 * v, 26, 6);
    });
    void loadLabel;

    const base = (import.meta as any).env?.BASE_URL || '/';
  }

  create() {
    createTilesetTexture(this);
    // Always use procedural sprite system for full visual diversity.
    // The sprite-sheet approach only has 2 designs (male/female) — all NPCs looked identical.
    this.createPlayerSprite();
    this.createNPCSprites();
    this.createPortraits();
    this.createPixelTexture();
    this.createLightTextures();
    this.createPixelizedHuap();
    this.scene.start(SCENES.MENU);
  }

  private createPixelizedHuap() {
    const TARGET_W = 1280, TARGET_H = 720;
    const PIX_W = 320, PIX_H = 180; // Pixel art resolution

    const small = document.createElement('canvas');
    small.width = PIX_W; small.height = PIX_H;
    const sctx = small.getContext('2d')!;
    sctx.imageSmoothingEnabled = false;

    // Draw sky
    const skyGrad = sctx.createLinearGradient(0, 0, 0, PIX_H);
    skyGrad.addColorStop(0, '#0ea5e9');
    skyGrad.addColorStop(1, '#bae6fd');
    sctx.fillStyle = skyGrad;
    sctx.fillRect(0, 0, PIX_W, PIX_H);

    // Draw clouds
    sctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    sctx.beginPath(); sctx.arc(40, 40, 15, 0, Math.PI * 2); sctx.arc(60, 40, 20, 0, Math.PI * 2); sctx.arc(80, 40, 15, 0, Math.PI * 2); sctx.fill();
    sctx.beginPath(); sctx.arc(240, 30, 10, 0, Math.PI * 2); sctx.arc(260, 30, 15, 0, Math.PI * 2); sctx.arc(280, 30, 10, 0, Math.PI * 2); sctx.fill();

    // Draw Hospital Building Background Block
    sctx.fillStyle = '#64748b'; // Back building
    sctx.fillRect(60, 50, 200, 130);
    
    // Draw Hospital Building Main Block
    sctx.fillStyle = '#f8fafc';
    sctx.fillRect(80, 60, 160, 120);
    sctx.fillStyle = '#e2e8f0';
    sctx.fillRect(80, 60, 160, 5); // roof edge
    
    // Hospital windows
    sctx.fillStyle = '#38bdf8';
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 6; col++) {
        if (col === 2 && row === 3) continue; // Door space
        if (col === 3 && row === 3) continue; // Door space
        sctx.fillRect(95 + col * 22, 75 + row * 20, 15, 12);
        // Window glow/reflection
        sctx.fillStyle = '#7dd3fc';
        sctx.fillRect(95 + col * 22, 75 + row * 20, 5, 12);
        sctx.fillStyle = '#38bdf8';
      }
    }

    // Red Cross Logo
    sctx.fillStyle = '#ef4444';
    sctx.fillRect(155, 45, 10, 30);
    sctx.fillRect(145, 55, 30, 10);

    // Entrance
    sctx.fillStyle = '#334155';
    sctx.fillRect(139, 135, 42, 45); // surround
    sctx.fillStyle = '#0f172a';
    sctx.fillRect(142, 140, 16, 40); // left door
    sctx.fillRect(162, 140, 16, 40); // right door
    sctx.fillStyle = '#38bdf8';
    sctx.fillRect(144, 142, 12, 20); // left glass
    sctx.fillRect(164, 142, 12, 20); // right glass

    // Ground / Path
    sctx.fillStyle = '#94a3b8';
    sctx.fillRect(0, 170, PIX_W, 10); // road
    sctx.fillStyle = '#cbd5e1';
    sctx.fillRect(130, 170, 60, 10); // walkway

    // Trees
    sctx.fillStyle = '#064e3b';
    sctx.beginPath(); sctx.arc(50, 150, 20, 0, Math.PI * 2); sctx.fill();
    sctx.beginPath(); sctx.arc(270, 150, 25, 0, Math.PI * 2); sctx.fill();
    sctx.fillStyle = '#10b981';
    sctx.beginPath(); sctx.arc(45, 145, 15, 0, Math.PI * 2); sctx.fill();
    sctx.beginPath(); sctx.arc(265, 145, 18, 0, Math.PI * 2); sctx.fill();
    // Tree trunks
    sctx.fillStyle = '#78350f';
    sctx.fillRect(47, 160, 6, 20);
    sctx.fillRect(267, 165, 6, 15);

    if (this.textures.exists('huap_pixel')) this.textures.remove('huap_pixel');
    const big = this.textures.createCanvas('huap_pixel', TARGET_W, TARGET_H) as Phaser.Textures.CanvasTexture;
    const ctx = big.getContext();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, TARGET_W, TARGET_H);
    big.refresh();
  }

  private createLightTextures() {
    const glowD = 256;
    const ctGlow = this.textures.createCanvas('light_glow', glowD, glowD) as Phaser.Textures.CanvasTexture;
    const ctxG = ctGlow.getContext();
    const grad = ctxG.createRadialGradient(glowD / 2, glowD / 2, 0, glowD / 2, glowD / 2, glowD / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctxG.fillStyle = grad;
    ctxG.beginPath(); ctxG.arc(glowD / 2, glowD / 2, glowD / 2, 0, Math.PI * 2); ctxG.fill();
    ctGlow.refresh();

    const ctLed = this.textures.createCanvas('red_led', 4, 4) as Phaser.Textures.CanvasTexture;
    const ctxLed = ctLed.getContext();
    ctxLed.fillStyle = '#ff2222'; ctxLed.fillRect(0, 0, 4, 4);
    ctxLed.fillStyle = '#ff9999'; ctxLed.fillRect(1, 1, 2, 2);
    ctLed.refresh();

    const ctLedG = this.textures.createCanvas('green_led', 4, 4) as Phaser.Textures.CanvasTexture;
    const ctxLedG = ctLedG.getContext();
    ctxLedG.fillStyle = '#22ff22'; ctxLedG.fillRect(0, 0, 4, 4);
    ctxLedG.fillStyle = '#99ff99'; ctxLedG.fillRect(1, 1, 2, 2);
    ctLedG.refresh();

    const ctLedB = this.textures.createCanvas('blue_led', 4, 4) as Phaser.Textures.CanvasTexture;
    const ctxLedB = ctLedB.getContext();
    ctxLedB.fillStyle = '#2288ff'; ctxLedB.fillRect(0, 0, 4, 4);
    ctxLedB.fillStyle = '#99ccff'; ctxLedB.fillRect(1, 1, 2, 2);
    ctLedB.refresh();
  }

  private createPlayerSprite() {
    const key = 'player';
    if (this.textures.exists(key)) this.textures.remove(key);
    const ct = this.textures.createCanvas(key, SPR_W * FRAMES, SPR_H) as Phaser.Textures.CanvasTexture;
    const ctx = ct.getContext();
    const visual = CHAR_VISUALS[key] ?? DEFAULT_VISUAL;

    for (let dir = 0; dir < 4; dir++) {
      for (let step = 0; step < 6; step++) {
        this.drawCharacter(ctx, dir * 6 + step, dir, step, {
          skin: '#f5c5a3', coat: '#1abc9c', coatDark: '#12876b',
          pants: '#0e6b55', hair: '#2c1a12', shoe: '#1a0f08',
          role: 'nurse', isPlayer: true, visual,
        });
      }
    }
    ct.refresh();
    for (let i = 0; i < FRAMES; i++) ct.add(i, 0, i * SPR_W, 0, SPR_W, SPR_H);
  }

  private createNPCSprites() {
    const hexRgb = (n: number) => `rgb(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff})`;
    const hexDark = (n: number, p = 0.3) => {
      const r = Math.max(0, ((n >> 16) & 0xff) * (1 - p)) | 0;
      const g = Math.max(0, ((n >> 8) & 0xff) * (1 - p)) | 0;
      const b = Math.max(0, (n & 0xff) * (1 - p)) | 0;
      return `rgb(${r},${g},${b})`;
    };
    const pantsDark = (n: number) => hexDark(n, 0.45);

    for (const def of NPC_DEFS) {
      const key = def.id; // Use unique ID to prevent texture overriding
      if (this.textures.exists(key)) this.textures.remove(key);
      const ct = this.textures.createCanvas(key, SPR_W * FRAMES, SPR_H) as Phaser.Textures.CanvasTexture;
      const ctx = ct.getContext();
      const visual = CHAR_VISUALS[def.spriteKey] ?? DEFAULT_VISUAL;

      for (let dir = 0; dir < 4; dir++) {
        for (let step = 0; step < 6; step++) {
          this.drawCharacter(ctx, dir * 6 + step, dir, step, {
            skin: def.skinColor ? hexRgb(def.skinColor) : '#f5c5a3',
            coat: hexRgb(def.coatColor),
            coatDark: hexDark(def.coatColor),
            pants: pantsDark(def.coatColor),
            hair: hexRgb(def.hairColor),
            shoe: '#1a1008',
            role: def.role,
            isPlayer: false,
            visual,
          });
        }
      }
      ct.refresh();
      for (let i = 0; i < FRAMES; i++) ct.add(i, 0, i * SPR_W, 0, SPR_W, SPR_H);
    }
  }

  // ── SPRITE SHEET CHARACTER CREATION ──────────────────────────────────────

  /**
   * Remove near-white background from the nurses sprite sheet so
   * characters have transparent backgrounds in-game.
   */
  private buildTransparentSheet(img: HTMLImageElement): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    const px = imageData.data;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const brightness = (r + g + b) / 3;
      if (brightness > 238) {
        px[i + 3] = 0; // fully transparent
      } else if (brightness > 210) {
        // smooth edge anti-aliasing
        px[i + 3] = Math.round((238 - brightness) / 28 * 255);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * Draw one frame from the new sprite sheet using exact pixel coordinates.
   * colSpec: {x1, x2} pixel range in source for this frame column
   * rowSpec: [y1, y2] pixel range in source for this direction row
   * flipX: mirror horizontally (for left-facing)
   */
  private drawNewSheetFrame(
    ctx: CanvasRenderingContext2D,
    sheet: HTMLCanvasElement,
    gameFrame: number,
    colSpec: { x1: number; x2: number },
    rowSpec: [number, number],
    flipX: boolean,
  ) {
    const srcX = colSpec.x1;
    const srcY = rowSpec[0];
    const srcW = colSpec.x2 - colSpec.x1 + 1;
    const srcH = rowSpec[1] - rowSpec[0] + 1;
    // Destination: draw the character into a DRAW_W×DRAW_H area
    // centred horizontally and top-anchored inside the SPR_W×SPR_H canvas.
    const slotX = gameFrame * SPR_W; // left edge of this frame slot in the atlas
    const destX = slotX + DRAW_X_OFF;
    const destY = 0;

    if (flipX) {
      ctx.save();
      ctx.translate(slotX + SPR_W - DRAW_X_OFF, destY);
      ctx.scale(-1, 1);
      ctx.drawImage(sheet, srcX, srcY, srcW, srcH, 0, 0, DRAW_W, DRAW_H);
      ctx.restore();
    } else {
      ctx.drawImage(sheet, srcX, srcY, srcW, srcH, destX, destY, DRAW_W, DRAW_H);
    }
  }

  private buildCharSprite(key: string, rows: { front: [number,number]; side: [number,number]; back: [number,number] }, sheet: HTMLCanvasElement) {
    if (this.textures.exists(key)) this.textures.remove(key);
    const ct = this.textures.createCanvas(key, SPR_W * FRAMES, SPR_H) as Phaser.Textures.CanvasTexture;
    const ctx = ct.getContext();

    // Game frame layout: down(0-5)=front, up(6-11)=back, right(12-17)=side, left(18-23)=side flipped
    for (let f = 0; f < 6; f++) {
      this.drawNewSheetFrame(ctx, sheet, f,      FRAME_COLS[f], rows.front, false); // down
      this.drawNewSheetFrame(ctx, sheet, 6 + f,  FRAME_COLS[f], rows.back,  false); // up
      this.drawNewSheetFrame(ctx, sheet, 12 + f, FRAME_COLS[f], rows.side,  false); // right
      this.drawNewSheetFrame(ctx, sheet, 18 + f, FRAME_COLS[f], rows.side,  true);  // left (mirrored)
    }

    ct.refresh();
    for (let i = 0; i < FRAMES; i++) ct.add(i, 0, i * SPR_W, 0, SPR_W, SPR_H);
  }

  // ── COMPLETE CHARACTER DRAWING SYSTEM ─────────────────────────────────────
  private drawCharacter(
    ctx: CanvasRenderingContext2D,
    fi: number, dir: number, step: number,
    c: { skin: string; coat: string; coatDark: string; pants: string; hair: string; shoe: string; role: string; isPlayer: boolean; visual: CharVisual },
  ) {
    const x = fi * SPR_W;
    ctx.clearRect(x, 0, SPR_W, SPR_H);

    const isDown = dir === 0, isUp = dir === 1;
    const isLeft = dir === 2, isRight = dir === 3;
    const isLR = isLeft || isRight;
    const moving = step > 0;
    const facing = isRight ? 1 : -1;

    // Bouncy chibi animation
    const phase = moving ? (step - 1) * (Math.PI * 2 / 5) : 0;
    const stride = moving ? Math.sin(phase) * 6 : 0;
    const strideB = -stride;
    const bob = moving ? -Math.abs(Math.sin(phase)) * 2 : 0;
    
    const cx = x + SPR_W / 2;
    const groundY = 68;
    const bodyBase = groundY + bob;

    const darkSkin = darken(c.skin, 0.25);
    const outline = '#1e293b';

    // Shadow
    if (c.role !== 'patient') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(cx, groundY + 2, 11, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const drawRoundedRect = (px: number, py: number, pw: number, ph: number, fill: string, line: string, radius: number = 2) => {
      ctx.fillStyle = fill;
      rrFill(ctx, px, py, pw, ph, radius);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.5;
      rrStroke(ctx, px, py, pw, ph, radius);
    };

    // --- FEET ---
    if (isLR) {
      drawRoundedRect(cx - 3 + facing * stride, bodyBase - 4, 7, 5, c.shoe, outline, 2);
      drawRoundedRect(cx - 6 - facing * stride, bodyBase - 4, 7, 5, darken(c.shoe, 0.3), outline, 2);
    } else {
      drawRoundedRect(cx - 8, bodyBase - 4 + (moving?stride:0), 6, 5, c.shoe, outline, 2);
      drawRoundedRect(cx + 2, bodyBase - 4 + (moving?strideB:0), 6, 5, c.shoe, outline, 2);
    }

    // --- LEGS ---
    if (isLR) {
      drawRoundedRect(cx - 2 + facing * stride, bodyBase - 12, 5, 10, c.pants, outline, 1);
      drawRoundedRect(cx - 5 - facing * stride, bodyBase - 12, 5, 10, darken(c.pants,0.2), outline, 1);
    } else {
      drawRoundedRect(cx - 8, bodyBase - 12 + (moving?stride:0), 6, 12, c.pants, outline, 1);
      drawRoundedRect(cx + 2, bodyBase - 12 + (moving?strideB:0), 6, 12, c.pants, outline, 1);
    }

    // --- TORSO ---
    const tW = isLR ? 14 : 18;
    const tH = 14;
    const tX = cx - tW / 2;
    const tY = bodyBase - 24;
    
    // Fill + Outline
    drawRoundedRect(tX, tY, tW, tH, c.coat, outline, 4);
    
    // Bottom shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(tX + 1, tY + tH - 3, tW - 2, 2);
    
    // Coat accents / collars
    if (!isUp) {
      ctx.fillStyle = c.role === 'doctor' ? '#f8fafc' : darken(c.coat, 0.1);
      ctx.beginPath();
      if(isLR) {
        ctx.moveTo(tX + (facing>0?10:4), tY); ctx.lineTo(tX + (facing>0?14:0), tY+8); ctx.lineTo(tX + (facing>0?10:4), tY+10);
      } else {
        ctx.moveTo(tX+4, tY); ctx.lineTo(tX+9, tY+6); ctx.lineTo(tX+14, tY);
        ctx.lineTo(tX+14, tY+10); ctx.lineTo(tX+9, tY+12); ctx.lineTo(tX+4, tY+10);
      }
      ctx.fill();
    }

    // --- ARMS (back) ---
    if (isLR) {
      const armSwing = moving ? -Math.sin(phase) * 5 : 0;
      drawRoundedRect(cx - tW/2 + 2, tY + 2 + armSwing, 4, 10, darken(c.coat, 0.2), outline, 2);
    }

    // --- HEAD ---
    const hW = isLR ? 20 : 24;
    const hH = 20;
    const hX = cx - hW / 2;
    const hY = tY - hH + 4;

    // Head base
    drawRoundedRect(hX, hY, hW, hH, c.skin, outline, 7);
    
    // Blush
    if (!isUp && c.visual.gender === 'female') {
      ctx.fillStyle = 'rgba(244,114,182, 0.5)';
      if(isLR) {
        ctx.beginPath(); ctx.arc(hX + (facing>0?hW-6:6), hY + hH - 6, 3, 0, Math.PI*2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(hX + 4, hY + hH - 6, 3, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(hX + hW - 4, hY + hH - 6, 3, 0, Math.PI*2); ctx.fill();
      }
    }

    // Eyes
    if (!isUp) {
      ctx.fillStyle = '#0f172a';
      if (isLR) {
        const eyeX = facing > 0 ? hX + hW - 6 : hX + 6;
        ctx.fillRect(eyeX, hY + hH/2 - 2, 3, 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(eyeX + (facing>0?1:0), hY + hH/2 - 2, 1, 1);
        if (c.visual.gender === 'female') {
           ctx.fillStyle = '#0f172a';
           ctx.fillRect(eyeX + (facing>0 ? 3 : -1), hY + hH/2 - 2, 1, 1);
        }
      } else {
        ctx.fillRect(hX + 5, hY + hH/2 - 2, 3, 4);
        ctx.fillRect(hX + hW - 8, hY + hH/2 - 2, 3, 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(hX + 6, hY + hH/2 - 2, 1, 1);
        ctx.fillRect(hX + hW - 7, hY + hH/2 - 2, 1, 1);
        if (c.visual.gender === 'female') {
           ctx.fillStyle = '#0f172a';
           ctx.fillRect(hX + 4, hY + hH/2 - 2, 1, 1);
           ctx.fillRect(hX + hW - 5, hY + hH/2 - 2, 1, 1);
        }
      }
    }

    // Hair
    ctx.fillStyle = c.hair;
    this.drawHair(ctx, c.visual.hairStyle, c.hair, cx, hY, hW/2, hH/2, isDown, isUp, isLR, facing, c.skin);

    // Stethoscope for Doctors
    if (c.role === 'doctor' && !isUp) {
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      if (isLR) {
         ctx.beginPath();
         ctx.moveTo(cx + (facing>0?-2:2), tY + 2);
         ctx.lineTo(cx + (facing>0?4:-4), tY + 8);
         ctx.stroke();
      } else {
         ctx.beginPath();
         ctx.arc(cx, tY + 4, 4, 0, Math.PI);
         ctx.stroke();
         ctx.beginPath();
         ctx.moveTo(cx - 4, tY + 4); ctx.lineTo(cx - 4, tY + 1); ctx.stroke();
         ctx.moveTo(cx + 4, tY + 4); ctx.lineTo(cx + 4, tY + 1); ctx.stroke();
         
         ctx.beginPath();
         ctx.moveTo(cx, tY + 8); ctx.lineTo(cx, tY + 12); ctx.stroke();
         ctx.fillStyle = '#334155';
         ctx.beginPath(); ctx.arc(cx, tY + 12, 1.5, 0, Math.PI*2); ctx.fill();
      }
    }

    // Accessories
    if (!isUp) {
      if (c.visual.accessory === 'glasses') {
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1.5;
        if (isLR) {
          rrStroke(ctx, facing > 0 ? hX + hW - 10 : hX + 2, hY + hH/2 - 4, 8, 5, 2);
          ctx.beginPath(); ctx.moveTo(facing > 0 ? hX + hW - 10 : hX + 10, hY + hH/2 - 2); ctx.lineTo(facing > 0 ? hX + 5 : hX + hW - 5, hY + hH/2 - 3); ctx.stroke();
        } else {
          rrStroke(ctx, hX + 3, hY + hH/2 - 4, 7, 5, 2);
          rrStroke(ctx, hX + hW - 10, hY + hH/2 - 4, 7, 5, 2);
          ctx.beginPath(); ctx.moveTo(hX + 10, hY + hH/2 - 2); ctx.lineTo(hX + hW - 10, hY + hH/2 - 2); ctx.stroke();
        }
      }
      if (c.visual.accessory === 'mask') {
        const maskColor = '#38bdf8';
        ctx.fillStyle = maskColor;
        if (isLR) {
          ctx.fillRect(facing > 0 ? hX + hW - 10 : hX, hY + hH - 8, 10, 8);
        } else {
          ctx.fillRect(hX + 3, hY + hH - 8, hW - 6, 8);
        }
      }
    }

    if (c.visual.nurseCap || c.role === 'nurse') {
      const capColor = '#ffffff';
      const stripeColor = '#e74c3c';
      const capY = hY - 5;
      ctx.fillStyle = capColor;
      if (isLR) {
        rrFill(ctx, cx - 4, capY, 8, 5, 1);
        ctx.fillStyle = stripeColor;
        ctx.fillRect(cx - 4, capY + 2, 8, 2);
      } else {
        rrFill(ctx, cx - 8, capY, 16, 6, 1);
        ctx.fillStyle = stripeColor;
        ctx.fillRect(cx - 8, capY + 3, 16, 2);
      }
    }

    // --- ARMS (front) ---
    if (isLR) {
      const armSwingB = moving ? Math.sin(phase) * 5 : 0;
      drawRoundedRect(cx +(facing>0?-2:0), tY + 2 + armSwingB, 4, 10, c.coat, outline, 2);
      if (c.role === 'patient') {
         ctx.fillStyle = '#ef4444'; // Red allergy/ID wristband
         ctx.fillRect(cx +(facing>0?-2:0), tY + 9 + armSwingB, 4, 2);
      }
    } else {
      const armColor = isUp ? darken(c.coat, 0.1) : c.coat;
      drawRoundedRect(cx - tW/2 - 4, tY + 2 +(moving?-stride:0), 5, 11, armColor, outline, 2);
      drawRoundedRect(cx + tW/2 - 1, tY + 2 +(moving?-strideB:0), 5, 11, armColor, outline, 2);
      if (c.role === 'patient' && !isUp) {
         ctx.fillStyle = '#ef4444'; // Red allergy/ID wristband
         ctx.fillRect(cx + tW/2 - 1, tY + 10 +(moving?-strideB:0), 5, 2);
      }
    }
  }

  private drawHair(
    ctx: CanvasRenderingContext2D,
    style: string,
    hair: string,
    cx: number, hY: number, hrx: number, hry: number,
    isDown: boolean, isUp: boolean, isLR: boolean, facing: number,
    skinColor: string,
  ) {
    const outline = '#1e293b';
    const drawHairChunk = (x:number, y:number, w:number, h:number, r:number=4) => {
      ctx.fillStyle = hair; rrFill(ctx, x, y, w, h, r);
      ctx.strokeStyle = outline; ctx.lineWidth = 1.5; rrStroke(ctx, x, y, w, h, r);
    };

    if (style === 'bald') return;

    // Full coverage if facing away
    if (isUp) {
      drawHairChunk(cx - hrx, hY, hrx*2, hry*2, 7);
    } else {
      // Top cap (bangs)
      let bangH = 6;
      if (style.includes('short') || style === 'business' || style === 'low_fade') bangH = 4;
      if (style === 'bob') bangH = 7;
      if (style === 'afro_short' || style === 'curly_top') bangH = 8;
      
      drawHairChunk(cx - hrx, hY - 1, hrx*2, bangH + 1, 3);
      
      // Sideburns / back hair extending down if facing side
      if (isLR) {
        if (style === 'bob' || style.includes('long')) {
           drawHairChunk(facing > 0 ? cx - hrx : cx, hY, hrx, hry*2 - 2, 2);
        } else {
           drawHairChunk(facing > 0 ? cx - hrx : cx + hrx/2, hY, hrx/2, hry, 2);
        }
      } else {
        // Front facing sideburns or long hair framing face
        if (style === 'bob' || style.includes('long')) {
          drawHairChunk(cx - hrx, hY, 4, hry*2 - 2, 2);
          drawHairChunk(cx + hrx - 4, hY, 4, hry*2 - 2, 2);
        }
      }
    }

    // Additional pieces
    switch (style) {
      case 'bun':
      case 'updo':
        drawHairChunk(cx - 6, hY - 8, 12, 8, 4);
        break;
      case 'ponytail':
      case 'long_tied':
        if(isUp || isLR) drawHairChunk(cx - (isLR && facing<0 ? 8 : -4), hY + 4, 6, 12, 2);
        break;
      case 'afro_short':
      case 'curly_top':
      case 'short_curly_gray':
      case 'short_wavy':
        drawHairChunk(cx - hrx - 2, hY - 4, hrx*2 + 4, 10, 5);
        break;
      case 'receding':
        if (!isUp) {
           ctx.fillStyle = skinColor;
           ctx.fillRect(cx - hrx + 2, hY - 1, hrx*2 - 4, 6);
        }
        break;
      case 'loose_long':
        if (!isUp) {
          if (isLR) {
            drawHairChunk(facing>0 ? cx - hrx - 2 : cx, hY, hrx + 2, hry*2 + 4, 3);
          } else {
            drawHairChunk(cx - hrx - 3, hY, 7, hry*2 + 4, 3);
            drawHairChunk(cx + hrx - 4, hY, 7, hry*2 + 4, 3);
          }
        } else {
          drawHairChunk(cx - hrx - 3, hY, hrx*2 + 6, hry*2 + 6, 2);
        }
        break;
      default: // Short generic
        drawHairChunk(cx - hrx - 1, hY - 4, hrx*2 + 2, hry+2, 2);
        break;
    }
    
    // Front bangs
    if (!isUp) {
      ctx.fillStyle = hair;
      ctx.beginPath();
      if(isLR) {
        ctx.moveTo(cx - hrx, hY-2); ctx.lineTo(cx + hrx, hY-2); 
        ctx.lineTo(cx + (facing>0?hrx:-hrx), hY + hry); ctx.fill();
      } else {
        ctx.moveTo(cx - hrx, hY-2); ctx.lineTo(cx + hrx, hY-2);
        ctx.lineTo(cx, hY + 6); ctx.fill();
      }
    }
  }

  // ── PORTRAITS ─────────────────────────────────────────────────────────────
  private createPortraits() {
    // Map role → loaded AI portrait image key
    const rolePortraitImg: Record<string, string> = {
      nurse: 'portrait_img_nurse',
      doctor: 'portrait_img_doctor',
      admin: 'portrait_img_admin',
      receptionist: 'portrait_img_receptionist',
    };

    for (const def of NPC_DEFS) {
      const key = `portrait_${def.id}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      const ct = this.textures.createCanvas(key, 90, 90) as Phaser.Textures.CanvasTexture;
      const ctx = ct.getContext();

      const hexRgb = (n: number) => `rgb(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff})`;
      const skinC = def.skinColor ? hexRgb(def.skinColor) : '#f5c5a3';
      const coatC = hexRgb(def.coatColor);
      const hairC = hexRgb(def.hairColor);
      const r0 = (def.coatColor >> 16) & 0xff;
      const g0 = (def.coatColor >> 8) & 0xff;
      const b0 = def.coatColor & 0xff;

      // Try to use the AI-generated portrait PNG for this role
      const imgKey = rolePortraitImg[def.role];
      if (imgKey && this.textures.exists(imgKey)) {
        const src = this.textures.get(imgKey).getSourceImage() as HTMLImageElement;
        if (src && src.width) {
          // Rounded clip mask
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(0, 0, 90, 90, 10);
          ctx.clip();
          ctx.drawImage(src, 0, 0, 90, 90);
          ctx.restore();
          // Subtle colored tint overlay to unify with game palette
          ctx.fillStyle = `rgba(${r0},${g0},${b0},0.12)`;
          ctx.beginPath(); ctx.roundRect(0, 0, 90, 90, 10); ctx.fill();
          ct.refresh();
          continue;
        }
      }

      // ── Fallback: procedural pixel-art portrait ──────────────────────────
      // Background gradient
      ctx.fillStyle = '#f0f5f8'; ctx.fillRect(0, 0, 90, 90);
      const bgGrad = ctx.createLinearGradient(0, 0, 90, 90);
      bgGrad.addColorStop(0, `rgba(${r0},${g0},${b0},0.10)`);
      bgGrad.addColorStop(1, `rgba(${r0},${g0},${b0},0.40)`);
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, 90, 90);

      // Subtle dot grid
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
      for (let gy = 4; gy < 90; gy += 8) for (let gx = 4; gx < 90; gx += 8) {
        ctx.fillRect(gx, gy, 1, 1);
      }

      // Shoulders — wider and more realistic
      ctx.fillStyle = coatC;
      ctx.beginPath();
      ctx.moveTo(-5, 90); ctx.lineTo(-5, 58);
      ctx.bezierCurveTo(2, 50, 32, 48, 45, 51);
      ctx.bezierCurveTo(58, 48, 88, 50, 95, 58);
      ctx.lineTo(95, 90); ctx.closePath(); ctx.fill();
      // Shoulder shadow
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      ctx.moveTo(-5, 90); ctx.lineTo(-5, 68);
      ctx.bezierCurveTo(2, 62, 32, 60, 45, 63);
      ctx.bezierCurveTo(58, 60, 88, 62, 95, 68);
      ctx.lineTo(95, 90); ctx.closePath(); ctx.fill();

      // Doctor white coat lapels
      if (def.role === 'doctor') {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.moveTo(40, 51); ctx.lineTo(-5, 68); ctx.lineTo(-5, 51); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(50, 51); ctx.lineTo(95, 68); ctx.lineTo(95, 51); ctx.closePath(); ctx.fill();
      }

      // Stethoscope
      if (def.role === 'doctor' || def.role === 'nurse') {
        ctx.strokeStyle = '#1a252f'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(45, 64, 10, 0, Math.PI); ctx.stroke();
        ctx.fillStyle = '#2c3e50';
        ctx.beginPath(); ctx.arc(45, 74, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath(); ctx.arc(45, 74, 2, 0, Math.PI * 2); ctx.fill();
      }

      // V-neck skin visible
      ctx.fillStyle = skinC;
      ctx.beginPath(); ctx.moveTo(38, 51); ctx.lineTo(45, 64); ctx.lineTo(52, 51); ctx.closePath(); ctx.fill();

      // Neck
      ctx.fillStyle = skinC; rrFill(ctx, 37, 38, 16, 16, 5);
      ctx.fillStyle = darken(skinC, 0.1);
      ctx.fillRect(37, 50, 16, 4);

      // Head — bigger and more proportional
      ctx.fillStyle = skinC;
      ctx.beginPath(); ctx.ellipse(45, 24, 21, 23, 0, 0, Math.PI * 2); ctx.fill();
      // Subtle cheek shading
      ctx.fillStyle = darken(skinC, 0.06);
      ctx.beginPath(); ctx.ellipse(30, 28, 6, 8, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(60, 28, 6, 8, -0.2, 0, Math.PI * 2); ctx.fill();
      // Head highlight
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.ellipse(36, 14, 9, 10, -0.3, 0, Math.PI * 2); ctx.fill();

      // Hair — fuller and more volumetric
      ctx.fillStyle = hairC;
      ctx.beginPath(); ctx.ellipse(45, 7, 22, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(24, 7, 42, 20);
      // Hair shine
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.ellipse(38, 5, 8, 5, -0.2, 0, Math.PI * 2); ctx.fill();

      // Eyebrows — arched
      ctx.strokeStyle = darken(hairC, 0.15); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(31, 17); ctx.quadraticCurveTo(36, 13, 41, 17); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(49, 17); ctx.quadraticCurveTo(54, 13, 59, 17); ctx.stroke();

      // Eyes — larger and more expressive
      ctx.fillStyle = '#1a2530';
      rrFill(ctx, 32, 20, 9, 7, 3);
      rrFill(ctx, 49, 20, 9, 7, 3);
      ctx.fillStyle = '#fff';
      ctx.fillRect(32, 20, 3.5, 3); ctx.fillRect(49, 20, 3.5, 3);
      ctx.fillStyle = '#000';
      ctx.fillRect(35, 21, 4, 4); ctx.fillRect(52, 21, 4, 4);
      // Eye sparkle
      ctx.fillStyle = '#fff';
      ctx.fillRect(36, 21, 1.5, 1.5); ctx.fillRect(53, 21, 1.5, 1.5);

      // Nose — subtle
      ctx.fillStyle = darken(skinC, 0.13);
      ctx.beginPath(); ctx.arc(45, 32, 2.5, 0, Math.PI * 2); ctx.fill();

      // Warm smile
      ctx.strokeStyle = darken(skinC, 0.20); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(45, 38, 7, 0.2, Math.PI - 0.2); ctx.stroke();

      // Blush cheeks
      ctx.fillStyle = 'rgba(220,80,80,0.16)';
      ctx.beginPath(); ctx.ellipse(31, 33, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(59, 33, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();

      // Glasses (doctor/admin)
      if (def.role === 'doctor' || def.role === 'admin') {
        ctx.strokeStyle = '#4a5568'; ctx.lineWidth = 2;
        rrStroke(ctx, 31, 19, 12, 9, 3);
        rrStroke(ctx, 47, 19, 12, 9, 3);
        ctx.beginPath(); ctx.moveTo(43, 23); ctx.lineTo(47, 23); ctx.stroke();
      }

      // Nurse cap
      if (def.role === 'nurse') {
        ctx.fillStyle = '#ffffff';
        rrFill(ctx, 24, 2, 42, 8, 2);
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(24, 6, 42, 3);
        // Cap highlight
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(24, 2, 42, 2);
      }

      // ID Badge
      if (def.role === 'nurse' || def.role === 'admin' || def.role === 'receptionist') {
        ctx.fillStyle = '#e74c3c';
        rrFill(ctx, 24, 57, 18, 22, 2);
        ctx.fillStyle = '#fff';
        ctx.fillRect(26, 61, 14, 2); ctx.fillRect(26, 65, 12, 2); ctx.fillRect(26, 69, 14, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(24, 57, 18, 3);
      }

      ct.refresh();
    }

    // Player portrait
    const pk = 'portrait_player';
    if (!this.textures.exists(pk)) {
      const ct = this.textures.createCanvas(pk, 90, 90) as Phaser.Textures.CanvasTexture;
      const ctx = ct.getContext();
      ctx.fillStyle = '#e0faf4'; ctx.fillRect(0, 0, 90, 90);
      const grad = ctx.createLinearGradient(0, 0, 90, 90);
      grad.addColorStop(0, 'rgba(26,188,156,0.1)');
      grad.addColorStop(1, 'rgba(26,188,156,0.35)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, 90, 90);
      // Shoulders
      ctx.fillStyle = '#1abc9c';
      ctx.beginPath();
      ctx.moveTo(0, 90); ctx.lineTo(0, 60);
      ctx.bezierCurveTo(5, 52, 35, 50, 45, 52);
      ctx.bezierCurveTo(55, 50, 85, 52, 90, 60);
      ctx.lineTo(90, 90); ctx.closePath(); ctx.fill();
      // Stethoscope
      ctx.strokeStyle = '#1a252f'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(45, 62, 9, 0, Math.PI); ctx.stroke();
      ctx.fillStyle = '#1a252f'; ctx.beginPath(); ctx.arc(45, 71, 4, 0, Math.PI * 2); ctx.fill();
      // Head/neck/hair
      ctx.fillStyle = '#f5c5a3';
      ctx.beginPath(); ctx.ellipse(45, 26, 19, 22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(38, 40, 14, 14);
      ctx.fillStyle = '#2c1a12';
      ctx.beginPath(); ctx.ellipse(45, 9, 19, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(26, 9, 38, 18);
      ctx.beginPath(); ctx.arc(45, -2, 6, 0, Math.PI * 2); ctx.fill();
      // Cap
      ctx.fillStyle = '#ffffff'; rrFill(ctx, 26, 4, 38, 7, 1);
      ctx.fillStyle = '#e74c3c'; ctx.fillRect(26, 7, 38, 2.5);
      // Eyes
      ctx.fillStyle = '#1a2530'; ctx.fillRect(34, 23, 6, 5); ctx.fillRect(50, 23, 6, 5);
      ctx.fillStyle = '#fff'; ctx.fillRect(34, 23, 2.5, 2.5); ctx.fillRect(50, 23, 2.5, 2.5);
      ct.refresh();
    }
  }

  private createPixelTexture() {
    const key = 'pixel';
    if (this.textures.exists(key)) this.textures.remove(key);
    const ct = this.textures.createCanvas(key, TILE_SIZE, TILE_SIZE) as Phaser.Textures.CanvasTexture;
    ct.getContext().fillStyle = '#fff'; ct.getContext().fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    ct.refresh();
  }
}

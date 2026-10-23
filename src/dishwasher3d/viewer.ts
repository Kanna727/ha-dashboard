import {
  ACESFilmicToneMapping,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  Scene,
  Shape,
  SRGBColorSpace,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// The owner's free-standing 60 cm dishwasher, built from primitives (no model
// file), measured off every product photo on the maker's page (front studio
// shot, kitchen shots closed and open, upper and lower rack, dispenser, tub
// floor). Sizes come from pixel rows of the front shot (845 mm tall):
// lid 28 mm with a bullnose and rounded corners, a 6.7 mm dark slot, the
// control panel (36–125 mm from the top), the door down to a black 11.8 mm
// gap, a flush 74 mm plinth, 8.4 mm feet.
//
// Look: a studio environment (tall softbox in front, strips at the sides, an
// overhead box) gives the photos' bright band down the brushed door and the
// light lid top; brushed steel is anisotropic (MeshPhysicalMaterial), the panel
// a granular satin, the sides matte painted grey, the scoop and logo strip
// polished. The panel is drawn on canvases at the photos' layout (see
// drawPanel), the LCD with its unlit "ghost" segments and icons.
//
// Inside: tub with embossed wall panels and the riser pipe, filter plate,
// salt cap, curved spray arms; racks with wavy rims (light grey frame, dark
// plate tines below), utensil tray, comb glass shelf, red-trimmed handles,
// three-module cutlery basket, telescopic rails; inner door with a raised rim
// and the dispenser.
//
// Metres. Front +z, floor y = 0. The control panel is the top of the door.
// The door hinges on its inner bottom edge and swings on a damped spring
// that settles against its stop; "look inside" then rolls the lower rack out
// and slides the upper one forward (closing reverses it). Mid-cycle, "look
// inside" shows a cutaway instead (see-through door, spinning arms, spray).
// Renders on demand: nothing runs while it's still.

export interface DishState {
  power: boolean; // panel lit
  op?: string; // Home Connect operation state
  program?: string; // program key (dishcare_dishwasher_program_*)
  remainingMin?: number; // minutes to the end of the cycle
  door?: string; // open / closed / locked
  remoteStart?: boolean;
  connected?: boolean;
  halfLoad?: boolean;
  intensiveZone?: boolean;
  childLock?: boolean;
  saltLow?: boolean;
  rinseLow?: boolean;
}

const W = 0.6;
const H = 0.845;
const D = 0.6;
const FRONT = D / 2;
const LID = 0.028;
const PLINTH_TOP = 0.0825;
const HINGE = 0.0943; // door bottom
const DOOR_T = 0.048; // door thickness
const DOOR_H = 0.7147; // door + panel, from its bottom
const FACE_TOP = 0.6257; // door face / panel seam, from the door bottom
const PANEL_H = DOOR_H - FACE_TOP;
const MOD = 0.144; // half width of the module, logo strip and scoop
const STRIP_Y0 = 0.6251;
const STRIP_Y1 = 0.6398;
const SCOOP_Y = 0.5857;
const OPEN = Math.PI / 2 - 0.012; // the door's stop, a hair above level
const PX = 6000; // panel canvas pixels per metre
const RESUME_MS = 8000;
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Program keys -> the program printed on the panel (index along the track).
const PANEL_PROGRAM: Record<string, number> = {
  eco_50: 0,
  auto_1: 1,
  auto_2: 1,
  auto_3: 1,
  intensiv_power: 2,
  quick_65: 3,
  pre_rinse: 4,
};
const PROGRAMS: [string, string?, string?][] = [
  ['Eco', undefined, '50°'],
  ['Auto', undefined, '45°-65°'],
  ['Intensive', 'Kadhai', '70°'],
  ['Express', undefined, '65°'],
  ['Pre-', 'Rinse'],
  ['Favourite', undefined, '☆'],
];
const OPTIONS: [string, string][] = [
  ['Start', 'in hr.'],
  ['Remote', 'Start'],
  ['Intensive', 'Zone'],
  ['Pre-', 'Treatment'],
  ['Half', 'Load'],
  ['Speed', 'Perfect'],
];

/* ---------- panel layout, canvas pixels (measured off the close-ups) ---------- */

const TEXT_Y = 202;
const FRAME: [number, number, number] = [930, 2670, 236]; // left, right, top
const BTN_Y = 267;
const BTN_H = 63;
const TRACK_Y = 332;
const TRACK_H = 10;
const PROG_BTN: [number, number] = [960, 1071];
const PROG_TRACK: [number, number] = [960, 1637];
const OPT_BTNS: [number, number] = [1936, 2611];
const PROG_X = [1020, 1133, 1246, 1357, 1468, 1579];
const OPT_X = [1992, 2105, 2217, 2330, 2442, 2555];
const SEG_W = 112;
const DISPLAY: [number, number, number, number] = [1657, 262, 257, 148];
const POWER_X = 834;
const START_X = 2782;
const KNOB_Y = 346;
const INK = '#3a3937';
const LED = '#ff4d57';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c: HTMLCanvasElement, color = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (color) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Fine brushing along x (or y): thin streaks on a light base.
function brushed(size: number, base: number, spread: number, vertical = false) {
  const c = canvas(size, size);
  const g = c.getContext('2d')!;
  g.fillStyle = `rgb(${base},${base},${base})`;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 8; i++) {
    const v = base + (Math.random() - 0.5) * spread;
    g.strokeStyle = `rgba(${v | 0},${v | 0},${v | 0},${0.1 + Math.random() * 0.25})`;
    g.lineWidth = 1;
    const p = Math.random() * size;
    const a = Math.random() * size;
    const len = size * (0.15 + Math.random() * 0.85);
    g.beginPath();
    if (vertical) {
      g.moveTo(p, a);
      g.lineTo(p, a + len);
    } else {
      g.moveTo(a, p);
      g.lineTo(a + len, p);
    }
    g.stroke();
  }
  return c;
}

// The panel's granular satin finish: fine speckle, a faint horizontal grain.
function speckle(w: number, h: number, base: [number, number, number], amp: number) {
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const row = (Math.random() - 0.5) * amp * 0.3;
    for (let x = 0; x < w; x++) {
      const n = (Math.random() - 0.5) * amp + row;
      const i = (y * w + x) * 4;
      img.data[i] = base[0] + n;
      img.data[i + 1] = base[1] + n;
      img.data[i + 2] = base[2] + n;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Square holes in grey plastic (cutlery basket, utensil tray).
function grid(size: number, cell: number, bg: string, hole: string) {
  const c = canvas(size, size);
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  g.fillStyle = hole;
  const gap = Math.max(2, cell * 0.28);
  for (let y = gap; y < size; y += cell) for (let x = gap; x < size; x += cell) g.fillRect(x, y, cell - gap, cell - gap);
  return c;
}

/* ---------- LCD ---------- */

// Seven-segment digit with the LCD's rounded, separated segments; unlit
// segments stay faintly visible as on the real glass.
const SEGS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
};
function digit(g: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, h: number, t: number, lit: string, ghost: string) {
  const on = SEGS[ch] ?? '';
  const gap = t * 0.45;
  const seg = (s: string, x0: number, y0: number, horiz: boolean, len: number) => {
    g.fillStyle = on.includes(s) ? lit : ghost;
    if (horiz) roundRect(g, x0 + gap, y0 - t / 2, len - 2 * gap, t, t / 2);
    else roundRect(g, x0 - t / 2, y0 + gap, t, len - 2 * gap, t / 2);
    g.fill();
  };
  const h2 = h / 2;
  seg('a', x, y, true, w);
  seg('g', x, y + h2, true, w);
  seg('d', x, y + h, true, w);
  seg('f', x, y, false, h2);
  seg('e', x, y + h2, false, h2);
  seg('b', x + w, y, false, h2);
  seg('c', x + w, y + h2, false, h2);
}

function wifi(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.lineWidth = s * 0.15;
  g.lineCap = 'round';
  for (const r of [0.35, 0.65, 0.95]) {
    g.beginPath();
    g.arc(x, y, r * s, -Math.PI * 0.76, -Math.PI * 0.24);
    g.stroke();
  }
  g.beginPath();
  g.arc(x, y, s * 0.11, 0, Math.PI * 2);
  g.fill();
}

// LCD status icons: salt (S arrows), rinse aid (sparkle), machine care (page with a dot), child lock (key).
function icon(g: CanvasRenderingContext2D, kind: 'salt' | 'rinse' | 'care' | 'key', x: number, y: number, s: number) {
  g.lineWidth = s * 0.14;
  g.lineCap = 'round';
  g.beginPath();
  if (kind === 'salt') {
    g.arc(x, y - s * 0.25, s * 0.25, Math.PI * 0.2, Math.PI * 1.5, false);
    g.arc(x, y + s * 0.25, s * 0.25, -Math.PI * 0.5, Math.PI * 0.8, true);
  } else if (kind === 'rinse') {
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 4;
      g.moveTo(x - Math.cos(a) * s * 0.45, y - Math.sin(a) * s * 0.45);
      g.lineTo(x + Math.cos(a) * s * 0.45, y + Math.sin(a) * s * 0.45);
    }
  } else if (kind === 'care') {
    g.rect(x - s * 0.35, y - s * 0.45, s * 0.7, s * 0.9);
    g.moveTo(x + s * 0.5, y - s * 0.5);
    g.arc(x + s * 0.42, y - s * 0.5, s * 0.08, 0, Math.PI * 2);
  } else {
    g.arc(x - s * 0.3, y, s * 0.18, 0, Math.PI * 2);
    g.moveTo(x - s * 0.12, y);
    g.lineTo(x + s * 0.5, y);
    g.moveTo(x + s * 0.3, y);
    g.lineTo(x + s * 0.3, y + s * 0.18);
  }
  g.stroke();
}

let panelBase: HTMLCanvasElement | undefined; // the static parts, drawn once

// Everything on the panel that never changes: steel, lettering, module frame
// and plate, buttons, track, labels, knob bezels, the LCD glass.
function panelStatic(w: number, h: number) {
  if (panelBase) return panelBase;
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  const font = (px: number, weight = 400) => `${weight} ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`;

  g.drawImage(speckle(w, h, [190, 188, 184], 22), 0, 0);
  // Lettering.
  g.fillStyle = INK;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.font = font(40, 600);
  g.fillText('Steam', 936, TEXT_Y);
  const sw = g.measureText('Steam').width;
  g.font = font(40, 300);
  g.fillText('Treatment', 936 + sw + 5, TEXT_Y);
  g.font = font(38, 300);
  g.textAlign = 'right';
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '6px';
  g.fillText('Serie', 2552, TEXT_Y);
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
  g.fillRect(2569, TEXT_Y - 40, 3, 50);
  g.font = font(40, 700);
  g.textAlign = 'left';
  g.fillText('6', 2586, TEXT_Y);

  // Knob bezels: a dark ring round each domed knob (the knobs are 3D).
  for (const x of [POWER_X, START_X]) {
    const ring = g.createRadialGradient(x, KNOB_Y, 66, x, KNOB_Y, 82);
    ring.addColorStop(0, '#5f5e5a');
    ring.addColorStop(0.45, '#7a7975');
    ring.addColorStop(1, 'rgba(170,168,164,0)');
    g.fillStyle = ring;
    g.beginPath();
    g.arc(x, KNOB_Y, 82, 0, Math.PI * 2);
    g.fill();
  }
  // Power symbol and "Reset 4 sec."; "Start".
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(POWER_X - 156, 316, 17, -Math.PI * 0.28, Math.PI * 1.28);
  g.stroke();
  g.beginPath();
  g.moveTo(POWER_X - 156, 292);
  g.lineTo(POWER_X - 156, 314);
  g.stroke();
  g.textAlign = 'center';
  g.font = font(19, 400);
  g.fillText('Reset', POWER_X - 156, 362);
  g.fillText('4 sec.', POWER_X - 156, 384);
  g.textAlign = 'left';
  g.font = font(28, 400);
  g.fillText('Start', START_X + 104, KNOB_Y + 10);

  // Module: dark raised frame, light speckled plate.
  const [fl, fr, ft] = FRAME;
  const frame = g.createLinearGradient(0, ft, 0, ft + 30);
  frame.addColorStop(0, '#8a8985');
  frame.addColorStop(1, '#6e6d69');
  g.fillStyle = frame;
  roundRect(g, fl, ft, fr - fl, h - ft + 40, 20);
  g.fill();
  g.save();
  roundRect(g, fl + 14, ft + 14, fr - fl - 28, h - ft + 40, 10);
  g.clip();
  g.drawImage(speckle(fr - fl, h - ft, [214, 212, 207], 14), fl, ft);
  // Inner shadow along the top of the plate (it sits below the frame).
  const sh = g.createLinearGradient(0, ft + 14, 0, ft + 30);
  sh.addColorStop(0, 'rgba(0,0,0,0.25)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh;
  g.fillRect(fl, ft + 14, fr - fl, 16);
  g.restore();

  // Buttons: soft raised keys; the option keys sit joined in a darker recess.
  const key = (x0: number, x1: number, r: number) => {
    const bg = g.createLinearGradient(0, BTN_Y, 0, BTN_Y + BTN_H);
    bg.addColorStop(0, '#f6f5f1');
    bg.addColorStop(0.7, '#e9e8e3');
    bg.addColorStop(1, '#d2d1cc');
    g.fillStyle = bg;
    roundRect(g, x0, BTN_Y, x1 - x0, BTN_H, r);
    g.fill();
    g.strokeStyle = 'rgba(80,78,74,0.55)';
    g.lineWidth = 2;
    roundRect(g, x0 + 1, BTN_Y + 1, x1 - x0 - 2, BTN_H - 2, r);
    g.stroke();
  };
  key(...PROG_BTN, 7);
  g.fillStyle = '#7d7c78';
  roundRect(g, OPT_BTNS[0] - 5, BTN_Y - 5, OPT_BTNS[1] - OPT_BTNS[0] + 10, BTN_H + 10, 8);
  g.fill();
  const step = (OPT_BTNS[1] - OPT_BTNS[0]) / 6;
  for (let i = 0; i < 6; i++) key(OPT_BTNS[0] + i * step + 2, OPT_BTNS[0] + (i + 1) * step - 2, 4);
  g.strokeStyle = INK;
  keyMark(g);
  // ">" next to the program key.
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(1092, 288);
  g.lineTo(1107, 299);
  g.lineTo(1092, 310);
  g.stroke();
  // Tracks under the keys.
  g.fillStyle = '#a4a29e';
  roundRect(g, PROG_TRACK[0], TRACK_Y, PROG_TRACK[1] - PROG_TRACK[0], TRACK_H, 5);
  g.fill();
  roundRect(g, OPT_BTNS[0], TRACK_Y, OPT_BTNS[1] - OPT_BTNS[0], TRACK_H, 5);
  g.fill();

  // Labels.
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.font = font(27, 300);
  PROGRAMS.forEach(([a, b, c2], i) => {
    g.fillText(a, PROG_X[i], 372);
    if (b) g.fillText(b, PROG_X[i], 398);
    if (c2) g.fillText(c2, PROG_X[i], 432);
  });
  OPTIONS.forEach(([a, b], i) => {
    g.fillText(a, OPT_X[i], 372);
    g.fillText(b, OPT_X[i], 398);
  });
  g.font = font(16, 400);
  g.fillText('Setup 3 sec.', OPT_X[4], 420);
  // Remote Start mark, Pre-Treatment mark.
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.strokeRect(OPT_X[1] + 38, 382, 11, 13);
  g.beginPath();
  g.moveTo(OPT_X[1] + 46, 386);
  g.lineTo(OPT_X[1] + 56, 376);
  g.moveTo(OPT_X[1] + 50, 376);
  g.lineTo(OPT_X[1] + 56, 376);
  g.lineTo(OPT_X[1] + 56, 382);
  g.stroke();
  g.beginPath();
  g.arc(OPT_X[3], 418, 8, Math.PI, 0);
  g.moveTo(OPT_X[3] - 10, 420);
  g.lineTo(OPT_X[3] + 10, 420);
  g.moveTo(OPT_X[3] + 4, 428);
  g.lineTo(OPT_X[3] + 14, 418);
  g.stroke();

  // LCD glass: dark grey, a diagonal reflection, a bright bezel line.
  const [dx, dy, dw, dh] = DISPLAY;
  g.fillStyle = '#6f6e6a';
  roundRect(g, dx - 7, dy - 7, dw + 14, dh + 14, 8);
  g.fill();
  const lcd = g.createLinearGradient(0, dy, 0, dy + dh);
  lcd.addColorStop(0, '#525354');
  lcd.addColorStop(1, '#3f4041');
  g.fillStyle = lcd;
  roundRect(g, dx, dy, dw, dh, 4);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.07)';
  g.beginPath();
  g.moveTo(dx + dw * 0.66, dy);
  g.lineTo(dx + dw, dy);
  g.lineTo(dx + dw, dy + dh * 0.15);
  g.lineTo(dx + dw * 0.83, dy + dh);
  g.lineTo(dx + dw * 0.5, dy + dh);
  g.closePath();
  g.fill();

  panelBase = c;
  return c;
}

// The panel's live layers. `color` = static panel + lit parts; `emit` = lit
// parts only (LEDs, LCD), for the emissive map.
function drawPanel(g: CanvasRenderingContext2D, s: DishState, layer: 'color' | 'emit') {
  const w = g.canvas.width;
  const h = g.canvas.height;
  if (layer === 'color') g.drawImage(panelStatic(w, h), 0, 0);
  else {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
  }
  const lit = s.power;
  const [dx, dy, dw, dh] = DISPLAY;
  const ghost = layer === 'color' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0)';
  const white = '#f4f5f3';
  const active = lit && ['run', 'pause', 'delayedstart', 'finished'].includes(s.op ?? '');

  // LCD: icons and digits, ghosts always, lit ones when on.
  g.strokeStyle = g.fillStyle = ghost;
  const icons: [Parameters<typeof icon>[1], number, number, boolean][] = [
    ['salt', 0.12, 0.24, !!s.saltLow],
    ['rinse', 0.3, 0.24, !!s.rinseLow],
    ['care', 0.88, 0.24, false],
    ['key', 0.1, 0.66, !!s.childLock],
  ];
  for (const [k, fx, fy, on] of icons) {
    g.strokeStyle = g.fillStyle = lit && on ? white : ghost;
    icon(g, k, dx + dw * fx, dy + dh * fy, 22);
  }
  g.strokeStyle = g.fillStyle = lit && s.connected ? white : ghost;
  wifi(g, dx + dw * 0.5, dy + dh * 0.33, 22);
  const mins = Math.min(599, Math.max(0, Math.round(s.remainingMin ?? 0)));
  const text = active && s.remainingMin !== undefined ? `${Math.floor(mins / 60)}${String(mins % 60).padStart(2, '0')}` : '   ';
  const dgW = dw * 0.12;
  const dgH = dh * 0.4;
  const top = dy + dh * 0.5;
  const xs = [dx + dw * 0.2, dx + dw * 0.44, dx + dw * 0.67];
  for (let i = 0; i < 3; i++) digit(g, text[i], xs[i], top, dgW, dgH, 7, lit ? white : ghost, ghost);
  g.fillStyle = active ? white : ghost;
  g.beginPath();
  g.arc(dx + dw * 0.385, top + dgH * 0.3, 4, 0, Math.PI * 2);
  g.arc(dx + dw * 0.385, top + dgH * 0.7, 4, 0, Math.PI * 2);
  g.fill();
  if (active) {
    g.font = '400 17px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textAlign = 'left';
    g.fillText('h', dx + dw * 0.355, top + dgH + 4);
    g.fillText('m', dx + dw * 0.85, top + dgH + 4);
  }

  if (!lit) return;
  // Program and option LEDs: glowing segments in the tracks.
  const led = (x0: number, x1: number, round: boolean) => {
    g.save();
    g.shadowColor = LED;
    g.shadowBlur = 16;
    g.fillStyle = LED;
    roundRect(g, x0, TRACK_Y, x1 - x0, TRACK_H, round ? 5 : 1);
    g.fill();
    g.restore();
    g.fillStyle = 'rgba(255,220,222,0.85)';
    g.fillRect(x0 + 4, TRACK_Y + 3, x1 - x0 - 8, 3);
  };
  const key = (s.program ?? '').replace(/^dishcare_dishwasher_program_/, '');
  const p = PANEL_PROGRAM[key];
  if (p !== undefined) led(PROG_X[p] - SEG_W / 2, PROG_X[p] + SEG_W / 2, p === 0);
  const opt = (i: number) => led(OPT_X[i] - SEG_W / 2 + 2, OPT_X[i] + SEG_W / 2 - 2, false);
  if (s.op === 'delayedstart') opt(0);
  if (s.remoteStart) opt(1);
  if (s.intensiveZone) opt(2);
  if (s.halfLoad) opt(4);
  // Child lock: the key over Speed Perfect lights.
  if (s.childLock) {
    g.strokeStyle = LED;
    keyMark(g);
  }
}

function keyMark(g: CanvasRenderingContext2D) {
  g.lineWidth = 3;
  g.beginPath();
  g.arc(OPT_X[5] - 10, 256, 5, 0, Math.PI * 2);
  g.moveTo(OPT_X[5] - 5, 256);
  g.lineTo(OPT_X[5] + 12, 256);
  g.moveTo(OPT_X[5] + 8, 256);
  g.lineTo(OPT_X[5] + 8, 261);
  g.stroke();
}

/* ---------- the maker's logo, embossed (light upper edge, dark lower edge) ---------- */

function logoTexture() {
  const c = canvas(1024, 256);
  const g = c.getContext('2d')!;
  const draw = (fill: string, stroke: string) => {
    g.fillStyle = fill;
    g.strokeStyle = stroke;
    g.lineWidth = 15;
    g.beginPath();
    g.arc(140, 128, 88, 0, Math.PI * 2);
    g.stroke();
    // Armature: two arcs joined by a bar.
    g.lineWidth = 13;
    g.beginPath();
    g.arc(100, 128, 52, -Math.PI / 2.5, Math.PI / 2.5);
    g.stroke();
    g.beginPath();
    g.arc(180, 128, 52, Math.PI - Math.PI / 2.5, Math.PI + Math.PI / 2.5);
    g.stroke();
    g.fillRect(104, 119, 72, 18);
    g.font = '800 168px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('BOSCH', 262, 136);
  };
  g.save();
  g.translate(-4, -4);
  draw('rgba(255,255,255,0.95)', 'rgba(255,255,255,0.95)');
  g.restore();
  g.save();
  g.translate(4, 4);
  draw('rgba(40,42,46,0.75)', 'rgba(40,42,46,0.75)');
  g.restore();
  draw('#b9bcc0', '#b9bcc0');
  return c;
}

/* ---------- studio light for the reflections ---------- */

function studio(): Scene {
  const s = new Scene();
  const room = new Mesh(new BoxGeometry(14, 9, 14), new MeshBasicMaterial({ color: '#b6b7b9', side: BackSide }));
  room.position.y = 3.5;
  s.add(room);
  const floor = new Mesh(new PlaneGeometry(14, 14), new MeshBasicMaterial({ color: '#3e3f41' }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.98;
  s.add(floor);
  const box = (w: number, h: number, pos: [number, number, number], intensity: number) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(1, 1, 1).multiplyScalar(intensity), side: DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0.4, 0);
    s.add(m);
  };
  box(0.5, 6, [0, 1.5, 5.5], 3.2); // narrow tall softbox in front: the bright band down the door
  box(1.1, 5, [-5.5, 1.8, 2.5], 2.0); // strips either side
  box(1.1, 5, [5.5, 1.8, 2.5], 1.5);
  box(6, 6, [0, 7, 0.5], 2.6); // overhead: the light lid top
  return s;
}

/* ---------- wire racks ---------- */

// Wires (cylinders) as instances of one mesh.
class Wires {
  private mats: Matrix4[] = [];
  private up = new Vector3(0, 1, 0);
  add(a: Vector3, b: Vector3, r = 0.0016) {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-5) return;
    const q = new Quaternion().setFromUnitVectors(this.up, d.normalize());
    this.mats.push(new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(r, len, r)));
  }
  line(pts: [number, number, number][], r?: number) {
    for (let i = 1; i < pts.length; i++) this.add(new Vector3(...pts[i - 1]), new Vector3(...pts[i]), r);
  }
  mesh(mat: Material) {
    const im = new InstancedMesh(new CylinderGeometry(1, 1, 1, 6, 1, true), mat, Math.max(1, this.mats.length));
    this.mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.count = this.mats.length;
    im.instanceMatrix.needsUpdate = true;
    return im;
  }
}

// A rack's top rim with the photos' U-shaped dips along it.
function wavyRim(xw: number, z0: number, z1: number, y: number, dip: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const corners: [number, number][] = [
    [-xw, z0],
    [xw, z0],
    [xw, z1],
    [-xw, z1],
    [-xw, z0],
  ];
  for (let c = 0; c < 4; c++) {
    const [ax, az] = corners[c];
    const [bx, bz] = corners[c + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(3, Math.round(len / 0.06));
    for (let i = 0; i < n; i++) {
      const f0 = i / n;
      const f1 = (i + 1) / n;
      const p = (f: number, yy: number): [number, number, number] => [ax + (bx - ax) * f, yy, az + (bz - az) * f];
      if (i % 2 === 1 && i < n - 1) {
        const e = 0.12 / n;
        pts.push(p(f0, y), p(f0 + e, y - dip), p(f1 - e, y - dip), p(f1, y));
      } else pts.push(p(f0, y), p(f1, y));
    }
  }
  return pts;
}

export class DishwasherViewer {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(28, 1, 0.05, 30);
  private controls: OrbitControls;
  private pmrem: PMREMGenerator;
  private door = new Group(); // pivot on the hinge line
  private upperRack = new Group();
  private lowerRack = new Group();
  private arms: Group[] = [];
  private water!: Points;
  private panel: { color: HTMLCanvasElement; emit: HTMLCanvasElement; maps: CanvasTexture[] } | null = null;
  private ghost: Material[] = [];
  private textures: Texture[] = [];
  private st: DishState = { power: false };
  private panelKey = '';
  private wantInside = false;
  private open = false; // door open (real or on demand)
  private racksOut = false; // racks pulled out (on demand only)
  private cutaway = false; // see-through door mid-cycle
  private doorAngle = 0;
  private doorVel = 0;
  private rack = 0; // 0 in … 1 out
  private rackVel = 0;
  private running = false;
  private dirty = true;
  private last = 0;
  private userHold = false;
  private resumeTimer = 0;
  private disposed = false;
  private aspect = 1;
  private camTarget = { pos: new Vector3(), look: new Vector3() };

  constructor(canvasEl: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.pmrem = new PMREMGenerator(this.renderer);
    const env = studio();
    this.scene.environment = this.pmrem.fromScene(env, 0.02).texture;
    env.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as Material).dispose();
      }
    });
    this.scene.add(new HemisphereLight('#ffffff', '#4a4b4e', 0.7));
    const key = new DirectionalLight('#ffffff', 0.7);
    key.position.set(-1.4, 2.4, 2.2);
    this.scene.add(key);
    const fill = new DirectionalLight('#eef2ff', 0.4);
    fill.position.set(1.6, 1, 1.4);
    this.scene.add(fill);

    this.buildCabinet();
    this.buildTub();
    this.buildLowerRack();
    this.buildUpperRack();
    this.buildDoor();
    this.buildWater();

    this.controls = new OrbitControls(this.camera, canvasEl);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.minPolarAngle = 0.45;
    this.controls.maxPolarAngle = 1.62;
    // One finger belongs to the page (swiping, scrolling); two turn the model.
    this.controls.touches = { ONE: null, TWO: TOUCH.DOLLY_ROTATE };
    canvasEl.style.touchAction = 'pan-y';
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.controls.addEventListener('start', () => {
      this.userHold = true;
      window.clearTimeout(this.resumeTimer);
      this.start();
    });
    this.controls.addEventListener('end', () => {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = window.setTimeout(() => {
        this.userHold = false;
        this.dirty = true;
        this.start();
      }, RESUME_MS);
    });
    this.frame(true);
  }

  private keep<T extends Material>(m: T): T {
    this.ghost.push(m);
    return m;
  }

  private track<T extends Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  // Brushed stainless: anisotropic highlights stretched across the grain.
  private steel(opts: { color?: string; rough?: number; aniso?: number; vertical?: boolean; repeat?: number; base?: number } = {}) {
    const t = this.track(tex(brushed(512, opts.base ?? 230, 13, opts.vertical)));
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(opts.repeat ?? 1.6, opts.repeat ?? 1.6);
    return new MeshPhysicalMaterial({
      map: t,
      color: opts.color ?? '#d2d1ce',
      metalness: 1,
      roughness: opts.rough ?? 0.3,
      anisotropy: opts.aniso ?? 0.8,
      anisotropyRotation: opts.vertical ? 0 : Math.PI / 2, // highlights smear across the grain
    });
  }

  /* ---------- cabinet: sides, back, lid, plinth, feet ---------- */

  private buildCabinet() {
    const sideMat = new MeshPhysicalMaterial({ color: '#b6b4b0', metalness: 0.65, roughness: 0.5 });
    const lidMat = new MeshPhysicalMaterial({ color: '#d9d7d3', metalness: 1, roughness: 0.4 });
    const plinthMat = this.steel({ rough: 0.2, aniso: 0.3, color: '#d6d5d2' });
    const black = new MeshStandardMaterial({ color: '#0a0a0b', roughness: 0.7 });
    const dark = new MeshStandardMaterial({ color: '#1c1d1f', roughness: 0.8 });
    const foot = new MeshStandardMaterial({ color: '#3c3d40', roughness: 0.6 });
    const top = H - LID;

    // Side panels: painted, a rounded front return where they meet the door.
    for (const sx of [-1, 1]) {
      const p = new Mesh(new RoundedBoxGeometry(0.003, top - 0.0084, D - 0.002, 2, 0.0014), sideMat);
      p.position.set(sx * (W / 2 - 0.0015), (top + 0.0084) / 2, -0.001);
      this.scene.add(p);
    }
    const back = new Mesh(new BoxGeometry(W - 0.01, top - 0.0084, 0.004), dark);
    back.position.set(0, (top + 0.0084) / 2, -D / 2 + 0.002);
    this.scene.add(back);

    // Lid: a sheet with a rounded bullnose front and rounded corners, a hair
    // wider than the body and over the front.
    const lid = new Mesh(new RoundedBoxGeometry(W + 0.004, LID, D + 0.012, 6, 0.009), lidMat);
    lid.position.set(0, H - LID / 2, 0.006);
    this.scene.add(lid);
    // The dark slot under the lid's lip, over the panel.
    const slot = new Mesh(new BoxGeometry(W - 0.012, 0.012, 0.02), black);
    slot.position.set(0, top - 0.004, FRONT - 0.03);
    this.scene.add(slot);

    // Plinth, flush with the door; the black gap above it; feet set in.
    const plinth = new Mesh(new BoxGeometry(W - 0.016, PLINTH_TOP - 0.0084, 0.012), plinthMat);
    plinth.position.set(0, (PLINTH_TOP + 0.0084) / 2, FRONT - 0.006);
    this.scene.add(plinth);
    const gap = new Mesh(new BoxGeometry(W - 0.016, HINGE - PLINTH_TOP + 0.004, 0.012), black);
    gap.position.set(0, (HINGE + PLINTH_TOP) / 2, FRONT - 0.03);
    this.scene.add(gap);
    const base = new Mesh(new BoxGeometry(W - 0.016, 0.004, D - 0.02), dark);
    base.position.set(0, 0.0104, 0);
    this.scene.add(base);
    const footGeo = new CylinderGeometry(0.016, 0.018, 0.0084, 20);
    for (const [x, z] of [[-0.255, 0.26], [0.255, 0.26], [-0.255, -0.26], [0.255, -0.26]]) {
      const f = new Mesh(footGeo, foot);
      f.position.set(x, 0.0042, z);
      this.scene.add(f);
    }

    // Soft contact shadow.
    const sh = canvas(128, 128);
    const g = sh.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 22, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const shadow = new Mesh(new PlaneGeometry(1.1, 1.1), new MeshBasicMaterial({ map: this.track(tex(sh)), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.0005, 0.03);
    this.scene.add(shadow);
  }

  /* ---------- tub: walls with embossed panels, riser, floor, filter, salt, lower arm ---------- */

  private buildTub() {
    // Embossed rounded panels on the walls (bump map).
    const bump = canvas(256, 256);
    const bg = bump.getContext('2d')!;
    bg.fillStyle = '#000';
    bg.fillRect(0, 0, 256, 256);
    bg.filter = 'blur(5px)';
    bg.fillStyle = '#fff';
    roundRect(bg, 26, 26, 204, 204, 22);
    bg.fill();
    const bumpTex = this.track(tex(bump, false));
    // Inside the closed box light bounces between the steel walls, which the
    // studio reflections alone don't give (they'd mirror the dark floor): a
    // partly diffuse steel and a soft light in the cavity keep it bright.
    const tub = this.steel({ vertical: true, rough: 0.34, aniso: 0.5, color: '#dcdddf' });
    tub.metalness = 0.5;
    tub.side = DoubleSide;
    tub.bumpMap = bumpTex;
    tub.bumpScale = 0.35;
    const plain = this.steel({ vertical: true, rough: 0.34, aniso: 0.5, color: '#dcdddf' });
    plain.metalness = 0.5;
    plain.side = DoubleSide;
    const glow = new PointLight('#ffffff', 0.9, 1.1, 1.2);
    glow.position.set(0, 0.62, 0.12);
    this.scene.add(glow);
    const tw = 0.54;
    const ty0 = 0.105;
    const ty1 = 0.8;
    const tz0 = -0.27;
    const tz1 = 0.255;
    const wall = (w: number, h: number, pos: [number, number, number], rot: [number, number, number], m: Material) => {
      const mesh = new Mesh(new PlaneGeometry(w, h), m);
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      this.scene.add(mesh);
    };
    wall(tz1 - tz0, ty1 - ty0, [-tw / 2, (ty0 + ty1) / 2, (tz0 + tz1) / 2], [0, Math.PI / 2, 0], tub);
    wall(tz1 - tz0, ty1 - ty0, [tw / 2, (ty0 + ty1) / 2, (tz0 + tz1) / 2], [0, -Math.PI / 2, 0], tub);
    wall(tw, ty1 - ty0, [0, (ty0 + ty1) / 2, tz0], [0, 0, 0], tub);
    wall(tw, tz1 - tz0, [0, ty1, (tz0 + tz1) / 2], [Math.PI / 2, 0, 0], plain);
    wall(tw, tz1 - tz0, [0, ty0, (tz0 + tz1) / 2], [-Math.PI / 2, 0, 0], plain);

    const greyPlastic = new MeshStandardMaterial({ color: '#8f9398', roughness: 0.55 });
    // Riser pipe up the back wall to the upper spray arm.
    const riser = new Mesh(new RoundedBoxGeometry(0.042, 0.34, 0.024, 3, 0.011), plain);
    riser.position.set(0, ty0 + 0.17, tz0 + 0.013);
    this.scene.add(riser);
    const bulge = new Mesh(new RoundedBoxGeometry(0.06, 0.07, 0.03, 3, 0.014), plain);
    bulge.position.set(0, ty0 + 0.1, tz0 + 0.016);
    this.scene.add(bulge);

    // Filter: perforated plate round the sump, the filter cup in the middle.
    const perf = this.track(tex(grid(256, 8, '#b9bbbd', '#55585c')));
    perf.wrapS = perf.wrapT = RepeatWrapping;
    perf.repeat.set(3, 3);
    const plateShape = new Shape();
    plateShape.moveTo(-0.11, 0.06);
    plateShape.quadraticCurveTo(0, 0.12, 0.11, 0.06);
    plateShape.quadraticCurveTo(0.08, -0.08, 0, -0.09);
    plateShape.quadraticCurveTo(-0.08, -0.08, -0.11, 0.06);
    const plate = new Mesh(new ExtrudeGeometry(plateShape, { depth: 0.003, bevelEnabled: false }), new MeshStandardMaterial({ map: perf, metalness: 0.6, roughness: 0.4 }));
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(0.02, ty0 + 0.001, 0.05);
    this.scene.add(plate);
    const cup = new Mesh(new CylinderGeometry(0.034, 0.03, 0.03, 32), greyPlastic);
    cup.position.set(0.02, ty0 + 0.015, 0.06);
    this.scene.add(cup);
    // Salt cap, front left: round grey screw cap with its lettering.
    const salt = canvas(256, 256);
    const sg = salt.getContext('2d')!;
    sg.fillStyle = '#8e9297';
    sg.fillRect(0, 0, 256, 256);
    sg.fillStyle = '#6c7075';
    sg.font = '600 22px Helvetica, Arial, sans-serif';
    sg.textAlign = 'center';
    sg.translate(128, 128);
    const words = 'SALZ · SALT · SEL · ZOUT · SO · TUZ · ';
    for (let i = 0; i < words.length; i++) {
      sg.save();
      sg.rotate((i / words.length) * Math.PI * 2);
      sg.fillText(words[i], 0, -96);
      sg.restore();
    }
    sg.font = '800 90px Helvetica, Arial, sans-serif';
    sg.fillText('S', 0, 32);
    const saltCap = new Mesh(new CylinderGeometry(0.045, 0.047, 0.014, 40), [
      greyPlastic,
      new MeshStandardMaterial({ map: this.track(tex(salt)), roughness: 0.55 }),
      greyPlastic,
    ]);
    saltCap.position.set(-0.15, ty0 + 0.007, 0.13);
    this.scene.add(saltCap);

    // Lower spray arm on the floor hub.
    const arm = this.sprayArm(0.43, 0.042, greyPlastic);
    arm.position.set(0.02, 0.126, 0.02);
    this.scene.add(arm);
    this.arms.push(arm);

    // Dark frame round the tub opening (behind the door edges).
    const gasket = new MeshStandardMaterial({ color: '#2a2b2e', roughness: 0.7 });
    const frame = (w: number, h: number, x: number, y: number) => {
      const m = new Mesh(new BoxGeometry(w, h, 0.03), gasket);
      m.position.set(x, y, tz1 + 0.012);
      this.scene.add(m);
    };
    const fw = (W - tw) / 2 - 0.008;
    frame(fw, ty1 - HINGE, -(tw / 2 + fw / 2), (ty1 + HINGE) / 2);
    frame(fw, ty1 - HINGE, tw / 2 + fw / 2, (ty1 + HINGE) / 2);
    frame(W - 0.016, H - LID - ty1 - 0.004, 0, (ty1 + H - LID - 0.004) / 2);
    frame(W - 0.016, ty0 - HINGE + 0.002, 0, (ty0 + HINGE) / 2);
  }

  // A curved, tapered spray arm with nozzle holes and its hub.
  private sprayArm(len: number, width: number, mat: Material) {
    const g = new Group();
    const s = new Shape();
    const n = 24;
    const half = len / 2;
    const top: [number, number][] = [];
    const bottom: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const x = -half + (i / n) * len;
      const f = Math.abs(x) / half;
      const w2 = (width / 2) * (1 - 0.45 * f);
      const bend = Math.sign(x) * f * f * 0.03; // the arms sweep back at the ends
      top.push([x, bend + w2]);
      bottom.push([x, bend - w2]);
    }
    s.moveTo(...top[0]);
    for (const p of top.slice(1)) s.lineTo(...p);
    for (const p of bottom.reverse()) s.lineTo(...p);
    s.closePath();
    const blade = new Mesh(new ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2 }), mat);
    blade.rotation.x = -Math.PI / 2;
    blade.position.y = -0.006;
    g.add(blade);
    const hole = new MeshBasicMaterial({ color: '#2c2f33' });
    for (const x of [-0.17, -0.11, -0.05, 0.06, 0.12, 0.18].map((v) => (v * len) / 0.43)) {
      const h = new Mesh(new CylinderGeometry(0.0025, 0.0025, 0.002, 10), hole);
      const f = Math.abs(x) / half;
      h.position.set(x, 0.0095, -(Math.sign(x) * f * f * 0.03));
      g.add(h);
    }
    const hub = new Mesh(new CylinderGeometry(0.024, 0.028, 0.026, 28), mat);
    g.add(hub);
    return g;
  }

  /* ---------- lower rack ---------- */

  private buildLowerRack() {
    const r = this.lowerRack;
    const frameMat = new MeshStandardMaterial({ color: '#b9bcc0', metalness: 0.2, roughness: 0.42 });
    const tineMat = new MeshStandardMaterial({ color: '#4a4d52', metalness: 0.1, roughness: 0.5 });
    const plastic = new MeshStandardMaterial({ color: '#9a9ea3', roughness: 0.55 });
    const red = new MeshStandardMaterial({ color: '#d22630', roughness: 0.45 });
    const frame = new Wires();
    const tines = new Wires();
    const xw = 0.252;
    const z0 = -0.245;
    const z1 = 0.235;
    const y = 0.14;
    const hgt = 0.13;

    frame.line([[-xw, y, z0], [xw, y, z0], [xw, y, z1], [-xw, y, z1], [-xw, y, z0]], 0.0024);
    frame.line(wavyRim(xw, z0, z1, y + hgt, 0.018), 0.0022);
    for (const z of [z0, z1]) for (let x = -xw; x <= xw + 1e-6; x += xw / 5) frame.add(new Vector3(x, y, z), new Vector3(x, y + hgt, z));
    for (let z = z0 + 0.048; z < z1; z += 0.048) for (const x of [-xw, xw]) frame.add(new Vector3(x, y, z), new Vector3(x, y + hgt, z));
    for (let x = -xw + 0.024; x < xw; x += 0.024) frame.add(new Vector3(x, y, z0), new Vector3(x, y, z1), 0.0014);
    for (const z of [z0 + 0.12, 0, z1 - 0.12]) frame.add(new Vector3(-xw, y - 0.003, z), new Vector3(xw, y - 0.003, z), 0.0022);
    // Fold-down plate tines, left two thirds, rows across the rack.
    for (let z = -0.19; z < 0.12; z += 0.038) {
      tines.add(new Vector3(-0.235, y + 0.012, z), new Vector3(0.07, y + 0.012, z), 0.0018);
      for (let x = -0.225; x < 0.07; x += 0.021) tines.add(new Vector3(x, y + 0.012, z), new Vector3(x, y + 0.14, z + 0.016), 0.0016);
    }
    r.add(frame.mesh(frameMat), tines.mesh(tineMat));
    // Wheels along both sides.
    const wheel = new CylinderGeometry(0.017, 0.017, 0.01, 20);
    for (const sx of [-1, 1]) {
      for (const z of [z0 + 0.035, 0, z1 - 0.035]) {
        const wh = new Mesh(wheel, plastic);
        wh.rotation.z = Math.PI / 2;
        wh.position.set(sx * (xw + 0.008), y - 0.005, z);
        r.add(wh);
      }
    }
    // Cutlery basket: three perforated modules, a grey handle with a red top.
    const perf = this.track(tex(grid(128, 16, '#a9adb2', '#5c6066')));
    perf.wrapS = perf.wrapT = RepeatWrapping;
    perf.repeat.set(2, 2);
    const basketMat = new MeshStandardMaterial({ map: perf, roughness: 0.6 });
    for (let i = 0; i < 3; i++) {
      const m = new Mesh(new RoundedBoxGeometry(0.064, 0.125, 0.11, 2, 0.006), basketMat);
      m.position.set(0.1 + i * 0.067, y + 0.065, 0.165);
      r.add(m);
    }
    for (const dx of [-0.07, 0.07]) {
      const post = new Mesh(new BoxGeometry(0.01, 0.06, 0.012), plastic);
      post.position.set(0.167 + dx, y + 0.155, 0.165);
      r.add(post);
    }
    const bar = new Mesh(new RoundedBoxGeometry(0.16, 0.016, 0.018, 2, 0.005), plastic);
    bar.position.set(0.167, y + 0.186, 0.165);
    r.add(bar);
    const barRed = new Mesh(new BoxGeometry(0.15, 0.004, 0.019), red);
    barRed.position.set(0.167, y + 0.195, 0.165);
    r.add(barRed);
    this.scene.add(r);
  }

  /* ---------- upper rack ---------- */

  private buildUpperRack() {
    const r = this.upperRack;
    const frameMat = new MeshStandardMaterial({ color: '#b3b6ba', metalness: 0.2, roughness: 0.42 });
    const plastic = new MeshStandardMaterial({ color: '#8f9398', roughness: 0.55 });
    const red = new MeshStandardMaterial({ color: '#d22630', roughness: 0.45 });
    const wires = new Wires();
    const xw = 0.25;
    const z0 = -0.24;
    const z1 = 0.23;
    const y = 0.47;
    const hgt = 0.11;

    wires.line([[-xw, y, z0], [xw, y, z0], [xw, y, z1], [-xw, y, z1], [-xw, y, z0]], 0.0024);
    wires.line(wavyRim(xw, z0, z1, y + hgt, 0.022), 0.0022);
    for (const z of [z0, z1]) for (let x = -xw; x <= xw + 1e-6; x += xw / 5) wires.add(new Vector3(x, y, z), new Vector3(x, y + hgt, z));
    for (let z = z0 + 0.047; z < z1; z += 0.047) for (const x of [-xw, xw]) wires.add(new Vector3(x, y, z), new Vector3(x, y + hgt, z));
    for (let x = -xw + 0.025; x < xw; x += 0.025) wires.add(new Vector3(x, y, z0), new Vector3(x, y, z1), 0.0014);
    for (const z of [z0 + 0.11, 0, z1 - 0.11]) wires.add(new Vector3(-xw, y - 0.003, z), new Vector3(xw, y - 0.003, z), 0.0022);
    // Cup tines in the middle: rows front to back, leaning.
    for (const x of [-0.09, -0.03, 0.03, 0.09]) {
      wires.add(new Vector3(x, y + 0.01, z0 + 0.02), new Vector3(x, y + 0.01, z1 - 0.02), 0.0015);
      for (let z = z0 + 0.03; z < z1 - 0.02; z += 0.032) wires.add(new Vector3(x, y + 0.01, z), new Vector3(x + 0.012, y + 0.085, z), 0.0014);
    }
    r.add(wires.mesh(frameMat));

    // Utensil tray along the left: grey plastic with a perforated floor.
    const perf = this.track(tex(grid(128, 14, '#9da1a6', '#575b60')));
    perf.wrapS = perf.wrapT = RepeatWrapping;
    perf.repeat.set(1, 4);
    const trayFloor = new Mesh(new BoxGeometry(0.085, 0.004, 0.45), new MeshStandardMaterial({ map: perf, roughness: 0.6 }));
    trayFloor.position.set(-0.205, y + 0.078, 0);
    r.add(trayFloor);
    for (const [w, d, x, z] of [[0.004, 0.45, -0.248, 0], [0.004, 0.45, -0.162, 0], [0.085, 0.004, -0.205, -0.225], [0.085, 0.004, -0.205, 0.225]] as const) {
      const wall = new Mesh(new BoxGeometry(w, 0.034, d), plastic);
      wall.position.set(x, y + 0.093, z);
      r.add(wall);
    }
    // Comb glass shelf on the right: notched upright plate and its fold-down ledge.
    const comb = new Shape();
    comb.moveTo(0, 0);
    comb.lineTo(0.36, 0);
    for (let i = 0; i < 9; i++) {
      const x = 0.36 - i * 0.04;
      comb.lineTo(x, 0.08);
      comb.lineTo(x - 0.012, 0.08);
      comb.lineTo(x - 0.016, 0.065);
      comb.lineTo(x - 0.036, 0.065);
      comb.lineTo(x - 0.04, 0.08);
    }
    comb.lineTo(0, 0.08);
    comb.closePath();
    const combMesh = new Mesh(new ExtrudeGeometry(comb, { depth: 0.004, bevelEnabled: false }), plastic);
    combMesh.rotation.y = -Math.PI / 2;
    combMesh.position.set(0.19, y + 0.02, -0.21);
    r.add(combMesh);
    const ledge = new Mesh(new BoxGeometry(0.06, 0.004, 0.36), plastic);
    ledge.position.set(0.22, y + 0.075, -0.03);
    ledge.rotation.z = 0.35;
    r.add(ledge);

    // Front handle: grey with a red top edge and the embossed logo.
    const logo = this.track(tex(logoTexture()));
    const handleFace = new MeshStandardMaterial({ color: '#9a9ea3', roughness: 0.5 });
    const handle = new Mesh(new RoundedBoxGeometry(0.13, 0.044, 0.02, 3, 0.005), handleFace);
    handle.position.set(0, y + 0.06, z1 + 0.012);
    r.add(handle);
    const mark = new Mesh(new PlaneGeometry(0.06, 0.015), new MeshStandardMaterial({ map: logo, transparent: true, opacity: 0.55, roughness: 0.5 }));
    mark.position.set(0, y + 0.056, z1 + 0.0225);
    r.add(mark);
    const stripe = new Mesh(new RoundedBoxGeometry(0.13, 0.006, 0.021, 2, 0.002), red);
    stripe.position.set(0, y + 0.083, z1 + 0.012);
    r.add(stripe);
    // Height adjusters and rollers on the sides.
    for (const sx of [-1, 1]) {
      const lever = new Mesh(new RoundedBoxGeometry(0.012, 0.05, 0.03, 2, 0.004), plastic);
      lever.position.set(sx * (xw + 0.006), y + 0.04, z1 - 0.06);
      r.add(lever);
      for (const z of [z0 + 0.04, z1 - 0.12]) {
        const roller = new Mesh(new CylinderGeometry(0.012, 0.012, 0.008, 16), plastic);
        roller.rotation.z = Math.PI / 2;
        roller.position.set(sx * (xw + 0.008), y + 0.03, z);
        r.add(roller);
      }
      // Inner rail (slides with the rack).
      const inner = new Mesh(new BoxGeometry(0.006, 0.014, 0.42), new MeshStandardMaterial({ color: '#c4c7cb', metalness: 0.8, roughness: 0.3 }));
      inner.position.set(sx * (xw + 0.014), y + 0.03, -0.01);
      r.add(inner);
    }
    // Upper spray arm under the rack.
    const arm = this.sprayArm(0.36, 0.036, plastic);
    arm.position.set(0, y - 0.016, -0.01);
    r.add(arm);
    this.arms.push(arm);
    this.scene.add(r);

    // Outer rails on the tub walls, with grey end stops.
    const railTex = canvas(256, 32);
    const rg = railTex.getContext('2d')!;
    rg.fillStyle = '#c9ccd0';
    rg.fillRect(0, 0, 256, 32);
    rg.fillStyle = '#5d6166';
    for (let x = 20; x < 256; x += 40) {
      rg.beginPath();
      rg.arc(x, 16, 4, 0, Math.PI * 2);
      rg.fill();
    }
    const railMat = new MeshStandardMaterial({ map: this.track(tex(railTex)), metalness: 0.8, roughness: 0.3 });
    for (const sx of [-1, 1]) {
      const rail = new Mesh(new BoxGeometry(0.008, 0.024, 0.5), railMat);
      rail.position.set(sx * 0.266, y + 0.03, -0.005);
      this.scene.add(rail);
      const stop = new Mesh(new RoundedBoxGeometry(0.012, 0.03, 0.02, 2, 0.004), plastic);
      stop.position.set(sx * 0.266, y + 0.03, 0.24);
      this.scene.add(stop);
    }
  }

  /* ---------- door with the control panel ---------- */

  private buildDoor() {
    // The door pivots on its inner bottom edge; `d` holds it in door space
    // (front face at z = 0, bottom at y = 0).
    this.door.position.set(0, HINGE, FRONT - DOOR_T);
    const d = new Group();
    d.position.z = DOOR_T;
    this.door.add(d);

    const faceMat = this.keep(this.steel({ repeat: 1 / 0.6, rough: 0.17, aniso: 0.45 }));
    faceMat.map!.repeat.set(1 / 0.6, 1 / 0.6);
    const edgeMat = this.keep(this.steel({ rough: 0.35, aniso: 0.5 }));
    const scoopMat = this.keep(new MeshPhysicalMaterial({ color: '#7e8083', metalness: 1, roughness: 0.2, side: DoubleSide }));
    const dw = W - 0.006;

    // Body behind the face, left open where the scoop goes in.
    const slab = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
      const m = new Mesh(new BoxGeometry(x1 - x0, y1 - y0, z1 - z0), edgeMat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      d.add(m);
    };
    const back = -DOOR_T;
    slab(-dw / 2, dw / 2, 0, SCOOP_Y - 0.002, back, -0.005);
    slab(-dw / 2, dw / 2, STRIP_Y0, DOOR_H, back, -0.005);
    slab(-dw / 2, -MOD, SCOOP_Y - 0.002, STRIP_Y0, back, -0.005);
    slab(MOD, dw / 2, SCOOP_Y - 0.002, STRIP_Y0, back, -0.005);
    slab(-MOD, MOD, SCOOP_Y - 0.002, STRIP_Y0, back, -0.044);

    // Face: one brushed sheet folded round its edges (the bevel catches the
    // light like the photos' bright edge line), notched for the scoop.
    const R = 0.011; // scoop corner radius
    const face = new Shape();
    face.moveTo(-dw / 2, 0);
    face.lineTo(dw / 2, 0);
    face.lineTo(dw / 2, FACE_TOP);
    face.lineTo(MOD, FACE_TOP);
    face.lineTo(MOD, SCOOP_Y + R);
    face.quadraticCurveTo(MOD, SCOOP_Y, MOD - R, SCOOP_Y);
    face.lineTo(-MOD + R, SCOOP_Y);
    face.quadraticCurveTo(-MOD, SCOOP_Y, -MOD, SCOOP_Y + R);
    face.lineTo(-MOD, FACE_TOP);
    face.lineTo(-dw / 2, FACE_TOP);
    face.closePath();
    const faceMesh = new Mesh(new ExtrudeGeometry(face, { depth: 0.002, bevelEnabled: true, bevelSize: 0.0022, bevelThickness: 0.0022, bevelSegments: 3, curveSegments: 12 }), faceMat);
    faceMesh.position.z = -0.0044;
    d.add(faceMesh);
    const seam = new Mesh(new BoxGeometry(dw, 0.0014, 0.004), new MeshBasicMaterial({ color: '#4a4b4c' }));
    seam.position.set(0, FACE_TOP + 0.0004, -0.002);
    d.add(seam);

    // Scoop: a polished quarter-round recess under the strip, closed at the ends.
    const r = STRIP_Y0 - SCOOP_Y;
    const shell = new Shape();
    shell.moveTo(0, -r);
    shell.absarc(0, 0, r, -Math.PI / 2, -Math.PI, true);
    shell.lineTo(-r - 0.004, 0);
    shell.lineTo(-r - 0.004, -r - 0.004);
    shell.lineTo(0, -r - 0.004);
    shell.closePath();
    const scoop = new Mesh(new ExtrudeGeometry(shell, { depth: MOD * 2 - 0.004, bevelEnabled: false, curveSegments: 28 }), scoopMat);
    scoop.rotation.y = -Math.PI / 2; // shape x -> into the door, extrusion -> −x
    scoop.position.set(MOD - 0.002, STRIP_Y0, -0.002);
    d.add(scoop);
    const cap = new Shape();
    cap.moveTo(0, 0);
    cap.lineTo(0, -r);
    cap.absarc(0, 0, r, -Math.PI / 2, -Math.PI, true);
    cap.closePath();
    for (const sx of [-1, 1]) {
      const c = new Mesh(new ExtrudeGeometry(cap, { depth: 0.001, bevelEnabled: false, curveSegments: 28 }), scoopMat);
      c.rotation.y = -Math.PI / 2;
      c.position.set(sx * (MOD - 0.002) + (sx < 0 ? 0.001 : 0), STRIP_Y0, -0.002);
      d.add(c);
    }

    // Control panel (canvases): colour, emissive (LEDs, LCD), metalness mask.
    const pw = Math.round(W * PX);
    const ph = Math.round(PANEL_H * PX);
    const color = canvas(pw, ph);
    const emit = canvas(pw, ph);
    const metal = canvas(pw, ph);
    const mg = metal.getContext('2d')!;
    mg.fillStyle = '#d0d0d0';
    mg.fillRect(0, 0, pw, ph);
    mg.fillStyle = '#000';
    roundRect(mg, FRAME[0] + 14, FRAME[2] + 14, FRAME[1] - FRAME[0] - 28, ph, 10);
    mg.fill();
    const maps = [tex(color), tex(emit), tex(metal, false)];
    this.textures.push(...maps);
    this.panel = { color, emit, maps };
    const panelMat = this.keep(
      new MeshPhysicalMaterial({
        map: maps[0],
        emissiveMap: maps[1],
        emissive: '#ffffff',
        emissiveIntensity: 1.5,
        metalnessMap: maps[2],
        metalness: 1,
        roughness: 0.46,
      }),
    );
    const panel = new Mesh(new PlaneGeometry(dw, PANEL_H), panelMat);
    panel.position.set(0, FACE_TOP + PANEL_H / 2, 0.0004);
    d.add(panel);
    this.drawPanel();

    // Power and Start knobs: domed steel caps.
    const knobMat = this.keep(new MeshPhysicalMaterial({ color: '#dddcd8', metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 }));
    const knobProfile = [
      [0, 0.0068],
      [0.004, 0.0066],
      [0.0085, 0.0058],
      [0.0106, 0.0042],
      [0.0115, 0.0022],
      [0.0117, 0],
    ].map(([x, y]) => new Vector2(x, y));
    const knobGeo = new LatheGeometry(knobProfile, 64);
    for (const x of [POWER_X, START_X]) {
      const k = new Mesh(knobGeo, knobMat);
      k.rotation.x = Math.PI / 2;
      k.position.set(x / PX - W / 2, DOOR_H - KNOB_Y / PX, 0.0005);
      d.add(k);
    }

    // Logo strip: polished chrome bar with the embossed logo.
    const chrome = this.keep(new MeshPhysicalMaterial({ color: '#eceef0', metalness: 1, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05 }));
    const strip = new Mesh(new RoundedBoxGeometry(MOD * 2, STRIP_Y1 - STRIP_Y0, 0.008, 4, 0.0025), chrome);
    strip.position.set(0, (STRIP_Y0 + STRIP_Y1) / 2, 0.0005);
    d.add(strip);
    const logo = this.track(tex(logoTexture()));
    const decal = new Mesh(new PlaneGeometry(0.062, 0.0155), this.keep(new MeshPhysicalMaterial({ map: logo, transparent: true, metalness: 0.9, roughness: 0.2 })));
    decal.position.set(0.006, (STRIP_Y0 + STRIP_Y1) / 2, 0.0047);
    d.add(decal);

    // Inside of the door: steel liner with a raised rim, rails, the dispenser.
    const liner = this.keep(this.steel({ vertical: true, rough: 0.26, aniso: 0.5, color: '#c4c5c6' }));
    const inner = new Mesh(new PlaneGeometry(0.5, 0.6), liner);
    inner.rotation.y = Math.PI;
    inner.position.set(0, 0.35, back - 0.004);
    d.add(inner);
    for (const [w, h, x, y] of [[0.53, 0.018, 0, 0.04], [0.53, 0.018, 0, 0.66], [0.018, 0.64, -0.257, 0.35], [0.018, 0.64, 0.257, 0.35]] as const) {
      const rim = new Mesh(new RoundedBoxGeometry(w, h, 0.012, 2, 0.004), liner);
      rim.position.set(x, y, back - 0.004);
      d.add(rim);
    }
    const plasticMat = this.keep(new MeshStandardMaterial({ color: '#8d9196', roughness: 0.5 }));
    for (const sx of [-1, 1]) {
      const rail = new Mesh(new BoxGeometry(0.008, 0.5, 0.008), plasticMat);
      rail.position.set(sx * 0.23, 0.3, back - 0.012);
      d.add(rail);
    }
    const gasket = new Mesh(new BoxGeometry(dw - 0.02, 0.012, 0.008), this.keep(new MeshStandardMaterial({ color: '#2b2c2f', roughness: 0.7 })));
    gasket.position.set(0, DOOR_H - 0.03, back - 0.004);
    d.add(gasket);
    d.add(this.dispenser(plasticMat, back));
    this.scene.add(this.door);
  }

  // Detergent dispenser on the inner door: grey base, big hinged lid with
  // the fan of embossed lines, latch with three dots, pre-wash cup.
  private dispenser(mat: Material, back: number) {
    const g = new Group();
    g.position.set(0.02, 0.56, back - 0.01);
    g.rotation.y = Math.PI;
    const base = new Mesh(new RoundedBoxGeometry(0.21, 0.11, 0.01, 3, 0.004), mat);
    g.add(base);
    const lidTex = canvas(256, 160);
    const lg = lidTex.getContext('2d')!;
    lg.fillStyle = '#9599a0';
    lg.fillRect(0, 0, 256, 160);
    lg.strokeStyle = '#6a6e74';
    lg.lineWidth = 4;
    lg.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const a = -0.5 + i * 0.22;
      lg.beginPath();
      lg.moveTo(200 + Math.cos(a + Math.PI) * 20, 110 + Math.sin(a + Math.PI) * 20);
      lg.lineTo(200 + Math.cos(a + Math.PI) * 70, 110 + Math.sin(a + Math.PI) * 70);
      lg.stroke();
    }
    lg.strokeStyle = 'rgba(255,255,255,0.35)';
    lg.lineWidth = 3;
    lg.strokeRect(6, 6, 244, 148);
    const lid = new Mesh(new RoundedBoxGeometry(0.115, 0.075, 0.008, 3, 0.003), [mat, mat, mat, mat, this.keep(new MeshStandardMaterial({ map: this.track(tex(lidTex)), roughness: 0.5 })), mat]);
    lid.position.set(0.035, -0.005, 0.008);
    g.add(lid);
    const latch = new Mesh(new RoundedBoxGeometry(0.03, 0.018, 0.012, 2, 0.003), mat);
    latch.position.set(-0.03, 0.03, 0.009);
    g.add(latch);
    const cupMat = this.keep(new MeshStandardMaterial({ color: '#6f7379', roughness: 0.55 }));
    const cup = new Mesh(new BoxGeometry(0.045, 0.04, 0.004), cupMat);
    cup.position.set(-0.065, -0.02, 0.006);
    g.add(cup);
    return g;
  }

  private buildWater() {
    const n = 420;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
    const drop = canvas(32, 32);
    const dg = drop.getContext('2d')!;
    const grad = dg.createRadialGradient(16, 16, 2, 16, 16, 15);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    dg.fillStyle = grad;
    dg.fillRect(0, 0, 32, 32);
    this.water = new Points(geo, new PointsMaterial({ color: '#1f8bff', map: this.track(tex(drop)), size: 0.026, transparent: true, opacity: 0.95, depthWrite: false }));
    this.water.userData.seed = Array.from({ length: n }, () => [Math.random(), Math.random(), Math.random(), Math.random() < 0.6 ? 0 : 1]);
    this.water.frustumCulled = false; // its bounds change every frame
    this.water.visible = false;
    this.scene.add(this.water);
  }

  private drawPanel() {
    if (!this.panel) return;
    const key = JSON.stringify(this.st);
    if (key === this.panelKey) return;
    this.panelKey = key;
    drawPanel(this.panel.color.getContext('2d')!, this.st, 'color');
    drawPanel(this.panel.emit.getContext('2d')!, this.st, 'emit');
    this.panel.maps[0].needsUpdate = true;
    this.panel.maps[1].needsUpdate = true;
  }

  /* ---------- state ---------- */

  setState(s: DishState) {
    this.st = s;
    this.drawPanel();
    this.applyView();
  }

  // Look inside: opens the door and pulls the racks out, or mid-cycle shows the cutaway.
  setInside(on: boolean) {
    this.wantInside = on;
    this.applyView();
  }

  get inside() {
    return this.wantInside;
  }

  private applyView() {
    const running = ['run', 'pause', 'delayedstart'].includes(this.st.op ?? '');
    const realOpen = this.st.door === 'open';
    this.open = realOpen || (this.wantInside && !running);
    this.racksOut = this.wantInside && !running && !realOpen;
    const cut = this.wantInside && running && !realOpen;
    if (cut !== this.cutaway) {
      this.cutaway = cut;
      for (const m of this.ghost) {
        const u = m.userData as { opacity?: number; transparent?: boolean };
        if (u.opacity === undefined) {
          u.opacity = m.opacity;
          u.transparent = m.transparent;
        }
        m.transparent = cut || !!u.transparent;
        m.opacity = cut ? 0.14 : u.opacity!;
        m.depthWrite = !cut;
        m.needsUpdate = true;
      }
    }
    this.water.visible = cut && this.st.op === 'run';
    this.frame(false);
    this.dirty = true;
    this.start();
  }

  private animating() {
    if (reduced()) return false;
    return this.cutaway && this.st.op === 'run';
  }

  // Front-left three-quarter view, a little above (as in the maker's kitchen
  // photo); with the door open, higher and further so the racks show.
  private frame(snap: boolean) {
    const open = this.open;
    const look = open ? new Vector3(0, 0.27, 0.3) : new Vector3(0, 0.42, 0);
    const dir = (open ? new Vector3(-0.45, 0.62, 1) : new Vector3(-0.5, 0.27, 1)).normalize();
    // Narrow stages need more distance to keep the whole machine in view.
    const dist = (open ? 3.25 : 2.3) * Math.max(1, 0.95 / this.aspect);
    this.camTarget = { pos: look.clone().addScaledVector(dir, dist), look };
    if (snap || reduced()) {
      this.camera.position.copy(this.camTarget.pos);
      this.controls?.target.copy(look);
    }
    this.controls?.update();
  }

  resize(w: number, h: number) {
    if (!w || !h) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.frame(!this.running && this.last === 0);
    this.dirty = true;
    this.start();
  }

  /* ---------- loop ---------- */

  // Door and racks move on damped springs: the door eases out of its catch,
  // swings down and settles against its stop with a small rebound; the racks
  // roll out only once the door is down, and go back in before it closes.
  private stepMotion(dt: number) {
    if (reduced()) {
      const doorTo = this.open ? OPEN : 0;
      const changed = this.doorAngle !== doorTo || this.rack !== (this.racksOut ? 1 : 0);
      this.doorAngle = doorTo;
      this.rack = this.racksOut ? 1 : 0;
      this.doorVel = this.rackVel = 0;
      this.place();
      return changed;
    }
    const doorDown = this.doorAngle > OPEN - 0.05;
    const rackTo = this.racksOut && doorDown ? 1 : 0;
    const doorTo = this.open || this.rack > 0.02 ? OPEN : 0;
    const spring = (x: number, v: number, to: number, k: number, zeta: number, h: number): [number, number] => {
      const a = k * (to - x) - 2 * zeta * Math.sqrt(k) * v;
      v += a * h;
      return [x + v * h, v];
    };
    const n = 4;
    for (let i = 0; i < n; i++) {
      const h = dt / n;
      [this.doorAngle, this.doorVel] = spring(this.doorAngle, this.doorVel, doorTo, 16, 0.7, h);
      if (this.doorAngle > OPEN) {
        this.doorAngle = OPEN;
        this.doorVel = -this.doorVel * 0.22;
      } else if (this.doorAngle < 0) {
        this.doorAngle = 0;
        this.doorVel = -this.doorVel * 0.12;
      }
      [this.rack, this.rackVel] = spring(this.rack, this.rackVel, rackTo, 22, 1, h);
      this.rack = Math.max(0, Math.min(1, this.rack));
    }
    const moving = Math.abs(this.doorVel) > 1e-3 || Math.abs(this.doorAngle - doorTo) > 1e-4 || Math.abs(this.rackVel) > 1e-3 || Math.abs(this.rack - rackTo) > 1e-4;
    if (!moving) {
      this.doorAngle = doorTo;
      this.rack = rackTo;
      this.doorVel = this.rackVel = 0;
    }
    this.place();
    return moving;
  }

  private place() {
    this.door.rotation.x = this.doorAngle;
    this.lowerRack.position.z = this.rack * 0.26;
    this.upperRack.position.z = this.rack * 0.16;
  }

  private tick = (t: number) => {
    if (document.hidden) return;
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0;
    this.last = t;
    let busy = this.stepMotion(dt);

    if (this.animating()) {
      this.arms[0].rotation.y += dt * 5;
      this.arms[1].rotation.y -= dt * 6.5;
      this.moveWater(t / 1000);
      busy = true;
    }

    if (!this.userHold) {
      const k = 1 - Math.exp(-dt * 2.6);
      const dp = this.camera.position.distanceTo(this.camTarget.pos);
      const dl = this.controls.target.distanceTo(this.camTarget.look);
      if (dp > 0.002 || dl > 0.002) {
        this.camera.position.lerp(this.camTarget.pos, k);
        this.controls.target.lerp(this.camTarget.look, k);
        busy = true;
      }
    }
    if (this.controls.update()) this.dirty = true;
    if (busy) this.dirty = true;
    if (this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    } else if (!this.userHold) {
      this.stop();
    }
  };

  // Each drop leaves a spray arm along a jet, rises and falls back over ~1 s.
  private moveWater(time: number) {
    const pos = this.water.geometry.getAttribute('position') as Float32BufferAttribute;
    const seeds = this.water.userData.seed as number[][];
    for (let i = 0; i < seeds.length; i++) {
      const [a, b, c, arm] = seeds[i];
      const ph = (time * 0.9 + a) % 1;
      const y0 = arm ? 0.455 : 0.13;
      const reach = arm ? 0.16 : 0.2;
      const ang = b * Math.PI * 2 + time * (arm ? -6.5 : 5) * 0.15;
      const rad = (0.04 + c * reach) * (0.6 + ph * 0.4);
      pos.setXYZ(i, Math.cos(ang) * rad, y0 + ph * (arm ? 0.24 : 0.3) - ph * ph * 0.18, Math.sin(ang) * rad * 0.9);
    }
    pos.needsUpdate = true;
  }

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.last = 0;
    this.renderer.setAnimationLoop(this.tick);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  wake() {
    this.dirty = true;
    this.start();
  }

  dispose() {
    this.disposed = true;
    this.stop();
    window.clearTimeout(this.resumeTimer);
    this.controls.dispose();
    this.scene.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (!m.isMesh && !(o as Points).isPoints) return;
      m.geometry.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
    });
    this.textures.forEach((t) => t.dispose());
    this.scene.environment?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

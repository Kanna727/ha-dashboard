import {
  ACESFilmicToneMapping,
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Shape,
  SRGBColorSpace,
  TOUCH,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { columnStages } from '../lib/desk';

// The owner's standing desk, built from primitives (no model file) after the
// maker's product photos and frame drawing: a four-leg frame, two rectangular
// three-stage columns per side (wide stage at the bottom, a lip where each
// narrower stage comes out), joined at the floor by a flat foot with tapered
// ends and four levelling pads; an end bracket under the top on each side,
// two long telescoping beams between them (a wider sleeve in the middle), one
// motor per side on the inside of a column top, the control box in the middle
// and the keypad under the front edge on the right (arrow and M keys, a
// display, four memory keys, a USB-C port). Maple-look top, black frame.
//
// Metres. Floor y = 0, the user stands at +z, the desk is centred on x = 0.
// The height is the top surface's, as the keypad shows it. Renders on demand:
// nothing runs while the desk is still.

export interface DeskLook {
  top?: [number, number]; // cm, width × depth
  board?: string; // top colour
  frame?: string; // frame colour
}

const T = 0.025; // top thickness
const BRACKET_H = 0.032;
const FOOT_TOP = 0.036; // foot (and its levelling pads) height
const RESUME_MS = 8000;
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Column stages, bottom to top: width across the desk (x) and front-to-back (z).
const STAGES: [number, number][] = [
  [0.062, 0.084],
  [0.054, 0.074],
  [0.046, 0.064],
];

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(Math.min(255, Math.max(0, k > 0 ? v + (255 - v) * k : v * (1 + k)))));
  return `rgb(${c.join(',')})`;
}

// Maple-look laminate: a pale honey board with long, fine, slightly wavy grain
// along the desk and a few soft darker streaks.
function woodTexture(color: string): CanvasTexture {
  const W = 2048;
  const H = 1024;
  return canvasTexture(W, H, (g) => {
    const rand = seeded(7);
    g.fillStyle = color;
    g.fillRect(0, 0, W, H);
    // Broad soft bands of lighter and darker wood.
    for (let i = 0; i < 26; i++) {
      const y = rand() * H;
      const h = 20 + rand() * 90;
      const grad = g.createLinearGradient(0, y - h, 0, y + h);
      const c = rand() > 0.5 ? shade(color, 0.1) : shade(color, -0.07);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(0.5, c);
      grad.addColorStop(1, 'transparent');
      g.globalAlpha = 0.12 + rand() * 0.16;
      g.fillStyle = grad;
      g.fillRect(0, y - h, W, h * 2);
    }
    // Fine grain lines, gently wavy.
    for (let i = 0; i < 520; i++) {
      const y0 = rand() * H;
      const amp = 1 + rand() * 6;
      const freq = 0.0015 + rand() * 0.004;
      const ph = rand() * 10;
      g.globalAlpha = 0.03 + rand() * 0.09;
      g.strokeStyle = rand() > 0.4 ? shade(color, -0.2) : shade(color, 0.18);
      g.lineWidth = 0.6 + rand() * 1.6;
      g.beginPath();
      for (let x = 0; x <= W; x += 16) {
        const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph * 2) * amp * 0.3;
        if (x) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
    // A few small darker flecks (maple's pin knots), stretched along the grain.
    for (let i = 0; i < 60; i++) {
      g.globalAlpha = 0.08 + rand() * 0.12;
      g.fillStyle = shade(color, -0.35);
      g.beginPath();
      g.ellipse(rand() * W, rand() * H, 3 + rand() * 8, 0.8 + rand() * 1.5, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

export class DeskViewer {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.05, 30);
  private controls: OrbitControls;
  private pmrem: PMREMGenerator;
  private top = new Group(); // everything that rides on the columns; y = the top surface
  private mids: Mesh[] = []; // middle stages
  private uppers: Mesh[] = []; // top stages
  private midLips: Mesh[] = [];
  private cable?: Mesh;
  private cableMat!: Material;
  private cableH = -1;
  private ghost = new Group();
  private display!: CanvasTexture;
  private displayText = '';
  private textures: Texture[] = [];
  private W: number;
  private D: number;
  private look: Required<DeskLook>;
  private goal = 0.75; // m
  private shown = -1;
  private running = false;
  private dirty = true;
  private last = 0;
  private userHold = false;
  private resumeTimer = 0;
  private disposed = false;
  private aspect = 1;
  private home = { pos: new Vector3(), look: new Vector3(0, 0.6, 0) };

  constructor(canvas: HTMLCanvasElement, look: DeskLook = {}) {
    this.look = { top: look.top ?? [140, 70], board: look.board ?? '#cf9452', frame: look.frame ?? '#17181b' };
    this.W = this.look.top[0] / 100;
    this.D = this.look.top[1] / 100;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    const sun = new DirectionalLight('#fff6ea', 1.4);
    sun.position.set(1.2, 2.4, 1.6);
    this.scene.add(sun);

    this.build();
    this.layout(this.goal); // until the first reading arrives

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = 1.52;
    // One finger belongs to the page (scrolling the popup); two turn the desk. The mouse drags it.
    this.controls.touches = { ONE: null, TWO: TOUCH.DOLLY_ROTATE };
    canvas.style.touchAction = 'pan-y';
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.controls.addEventListener('start', () => {
      this.userHold = true;
      window.clearTimeout(this.resumeTimer);
      this.start();
    });
    this.controls.addEventListener('end', () => {
      window.clearTimeout(this.resumeTimer);
      // Glide back to the usual view a while after the last drag.
      this.resumeTimer = window.setTimeout(() => {
        this.userHold = false;
        this.wake();
      }, RESUME_MS);
    });
    this.frame(true);
  }

  /* ---------- building ---------- */

  private build() {
    const L = this.look;
    const { W, D } = this;
    const frame = new MeshPhysicalMaterial({ color: L.frame, roughness: 0.5, metalness: 0.35, clearcoat: 0.3, clearcoatRoughness: 0.5 });
    const plastic = new MeshStandardMaterial({ color: '#0f1012', roughness: 0.75 });
    const rubber = new MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.95 });
    const steel = new MeshStandardMaterial({ color: '#8d9198', metalness: 0.9, roughness: 0.35 });

    // Desktop: rounded slab, maple on every face.
    const wood = woodTexture(L.board);
    this.textures.push(wood);
    const board = new Mesh(new RoundedBoxGeometry(W, T, D, 4, 0.006), new MeshPhysicalMaterial({ map: wood, roughness: 0.48, clearcoat: 0.25, clearcoatRoughness: 0.35 }));
    board.position.y = -T / 2;
    this.top.add(board);
    // Its underside is plain particle board with the frame screwed on.
    const under = new Mesh(new PlaneGeometry(W - 0.02, D - 0.02), new MeshStandardMaterial({ color: shade(L.board, -0.25), roughness: 0.9 }));
    under.rotation.x = Math.PI / 2;
    under.position.y = -T - 0.0005;
    this.top.add(under);

    const sideX = W / 2 - 0.11; // the frame sits ~11 cm in from each end
    const legZ = 0.185; // front and back columns, either side of the bracket's middle
    const bz = -0.01; // the frame is a little behind the top's middle

    for (const s of [-1, 1]) {
      const x = s * sideX;

      // End bracket under the top: a channel with chamfered ends and a mounting plate.
      const bracket = new Mesh(new RoundedBoxGeometry(0.056, BRACKET_H, 0.6, 2, 0.004), frame);
      bracket.position.set(x, -T - BRACKET_H / 2, bz);
      this.top.add(bracket);
      for (const e of [-1, 1]) {
        const end = new Mesh(new BoxGeometry(0.07, 0.006, 0.05), frame);
        end.position.set(x, -T - 0.003, bz + e * 0.29);
        this.top.add(end);
      }

      // Columns: bottom stage fixed, middle and top come out with the height.
      for (const z of [-legZ, legZ]) {
        const [w1, d1] = STAGES[0];
        const bottom = new Mesh(new RoundedBoxGeometry(w1, 1, d1, 2, 0.006), frame);
        const [len1] = columnStages(1);
        bottom.scale.y = len1;
        bottom.position.set(x, FOOT_TOP + len1 / 2, bz + z);
        this.scene.add(bottom);
        const lip1 = new Mesh(new RoundedBoxGeometry(w1 + 0.004, 0.012, d1 + 0.004, 2, 0.003), plastic);
        lip1.position.set(x, FOOT_TOP + len1 - 0.004, bz + z);
        this.scene.add(lip1);

        const [w2, d2] = STAGES[1];
        const mid = new Mesh(new RoundedBoxGeometry(w2, 1, d2, 2, 0.003), frame);
        mid.position.set(x, 0, bz + z);
        this.scene.add(mid);
        this.mids.push(mid);
        const lip2 = new Mesh(new RoundedBoxGeometry(w2 + 0.004, 0.01, d2 + 0.004, 2, 0.003), plastic);
        lip2.position.set(x, 0, bz + z);
        this.scene.add(lip2);
        this.midLips.push(lip2);

        const [w3, d3] = STAGES[2];
        const upper = new Mesh(new RoundedBoxGeometry(w3, 1, d3, 2, 0.003), frame);
        upper.position.set(x, 0, bz + z);
        this.scene.add(upper);
        this.uppers.push(upper);

        // Mounting block where the column meets the bracket.
        const block = new Mesh(new BoxGeometry(w3 + 0.012, 0.022, d3 + 0.012), frame);
        block.position.set(x, -T - BRACKET_H - 0.011, bz + z);
        this.top.add(block);
      }

      // Foot: a flat bar with tapered ends, longer than the bracket, on four pads.
      const len = 0.68;
      const h = FOOT_TOP - 0.008;
      const prof = new Shape();
      prof.moveTo(-len / 2, 0);
      prof.lineTo(len / 2, 0);
      prof.lineTo(len / 2, h * 0.45);
      prof.quadraticCurveTo(len / 2 - 0.01, h, len / 2 - 0.07, h);
      prof.lineTo(-len / 2 + 0.07, h);
      prof.quadraticCurveTo(-len / 2 + 0.01, h, -len / 2, h * 0.45);
      prof.closePath();
      const foot = new Mesh(new ExtrudeGeometry(prof, { depth: 0.07, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2 }), frame);
      foot.rotation.y = Math.PI / 2; // the profile runs front to back
      foot.position.set(x - 0.035, 0.008, bz);
      this.scene.add(foot);
      for (const z of [-0.3, 0.3]) {
        const pad = new Mesh(new CylinderGeometry(0.016, 0.018, 0.008, 20), rubber);
        pad.position.set(x, 0.004, bz + z);
        this.scene.add(pad);
      }

      // Motor: a cylinder on the inside of one column top per side (front left, back right).
      const motorZ = bz + (s < 0 ? legZ : -legZ);
      const motor = new Mesh(new CylinderGeometry(0.022, 0.022, 0.1, 24), plastic);
      motor.rotation.z = Math.PI / 2;
      motor.position.set(x - s * 0.08, -T - BRACKET_H - 0.024, motorZ);
      this.top.add(motor);
      const cap = new Mesh(new CylinderGeometry(0.0225, 0.0225, 0.012, 24), steel);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(x - s * 0.135, -T - BRACKET_H - 0.024, motorZ);
      this.top.add(cap);
    }

    // Two long beams between the brackets (front and back), each telescoping
    // through a wider sleeve in the middle.
    for (const z of [bz + 0.13, bz - 0.21]) {
      const beam = new Mesh(new RoundedBoxGeometry(2 * sideX - 0.05, 0.026, 0.036, 2, 0.003), frame);
      beam.position.set(0, -T - 0.016, z);
      this.top.add(beam);
      const sleeve = new Mesh(new RoundedBoxGeometry(0.32, 0.032, 0.042, 2, 0.004), frame);
      sleeve.position.set(0, -T - 0.019, z);
      this.top.add(sleeve);
      for (const bx of [-0.12, 0.12]) {
        const bolt = new Mesh(new CylinderGeometry(0.004, 0.004, 0.002, 10), steel);
        bolt.position.set(bx, -T - 0.0355, z);
        this.top.add(bolt);
      }
    }

    // Control box in the middle, under the top between the beams.
    const box = new Mesh(new RoundedBoxGeometry(0.26, 0.036, 0.095, 3, 0.006), plastic);
    box.position.set(0, -T - 0.018, bz - 0.04);
    this.top.add(box);

    this.buildKeypad();

    // The keypad's cable runs under the top to the control box.
    const kx = W / 2 - 0.2;
    const kc = new CatmullRomCurve3(
      [
        [kx - 0.06, -T - 0.012, D / 2 - 0.07],
        [kx - 0.2, -T - 0.006, D / 2 - 0.12],
        [0.4, -T - 0.006, bz + 0.06],
        [0.13, -T - 0.02, bz - 0.04],
      ].map(([a, b, c]) => new Vector3(a, b, c)),
    );
    this.cableMat = rubber;
    this.top.add(new Mesh(new TubeGeometry(kc, 40, 0.0028, 6, false), rubber));

    // Soft contact shadow under the desk.
    const shadowTex = canvasTexture(256, 128, (g) => {
      const grad = g.createRadialGradient(128, 64, 10, 128, 64, 128);
      grad.addColorStop(0, 'rgba(0,0,0,0.5)');
      grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 128);
    });
    this.textures.push(shadowTex);
    const shadow = new Mesh(new PlaneGeometry(W + 0.6, D + 0.5), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.0005;
    this.scene.add(shadow);

    // Where the desk is going: a see-through outline of the top at the target height.
    const plane = new Mesh(new PlaneGeometry(W, D), new MeshBasicMaterial({ color: '#8b7cf6', transparent: true, opacity: 0.16, depthWrite: false }));
    plane.rotation.x = -Math.PI / 2;
    this.ghost.add(plane);
    const edges = new LineSegments(new EdgesGeometry(new PlaneGeometry(W, D)), new LineBasicMaterial({ color: '#a99cff', transparent: true, opacity: 0.85 }));
    edges.rotation.x = -Math.PI / 2;
    this.ghost.add(edges);
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this.scene.add(this.top);
  }

  // The keypad under the front edge on the right: a black box whose face has
  // up/down and M keys, the height display, four memory keys and a USB-C port.
  private buildKeypad() {
    const k = new Group();
    const w = 0.17;
    const h = 0.032;
    const d = 0.07;
    k.position.set(this.W / 2 - 0.2, -T - h / 2, this.D / 2 - d / 2 + 0.006);
    const body = new Mesh(new RoundedBoxGeometry(w, h, d, 3, 0.006), new MeshPhysicalMaterial({ color: '#0d0e10', roughness: 0.3, clearcoat: 0.6 }));
    k.add(body);
    this.display = canvasTexture(1024, 192, () => undefined);
    this.textures.push(this.display);
    this.drawKeypad('--.-');
    const face = new Mesh(new PlaneGeometry(w - 0.008, h - 0.006), new MeshBasicMaterial({ map: this.display, toneMapped: false }));
    face.position.z = d / 2 + 0.0004;
    k.add(face);
    this.top.add(k);
  }

  private drawKeypad(text: string) {
    const c = this.display.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    g.fillStyle = '#0d0e10';
    g.fillRect(0, 0, W, H);
    const key = (x: number, y: number, r: number, label: string | ((cx: number, cy: number) => void)) => {
      g.strokeStyle = '#8c9099';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#c9ccd2';
      g.strokeStyle = '#c9ccd2';
      if (typeof label === 'function') label(x, y);
      else {
        g.font = `700 ${Math.round(r * 1.05)}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(label, x, y + 2);
      }
    };
    const chevron = (dir: 1 | -1) => (x: number, y: number) => {
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(x - 14, y + dir * 7);
      g.lineTo(x, y - dir * 7);
      g.lineTo(x + 14, y + dir * 7);
      g.stroke();
    };
    const cy = H / 2;
    key(80, cy, 36, chevron(1));
    key(175, cy, 36, chevron(-1));
    key(270, cy, 36, 'M');
    // The display: white digits, a faint glow.
    g.save();
    g.font = '700 108px "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(255,255,255,0.55)';
    g.shadowBlur = 14;
    g.fillStyle = '#f4f6fa';
    g.fillText(text, 470, cy + 6);
    g.restore();
    // Memory keys in a 2 × 2 grid.
    const gx = [650, 735];
    const gy = [cy - 44, cy + 44];
    ['1', '2', '3', '4'].forEach((l, i) => key(gx[i % 2], gy[Math.floor(i / 2)], 30, l));
    // USB-C port and its label.
    g.fillStyle = '#26282d';
    g.beginPath();
    g.roundRect(850, cy - 13, 74, 26, 13);
    g.fill();
    g.fillStyle = '#000';
    g.beginPath();
    g.roundRect(860, cy - 6, 54, 12, 6);
    g.fill();
    g.fillStyle = '#7d828b';
    g.font = '600 26px sans-serif';
    g.textAlign = 'center';
    g.fillText('USB-C', 887, cy + 46);
    this.display.needsUpdate = true;
  }

  /* ---------- state ---------- */

  // The top surface's height in cm, as the desk reports it.
  setHeight(cm: number | undefined) {
    if (cm === undefined || !Number.isFinite(cm)) return;
    const first = this.shown < 0;
    this.goal = cm / 100;
    if (first || reduced()) {
      this.shown = this.goal;
      this.layout(this.shown);
    }
    this.frame(first);
    this.wake();
  }

  // The keypad display's text (it follows the reported height).
  setDisplay(text: string) {
    if (text === this.displayText) return;
    this.displayText = text;
    this.drawKeypad(text);
    this.wake();
  }

  // A height being picked (cm), shown as an outline; undefined hides it.
  setTarget(cm: number | undefined) {
    this.ghost.visible = cm !== undefined;
    if (cm !== undefined) this.ghost.position.y = cm / 100;
    this.frame(false);
    this.wake();
  }

  private layout(h: number) {
    this.top.position.y = h;
    const colTop = h - T - BRACKET_H - 0.022; // under the mounting block
    const [v1, v2, v3] = columnStages(colTop - FOOT_TOP);
    const midTop = FOOT_TOP + v1 + v2;
    for (const m of this.mids) {
      const bottom = FOOT_TOP + v1 - 0.06; // hidden inside the bottom stage
      m.scale.y = midTop - bottom;
      m.position.y = (midTop + bottom) / 2;
    }
    for (const l of this.midLips) l.position.y = midTop - 0.003;
    for (const u of this.uppers) {
      const bottom = midTop - 0.06;
      const top = colTop + 0.004;
      u.scale.y = top - bottom;
      u.position.y = (top + bottom) / 2;
    }
    void v3;
    this.layoutCable(h);
  }

  // The power cable hangs from the control box to the floor behind the desk.
  private layoutCable(h: number) {
    if (Math.abs(h - this.cableH) < 0.004) return;
    this.cableH = h;
    const x = -0.1;
    const y0 = h - T - 0.03;
    const curve = new CatmullRomCurve3(
      [
        [x, y0, -0.1],
        [x, y0 - 0.03, -0.24],
        [x - 0.02, y0 * 0.55, -0.34],
        [x - 0.04, 0.03, -0.38],
        [x - 0.12, 0.004, -0.5],
        [x - 0.3, 0.004, -0.62],
      ].map(([a, b, c]) => new Vector3(a, b, c)),
    );
    const geo = new TubeGeometry(curve, 48, 0.0035, 6, false);
    if (this.cable) {
      this.cable.geometry.dispose();
      this.cable.geometry = geo;
    } else {
      this.cable = new Mesh(geo, this.cableMat);
      this.scene.add(this.cable);
    }
  }

  // A front-right three-quarter view, a little above, fitting the desk from the
  // floor to its top (or the target outline): the camera follows the height.
  private frame(snap: boolean) {
    const fov = (this.camera.fov * Math.PI) / 180;
    const h = Math.max(this.goal, this.ghost.visible ? this.ghost.position.y : 0);
    const halfH = h / 2 + 0.25; // the front feet come forward of the middle, so lower on screen
    // Narrow stages (phones): leave room on the right for the hold buttons.
    const narrow = this.aspect < 1.4;
    const halfW = this.W / 2 + (narrow ? 0.32 : 0.1);
    const dist = Math.max(halfH / Math.tan(fov / 2), halfW / (Math.tan(fov / 2) * this.aspect));
    const look = new Vector3(narrow ? 0.2 : 0.03, h / 2 - 0.07, 0);
    const dir = new Vector3(0.62, 0.4, 1).normalize();
    this.home = { pos: look.clone().addScaledVector(dir, dist), look };
    if (snap || reduced()) {
      this.camera.position.copy(this.home.pos);
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
    this.frame(!this.userHold);
    this.dirty = true;
    this.renderOnce();
  }

  /* ---------- loop ---------- */

  private tick = (t: number) => {
    if (document.hidden) return;
    const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : 0;
    this.last = t;
    // Glide towards the reported height (it arrives in steps while moving).
    if (Math.abs(this.goal - this.shown) > 0.0002) {
      this.shown += (this.goal - this.shown) * (1 - Math.exp(-dt * 7));
      this.layout(this.shown);
      this.dirty = true;
    } else if (this.shown !== this.goal) {
      this.shown = this.goal;
      this.layout(this.shown);
      this.dirty = true;
    }
    if (!this.userHold) {
      const k = 1 - Math.exp(-dt * 3);
      if (this.camera.position.distanceTo(this.home.pos) > 0.002 || this.controls.target.distanceTo(this.home.look) > 0.002) {
        this.camera.position.lerp(this.home.pos, k);
        this.controls.target.lerp(this.home.look, k);
        this.dirty = true;
      }
    }
    if (this.controls.update()) this.dirty = true;
    if (this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    } else if (!this.userHold) {
      this.stop(); // still: sleep until something changes
    }
  };

  private renderOnce() {
    if (this.running) return;
    this.renderer.render(this.scene, this.camera);
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
    const mats = new Set<Material>();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh && !(o as LineSegments).isLineSegments) return;
      m.geometry.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
    });
    mats.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.scene.environment?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

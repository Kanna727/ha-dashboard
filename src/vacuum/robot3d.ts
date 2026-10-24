import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Points,
  PointsMaterial,
  RepeatWrapping,
  RingGeometry,
  Scene,
  ShadowMaterial,
  Shape,
  SRGBColorSpace,
  TOUCH,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// The owner's robot vacuum and its auto-empty dock, built from primitives (no
// model file), measured off the maker's product photos (hero shot on the dock,
// three-quarter, front, side, top and underside views, the dock alone and the
// emptying cutaway).
//
// Robot (Ø 350 mm, 80 mm to the lid, 97 mm over the turret): a vertical side
// wall with a tight rounded shoulder into the flat lid; a thin groove ring
// round the lid and a seam across it through the turret, ending in notches
// where the front bumper ends (a gap runs down the wall there). The bumper
// (front half) carries the glossy black window and a light-grey lower skirt;
// the back half a clear smoky tank lip that flares out at the floor, and a
// perforated grille on the left rear only. The turret is low: a light-grey
// collar in a shadow gap, the orange laser drum between four white posts and a
// white cap. Ahead of it a grey pill with two buttons, side by side across the
// robot (the front one's ring is the status LED). Black treaded wheels show
// under the sides, the white side brush front right.
//
// Dock: a white tower with rounded edges, an inverted L in profile: the
// dust-bag chamber on top overhangs an open bay (glossy black ceiling curving
// down into the back wall), on a long thin base plate with a ramp, wheel pads
// and two charging contacts. The robot docks front first, so the docked view
// shows its back (and the grille), as the photos do.
//
// Metres. Robot: front +z, floor y = 0. Dock: behind the origin (−z); a docked
// robot sits at the origin facing −z.
//
// States: docked → on the dock, still; emptying → dock and robot go see-through
// and blue airflow runs from the plate up the spine into the bag, swirling
// through the cyclone; cleaning/returning → off the dock, turning slowly with
// the brush and laser spinning. The battery is a ring on the floor. Renders on
// demand: nothing runs while it's still.

export interface RobotLook {
  body?: string; // shell colour
  laser?: string; // the turret drum
  dock?: boolean; // show the dock while docked
}

export interface RobotState {
  state?: string; // vacuum entity state
  battery?: number; // 0–100
  tone: 'active' | 'ok' | 'warn' | 'idle';
  emptying?: boolean; // the dock is emptying the robot's bin
}

const R = 0.175; // robot radius
const LID = 0.08; // lid height
const TZ = 0.045; // turret centre, ahead of the robot's centre
const BUMPER = Math.acos(TZ / R); // angle (from the front) where the bumper ends, in line with the seam
// Dock (docked robot at the origin, facing −z).
const DW = 0.285; // width (the maker lists the station at 397 deep × 285 wide × 384 tall)
const DH = 0.384; // height
const BACK = -0.24; // back face (the plate runs to 397 mm in front of it, just short of a docked robot's back)
const SPINE = -0.182; // the bay's back wall
const CHAMBER = -0.04; // the chamber's front face
const CEIL = 0.165; // the bay's ceiling at the front
const BAY_LOW = 0.105; // where its curve meets the back wall
const PLATE = 0.012; // base plate thickness (the docked robot stands on it)
const RESUME_MS = 8000;
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const LED: Record<RobotState['tone'], string> = { active: '#8b7cf6', ok: '#ffffff', warn: '#fb923c', idle: '#5b6478' };
const batteryColor = (pct: number) => (pct <= 20 ? '#f87171' : pct <= 50 ? '#fbbf24' : '#34d399');

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, color = true): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  if (color) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
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

// A band on the robot's side wall: `from`/`to` are angles from the front (+z), towards +x (its left).
function band(r: number, y0: number, y1: number, from: number, to: number, mat: Material, segs = 48) {
  const m = new Mesh(new CylinderGeometry(r, r, y1 - y0, segs, 1, true, from, to - from), mat);
  m.position.y = (y0 + y1) / 2;
  return m;
}

// A turned part over an arc of angles (same convention as band).
function lathe(profile: [number, number][], from = 0, to = Math.PI * 2, segs = 96) {
  return new LatheGeometry(
    profile.map(([x, y]) => new Vector2(x, y)),
    segs,
    from,
    to - from,
  );
}

// The dock's bay in side view (x = z, y = height): from the chamber's front
// edge, one curve back and down into the back wall, then down to the plate.
function bayCurve(): Vector2[] {
  const pts: Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    pts.push(new Vector2(u * u * CHAMBER + 2 * u * t * SPINE + t * t * SPINE, u * u * CEIL + 2 * u * t * CEIL + t * t * BAY_LOW));
  }
  pts.push(new Vector2(SPINE, PLATE));
  return pts;
}

// The curve moved by `d` into the dock's shell (negative: out into the bay).
function offsetCurve(pts: Vector2[], d: number): Vector2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const t = b.clone().sub(a).normalize();
    return new Vector2(p.x + t.y * d, p.y - t.x * d);
  });
}

export class RobotViewer {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.05, 20);
  private controls: OrbitControls;
  private pmrem: PMREMGenerator;
  private robot = new Group();
  private dock = new Group();
  private inside = new Group(); // airflow, bag and cyclone, shown while emptying
  private brush = new Group();
  private laser = new Group();
  private wheels: Mesh[] = [];
  private ring = new Group();
  private swirl = new Group();
  private floor!: Mesh;
  private flowMaps: Texture[] = [];
  private led!: MeshBasicMaterial;
  private ringFill!: Mesh;
  private ringMat!: MeshBasicMaterial;
  private body!: MeshPhysicalMaterial;
  // Materials that turn see-through for the emptying cutaway, with their normal opacity.
  private ghost: { mat: Material; robot: boolean }[] = [];
  private textures: Texture[] = [];
  private st: RobotState = { tone: 'idle' };
  private look: Required<RobotLook>;
  private running = false;
  private dirty = true;
  private last = 0;
  private userHold = false;
  private resumeTimer = 0;
  private disposed = false;
  private camTarget = { pos: new Vector3(), look: new Vector3() };

  constructor(canvas: HTMLCanvasElement, look: RobotLook = {}) {
    this.look = { body: look.body ?? '#f4f5f7', laser: look.laser ?? '#ff5a1f', dock: look.dock ?? true };
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.62;
    // Key light from above, front left: it shades the side wall and the shoulder
    // as in the photos, and casts the soft shadows (dock over the robot, robot on the plate).
    const sun = new DirectionalLight('#ffffff', 1.5);
    sun.position.set(-0.7, 1.6, 0.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -0.5;
    sun.shadow.camera.right = sun.shadow.camera.top = 0.5;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 3.5;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.002;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    const rim = new DirectionalLight('#eef3ff', 0.35);
    rim.position.set(1, 0.5, -0.8);
    this.scene.add(rim);

    this.buildRobot();
    this.buildDock();
    this.buildInside();
    this.buildRing();
    // Shadows land on an invisible floor (the page shows through).
    this.floor = new Mesh(new PlaneGeometry(3, 3), new ShadowMaterial({ opacity: 0.18 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.35;
    this.controls.autoRotateSpeed = 1.2;
    // On touch screens one finger belongs to the page (swiping between pages,
    // scrolling): the robot turns with two fingers. The mouse still drags it.
    this.controls.touches = { ONE: null, TWO: TOUCH.DOLLY_ROTATE };
    canvas.style.touchAction = 'pan-y';
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.controls.addEventListener('start', () => {
      this.userHold = true;
      window.clearTimeout(this.resumeTimer);
      this.start(); // the loop may be asleep while the robot is still
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

  private keep<T extends Material>(m: T, robot: boolean): T {
    this.ghost.push({ mat: m, robot });
    return m;
  }

  private track<T extends Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  // Every mesh in a group casts and receives shadows.
  private shadows(g: Object3D) {
    g.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
  }

  /* ---------- the robot ---------- */

  private buildRobot() {
    const L = this.look;
    const r = this.robot;
    const white = this.keep((this.body = new MeshPhysicalMaterial({ color: L.body, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.22 })), true);
    const skirt = this.keep(new MeshPhysicalMaterial({ color: '#d3d6db', roughness: 0.5, clearcoat: 0.3 }), true);
    const groove = this.keep(new MeshStandardMaterial({ color: '#9da3ac', roughness: 0.6 }), true);
    const gap = this.keep(new MeshStandardMaterial({ color: '#59606a', roughness: 0.7 }), true);
    const black = this.keep(new MeshPhysicalMaterial({ color: '#05070a', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }), true);
    const chassis = this.keep(new MeshStandardMaterial({ color: '#3a3f47', roughness: 0.85 }), true);
    const smoke = this.keep(new MeshPhysicalMaterial({ color: '#8c95a0', roughness: 0.08, transparent: true, opacity: 0.55, clearcoat: 1, side: DoubleSide }), true);
    const tyre = this.keep(new MeshStandardMaterial({ color: '#1a1c1f', roughness: 0.9 }), true);
    const collarMat = this.keep(new MeshPhysicalMaterial({ color: '#d5d9de', metalness: 0.35, roughness: 0.32, clearcoat: 0.5 }), true);

    // Chassis plate underneath, and the wheels and front caster that show below the wall.
    const base = new Mesh(new CylinderGeometry(R - 0.014, R - 0.024, 0.006, 64), chassis);
    base.position.y = 0.011;
    r.add(base);
    const treadTex = this.track(
      canvasTexture(256, 32, (g) => {
        g.fillStyle = '#1a1c1f';
        g.fillRect(0, 0, 256, 32);
        g.fillStyle = '#34373c';
        for (let x = 0; x < 256; x += 8) g.fillRect(x, 4, 4, 24);
      }),
    );
    treadTex.wrapS = RepeatWrapping;
    treadTex.repeat.set(3, 1);
    const tread = this.keep(new MeshStandardMaterial({ map: treadTex, roughness: 0.9 }), true);
    for (const s of [-1, 1]) {
      const w = new Mesh(new CylinderGeometry(0.034, 0.034, 0.022, 32), [tread, tyre, tyre]);
      w.rotation.z = Math.PI / 2;
      w.position.set(s * 0.118, 0.034, -0.005);
      r.add(w);
      this.wheels.push(w);
    }
    const caster = new Mesh(new CylinderGeometry(0.011, 0.011, 0.012, 20), tyre);
    caster.rotation.z = Math.PI / 2;
    caster.position.set(0, 0.011, 0.128);
    r.add(caster);

    // Shell: vertical side wall, tight rounded shoulder, flat lid.
    r.add(
      new Mesh(
        lathe([
          [R - 0.006, 0.024],
          [R, 0.029],
          [R, 0.066],
          [R - 0.0008, 0.0712],
          [R - 0.003, 0.0753],
          [R - 0.0068, 0.0783],
          [R - 0.0115, 0.0797],
          [R - 0.014, LID],
          [0, LID],
        ]),
        white,
      ),
    );

    // Front half (bumper): light-grey lower skirt under a shadow line.
    r.add(new Mesh(lathe([[R - 0.012, 0.0105], [R - 0.0045, 0.0125], [R - 0.0015, 0.018], [R - 0.0005, 0.0285]], -BUMPER, BUMPER, 72), skirt));
    r.add(band(R + 0.0002, 0.0285, 0.0293, -BUMPER, BUMPER, groove, 72));
    // Back half: the clear smoky tank lip, flaring out at the floor over a dark mop plate.
    r.add(new Mesh(lathe([[R - 0.03, 0.008], [R - 0.004, 0.0085], [R + 0.0035, 0.0125], [R + 0.004, 0.019], [R + 0.0005, 0.026], [R - 0.004, 0.0285]], BUMPER, Math.PI * 2 - BUMPER, 72), smoke));
    const mop = new Mesh(lathe([[R - 0.06, 0.0075], [R - 0.008, 0.0078], [R - 0.004, 0.0105]], BUMPER + 0.1, Math.PI * 2 - BUMPER - 0.1, 64), chassis);
    r.add(mop);
    // The tank's grey release tabs, one each side just behind the wheels.
    for (const s of [-1, 1]) {
      const a = s * (BUMPER + 0.42);
      const tab = new Mesh(new RoundedBoxGeometry(0.022, 0.007, 0.004, 2, 0.0018), this.keep(new MeshStandardMaterial({ color: '#9aa1aa', roughness: 0.5 }), true));
      tab.position.set(Math.sin(a) * (R + 0.003), 0.0175, Math.cos(a) * (R + 0.003));
      tab.rotation.y = a;
      r.add(tab);
    }

    // Where the bumper ends: a gap down the wall, and a notch in the rim.
    for (const s of [-1, 1]) {
      const a = s * BUMPER;
      const slit = new Mesh(new PlaneGeometry(0.0022, 0.06), gap);
      slit.position.set(Math.sin(a) * (R + 0.0004), 0.041, Math.cos(a) * (R + 0.0004));
      slit.rotation.y = a;
      r.add(slit);
      const notch = new Mesh(new RoundedBoxGeometry(0.0035, 0.004, 0.009, 1, 0.001), black);
      notch.position.set(Math.sin(a) * (R - 0.004), LID - 0.0025, Math.cos(a) * (R - 0.004));
      notch.rotation.y = a;
      r.add(notch);
    }

    // Lid: the groove ring near the edge, the seam across it through the turret.
    const ring = new Mesh(new RingGeometry(R - 0.0152, R - 0.014, 128), groove);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = LID + 0.0002;
    r.add(ring);
    const xEnd = Math.sqrt((R - 0.0146) ** 2 - TZ * TZ);
    for (const s of [-1, 1]) {
      const len = xEnd - 0.05;
      const seam = new Mesh(new PlaneGeometry(len, 0.0011), groove);
      seam.rotation.x = -Math.PI / 2;
      seam.position.set(s * (0.05 + len / 2), LID + 0.0002, TZ);
      r.add(seam);
    }

    // Grille: a perforated panel with rounded ends on the left rear of the wall.
    const g0 = Math.PI / 2 - 0.02;
    const g1 = Math.PI + 0.12;
    const gw = (g1 - g0) * R; // m
    const gh = 0.024;
    const pxm = 7000; // px per metre
    const dots = this.track(
      canvasTexture(Math.round(gw * pxm), Math.round(gh * pxm), (g) => {
        const w = g.canvas.width;
        const h = g.canvas.height;
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#e4e6e9';
        roundRect(g, 2, 2, w - 4, h - 4, h / 2);
        g.fill();
        g.save();
        g.clip();
        g.fillStyle = '#5d646e';
        const p = 0.0016 * pxm;
        for (let y = p * 0.55, row = 0; y < h; y += p * 0.87, row++)
          for (let x = row % 2 ? p / 2 : 0; x < w; x += p) {
            g.beginPath();
            g.arc(x, y, p * 0.36, 0, Math.PI * 2);
            g.fill();
          }
        g.restore();
      }),
    );
    r.add(band(R + 0.0003, 0.041, 0.041 + gh, g0, g1, this.keep(new MeshPhysicalMaterial({ map: dots, roughness: 0.5, clearcoat: 0.4 }), true), 64));

    // Front window (structured light / camera): glossy black, rounded ends.
    const winW = 0.058;
    const winH = 0.02;
    const win = this.track(
      canvasTexture(512, Math.round((512 * winH) / winW), (g) => {
        const w = g.canvas.width;
        const h = g.canvas.height;
        g.fillStyle = '#000';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#fff';
        roundRect(g, 2, 2, w - 4, h - 4, h / 2);
        g.fill();
      }, false),
    );
    const winMat = this.keep(new MeshPhysicalMaterial({ color: '#05070a', roughness: 0.05, clearcoat: 1, alphaMap: win, alphaTest: 0.5 }), true);
    r.add(band(R + 0.0006, 0.047 - winH / 2, 0.047 + winH / 2, -winW / R / 2, winW / R / 2, winMat, 24));

    // Button pill ahead of the turret, lying across the robot: home and power
    // buttons; the power button's ring is the status LED.
    const pw = 0.036;
    const ph = 0.014;
    const stadium = new Shape();
    stadium.absarc(pw / 2 - ph / 2, 0, ph / 2, -Math.PI / 2, Math.PI / 2, false);
    stadium.absarc(-pw / 2 + ph / 2, 0, ph / 2, Math.PI / 2, (Math.PI * 3) / 2, false);
    const face = this.track(
      canvasTexture(360, 140, (g) => {
        g.fillStyle = '#d9dce1';
        g.fillRect(0, 0, 360, 140);
        g.lineWidth = 5;
        for (const cx of [90, 270]) {
          g.fillStyle = '#e9ebee';
          g.strokeStyle = '#bfc4cb';
          g.beginPath();
          g.arc(cx, 70, 50, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
        g.strokeStyle = '#7f8690';
        g.lineWidth = 7;
        g.lineJoin = g.lineCap = 'round';
        g.beginPath(); // home
        g.moveTo(66, 74);
        g.lineTo(90, 52);
        g.lineTo(114, 74);
        g.moveTo(73, 68);
        g.lineTo(73, 92);
        g.lineTo(107, 92);
        g.lineTo(107, 68);
        g.stroke();
        g.beginPath(); // power
        g.arc(270, 74, 21, -Math.PI * 0.32, Math.PI * 1.32);
        g.moveTo(270, 46);
        g.lineTo(270, 70);
        g.stroke();
      }),
    );
    face.repeat.set(1 / pw, 1 / ph);
    face.offset.set(0.5, 0.5);
    const pillMesh = new Mesh(new ExtrudeGeometry(stadium, { depth: 0.0012, bevelEnabled: true, bevelSize: 0.0006, bevelThickness: 0.0006, bevelSegments: 2, curveSegments: 16 }), [
      this.keep(new MeshPhysicalMaterial({ map: face, roughness: 0.35, clearcoat: 0.6 }), true),
      this.keep(new MeshPhysicalMaterial({ color: '#d9dce1', roughness: 0.35, clearcoat: 0.6 }), true),
    ]);
    pillMesh.rotation.x = -Math.PI / 2;
    pillMesh.position.set(0, LID, TZ + 0.075);
    r.add(pillMesh);
    this.led = new MeshBasicMaterial({ color: LED.idle });
    const ledRing = new Mesh(new RingGeometry(0.0051, 0.0058, 32), this.led);
    ledRing.rotation.x = -Math.PI / 2;
    ledRing.position.set(0.009, LID + 0.0025, TZ + 0.075);
    r.add(ledRing);

    // Turret: shadow gap and light-grey collar in the lid, the orange drum between
    // four white posts behind dark slots, a white cap with a rounded edge.
    const turret = new Group();
    turret.position.set(0, LID, TZ);
    const well = new Mesh(new RingGeometry(0.0455, 0.0485, 64), groove);
    well.rotation.x = -Math.PI / 2;
    well.position.y = 0.0003;
    turret.add(well);
    turret.add(new Mesh(lathe([[0.0458, 0], [0.0458, 0.0016], [0.0445, 0.0026], [0.039, 0.0026]], 0, Math.PI * 2, 64), collarMat));
    const drumMat = this.keep(new MeshStandardMaterial({ color: L.laser, emissive: new Color(L.laser), emissiveIntensity: 0.25, roughness: 0.35 }), true);
    const inner = new Mesh(new CylinderGeometry(0.0335, 0.0335, 0.0082, 40), this.keep(new MeshStandardMaterial({ color: '#202328', roughness: 0.6 }), true));
    inner.position.y = 0.0067;
    turret.add(inner);
    const drum = new Mesh(new CylinderGeometry(0.0352, 0.0352, 0.0072, 48), drumMat);
    drum.position.y = 0.0067;
    this.laser.add(drum);
    for (const a of [0, Math.PI]) {
      const lens = new Mesh(new CylinderGeometry(0.0354, 0.0354, 0.005, 10, 1, true, a - 0.09, 0.18), black);
      lens.position.y = 0.0067;
      this.laser.add(lens);
    }
    turret.add(this.laser);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const post = new Mesh(new RoundedBoxGeometry(0.0085, 0.0084, 0.006, 2, 0.0015), white);
      post.position.set(Math.sin(a) * 0.036, 0.0068, Math.cos(a) * 0.036);
      post.rotation.y = a;
      turret.add(post);
    }
    turret.add(
      new Mesh(
        lathe([
          [0, 0.0106],
          [0.0385, 0.0106],
          [0.0399, 0.0113],
          [0.0406, 0.0127],
          [0.0406, 0.0152],
          [0.0398, 0.0165],
          [0.0382, 0.0171],
          [0, 0.0171],
        ], 0, Math.PI * 2, 72),
        white,
      ),
    );
    r.add(turret);

    // White side brush, front right (the robot's right is −x): three flat arms
    // with bristle tufts, reaching past the wall.
    this.brush.position.set(-0.112, 0.006, 0.112);
    this.brush.rotation.x = 0.06;
    const brushMat = this.keep(new MeshStandardMaterial({ color: '#e7e9ec', roughness: 0.75, side: DoubleSide }), true);
    const hubMat = this.keep(new MeshStandardMaterial({ color: '#c9cdd3', roughness: 0.5 }), true);
    this.brush.add(new Mesh(new CylinderGeometry(0.012, 0.013, 0.005, 24), hubMat));
    const tuft = new Shape();
    tuft.moveTo(0.011, -0.0015);
    tuft.lineTo(0.05, -0.0018);
    tuft.lineTo(0.071, -0.008);
    tuft.lineTo(0.073, 0.004);
    tuft.lineTo(0.05, 0.0018);
    tuft.lineTo(0.011, 0.0015);
    tuft.closePath();
    const tuftGeo = new ExtrudeGeometry(tuft, { depth: 0.0012, bevelEnabled: false });
    for (let i = 0; i < 3; i++) {
      const arm = new Mesh(tuftGeo, brushMat);
      arm.rotation.set(-Math.PI / 2, 0, (i * Math.PI * 2) / 3);
      arm.position.y = -0.002;
      this.brush.add(arm);
    }
    r.add(this.brush);

    // Soft contact shadow under the robot (the shadow map adds the sharper part).
    const shadowTex = this.track(
      canvasTexture(128, 128, (g) => {
        const grad = g.createRadialGradient(64, 64, 30, 64, 64, 64);
        grad.addColorStop(0, 'rgba(0,0,0,0.5)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
      }),
    );
    const shadow = new Mesh(new PlaneGeometry(0.42, 0.42), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.0006;
    r.add(shadow);

    this.shadows(r);
    shadow.castShadow = shadow.receiveShadow = false;
    this.scene.add(r);
  }

  /* ---------- the dock ---------- */

  private buildDock() {
    if (!this.look.dock) return;
    const d = this.dock;
    const white = this.keep(new MeshPhysicalMaterial({ color: this.look.body, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25 }), false);
    const black = this.keep(new MeshPhysicalMaterial({ color: '#15181d', roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04 }), false); // a hair lighter than black, so the bay still reads as a surface on the dark page
    const plateMat = this.keep(new MeshPhysicalMaterial({ color: '#eceef1', roughness: 0.48, clearcoat: 0.3 }), false);
    const pad = this.keep(new MeshStandardMaterial({ color: '#dfe2e6', roughness: 0.6 }), false);
    const metal = this.keep(new MeshStandardMaterial({ color: '#c3c7ce', metalness: 0.9, roughness: 0.28 }), false);

    // Tower: the side profile, extruded across the width with rounded edges. It
    // is an inverted L whose bay sweeps in one big curve from the chamber's
    // front edge down into the back wall, as the photos show from the side.
    // The bevel grows the outline by its size, so the outline is drawn inset by it.
    const bevel = 0.014;
    const top = 0.012;
    const bay = bayCurve();
    const inset = offsetCurve(bay, bevel);
    const [b0, f0, h0] = [BACK + bevel, CHAMBER - bevel, DH - bevel];
    const side = new Shape();
    side.moveTo(b0, PLATE + bevel);
    for (const p of inset.slice().reverse()) side.lineTo(Math.min(p.x, f0), Math.max(p.y, PLATE + bevel));
    side.lineTo(f0, h0 - top);
    side.quadraticCurveTo(f0, h0, f0 - top, h0);
    side.lineTo(b0 + top, h0);
    side.quadraticCurveTo(b0, h0, b0, h0 - top);
    side.closePath();
    const tower = new Mesh(new ExtrudeGeometry(side, { depth: DW - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 5, curveSegments: 16 }), white);
    tower.rotation.y = -Math.PI / 2; // shape x → z, extrusion → −x
    tower.position.x = DW / 2 - bevel;
    d.add(tower);

    // The bay's glossy black lining along that curve, set in from the sides by
    // the shell's thickness. The bay is open at the sides (the robot is wider
    // than the dock): the shell's curved edge is what the photos show there.
    const outer = offsetCurve(bay, 0.0015); // just inside the shell
    const face = offsetCurve(bay, -0.003); // the visible face, in the bay
    outer[0].x = face[0].x = CHAMBER - 0.002; // stops just short of the front face
    const lining = new Shape(outer);
    for (const p of face.slice().reverse()) lining.lineTo(p.x, p.y);
    lining.closePath();
    const lw = DW - 0.034;
    const liningMesh = new Mesh(new ExtrudeGeometry(lining, { depth: lw, bevelEnabled: false }), black);
    liningMesh.rotation.y = -Math.PI / 2;
    liningMesh.position.x = lw / 2;
    d.add(liningMesh);

    // Front: a small dark indicator dash low on the chamber.
    const dash = new Mesh(new PlaneGeometry(0.022, 0.0028), new MeshBasicMaterial({ color: '#2b3140' }));
    dash.position.set(0, CEIL + 0.06, CHAMBER + 0.0006);
    d.add(dash);

    // Base plate the robot drives onto: thin, as wide as the tower at the back,
    // its front corners cut off, every edge sloped (wide, shallow bevel).
    const pb = 0.012; // the slope's width
    const pt = 0.004; // and height
    const front = BACK + 0.397;
    const hw = DW / 2 - 0.004;
    const top2 = new Shape(); // top view: x across, y = −z
    top2.moveTo(-hw + pb, -(BACK + 0.008) - pb);
    top2.lineTo(hw - pb, -(BACK + 0.008) - pb);
    top2.lineTo(hw - pb, -(front - 0.07));
    top2.lineTo(hw - 0.07, -(front - pb));
    top2.lineTo(-hw + 0.07, -(front - pb));
    top2.lineTo(-hw + pb, -(front - 0.07));
    top2.closePath();
    const plate = new Mesh(new ExtrudeGeometry(top2, { depth: PLATE - 2 * pt, bevelEnabled: true, bevelSize: pb, bevelThickness: pt, bevelSegments: 1 }), plateMat);
    plate.rotation.x = -Math.PI / 2; // shape y → −z, extrusion → up
    plate.position.y = pt;
    d.add(plate);
    // Wheel pads (two raised strips each side) and the two charging contacts near the bay.
    for (const s of [-1, 1]) {
      for (const z of [0.035, 0.105]) {
        const p = new Mesh(new RoundedBoxGeometry(0.036, 0.004, 0.026, 2, 0.0015), pad);
        p.position.set(s * 0.104, PLATE + 0.001, z);
        d.add(p);
      }
      const post = new Mesh(new CylinderGeometry(0.009, 0.011, 0.01, 20), white);
      post.position.set(s * 0.04, PLATE + 0.005, -0.13);
      d.add(post);
      const contact = new Mesh(new CylinderGeometry(0.0055, 0.0065, 0.004, 16), metal);
      contact.position.set(s * 0.04, PLATE + 0.012, -0.13);
      d.add(contact);
    }

    this.shadows(d);
    this.scene.add(d);
  }

  // What the cutaway shows while the dock empties the bin: three bundled
  // airflow tubes from the plate, back along the base, up the spine and over
  // into the bag, a swirling cyclone under the bag, and dust in the air.
  private buildInside() {
    if (!this.look.dock) return;
    const stripes = () => {
      // Soft glowing streaks along the tube, brighter in the middle of its width.
      const t = this.track(
        canvasTexture(256, 32, (g) => {
          const img = g.createImageData(256, 32);
          for (let x = 0; x < 256; x++)
            for (let y = 0; y < 32; y++) {
              const along = Math.pow(0.5 + 0.5 * Math.sin((x / 256) * Math.PI * 6), 3);
              const across = Math.sin((y / 31) * Math.PI);
              const k = (0.25 + 0.75 * along) * (0.4 + 0.6 * across);
              img.data.set([30 + 110 * along, 150 + 80 * along, 255, 255 * k], (y * 256 + x) * 4);
            }
          g.putImageData(img, 0, 0);
        }),
      );
      t.wrapS = RepeatWrapping;
      t.repeat.set(5, 1);
      this.flowMaps.push(t);
      return new MeshBasicMaterial({ map: t, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    };
    const spineZ = (BACK + SPINE) / 2;
    const bagZ = (BACK + CHAMBER) / 2;
    for (const x of [-0.022, 0, 0.022]) {
      const path = new CatmullRomCurve3(
        [
          [x * 0.4, PLATE + 0.004, 0.06],
          [x * 0.6, 0.007, -0.04],
          [x, 0.007, SPINE - 0.01],
          [x, 0.03, spineZ - 0.004],
          [x, 0.2, spineZ - 0.006],
          [x, DH - 0.035, spineZ],
          [x, DH - 0.02, spineZ + 0.035],
          [x * 0.7, DH - 0.03, bagZ - 0.02],
          [x * 0.4, DH - 0.08, bagZ + 0.01],
        ].map(([a, b, c]) => new Vector3(a, b, c)),
        false,
        'centripetal',
      );
      this.inside.add(new Mesh(new TubeGeometry(path, 160, 0.0055, 8, false), stripes()));
    }
    // Cyclone: a helix under the bag, then the clean air's column down the middle.
    const helix: Vector3[] = [];
    for (let i = 0; i <= 120; i++) {
      const f = i / 120;
      const a = f * Math.PI * 6;
      helix.push(new Vector3(Math.sin(a) * 0.05 * (1 - f * 0.35), 0.31 - f * 0.11, Math.cos(a) * 0.05 * (1 - f * 0.35)));
    }
    helix.push(new Vector3(0, CEIL + 0.02, 0));
    this.swirl.position.z = bagZ; // spins about the cyclone's own axis
    this.swirl.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(helix), 240, 0.004, 6, false), stripes()));
    this.inside.add(this.swirl);
    // Dust bag in the chamber.
    const bag = new Mesh(
      new RoundedBoxGeometry(0.24, 0.1, 0.17, 3, 0.02),
      new MeshPhysicalMaterial({ color: '#f5f6f8', roughness: 0.9, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    bag.position.set(0, DH - 0.075, bagZ);
    this.inside.add(bag);
    // Dust swirling in the chamber.
    const n = 180;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = 0.015 + Math.random() * 0.075;
      pos.set([Math.sin(a) * rr, CEIL + 0.04 + Math.random() * 0.17, Math.cos(a) * rr], i * 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const dust = new Points(geo, new PointsMaterial({ color: '#d9f1ff', size: 0.005, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }));
    this.swirl.add(dust);
    this.inside.visible = false;
    this.scene.add(this.inside);
  }

  private buildRing() {
    const track = new Mesh(new RingGeometry(0.212, 0.222, 96), new MeshBasicMaterial({ color: '#2a3142', transparent: true, opacity: 0.8, side: DoubleSide }));
    track.rotation.x = -Math.PI / 2;
    this.ring.add(track);
    this.ringMat = new MeshBasicMaterial({ color: batteryColor(100), side: DoubleSide });
    this.ringFill = new Mesh(new RingGeometry(0.21, 0.224, 96, 1, Math.PI / 2, Math.PI * 2), this.ringMat);
    this.ringFill.rotation.x = -Math.PI / 2;
    this.ringFill.position.y = 0.0003;
    this.ring.add(this.ringFill);
    this.scene.add(this.ring);
  }

  /* ---------- state ---------- */

  setState(s: RobotState) {
    const was = this.st;
    this.st = s;
    const docked = s.state === 'docked' && this.look.dock;
    this.dock.visible = !!docked;
    // On the dock: on the plate, front first into the bay (so the camera sees its back).
    this.robot.position.set(0, docked ? PLATE : 0, 0);
    if (docked || was.state === 'docked') this.robot.rotation.y = docked ? Math.PI : 0;
    this.ring.position.set(0, docked ? PLATE + 0.0008 : 0.0008, 0);
    this.led.color.set(LED[s.tone]);
    const pct = Math.max(0, Math.min(100, s.battery ?? 0));
    this.ringFill.geometry.dispose();
    this.ringFill.geometry = new RingGeometry(0.21, 0.224, 96, 1, Math.PI / 2, Math.max(0.0001, (pct / 100) * Math.PI * 2));
    this.ringMat.color.set(batteryColor(pct));
    this.body.emissive.set(s.tone === 'warn' ? '#3a1a05' : '#000000');
    this.setCutaway(!!docked && !!s.emptying);
    this.frame(false);
    this.dirty = true;
    this.start(); // glides the camera to the new framing; the loop stops itself once still
  }

  // Emptying: the dock (and robot, less so) go see-through and the airflow shows.
  private setCutaway(on: boolean) {
    if (this.inside.visible === on) return;
    this.inside.visible = on;
    this.floor.visible = !on;
    for (const { mat, robot } of this.ghost) {
      const m = mat as Material & { userData: { opacity?: number; transparent?: boolean } };
      if (m.userData.opacity === undefined) {
        m.userData.opacity = m.opacity;
        m.userData.transparent = m.transparent;
      }
      m.transparent = on || !!m.userData.transparent;
      m.opacity = on ? Math.min(m.userData.opacity!, robot ? 0.4 : 0.16) : m.userData.opacity!;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
    // See-through parts don't block the light.
    for (const g of [this.robot, this.dock])
      g.traverse((o) => {
        if ((o as Mesh).isMesh && o.receiveShadow) o.castShadow = !on;
      });
  }

  private animating() {
    if (reduced()) return false;
    return this.st.state === 'cleaning' || this.st.state === 'returning' || (this.inside.visible && !!this.st.emptying);
  }

  // Frame the robot (and the dock when shown), from the front-left, a little above.
  private frame(snap: boolean) {
    const docked = this.dock.visible;
    // Emptying: from the side, as the maker shows it, so the airflow's path reads.
    const cut = this.inside.visible;
    const look = docked ? new Vector3(0, cut ? 0.19 : 0.16, cut ? -0.1 : -0.06) : new Vector3(0, 0.035, 0);
    const dist = docked ? (cut ? 1.25 : 1.3) : 0.82;
    const dir = (cut ? new Vector3(-1, 0.42, 0.42) : docked ? new Vector3(-0.55, 0.5, 1) : new Vector3(-0.6, 0.6, 1)).normalize();
    this.camTarget = { pos: look.clone().addScaledVector(dir, dist), look };
    if (snap || reduced()) {
      this.camera.position.copy(this.camTarget.pos);
      this.controls?.target.copy(look);
    }
    this.controls?.update();
  }

  resize(w: number, h: number) {
    if (!w || !h) return;
    // The pixel ratio can change after load (another screen, browser zoom).
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.renderOnce();
  }

  /* ---------- loop ---------- */

  private tick = (t: number) => {
    if (document.hidden) return;
    const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : 0;
    this.last = t;
    const moving = !reduced() && (this.st.state === 'cleaning' || this.st.state === 'returning');
    const anim = this.animating();
    if (moving) {
      this.brush.rotation.y -= dt * 14;
      this.laser.rotation.y += dt * 6;
      for (const w of this.wheels) w.rotation.x += dt * 4;
    }
    if (this.inside.visible && !reduced()) {
      for (const m of this.flowMaps) m.offset.x -= dt * 1.6;
      this.swirl.rotation.y += dt * 2.4;
    }
    if (anim) this.dirty = true;
    this.controls.autoRotate = moving && !this.userHold;
    // Glide the camera to the framing for the current state (dock in or out of view).
    if (!this.userHold) {
      const k = 1 - Math.exp(-dt * 3);
      const dp = this.camera.position.distanceTo(this.camTarget.pos);
      const dl = this.controls.target.distanceTo(this.camTarget.look);
      if (!moving && (dp > 0.002 || dl > 0.002)) {
        this.camera.position.lerp(this.camTarget.pos, k);
        this.controls.target.lerp(this.camTarget.look, k);
        this.dirty = true;
      } else if (moving && dl > 0.002) {
        this.controls.target.lerp(this.camTarget.look, k);
        this.dirty = true;
      }
    }
    if (this.controls.update()) this.dirty = true;
    if (this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    } else if (!anim && !this.userHold) {
      this.stop(); // still: stop the loop until something changes
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
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (!(m as Mesh).isMesh && !(o as Points).isPoints) return;
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

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
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Points,
  PointsMaterial,
  RepeatWrapping,
  RingGeometry,
  Scene,
  Shape,
  SRGBColorSpace,
  TOUCH,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// The owner's robot vacuum and its auto-empty dock, built from primitives (no
// model file), modelled on the maker's product photos: a round lidar robot
// (flat lid split by a seam through the turret, rim ring with notches where
// the front bumper ends, two-button pill ahead of the turret, turret = white
// cap over an orange drum framed by white posts, black front window, grille
// band on the rear sides, light-grey lower band at the front, smoky tank at
// the back, white side brush front right) and an inverted-L dock (rear spine
// and dust-bag chamber over an open, glossy black bay, on a long base plate
// with a ramp and charging contacts). The robot docks front first.
//
// Metres. Robot: front +z, floor y = 0. Dock: behind the origin (−z); a docked
// robot sits at the origin facing −z, so the camera sees its back.
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
const LID = 0.083; // lid height
const TZ = 0.045; // turret centre, ahead of the robot's centre
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
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// A band on the robot's side wall: `from`/`to` are angles from the front (+z), towards +x.
function band(r: number, y0: number, y1: number, from: number, to: number, mat: Material, segs = 48) {
  const m = new Mesh(new CylinderGeometry(r, r, y1 - y0, segs, 1, true, from, to - from), mat);
  m.position.y = (y0 + y1) / 2;
  return m;
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
  private ring = new Group();
  private swirl = new Group();
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
    this.renderer.toneMappingExposure = 1.1;
    this.pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.85;
    const sun = new DirectionalLight('#ffffff', 1.1);
    sun.position.set(0.6, 1.4, 0.9);
    this.scene.add(sun);

    this.buildRobot();
    this.buildDock();
    this.buildInside();
    this.buildRing();

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

  /* ---------- the robot ---------- */

  private buildRobot() {
    const L = this.look;
    const white = this.keep((this.body = new MeshPhysicalMaterial({ color: L.body, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.14 })), true);
    const greyBand = this.keep(new MeshStandardMaterial({ color: '#d9dce1', roughness: 0.6 }), true);
    const groove = this.keep(new MeshBasicMaterial({ color: '#a9aeb7' }), true);
    const black = this.keep(new MeshPhysicalMaterial({ color: '#07090d', roughness: 0.12, clearcoat: 1 }), true);
    const chassis = this.keep(new MeshStandardMaterial({ color: '#2b3039', roughness: 0.8 }), true);
    const smoke = this.keep(new MeshPhysicalMaterial({ color: '#7d848f', roughness: 0.08, transparent: true, opacity: 0.72, clearcoat: 1 }), true);
    const r = this.robot;

    // Chassis underneath (wheels and brushes stay in its shadow).
    const base = new Mesh(new CylinderGeometry(R - 0.012, R - 0.02, 0.012, 64), chassis);
    base.position.y = 0.01;
    r.add(base);

    // Shell: side wall rounding into the rim, then the flat lid.
    const profile = [
      [R - 0.004, 0.016],
      [R, 0.022],
      [R, 0.071],
      [R - 0.002, 0.077],
      [R - 0.006, 0.0815],
      [R - 0.012, LID],
      [0, LID],
    ].map(([x, y]) => new Vector2(x, y));
    r.add(new Mesh(new LatheGeometry(profile, 96), white));

    // Lid: the rim ring's inner groove, and the seam through the turret ending in two notches.
    const rimGroove = new Mesh(new RingGeometry(R - 0.0145, R - 0.0125, 96), groove);
    rimGroove.rotation.x = -Math.PI / 2;
    rimGroove.position.y = LID + 0.0003;
    r.add(rimGroove);
    for (const s of [-1, 1]) {
      const seam = new Mesh(new PlaneGeometry(R - 0.0125 - 0.05, 0.0013), groove);
      seam.rotation.x = -Math.PI / 2;
      seam.position.set(s * ((R - 0.0125 + 0.05) / 2), LID + 0.0003, TZ);
      r.add(seam);
      // Notch in the rim and the bumper's end down the side wall.
      const x = Math.sqrt(R * R - TZ * TZ);
      const notch = new Mesh(new PlaneGeometry(0.009, 0.004), black);
      notch.rotation.x = -Math.PI / 2;
      notch.position.set(s * (x - 0.007), LID - 0.0012, TZ);
      r.add(notch);
      const gap = new Mesh(new PlaneGeometry(0.0016, 0.055), groove);
      gap.position.set(s * (x + 0.0006), 0.045, TZ);
      gap.rotation.y = s * Math.atan2(x, TZ);
      r.add(gap);
    }

    // Front half: light-grey lower band (the bumper's skirt) under a groove.
    const front = Math.atan2(Math.sqrt(R * R - TZ * TZ), TZ); // angle of the bumper's ends
    r.add(band(R + 0.0006, 0.016, 0.034, -front, front, greyBand));
    r.add(band(R + 0.0008, 0.0342, 0.0354, -front, front, groove));
    // Back half: smoky water tank low down, and the perforated grille band higher up.
    r.add(band(R + 0.0004, 0.012, 0.034, front, Math.PI * 2 - front, smoke));
    const dots = canvasTexture(1024, 96, (g) => {
      g.fillStyle = '#f1f2f4';
      g.fillRect(0, 0, 1024, 96);
      g.fillStyle = '#6f7682';
      for (let y = 10; y < 90; y += 10) for (let x = (y / 10) % 2 ? 5 : 0; x < 1024; x += 10) {
        g.beginPath();
        g.arc(x + 2, y, 2, 0, Math.PI * 2);
        g.fill();
      }
    });
    dots.wrapS = RepeatWrapping;
    this.textures.push(dots);
    const grilleMat = this.keep(new MeshStandardMaterial({ map: dots, roughness: 0.55 }), true);
    r.add(band(R + 0.0007, 0.044, 0.07, front + 0.12, Math.PI - 0.35, grilleMat));
    r.add(band(R + 0.0007, 0.044, 0.07, Math.PI + 0.35, Math.PI * 2 - front - 0.12, grilleMat));

    // Front window (structured light): glossy black rounded rectangle.
    const win = canvasTexture(256, 64, (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, 256, 64);
      g.fillStyle = '#fff';
      roundRect(g, 4, 4, 248, 56, 26);
      g.fill();
    }, false);
    this.textures.push(win);
    const winMat = this.keep(new MeshPhysicalMaterial({ color: '#06080b', roughness: 0.06, clearcoat: 1, alphaMap: win, alphaTest: 0.5 }), true);
    r.add(band(R + 0.0011, 0.04, 0.062, -0.3, 0.3, winMat, 24));

    // Button pill ahead of the turret, its front button lit with the status.
    const pill = new Shape();
    const pw = 0.016;
    const ph = 0.038;
    pill.absarc(0, ph / 2 - pw / 2, pw / 2, 0, Math.PI, false);
    pill.absarc(0, -ph / 2 + pw / 2, pw / 2, Math.PI, Math.PI * 2, false);
    const pillMesh = new Mesh(new ExtrudeGeometry(pill, { depth: 0.0018, bevelEnabled: false }), this.keep(new MeshStandardMaterial({ color: '#d3d7dd', roughness: 0.45 }), true));
    pillMesh.rotation.x = -Math.PI / 2;
    pillMesh.position.set(0, LID, TZ + 0.072);
    r.add(pillMesh);
    this.led = new MeshBasicMaterial({ color: LED.idle });
    for (const [dz, lit] of [
      [0.0105, true],
      [-0.0105, false],
    ] as const) {
      const ring = new Mesh(new RingGeometry(0.0035, 0.0048, 24), lit ? this.led : groove);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, LID + 0.0021, TZ + 0.072 + dz);
      r.add(ring);
    }

    // Turret: shadow gap and collar in the lid, orange laser drum framed by white posts, white cap.
    const turret = new Group();
    turret.position.set(0, LID, TZ);
    const well = new Mesh(new RingGeometry(0.044, 0.05, 48), groove);
    well.rotation.x = -Math.PI / 2;
    well.position.y = 0.0004;
    turret.add(well);
    const collar = new Mesh(new CylinderGeometry(0.044, 0.045, 0.004, 48), white);
    collar.position.y = 0.002;
    turret.add(collar);
    const drumMat = this.keep(new MeshStandardMaterial({ color: L.laser, emissive: new Color(L.laser), emissiveIntensity: 0.3, roughness: 0.35 }), true);
    const drum = new Mesh(new CylinderGeometry(0.034, 0.034, 0.015, 40), drumMat);
    drum.position.y = 0.0115;
    this.laser.add(drum);
    const lens = new Mesh(new CylinderGeometry(0.0345, 0.0345, 0.008, 12, 1, true, -0.16, 0.32), black);
    lens.position.y = 0.0115;
    this.laser.add(lens);
    turret.add(this.laser);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const post = new Mesh(new RoundedBoxGeometry(0.012, 0.015, 0.008, 2, 0.002), white);
      post.position.set(Math.sin(a) * 0.037, 0.0115, Math.cos(a) * 0.037);
      post.rotation.y = a;
      turret.add(post);
    }
    const capProfile = [
      [0, 0.019],
      [0.041, 0.019],
      [0.0435, 0.0205],
      [0.0435, 0.0245],
      [0.041, 0.027],
      [0, 0.027],
    ].map(([x, y]) => new Vector2(x, y));
    turret.add(new Mesh(new LatheGeometry(capProfile, 64), white));
    r.add(turret);

    // White side brush, front right (the robot's right is −x).
    this.brush.position.set(-0.112, 0.005, 0.108);
    const brushMat = this.keep(new MeshStandardMaterial({ color: '#eef0f3', roughness: 0.7 }), true);
    this.brush.add(new Mesh(new CylinderGeometry(0.011, 0.011, 0.004, 20), brushMat));
    for (let i = 0; i < 3; i++) {
      const holder = new Group();
      holder.rotation.y = (i * Math.PI * 2) / 3;
      const arm = new Mesh(new CylinderGeometry(0.0022, 0.0012, 0.07, 6), brushMat);
      arm.rotation.z = Math.PI / 2;
      arm.position.x = 0.036;
      const tuft = new Mesh(new CylinderGeometry(0.0035, 0.0012, 0.018, 6), brushMat);
      tuft.rotation.z = Math.PI / 2;
      tuft.position.x = 0.078;
      holder.add(arm, tuft);
      this.brush.add(holder);
    }
    r.add(this.brush);

    // Soft contact shadow.
    const shadowTex = canvasTexture(128, 128, (g) => {
      const grad = g.createRadialGradient(64, 64, 14, 64, 64, 64);
      grad.addColorStop(0, 'rgba(0,0,0,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    });
    this.textures.push(shadowTex);
    const shadow = new Mesh(new PlaneGeometry(0.44, 0.44), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.0005;
    r.add(shadow);

    this.scene.add(r);
  }

  /* ---------- the dock ---------- */

  private buildDock() {
    if (!this.look.dock) return;
    const d = this.dock;
    const white = this.keep(new MeshPhysicalMaterial({ color: this.look.body, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.2 }), false);
    const black = this.keep(new MeshPhysicalMaterial({ color: '#07090d', roughness: 0.1, clearcoat: 1, side: DoubleSide }), false);
    const plateMat = this.keep(new MeshStandardMaterial({ color: '#eceef1', roughness: 0.55 }), false);
    const dim = this.keep(new MeshStandardMaterial({ color: '#c3c8cf', roughness: 0.7 }), false);
    const metal = this.keep(new MeshStandardMaterial({ color: '#b8bcc4', metalness: 0.9, roughness: 0.3 }), false);
    const W = 0.3;

    // Rear spine (full height) and the dust-bag chamber on top, overhanging the bay.
    const spine = new Mesh(new RoundedBoxGeometry(W, 0.3, 0.12, 4, 0.02), white); // its top hides inside the chamber
    spine.position.set(0, 0.15, -0.28);
    d.add(spine);
    const chamber = new Mesh(new RoundedBoxGeometry(W, 0.255, 0.28, 4, 0.03), white);
    chamber.position.set(0, 0.2925, -0.2);
    d.add(chamber);
    // The bay's glossy black ceiling and back wall (its sides are open).
    const ceil = new Mesh(new PlaneGeometry(W - 0.03, 0.15), black);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, 0.1645, -0.145);
    d.add(ceil);
    const back = new Mesh(new PlaneGeometry(W - 0.03, 0.155), black);
    back.position.set(0, 0.09, -0.2195);
    d.add(back);
    // Indicator dash on the chamber front.
    const dash = new Mesh(new PlaneGeometry(0.022, 0.003), new MeshBasicMaterial({ color: '#2b3140' }));
    dash.position.set(0, 0.25, -0.0598);
    d.add(dash);

    // Base plate the robot drives onto, with a ramp, charging contacts and wheel guides.
    const plate = new Mesh(new RoundedBoxGeometry(W, 0.012, 0.5, 3, 0.005), plateMat);
    plate.position.set(0, 0.006, -0.09);
    d.add(plate);
    const ramp = new Shape();
    ramp.moveTo(0, 0);
    ramp.lineTo(0.05, 0);
    ramp.lineTo(0, 0.012);
    ramp.closePath();
    const rampMesh = new Mesh(new ExtrudeGeometry(ramp, { depth: W, bevelEnabled: false }), plateMat);
    rampMesh.rotation.y = -Math.PI / 2;
    rampMesh.position.set(W / 2, 0, 0.158);
    d.add(rampMesh);
    for (const s of [-1, 1]) {
      const contact = new Mesh(new CylinderGeometry(0.006, 0.008, 0.008, 16), metal);
      contact.position.set(s * 0.04, 0.016, -0.195);
      d.add(contact);
      const guide = new Mesh(new PlaneGeometry(0.05, 0.07), dim);
      guide.rotation.x = -Math.PI / 2;
      guide.position.set(s * 0.095, 0.0122, 0.1);
      d.add(guide);
    }
    this.scene.add(d);
  }

  // What the cutaway shows while the dock empties the bin: three bundled
  // airflow tubes from the plate, back along the base, up the spine and over
  // into the bag, a swirling cyclone under the bag, and dust in the air.
  private buildInside() {
    if (!this.look.dock) return;
    const stripes = () => {
      // Soft glowing streaks along the tube, brighter in the middle of its width.
      const t = canvasTexture(256, 32, (g) => {
        const img = g.createImageData(256, 32);
        for (let x = 0; x < 256; x++)
          for (let y = 0; y < 32; y++) {
            const along = Math.pow(0.5 + 0.5 * Math.sin((x / 256) * Math.PI * 6), 3);
            const across = Math.sin((y / 31) * Math.PI);
            const k = (0.25 + 0.75 * along) * (0.4 + 0.6 * across);
            img.data.set([30 + 110 * along, 150 + 80 * along, 255, 255 * k], (y * 256 + x) * 4);
          }
        g.putImageData(img, 0, 0);
      });
      t.wrapS = RepeatWrapping;
      t.repeat.set(5, 1);
      this.flowMaps.push(t);
      this.textures.push(t);
      return new MeshBasicMaterial({ map: t, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    };
    for (const x of [-0.022, 0, 0.022]) {
      const path = new CatmullRomCurve3(
        [
          [x * 0.4, 0.012, 0.07],
          [x * 0.6, 0.007, -0.04],
          [x, 0.007, -0.25],
          [x, 0.03, -0.31],
          [x, 0.2, -0.318],
          [x, 0.385, -0.31],
          [x, 0.404, -0.27],
          [x * 0.7, 0.395, -0.21],
          [x * 0.4, 0.345, -0.18],
        ].map(([a, b, c]) => new Vector3(a, b, c)),
        false,
        'centripetal',
      );
      this.inside.add(new Mesh(new TubeGeometry(path, 160, 0.0055, 8, false), stripes()));
    }
    // Cyclone: a helix under the bag, then the clean air's column down the middle.
    const helix: Vector3[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const a = t * Math.PI * 6;
      helix.push(new Vector3(Math.sin(a) * 0.05 * (1 - t * 0.35), 0.3 - t * 0.1, Math.cos(a) * 0.05 * (1 - t * 0.35)));
    }
    helix.push(new Vector3(0, 0.17, 0));
    this.swirl.position.z = -0.17; // spins about the cyclone's own axis
    this.swirl.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(helix), 240, 0.004, 6, false), stripes()));
    this.inside.add(this.swirl);
    // Dust bag in the chamber.
    const bag = new Mesh(
      new RoundedBoxGeometry(0.22, 0.1, 0.2, 3, 0.02),
      new MeshPhysicalMaterial({ color: '#f5f6f8', roughness: 0.9, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    bag.position.set(0, 0.36, -0.2);
    this.inside.add(bag);
    // Dust swirling in the chamber.
    const n = 180;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = 0.015 + Math.random() * 0.075;
      pos.set([Math.sin(a) * rr, 0.22 + Math.random() * 0.17, Math.cos(a) * rr], i * 3);
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
    this.robot.position.set(0, docked ? 0.012 : 0, 0);
    if (docked || was.state === 'docked') this.robot.rotation.y = docked ? Math.PI : 0;
    this.ring.position.set(0, docked ? 0.0128 : 0.0008, 0);
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
    const look = docked ? new Vector3(0, cut ? 0.19 : 0.17, cut ? -0.12 : -0.1) : new Vector3(0, 0.035, 0);
    const dist = docked ? (cut ? 1.2 : 1.25) : 0.82;
    const dir = (cut ? new Vector3(-1, 0.42, 0.42) : new Vector3(-0.6, 0.6, 1)).normalize();
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

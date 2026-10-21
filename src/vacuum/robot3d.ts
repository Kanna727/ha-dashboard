import {
  ACESFilmicToneMapping,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// A robot vacuum built from primitives (no model file): a round lidar robot
// (glossy lid with a seam, perforated grille band, smoky bumper skirt, front
// sensor window, laser turret with its coloured band, a side brush) and an
// optional auto-empty dock. Metres, robot facing +z, floor at y = 0.
//
// States: docked → on its dock, still; cleaning/returning → off the dock,
// turning slowly with the brush and laser spinning; the battery is a ring on
// the floor. Renders on demand: nothing runs while it's still.

export interface RobotLook {
  body?: string; // shell colour
  laser?: string; // the turret's band
  dock?: boolean; // show the dock while docked
}

export interface RobotState {
  state?: string; // vacuum entity state
  battery?: number; // 0–100
  tone: 'active' | 'ok' | 'warn' | 'idle';
}

const R = 0.175; // robot radius
const TOP = 0.09; // lid height
const RESUME_MS = 8000;
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const LED: Record<RobotState['tone'], string> = { active: '#8b7cf6', ok: '#34d399', warn: '#fb923c', idle: '#5b6478' };
const batteryColor = (pct: number) => (pct <= 20 ? '#f87171' : pct <= 50 ? '#fbbf24' : '#34d399');

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class RobotViewer {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.05, 20);
  private controls: OrbitControls;
  private pmrem: PMREMGenerator;
  private robot = new Group();
  private dock = new Group();
  private brush = new Group();
  private ring = new Group();
  private turret = new Group();
  private led!: MeshBasicMaterial;
  private ringFill!: Mesh;
  private ringMat!: MeshBasicMaterial;
  private body!: MeshPhysicalMaterial;
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
    this.look = { body: look.body ?? '#f3f4f6', laser: look.laser ?? '#ff6b2c', dock: look.dock ?? true };
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

    this.build();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.35;
    this.controls.autoRotateSpeed = 1.2;
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
      }, RESUME_MS);
    });
    this.frame(true);
  }

  /* ---------- the model ---------- */

  private build() {
    const L = this.look;
    const white = (this.body = new MeshPhysicalMaterial({ color: L.body, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12 }));
    const satin = new MeshStandardMaterial({ color: new Color(L.body).multiplyScalar(0.94), roughness: 0.55 });
    const dark = new MeshPhysicalMaterial({ color: '#0d1117', roughness: 0.15, metalness: 0.1, clearcoat: 1 });
    const smoke = new MeshPhysicalMaterial({ color: '#59606c', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1 });
    const grey = new MeshStandardMaterial({ color: '#9aa1ad', roughness: 0.7 });

    // Shell: a lathe of the side profile, rounded at the lid and the base.
    const profile = [
      [0, 0.016],
      [R - 0.02, 0.016],
      [R - 0.006, 0.02],
      [R - 0.001, 0.032],
      [R, 0.06],
      [R - 0.003, 0.08],
      [R - 0.012, 0.0885],
      [R - 0.03, TOP],
      [0, TOP],
    ].map(([x, y]) => new Vector2(x, y));
    const shell = new Mesh(new LatheGeometry(profile, 96), white);
    this.robot.add(shell);

    // Smoky bumper skirt round the bottom edge.
    const skirt = new Mesh(new CylinderGeometry(R + 0.002, R + 0.003, 0.016, 96, 1, true), smoke);
    skirt.position.y = 0.024;
    this.robot.add(skirt);

    // Perforated grille band round the sides and back (the front has the sensor window).
    const dots = canvasTexture(1024, 64, (g) => {
      g.fillStyle = '#f2f3f5';
      g.fillRect(0, 0, 1024, 64);
      g.fillStyle = '#7d8590';
      for (let y = 8; y < 64; y += 12) for (let x = (y / 12) % 2 ? 6 : 0; x < 1024; x += 12) {
        g.beginPath();
        g.arc(x + 3, y, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    });
    dots.wrapS = RepeatWrapping;
    this.textures.push(dots);
    const grille = new Mesh(
      new CylinderGeometry(R + 0.0008, R + 0.0008, 0.022, 96, 1, true, Math.PI * 0.22, Math.PI * 1.56),
      new MeshStandardMaterial({ map: dots, roughness: 0.6 }),
    );
    grille.position.y = 0.052;
    this.robot.add(grille);

    // Front sensor window: a dark glossy pill on the bumper.
    const sensor = new Mesh(new CylinderGeometry(R + 0.0012, R + 0.0012, 0.014, 32, 1, true, -0.2, 0.4), dark);
    sensor.position.y = 0.05;
    this.robot.add(sensor);

    // Lid seam across the front third, and two small buttons behind the turret.
    const seam = new Mesh(new PlaneGeometry(0.27, 0.0016), new MeshBasicMaterial({ color: '#b9bec7' }));
    seam.rotation.x = -Math.PI / 2;
    seam.position.set(0, TOP + 0.0004, 0.072);
    this.robot.add(seam);
    for (const x of [-0.02, 0.02]) {
      const b = new Mesh(new CylinderGeometry(0.008, 0.008, 0.002, 24), satin);
      b.position.set(x, TOP + 0.001, -0.075);
      this.robot.add(b);
    }

    // Status light just ahead of the turret.
    this.led = new MeshBasicMaterial({ color: LED.idle });
    const led = new Mesh(new CircleGeometry(0.0045, 20), this.led);
    led.rotation.x = -Math.PI / 2;
    led.position.set(0, TOP + 0.0006, 0.05);
    this.robot.add(led);

    // Laser turret: a white drum with the coloured band and two lens windows (so its spin shows).
    this.turret.position.set(0, TOP, -0.01);
    const drum = new Mesh(new CylinderGeometry(0.041, 0.043, 0.02, 48), white);
    drum.position.y = 0.012;
    this.turret.add(drum);
    const cap = new Mesh(new CylinderGeometry(0.036, 0.041, 0.004, 48), satin);
    cap.position.y = 0.024;
    this.turret.add(cap);
    const band = new Mesh(
      new CylinderGeometry(0.0435, 0.0435, 0.006, 48, 1, true),
      new MeshStandardMaterial({ color: L.laser, emissive: new Color(L.laser), emissiveIntensity: 0.35, roughness: 0.3 }),
    );
    band.position.y = 0.008;
    this.turret.add(band);
    for (const a of [0, Math.PI]) {
      const lens = new Mesh(new CylinderGeometry(0.0438, 0.0438, 0.0062, 8, 1, true, a - 0.18, 0.36), dark);
      lens.position.y = 0.008;
      this.turret.add(lens);
    }
    this.robot.add(this.turret);

    // Side brush, front right, sticking out past the shell.
    this.brush.position.set(0.112, 0.006, 0.104);
    const hub = new Mesh(new CylinderGeometry(0.012, 0.012, 0.004, 20), grey);
    this.brush.add(hub);
    for (let i = 0; i < 3; i++) {
      const arm = new Mesh(new CylinderGeometry(0.003, 0.0012, 0.085, 6), grey);
      arm.rotation.z = Math.PI / 2;
      arm.position.x = 0.042;
      const holder = new Group();
      holder.rotation.y = (i * Math.PI * 2) / 3;
      holder.add(arm);
      this.brush.add(holder);
    }
    this.robot.add(this.brush);

    // Soft contact shadow.
    const shadowTex = canvasTexture(128, 128, (g) => {
      const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
      grad.addColorStop(0, 'rgba(0,0,0,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    });
    this.textures.push(shadowTex);
    const shadow = new Mesh(new PlaneGeometry(0.46, 0.46), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.0005;
    this.robot.add(shadow);

    this.scene.add(this.robot);

    // Battery ring on the floor (on the dock plate while docked).
    const track = new Mesh(new RingGeometry(0.212, 0.222, 96), new MeshBasicMaterial({ color: '#2a3142', transparent: true, opacity: 0.8, side: DoubleSide }));
    track.rotation.x = -Math.PI / 2;
    this.ring.add(track);
    this.ringMat = new MeshBasicMaterial({ color: batteryColor(100), side: DoubleSide });
    this.ringFill = new Mesh(new RingGeometry(0.21, 0.224, 96, 1, Math.PI / 2, Math.PI * 2), this.ringMat);
    this.ringFill.rotation.x = -Math.PI / 2;
    this.ringFill.position.y = 0.0003;
    this.ring.add(this.ringFill);
    this.scene.add(this.ring);

    // Auto-empty dock: a tall rounded tower with a dark bay the robot backs into, and a base plate.
    if (L.dock) {
      const tower = new Mesh(new RoundedBoxGeometry(0.34, 0.42, 0.2, 4, 0.03), white);
      tower.position.set(0, 0.21, -0.26);
      this.dock.add(tower);
      const bay = new Mesh(new RoundedBoxGeometry(0.29, 0.085, 0.05, 3, 0.02), dark);
      bay.position.set(0, 0.06, -0.17);
      this.dock.add(bay);
      const plate = new Mesh(new RoundedBoxGeometry(0.3, 0.012, 0.3, 3, 0.006), new MeshStandardMaterial({ color: '#c9cdd4', roughness: 0.6 }));
      plate.position.set(0, 0.006, -0.05);
      this.dock.add(plate);
      const mark = new Mesh(new PlaneGeometry(0.03, 0.004), new MeshBasicMaterial({ color: '#2b3140' }));
      mark.position.set(0, 0.25, -0.159);
      this.dock.add(mark);
      this.scene.add(this.dock);
    }
  }

  /* ---------- state ---------- */

  setState(s: RobotState) {
    this.st = s;
    const docked = s.state === 'docked' && this.look.dock;
    this.dock.visible = !!docked;
    // On the dock the robot sits on the plate, backed into the bay.
    this.robot.position.set(0, docked ? 0.012 : 0, docked ? 0.02 : 0);
    this.ring.position.set(0, docked ? 0.0135 : 0.0008, this.robot.position.z);
    if (docked) this.robot.rotation.y = 0;
    this.led.color.set(LED[s.tone]);
    const pct = Math.max(0, Math.min(100, s.battery ?? 0));
    this.ringFill.geometry.dispose();
    this.ringFill.geometry = new RingGeometry(0.21, 0.224, 96, 1, Math.PI / 2, Math.max(0.0001, (pct / 100) * Math.PI * 2));
    this.ringMat.color.set(batteryColor(pct));
    this.body.emissive.set(s.tone === 'warn' ? '#3a1a05' : '#000000');
    this.frame(false);
    this.dirty = true;
    this.start(); // glides the camera to the new framing; the loop stops itself once still
  }

  private animating() {
    return (this.st.state === 'cleaning' || this.st.state === 'returning') && !reduced();
  }

  // Frame the robot (and the dock when shown), from the front-left, a little above.
  private frame(snap: boolean) {
    const docked = this.dock.visible;
    const look = docked ? new Vector3(0, 0.17, -0.1) : new Vector3(0, 0.035, 0);
    const dist = docked ? 1.22 : 0.82;
    const dir = new Vector3(-0.55, 0.62, 1).normalize();
    this.camTarget = { pos: look.clone().addScaledVector(dir, dist), look };
    if (snap || reduced()) {
      this.camera.position.copy(this.camTarget.pos);
      this.controls?.target.copy(look);
    }
    this.controls?.update();
  }

  resize(w: number, h: number) {
    if (!w || !h) return;
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
    const anim = this.animating();
    if (anim) {
      this.brush.rotation.y -= dt * 14;
      this.turret.rotation.y += dt * 6;
      this.dirty = true;
    }
    this.controls.autoRotate = anim && !this.userHold;
    // Glide the camera to the framing for the current state (dock in or out of view).
    if (!this.userHold) {
      const k = 1 - Math.exp(-dt * 3);
      const dp = this.camera.position.distanceTo(this.camTarget.pos);
      const dl = this.controls.target.distanceTo(this.camTarget.look);
      if (!anim && (dp > 0.002 || dl > 0.002)) {
        this.camera.position.lerp(this.camTarget.pos, k);
        this.controls.target.lerp(this.camTarget.look, k);
        this.dirty = true;
      } else if (anim && dl > 0.002) {
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

  // A drag on the canvas needs the loop for damping; it stops by itself afterwards.
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
      if (!m.isMesh) return;
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

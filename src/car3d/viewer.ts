// Imperative three.js viewer for the car modal. React (CarScene.tsx) owns the
// canvas and calls into this; everything per-frame stays out of React.
//
// The model is found by node names (tyres, doors) rather than fixed
// coordinates, so any car model whose parts are named sensibly works.
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AnimationClip,
  AnimationMixer,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  LoopOnce,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Spherical,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type Material,
  type Texture,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Anchor, CarVisual, Corner } from '../lib/carVisual';

export type { Anchor, Corner };

export interface ViewerOptions {
  url: string;
  paint?: string; // body colour, e.g. '#2c3527'
  paintMaterial?: string; // case-insensitive regex for the body paint material names
  driverSide?: 'left' | 'right';
  gloss?: number; // 0 (satin) to 1 (wet look); default 0.4
  rhd?: boolean | RhdOptions;
  plate?: string; // registration shown on the number plates
  reducedMotion: boolean;
  onProgress?: (fraction: number) => void;
}

// Right-hand-drive conversion knobs (regexes, case-insensitive). See rhd().
export interface RhdOptions {
  include?: string; // extra parts to move (mesh or material names)
  exclude?: string; // parts to leave alone
  flip?: string; // materials whose texture text must read the right way round
  split?: string; // the two-part screen material (default 'display')
  keep?: string; // parts moved but not mirrored (default the steering-wheel logo)
}

const CORNERS: Corner[] = ['FL', 'FR', 'RL', 'RR'];

// The parsed model is kept for the session, so reopening the modal doesn't
// download and decode 8 MB again. GPU copies are freed on close and rebuilt.
const cache = new Map<string, Promise<GLTF>>();
function loadModel(url: string, onProgress?: (f: number) => void): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    p = loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

// GLTFLoader sanitises names ("00:203 tire FL_438" → "00203_tire_FL_438").
const TYRE = (c: Corner) => new RegExp(`(^|_)tire_${c}(_|$)`, 'i');
const DOOR = (c: Corner) => new RegExp(`^\\d*_?door_${c}_\\d+$`, 'i');
// Lamps come as twins: "<lamp>_Lights_On_<n>" (lit) next to "<lamp>_<n>" (unlit).
const LIT = /_(Lights_On|Turn_Signal)_\d+$/;
const FOCUS_TURN_MS = 1600;
const FOCUS_DWELL_MS = 3500;
const FOCUS_SPIN_MS = 15000; // free turntable between rounds of issues
const BLINK_MS = 400;
// Indicator/hazard amber. The model's lit signal twins glow through a reddish
// texture; the owner asked for this colour instead.
const SIGNAL_COLOR = '#cc5d29';
// Sequential indicators: each blink lights the lamp from its inner edge to its
// outer edge over SWEEP_MS, then it stays lit until the off half of the blink.
const SWEEP_MS = 260;
// How far the sweep has got, 0..1; shared by every tinted indicator material
// (the parsed model is cached, so the materials outlive a viewer).
const signalSweep = { value: 1 };
// 1 while the indicators are lit (the on half of a blink), for the tail-lamp segments.
const signalOn = { value: 0 };
// A texel counts as "white" (part of a lamp's white segment) when bright and unsaturated.
const WHITE_GLSL = 'max(t.r, max(t.g, t.b)) > 0.45 && min(t.r, min(t.g, t.b)) > 0.7 * max(t.r, max(t.g, t.b))';

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const OUTSIDE_FOV = 30;
const INSIDE_FOV = 72;
const RESUME_MS = 8000; // turntable resumes this long after the last drag

export class CarViewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  private camera = new PerspectiveCamera(OUTSIDE_FOV, 1, 0.05, 100);
  private controls: OrbitControls;
  private pmrem: PMREMGenerator;
  private model?: Object3D;
  private shadow?: Mesh;
  private mixer?: AnimationMixer;
  private doorActions = new Map<Corner, AnimationAction>();
  private doorOpen = new Map<Corner, boolean>();
  private tyres = new Map<Corner, Vector3>();
  // Car frame (world space, after normalising): unit vectors and key points.
  readonly frame = { forward: new Vector3(0, 0, 1), left: new Vector3(1, 0, 0), center: new Vector3(), size: new Vector3(), cabin: new Vector3() };
  private inside = false;
  private fly?: { from: [Vector3, Vector3]; to: [Vector3, Vector3]; t0: number; ms: number; done?: () => void };
  private resumeTimer = 0;
  private dirty = true;
  private running = false;
  private disposed = false;
  private onFrameCbs = new Set<() => void>();
  private plateTexture?: Texture;
  private lamps: { lit: Object3D; unlit: Object3D[]; signal: boolean }[] = [];
  private glass: { mat: MeshStandardMaterial; rear: boolean; color: Color }[] = [];
  private glows: { sprite: Sprite; key: string }[] = [];
  private glowTexture?: CanvasTexture;
  private visual?: CarVisual;
  private blinkOn = false;
  private userHold = false; // a drag happened recently: no turntable or focus
  private focusList: Anchor[] = [];
  private focusState?: { i: number; phase: 'turn' | 'dwell' | 'spin'; t0: number; from: number; to: number };

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: ViewerOptions,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6; // the room's ceiling lights otherwise bleach the roof and bonnet

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.autoRotate = false; // driven by schedule() each frame
    this.controls.autoRotateSpeed = 1; // one turn a minute
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.controls.addEventListener('start', () => {
      this.userHold = true;
      this.focusState = undefined;
      window.clearTimeout(this.resumeTimer);
    });
    this.controls.addEventListener('end', () => {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = window.setTimeout(() => (this.userHold = false), RESUME_MS);
    });
  }

  async load(): Promise<void> {
    const gltf = await loadModel(this.opts.url, this.opts.onProgress);
    if (this.disposed) return;
    const root = gltf.scene;
    this.model = root;
    this.normalise(root);
    this.rhd(root);
    this.plates(root);
    this.paint(root);
    this.prepareDoors(gltf.animations);
    this.prepareLamps(root);
    this.prepareGlass(root);
    this.scene.add(root);
    this.addShadow();
    this.addGlows(root);
    this.placeOutside();
    this.dirty = true;
  }

  // Scale to ~4.3 m long, wheels on y = 0, centred; then read the car's own
  // axes from the tyre positions (models come in any orientation).
  private normalise(root: Object3D) {
    root.position.set(0, 0, 0);
    root.scale.setScalar(1);
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    const size = box.getSize(new Vector3());
    root.scale.setScalar(4.3 / Math.max(size.x, size.z));
    root.updateMatrixWorld(true);
    box.setFromObject(root);
    const c = box.getCenter(new Vector3());
    root.position.set(-c.x, -box.min.y, -c.z);
    root.updateMatrixWorld(true);
    box.setFromObject(root);
    box.getSize(this.frame.size);
    box.getCenter(this.frame.center);

    for (const corner of ['FL', 'FR', 'RL', 'RR'] as Corner[]) {
      let found: Object3D | undefined;
      root.traverse((o) => {
        if (!found && TYRE(corner).test(o.name)) found = o;
      });
      if (found) this.tyres.set(corner, new Box3().setFromObject(found).getCenter(new Vector3()));
    }
    const t = this.tyres;
    if (t.size === 4) {
      const front = t.get('FL')!.clone().add(t.get('FR')!).multiplyScalar(0.5);
      const rear = t.get('RL')!.clone().add(t.get('RR')!).multiplyScalar(0.5);
      this.frame.forward.copy(front.clone().sub(rear).setY(0).normalize());
      this.frame.left.copy(t.get('FL')!.clone().sub(t.get('FR')!).setY(0).normalize());
      // Eye point for the inside view: centre of the cabin, a little ahead of
      // mid-wheelbase, at head height.
      this.frame.cabin.copy(rear.clone().lerp(front, 0.42)).setY(this.frame.size.y * 0.7);
    } else {
      this.frame.cabin.copy(this.frame.center).setY(this.frame.size.y * 0.7);
    }
  }

  private paint(root: Object3D) {
    const { paint } = this.opts;
    if (!paint) return;
    const re = new RegExp(this.opts.paintMaterial || 'carpaint', 'i');
    const done = new Set<Material>();
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (done.has(m) || !re.test(m.name)) continue;
        done.add(m);
        const std = m as MeshStandardMaterial;
        // gloss 0 = satin, 1 = wet look. Too much clearcoat mirrors the
        // environment's ceiling lights and the paint reads white.
        const g = Math.min(1, Math.max(0, this.opts.gloss ?? 0.4));
        std.color = new Color(paint);
        std.metalness = 0.25 + 0.35 * g;
        std.roughness = 0.6 - 0.3 * g;
        if ((m as MeshPhysicalMaterial).isMeshPhysicalMaterial) {
          const phys = m as MeshPhysicalMaterial;
          phys.clearcoat = 0.15 + 0.85 * g;
          phys.clearcoatRoughness = 0.4 - 0.34 * g;
        }
        std.needsUpdate = true;
      }
    });
  }

  // One clip opens all four doors; split it per door (each door's tracks sit
  // under its hinge node) so they can open independently.
  private prepareDoors(clips: AnimationClip[]) {
    if (!this.model) return;
    const open = clips.find((c) => /doors?_?open/i.test(c.name));
    if (!open) return;
    this.mixer = new AnimationMixer(this.model);
    for (const corner of ['FL', 'FR', 'RL', 'RR'] as Corner[]) {
      let hinge: Object3D | undefined;
      this.model.traverse((o) => {
        if (!hinge && DOOR(corner).test(o.name)) hinge = o;
      });
      if (!hinge) continue;
      const names = new Set<string>();
      hinge.traverse((o) => names.add(o.name));
      const tracks = open.tracks.filter((t) => names.has(t.name.slice(0, t.name.lastIndexOf('.'))));
      if (!tracks.length) continue;
      const action = this.mixer.clipAction(new AnimationClip(`door_${corner}`, open.duration, tracks));
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      this.doorActions.set(corner, action);
    }
  }

  hasDoor(corner: Corner): boolean {
    return this.doorActions.has(corner);
  }

  // Open or close a door; instant under reduced motion or on first sync.
  setDoor(corner: Corner, open: boolean, instant = false) {
    const a = this.doorActions.get(corner);
    if (!a || (this.doorOpen.get(corner) ?? false) === open) return;
    this.doorOpen.set(corner, open);
    const end = a.getClip().duration;
    if (!a.isRunning()) a.time = open ? 0 : end; // else reverse from where it is
    a.enabled = true;
    a.paused = false;
    a.timeScale = open ? 1 : -1;
    a.play();
    if (instant || this.opts.reducedMotion) {
      a.time = open ? end : 0;
      this.mixer!.update(0);
    }
    this.dirty = true;
  }

  private addShadow() {
    // Soft contact shadow: a radial gradient on a ground plane (no shadow maps).
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new CanvasTexture(c);
    const { size, forward } = this.frame;
    const plane = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    plane.rotation.x = -Math.PI / 2;
    plane.rotation.z = Math.atan2(forward.x, forward.z);
    const len = Math.max(size.x, size.z);
    const wid = Math.min(size.x, size.z);
    plane.scale.set(wid * 1.7, len * 1.3, 1);
    plane.position.y = 0.002;
    this.shadow = plane;
    this.scene.add(plane);
  }

  // Front-left three-quarter view, like the car photo.
  private outsidePose(): [Vector3, Vector3] {
    const { forward, left, size, center } = this.frame;
    const target = new Vector3(center.x, size.y * 0.42, center.z);
    const dir = forward.clone().multiplyScalar(0.85).add(left.clone().multiplyScalar(1)).normalize();
    const dist = this.fitDistance();
    const pos = target.clone().addScaledVector(dir, dist * Math.cos(0.26)).setY(target.y + dist * Math.sin(0.26));
    return [pos, target];
  }

  private fitDistance() {
    const len = Math.max(this.frame.size.x, this.frame.size.z);
    const vfov = (OUTSIDE_FOV * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    return Math.max((len * 0.5) / Math.tan(hfov / 2), (this.frame.size.y * 0.95) / Math.tan(vfov / 2));
  }

  private placeOutside() {
    const [pos, target] = this.outsidePose();
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.applyOutsideLimits();
    this.controls.update();
  }

  private applyOutsideLimits() {
    const d = this.fitDistance();
    this.camera.fov = OUTSIDE_FOV;
    this.camera.near = 0.05;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = d * 0.55;
    this.controls.maxDistance = d * 1.6;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04; // never below the ground
    this.controls.enableZoom = true;
    this.controls.rotateSpeed = 0.7;
  }

  isInside() {
    return this.inside;
  }

  // Fly into the cabin (look around from its centre) or back out.
  setInside(inside: boolean) {
    if (!this.model || inside === this.inside) return;
    this.inside = inside;
    this.controls.autoRotate = false;
    this.focusState = undefined;
    const from: [Vector3, Vector3] = [this.camera.position.clone(), this.controls.target.clone()];
    if (inside) {
      const eye = this.frame.cabin.clone();
      const to: [Vector3, Vector3] = [eye, eye.clone().addScaledVector(this.frame.forward, 0.01)];
      this.flyTo(from, to, () => {
        this.camera.fov = INSIDE_FOV;
        this.camera.near = 0.01;
        this.camera.updateProjectionMatrix();
        // Orbiting a target 1 cm ahead = turning your head; reversed so the
        // view follows the finger.
        this.controls.minDistance = this.controls.maxDistance = 0.01;
        this.controls.minPolarAngle = 0.35;
        this.controls.maxPolarAngle = Math.PI - 0.35;
        this.controls.enableZoom = false;
        this.controls.rotateSpeed = -0.35;
      });
    } else {
      this.controls.minDistance = 0;
      this.controls.maxDistance = Infinity;
      this.camera.fov = OUTSIDE_FOV;
      this.camera.updateProjectionMatrix();
      this.flyTo(from, this.outsidePose(), () => this.applyOutsideLimits());
    }
  }

  private flyTo(from: [Vector3, Vector3], to: [Vector3, Vector3], done?: () => void) {
    if (this.opts.reducedMotion) {
      this.camera.position.copy(to[0]);
      this.controls.target.copy(to[1]);
      done?.();
      this.controls.update();
      this.dirty = true;
      return;
    }
    this.controls.enabled = false;
    this.fly = { from, to, t0: performance.now(), ms: 1200, done };
  }

  // ---- Right-hand drive ----

  // Turn a left-hand-drive model into right-hand drive the way the real car
  // differs: the whole front-interior module (dashboard, screens, steering
  // wheel and column, pedals, centre stack) is reflected across the car's
  // centre plane. Exterior, doors and seats stay as they are, so badges read
  // normally. Text on the moved parts is put right again: textures matching
  // `flip` are mirrored back, the `split` screen texture has each half flipped
  // in place (so the cluster ends up in front of the driver), and parts matching
  // `keep` (the wheel's logo) are reflected again about their own centre.
  // Baked once into the cached model.
  private rhd(root: Object3D) {
    const opt = this.opts.rhd;
    if (!opt || root.userData.rhdDone) return;
    root.userData.rhdDone = true;
    const cfg = typeof opt === 'object' ? opt : {};
    const rx = (s: string | undefined, def?: string) => (s ?? def ? new RegExp((s ?? def)!, 'i') : undefined);
    const include = rx(cfg.include);
    const exclude = rx(cfg.exclude);
    const flip = rx(cfg.flip);
    const split = rx(cfg.split, 'display');
    const keep = rx(cfg.keep, 'steering_?wheel_?logo');
    const skipMat = new RegExp(`glass|${this.opts.paintMaterial || 'carpaint'}`, 'i');

    const { forward, left, center, size } = this.frame;
    const { front, rear } = this.axles();
    const along = (p: Vector3) => p.clone().sub(center).dot(forward);
    const across = (p: Vector3) => p.clone().sub(center).dot(left);
    const sF = along(front);
    const sR = along(rear);
    const wheelbase = sF - sR;
    // From the front seat backs to just behind the front axle; inside the body.
    const sMin = sR + 0.37 * wheelbase;
    const sMax = sF - 0.08 * wheelbase;
    const halfW = Math.min(size.x, size.z) * 0.45;

    const doorParts = new Set<Object3D>();
    root.traverse((o) => {
      if (CORNERS.some((c) => DOOR(c).test(o.name))) o.traverse((d) => doorParts.add(d));
    });
    const keepParts = new Set<Object3D>();
    if (keep) root.traverse((o) => keep.test(o.name) && o.traverse((d) => keepParts.add(d)));

    root.updateMatrixWorld(true);
    const picked: Mesh[] = [];
    const straddling: Mesh[] = [];
    const corner = new Vector3();
    // Loose world-space box around the region, for a quick overlap test.
    const regionBox = new Box3();
    for (const s of [sMin, sMax]) for (const l of [-halfW, halfW]) for (const y of [size.y * 0.1, size.y * 0.92]) {
      regionBox.expandByPoint(center.clone().addScaledVector(forward, s).addScaledVector(left, l).setY(y));
    }
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || doorParts.has(m)) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const named = (re?: RegExp) => !!re && (re.test(m.name) || mats.some((x) => re.test(x.name)));
      if (named(exclude)) return;
      if (named(include)) return void picked.push(m);
      if (mats.some((x) => skipMat.test(x.name))) return;
      const b = new Box3().setFromObject(m);
      if (b.isEmpty()) return;
      let inside = b.min.y > size.y * 0.1 && b.max.y < size.y * 0.92;
      for (let i = 0; inside && i < 8; i++) {
        corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
        const s = along(corner);
        inside = s > sMin && s < sMax && Math.abs(across(corner)) < halfW;
      }
      if (inside) picked.push(m);
      else if (!Array.isArray(m.material) && b.intersectsBox(regionBox)) straddling.push(m);
    });

    // Big meshes that reach into the region (the low-detail body shell carries
    // a hidden copy of the dashboard and wheel) are split: their triangles
    // inside the region become a new mesh that moves with the rest.
    const p = new Vector3();
    const inRegion = (q: Vector3) => {
      const s = along(q);
      return s > sMin && s < sMax && Math.abs(across(q)) < halfW && q.y > size.y * 0.1 && q.y < size.y * 0.92;
    };
    for (const m of straddling) {
      const g = m.geometry;
      const pos = g.attributes.position;
      const index = g.index;
      const tris = (index ? index.count : pos.count) / 3;
      const keep: number[] = [];
      const move: number[] = [];
      for (let t = 0; t < tris; t++) {
        const ids = [0, 1, 2].map((k) => (index ? index.getX(t * 3 + k) : t * 3 + k));
        const all = ids.every((id) => inRegion(p.fromBufferAttribute(pos, id).applyMatrix4(m.matrixWorld)));
        (all ? move : keep).push(...ids);
      }
      if (!move.length) continue;
      const big = pos.count > 65535;
      const piece = new BufferGeometry();
      for (const [k, a] of Object.entries(g.attributes)) piece.setAttribute(k, a);
      piece.setIndex(big ? Array.from(new Uint32Array(move)) : move);
      g.setIndex(keep);
      g.computeBoundingBox();
      g.computeBoundingSphere();
      piece.computeBoundingBox();
      piece.computeBoundingSphere();
      const part = new Mesh(piece, m.material);
      part.name = `${m.name}_rhd`;
      part.matrixAutoUpdate = false;
      part.matrix.copy(m.matrix);
      m.parent!.add(part);
      part.updateMatrixWorld(true);
      picked.push(part);
    }

    const reflect = (p: Vector3) => {
      const n = left;
      const r = new Matrix4().set(
        1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 0,
        -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 0,
        -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, 0,
        0, 0, 0, 1,
      );
      return new Matrix4().makeTranslation(p.x, p.y, p.z).multiply(r).multiply(new Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    };
    // Move only the top-most picked parts; their children come along.
    const pickedSet = new Set<Object3D>(picked);
    const hasPickedAncestor = (o: Object3D) => {
      for (let a = o.parent; a; a = a.parent) if (pickedSet.has(a)) return true;
      return false;
    };
    const mirror = reflect(center); // the car's centre plane
    for (const m of picked) {
      if (hasPickedAncestor(m)) continue;
      m.matrixAutoUpdate = false;
      m.matrix.copy(m.parent!.matrixWorld.clone().invert().multiply(mirror).multiply(m.matrixWorld));
    }
    root.updateMatrixWorld(true);

    const moved = new Set<Object3D>();
    for (const m of picked) m.traverse((d) => moved.add(d));
    const flipped = new Map<Material, Material>();
    const fix = (mat: Material) => {
      const halves = !!split && split.test(mat.name);
      if (!halves && !(flip && flip.test(mat.name))) return mat;
      let out = flipped.get(mat);
      if (!out) {
        out = mat.clone();
        const std = out as MeshStandardMaterial;
        for (const key of ['map', 'emissiveMap'] as const) {
          const t = std[key];
          if (t) std[key] = halves ? flipHalves(t) : flipU(t);
        }
        flipped.set(mat, out);
      }
      return out;
    };
    for (const o of moved) {
      const m = o as Mesh;
      if (!m.isMesh) continue;
      // Logos: reflect again about their own centre, so they're moved, not mirrored.
      if (keepParts.has(m)) {
        const c = new Box3().setFromObject(m).getCenter(new Vector3());
        m.matrixAutoUpdate = false;
        m.matrix.copy(m.parent!.matrixWorld.clone().invert().multiply(reflect(c)).multiply(m.matrixWorld));
      }
      m.material = Array.isArray(m.material) ? m.material.map(fix) : fix(m.material);
    }
    root.updateMatrixWorld(true);
  }

  // ---- Number plates ----

  // Puts `plate` on the car's number plates, found by shape: a thin textured
  // panel about 52 × 12 cm, centred, at the very front; the rear plate shares
  // its material. A rear plate that's broken in the source (squashed flat) is
  // replaced by a copy of the front one.
  private plates(root: Object3D) {
    const text = this.opts.plate;
    if (!text) return;
    const { forward, left, center } = this.frame;
    const { front: frontAxle } = this.axles();
    const along = (p: Vector3) => p.clone().sub(center).dot(forward);
    const sF = along(frontAxle);
    root.updateMatrixWorld(true);

    let front: { mesh: Mesh; s: number } | undefined;
    const boxOf = (m: Object3D) => new Box3().setFromObject(m);
    // Extent of a box along a horizontal axis (works for any yaw).
    const extent = (b: Box3, axis: Vector3) => Math.abs((b.max.x - b.min.x) * axis.x) + Math.abs((b.max.z - b.min.z) * axis.z);
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || Array.isArray(m.material) || !(m.material as MeshStandardMaterial).map) return;
      const b = boxOf(m);
      const c = b.getCenter(new Vector3());
      const wide = extent(b, left);
      const deep = extent(b, forward);
      const tall = b.max.y - b.min.y;
      const s = along(c);
      if (wide > 0.35 && wide < 0.7 && tall > 0.07 && tall < 0.22 && deep < 0.06 && Math.abs(c.clone().sub(center).dot(left)) < 0.1 && s > sF + 0.4) {
        if (!front || s > front.s) front = { mesh: m, s };
      }
    });
    if (!front) return;
    const mat = front.mesh.material as MeshStandardMaterial;

    if (!root.userData.platesDone) {
      root.userData.platesDone = true;
      const frontC = boxOf(front.mesh).getCenter(new Vector3());
      root.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh || m === front!.mesh || m.material !== mat) return;
        const b = boxOf(m);
        const c = b.getCenter(new Vector3());
        if (along(c) > 0 || b.max.y - b.min.y > 0.02) return; // a real rear plate keeps its own geometry
        // Squashed in the source: hide it and put a copy of the front plate there.
        m.visible = false;
        const turn = new Matrix4().makeRotationAxis(new Vector3(0, 1, 0), Math.PI);
        const at = c.clone().addScaledVector(forward, -0.004);
        const world = new Matrix4()
          .makeTranslation(at.x, at.y, at.z)
          .multiply(turn)
          .multiply(new Matrix4().makeTranslation(-frontC.x, -frontC.y, -frontC.z))
          .multiply(front!.mesh.matrixWorld);
        const copy = new Mesh(front!.mesh.geometry, mat);
        copy.name = 'rear_plate_copy';
        copy.matrixAutoUpdate = false;
        copy.matrix.copy(m.parent!.matrixWorld.clone().invert().multiply(world));
        m.parent!.add(copy);
      });
    }

    const old = mat.map;
    mat.map = plateTexture(text, old?.flipY ?? false);
    mat.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    mat.color.set('#ffffff');
    // The model's plate also glows its own text through emissiveMap; drop it.
    mat.emissiveMap = null;
    mat.emissive.set(0x000000);
    mat.needsUpdate = true;
    this.plateTexture = mat.map;
  }

  // ---- Car status on the model ----

  private prepareLamps(root: Object3D) {
    const byName = new Map<string, Object3D>();
    root.traverse((o) => byName.set(o.name, o));
    this.lamps = [];
    for (const [name, lit] of byName) {
      const m = LIT.exec(name);
      if (!m) continue;
      const base = name.slice(0, m.index);
      const unlit = [...byName.entries()].filter(([n]) => n !== name && n.startsWith(`${base}_`) && /^\d+$/.test(n.slice(base.length + 1))).map(([, o]) => o);
      // The model switches its lights off by scaling the lit twin to ~0 (1e-10),
      // so showing it needs the unlit twin's scale as well as `visible`.
      if (lit.scale.x < 1e-6 && unlit[0]) lit.scale.copy(unlit[0].scale);
      const signal = m[1] === 'Turn_Signal';
      if (signal) tintSignal(lit, this.frame);
      this.lamps.push({ lit, unlit, signal });
    }
    this.prepareTailSignals();
    this.setLamps();
  }

  // The white segments of the rear lamps at the indicators' height (the light
  // bar's segment on the tailgate, just inside the corner) join the rear
  // indicator: one sweep from their inner edge to the indicators' outer edge,
  // like the real car. They are texture detail inside the tail lens, so they're
  // found by sampling its glow texture, and recoloured in its shader.
  private prepareTailSignals() {
    const { forward, center, left } = this.frame;
    // World matrices must reflect the lit twins' restored scale.
    this.model?.updateMatrixWorld(true);
    const meshesOf = (o: Object3D) => {
      const out: Mesh[] = [];
      o.traverse((m) => (m as Mesh).isMesh && out.push(m as Mesh));
      return out;
    };
    const rearSignals = this.lamps.filter((l) => l.signal).flatMap((l) => meshesOf(l.lit)).filter((m) => meshSpan(m, center, forward, left).along < 0);
    if (!rearSignals.length) return;
    const spans = rearSignals.map((m) => meshSpan(m, center, forward, left));
    const band = { min: Math.min(...spans.map((x) => x.yMin)) - 0.05, max: Math.max(...spans.map((x) => x.yMax)) + 0.05 };
    let inner = Math.min(...spans.map((x) => x.inner));
    let outer = Math.max(...spans.map((x) => x.outer));

    const tails = this.lamps
      .filter((l) => !l.signal)
      .flatMap((l) => [l.lit, ...l.unlit].flatMap(meshesOf))
      .filter((m) => meshSpan(m, center, forward, left).along < 0 && !!(m.material as MeshStandardMaterial).emissiveMap);
    const found: { mesh: Mesh; white: { inner: number; outer: number } }[] = [];
    for (const mesh of tails) {
      mesh.userData.tailWhite ??= whiteSpan(mesh, center, left, band) ?? null;
      const white = mesh.userData.tailWhite as { inner: number; outer: number } | null;
      if (!white) continue;
      found.push({ mesh, white });
      inner = Math.min(inner, white.inner);
      outer = Math.max(outer, white.outer);
    }
    // One range for the whole rear sweep: the indicators share it too.
    for (const m of rearSignals) {
      const u = m.userData.signalUniforms as { uInner: { value: number }; uOuter: { value: number } } | undefined;
      if (u) {
        u.uInner.value = inner;
        u.uOuter.value = outer;
      }
    }
    for (const { mesh } of found) tintTail(mesh, { center, left, inner, outer, band });
  }

  private setLamps() {
    const v = this.visual;
    signalOn.value = v?.signals && this.blinkOn ? 1 : 0;
    for (const l of this.lamps) {
      const on = l.signal ? !!v?.signals && this.blinkOn : !!v?.headlamps;
      l.lit.visible = on;
      l.unlit.forEach((u) => (u.visible = !on));
    }
    this.dirty = true;
  }

  private prepareGlass(root: Object3D) {
    const seen = new Set<Material>();
    this.glass = [];
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (seen.has(m)) continue;
        seen.add(m);
        const front = /front.?glass/i.test(m.name);
        const rear = /^rear.?glass/i.test(m.name);
        if (!front && !rear) continue;
        const std = m as MeshStandardMaterial;
        // The parsed model is reused across opens: remember the original once.
        std.userData.baseColor ??= std.color.clone();
        this.glass.push({ mat: std, rear, color: std.userData.baseColor as Color });
      }
    });
  }

  // Soft additive glows for heaters and climate, placed from the car's frame.
  private addGlows(root: Object3D) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.glowTexture = new CanvasTexture(c);
    const add = (key: string, pos: Vector3, scale: number, color: string, opacity: number) => {
      const sprite = new Sprite(new SpriteMaterial({ map: this.glowTexture, color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false }));
      sprite.position.copy(pos);
      sprite.scale.setScalar(scale);
      sprite.visible = false;
      this.scene.add(sprite);
      this.glows.push({ sprite, key });
    };
    for (const corner of CORNERS) add(`seat:${corner}`, this.seatPoint(corner), 0.6, '#ff7a1a', 0.75);
    let wheel: Object3D | undefined;
    root.traverse((o) => {
      if (!wheel && /steering_?wheel/i.test(o.name)) wheel = o;
    });
    const wheelPos = wheel
      ? new Box3().setFromObject(wheel).getCenter(new Vector3())
      : this.seatPoint(this.opts.driverSide === 'right' ? 'FR' : 'FL').addScaledVector(this.frame.forward, 0.45).setY(this.frame.size.y * 0.55);
    add('steering', wheelPos, 0.5, '#ff7a1a', 0.8);
    add('ac', this.frame.cabin.clone().setY(this.frame.size.y * 0.55), 1.9, '#38bdf8', 0.35);
  }

  private axles() {
    const t = this.tyres;
    const { center, forward, size } = this.frame;
    const half = Math.max(size.x, size.z) * 0.3;
    const front = t.size === 4 ? t.get('FL')!.clone().add(t.get('FR')!).multiplyScalar(0.5) : center.clone().addScaledVector(forward, half);
    const rear = t.size === 4 ? t.get('RL')!.clone().add(t.get('RR')!).multiplyScalar(0.5) : center.clone().addScaledVector(forward, -half);
    return { front: front.setY(0), rear: rear.setY(0) };
  }

  private side(corner: Corner) {
    return this.frame.left.clone().multiplyScalar(corner[1] === 'L' ? 1 : -1);
  }

  private seatPoint(corner: Corner) {
    const { front, rear } = this.axles();
    return rear
      .clone()
      .lerp(front, corner[0] === 'F' ? 0.47 : 0.15)
      .addScaledVector(this.side(corner), 0.37)
      .setY(this.frame.size.y * 0.46); // just above the cushion, so it isn't hidden in it
  }

  // A point on the car for a callout, and the outward direction it faces.
  anchor(a: Anchor): { pos: Vector3; normal: Vector3 } {
    const { forward, size, cabin } = this.frame;
    const { front, rear } = this.axles();
    const halfW = Math.min(size.x, size.z) * 0.45;
    const up = new Vector3(0, 1, 0);
    const [kind, corner] = a.split(':') as [string, Corner | undefined];
    if (kind === 'tyre' && corner) {
      const side = this.side(corner);
      const isFront = corner[0] === 'F';
      const pos = (this.tyres.get(corner)?.clone() ?? (isFront ? front : rear).clone().addScaledVector(side, halfW).setY(0.35)).addScaledVector(side, 0.12);
      return { pos, normal: side.clone().addScaledVector(forward, isFront ? 0.6 : -0.6).normalize() };
    }
    if (kind === 'door' && corner) {
      const side = this.side(corner);
      const pos = rear
        .clone()
        .lerp(front, corner[0] === 'F' ? 0.66 : 0.3)
        .addScaledVector(side, halfW)
        .setY(size.y * 0.55);
      return { pos, normal: side.clone().addScaledVector(forward, corner[0] === 'F' ? 0.3 : -0.3).normalize() };
    }
    const passenger = this.frame.left.clone().multiplyScalar(this.opts.driverSide === 'right' ? 1 : -1);
    switch (a) {
      case 'hood':
        return { pos: front.clone().addScaledVector(forward, 0.25).setY(size.y * 0.62), normal: forward.clone().addScaledVector(up, 0.5).normalize() };
      case 'trunk':
        return { pos: rear.clone().addScaledVector(forward, -0.8).setY(size.y * 0.7), normal: forward.clone().negate().addScaledVector(up, 0.2).normalize() };
      case 'lampFront':
        return { pos: front.clone().addScaledVector(forward, 0.8).setY(size.y * 0.47), normal: forward.clone() };
      case 'lampRear':
        return { pos: rear.clone().addScaledVector(forward, -0.85).setY(size.y * 0.6), normal: forward.clone().negate() };
      case 'fuel':
        return {
          pos: rear.clone().addScaledVector(forward, 0.05).addScaledVector(passenger, halfW).setY(size.y * 0.6),
          normal: passenger.clone().addScaledVector(forward, -0.4).normalize(),
        };
      default:
        return { pos: cabin.clone().setY(size.y * 0.95), normal: up };
    }
  }

  // Screen position (CSS px within the canvas) of an anchor, and whether it
  // faces the camera (callouts on the far side hide).
  project(a: Anchor): { x: number; y: number; visible: boolean } {
    const { pos, normal } = this.anchor(a);
    const v = pos.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    const facing = normal.dot(this.camera.position.clone().sub(pos).normalize()) > 0.25;
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, visible: !this.inside && !this.fly && facing && v.z < 1 };
  }

  setVisual(v: CarVisual) {
    const first = !this.visual;
    this.visual = v;
    for (const c of CORNERS) this.setDoor(c, v.doors[c], first);
    this.setLamps();
    for (const g of this.glass) {
      const on = g.rear ? v.defrostRear : v.defrostFront;
      g.mat.color.copy(on ? new Color('#7a3008') : g.color);
    }
    for (const g of this.glows) {
      const [kind, corner] = g.key.split(':');
      g.sprite.visible = kind === 'seat' ? !!v.seatHeat[corner as Corner] : kind === 'steering' ? v.steeringHeat : v.ac;
    }
    this.dirty = true;
  }

  // Swing round to each anchor in turn (between free turntable spins).
  setFocus(anchors: Anchor[]) {
    if (anchors.join() === this.focusList.join()) return;
    this.focusList = anchors;
    this.focusState = undefined;
    if (this.opts.reducedMotion && anchors.length && this.model && !this.inside) {
      this.setAzimuth(this.azimuthOf(anchors[0]));
      this.dirty = true;
    }
  }

  private azimuthOf(a: Anchor) {
    const n = this.anchor(a).normal;
    return Math.atan2(n.x, n.z);
  }

  private spherical() {
    return new Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
  }

  private setAzimuth(theta: number) {
    const s = this.spherical();
    s.theta = theta;
    this.camera.position.copy(this.controls.target).add(new Vector3().setFromSpherical(s));
    this.camera.lookAt(this.controls.target);
  }

  // Turntable and issue focus, decided each frame.
  private schedule(now: number) {
    const idle = !!this.model && !this.inside && !this.userHold && !this.opts.reducedMotion;
    if (!idle) {
      this.controls.autoRotate = false;
      return;
    }
    if (!this.focusList.length) {
      this.controls.autoRotate = true;
      return;
    }
    const st = this.focusState;
    const startTurn = (i: number) => {
      const from = this.spherical().theta;
      let delta = this.azimuthOf(this.focusList[i]) - from;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // shortest way round
      this.focusState = { i, phase: 'turn', t0: now, from, to: from + delta };
    };
    if (!st) {
      this.controls.autoRotate = false;
      startTurn(0);
      return;
    }
    if (st.phase === 'turn') {
      this.controls.autoRotate = false;
      const k = Math.min(1, (now - st.t0) / FOCUS_TURN_MS);
      this.setAzimuth(st.from + (st.to - st.from) * easeInOut(k));
      this.dirty = true;
      if (k >= 1) this.focusState = { ...st, phase: 'dwell', t0: now };
    } else if (st.phase === 'dwell') {
      if (now - st.t0 < FOCUS_DWELL_MS) return;
      if (st.i + 1 < this.focusList.length) startTurn(st.i + 1);
      else this.focusState = { ...st, phase: 'spin', t0: now };
    } else {
      this.controls.autoRotate = true;
      if (now - st.t0 > FOCUS_SPIN_MS) startTurn(0);
    }
  }

  onFrame(cb: () => void) {
    this.onFrameCbs.add(cb);
    return () => {
      this.onFrameCbs.delete(cb);
    };
  }

  invalidate() {
    this.dirty = true;
  }

  resize(width: number, height: number) {
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Draw the car a little below (and on wide stages right of) centre, clear
    // of the fuel numbers in the stage's top-left, without moving the orbit
    // centre. Phones have room below, not beside.
    const aspect = width / height;
    this.camera.setViewOffset(width, height, aspect > 1.2 ? -width * 0.05 : 0, -height * (aspect > 1.2 ? 0.06 : 0.08), width, height);
    this.camera.updateProjectionMatrix();
    if (this.model && !this.inside && !this.fly) this.applyOutsideLimits();
    this.dirty = true;
  }

  private last = 0;
  private tick = (now: number) => {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (this.fly) {
      const f = this.fly;
      const k = easeInOut(Math.min(1, (now - f.t0) / f.ms));
      this.camera.position.lerpVectors(f.from[0], f.to[0], k);
      this.controls.target.lerpVectors(f.from[1], f.to[1], k);
      this.camera.lookAt(this.controls.target);
      this.dirty = true;
      if (k >= 1) {
        this.fly = undefined;
        this.controls.enabled = true;
        f.done?.();
      }
    } else {
      this.schedule(now);
      if (this.controls.update(dt)) this.dirty = true;
    }
    if (this.visual?.signals) {
      const phase = now % (2 * BLINK_MS);
      const on = phase < BLINK_MS;
      if (on !== this.blinkOn) {
        this.blinkOn = on;
        this.setLamps();
      }
      const sweep = this.opts.reducedMotion ? 1 : Math.min(1, phase / SWEEP_MS);
      if (on && sweep !== signalSweep.value) {
        signalSweep.value = sweep;
        this.dirty = true;
      }
    }
    if (this.mixer) {
      const busy = [...this.doorActions.values()].some((a) => a.isRunning());
      if (busy) {
        this.mixer.update(dt);
        this.dirty = true;
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.onFrameCbs.forEach((cb) => cb());
  };

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.last = 0;
    this.dirty = true;
    this.renderer.setAnimationLoop(this.tick);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  dispose() {
    this.disposed = true;
    this.stop();
    window.clearTimeout(this.resumeTimer);
    this.controls.dispose();
    // Free GPU copies only; the parsed model stays cached for the next open.
    const textures = new Set<Texture>();
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        for (const v of Object.values(m)) if ((v as Texture)?.isTexture) textures.add(v as Texture);
        m.dispose();
      }
    });
    textures.forEach((t) => t.dispose());
    if (this.shadow) {
      (this.shadow.material as MeshBasicMaterial).map?.dispose();
      this.scene.remove(this.shadow);
    }
    this.plateTexture?.dispose();
    this.glows.forEach((g) => g.sprite.material.dispose());
    this.glowTexture?.dispose();
    if (this.model) this.scene.remove(this.model);
    this.mixer?.stopAllAction(); // also puts the doors back: the parsed model is reused
    this.scene.environment?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

// A texture mirrored left-right (u → 1 − u), sharing the image.
function flipU(t: Texture): Texture {
  const f = t.clone();
  f.repeat.x = -1;
  f.offset.x = 1;
  f.needsUpdate = true;
  return f;
}

// The same image with its left and right halves each mirrored in place. On a
// mirrored screen this keeps both halves readable and swaps their sides.
function flipHalves(t: Texture): Texture {
  const img = t.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  const half = img.width / 2;
  for (const x0 of [0, half]) {
    g.save();
    g.translate(x0 + half, 0);
    g.scale(-1, 1);
    g.drawImage(img, x0, 0, half, img.height, 0, 0, half, img.height);
    g.restore();
  }
  const out = new CanvasTexture(c);
  out.flipY = t.flipY;
  out.colorSpace = t.colorSpace;
  out.wrapS = t.wrapS;
  out.wrapT = t.wrapT;
  return out;
}

// An Indian high-security registration plate: white, black border, a
// hologram disc and "IND" on the left, the number in bold condensed type.
function plateTexture(text: string, flipY: boolean): CanvasTexture {
  const W = 1024;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6f6f3';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#111';
  g.lineWidth = 10;
  g.beginPath();
  g.roundRect(14, 14, W - 28, H - 28, 22);
  g.stroke();
  // Hologram disc (chakra-like spokes) and IND.
  const cx = 82;
  const cy = 92;
  const disc = g.createRadialGradient(cx - 10, cy - 10, 4, cx, cy, 40);
  disc.addColorStop(0, '#e8eef8');
  disc.addColorStop(0.6, '#9fb3d6');
  disc.addColorStop(1, '#5d77a8');
  g.fillStyle = disc;
  g.beginPath();
  g.arc(cx, cy, 38, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#2f4a80';
  g.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30);
    g.stroke();
  }
  g.fillStyle = '#1d3f9a';
  g.font = 'bold 46px Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('IND', cx, 182);
  // Registration, squeezed to fit the space right of the hologram.
  g.fillStyle = '#111';
  g.font = 'bold 168px "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';
  const left = 150;
  const room = W - left - 40;
  const w = g.measureText(text).width;
  const k = Math.min(1, room / w);
  g.save();
  g.translate(left + room / 2, H / 2 + 6);
  g.scale(k, 1);
  g.fillText(text, 0, 0);
  g.restore();
  const t = new CanvasTexture(c);
  t.flipY = flipY;
  t.colorSpace = SRGBColorSpace;
  return t;
}

// A lit indicator glows flat SIGNAL_COLOR: its own material copy (the original
// may be shared with other lamps), no textures, no lighting and no tone mapping,
// so the colour shows as given. It is drawn only up to the sweep: fragments
// further from the car's centre line than inner + sweep × (outer − inner) are
// discarded, so the light runs outwards. Done once per mesh of the cached model.
function tintSignal(root: Object3D, frame: { left: Vector3; center: Vector3 }) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.userData.signalTint) return;
    mesh.userData.signalTint = true;
    // The lamp's span across the car, from its vertices in world space.
    const pos = mesh.geometry.getAttribute('position');
    const v = new Vector3();
    let inner = Infinity;
    let outer = 0;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.abs(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).sub(frame.center).dot(frame.left));
      inner = Math.min(inner, d);
      outer = Math.max(outer, d);
    }
    const uniforms = {
      uSweep: signalSweep,
      uInner: { value: Number.isFinite(inner) ? inner : 0 },
      uOuter: { value: outer },
      uCenter: { value: frame.center.clone() },
      uLeft: { value: frame.left.clone() },
    };
    mesh.userData.signalUniforms = uniforms;
    const tint = (m: Material) => {
      const c = m.clone() as MeshStandardMaterial;
      c.map = null;
      c.emissiveMap = null;
      c.color?.set(0x000000);
      c.emissive?.set(SIGNAL_COLOR);
      c.emissiveIntensity = 1;
      c.toneMapped = false;
      c.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uCenter;\nuniform vec3 uLeft;\nvarying float vAcross;')
          .replace(
            '#include <project_vertex>',
            '#include <project_vertex>\nvAcross = abs(dot((modelMatrix * vec4(transformed, 1.0)).xyz - uCenter, uLeft));',
          );
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uSweep;\nuniform float uInner;\nuniform float uOuter;\nvarying float vAcross;')
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vAcross > mix(uInner, uOuter, uSweep) + 0.002) discard;');
      };
      c.customProgramCacheKey = () => 'signal-sweep';
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
  });
}

// Where a mesh sits relative to the car: average position along it, its span
// across (distance from the centre line) and its height range, in world space.
function meshSpan(mesh: Mesh, center: Vector3, forward: Vector3, left: Vector3) {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.getAttribute('position');
  const v = new Vector3();
  const step = Math.max(1, Math.floor(pos.count / 400));
  let along = 0;
  let n = 0;
  let inner = Infinity;
  let outer = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < pos.count; i += step) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    yMin = Math.min(yMin, v.y);
    yMax = Math.max(yMax, v.y);
    v.sub(center);
    along += v.dot(forward);
    const d = Math.abs(v.dot(left));
    inner = Math.min(inner, d);
    outer = Math.max(outer, d);
    n++;
  }
  return { along: n ? along / n : 0, inner, outer, yMin, yMax };
}

// The span across the car of a mesh's white glow texels within a height band,
// by sampling its emissive texture over each triangle (the white is texture
// detail, so vertices alone miss it). Undefined when there is none.
function whiteSpan(mesh: Mesh, center: Vector3, left: Vector3, band: { min: number; max: number }) {
  const img = (mesh.material as MeshStandardMaterial).emissiveMap?.image as CanvasImageSource & { width: number; height: number } | undefined;
  const uv = mesh.geometry.getAttribute('uv');
  if (!img?.width || !uv) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const pos = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.index;
  const tris = index ? index.count / 3 : pos.count / 3;
  const P = [new Vector3(), new Vector3(), new Vector3()];
  const U = [0, 0, 0];
  const V = [0, 0, 0];
  const p = new Vector3();
  const N = 6;
  let inner = Infinity;
  let outer = 0;
  mesh.updateMatrixWorld(true);
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const i = index ? index.getX(3 * t + k) : 3 * t + k;
      P[k].fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      U[k] = uv.getX(i);
      V[k] = uv.getY(i);
    }
    if (Math.max(P[0].y, P[1].y, P[2].y) < band.min || Math.min(P[0].y, P[1].y, P[2].y) > band.max) continue;
    for (let a = 0; a <= N; a++) {
      for (let b = 0; a + b <= N; b++) {
        const w0 = a / N;
        const w1 = b / N;
        const w2 = 1 - w0 - w1;
        p.set(0, 0, 0).addScaledVector(P[0], w0).addScaledVector(P[1], w1).addScaledVector(P[2], w2);
        if (p.y < band.min || p.y > band.max) continue;
        const u = U[0] * w0 + U[1] * w1 + U[2] * w2;
        const v = V[0] * w0 + V[1] * w1 + V[2] * w2;
        const x = Math.min(img.width - 1, Math.floor((((u % 1) + 1) % 1) * img.width));
        const y = Math.min(img.height - 1, Math.floor((((v % 1) + 1) % 1) * img.height)); // glTF: flipY false
        const o = 4 * (y * img.width + x);
        const hi = Math.max(px[o], px[o + 1], px[o + 2]);
        const lo = Math.min(px[o], px[o + 1], px[o + 2]);
        if (hi <= 115 || lo <= 0.7 * hi) continue;
        const d = Math.abs(p.sub(center).dot(left));
        inner = Math.min(inner, d);
        outer = Math.max(outer, d);
      }
    }
  }
  return Number.isFinite(inner) ? { inner, outer } : undefined;
}

// While the indicators are lit, the tail lens's white texels inside the band
// and reached by the sweep show SIGNAL_COLOR (written after tone mapping, so
// exactly that colour); the rest of the lens is untouched. Once per mesh.
function tintTail(mesh: Mesh, r: { center: Vector3; left: Vector3; inner: number; outer: number; band: { min: number; max: number } }) {
  const prev = mesh.userData.tailUniforms as { uInner: { value: number }; uOuter: { value: number } } | undefined;
  if (prev) {
    prev.uInner.value = r.inner;
    prev.uOuter.value = r.outer;
    return;
  }
  const hex = SIGNAL_COLOR.replace('#', '');
  const uniforms = {
    uSweep: signalSweep,
    uSignalOn: signalOn,
    uInner: { value: r.inner },
    uOuter: { value: r.outer },
    uYMin: { value: r.band.min },
    uYMax: { value: r.band.max },
    uCenter: { value: r.center.clone() },
    uLeft: { value: r.left.clone() },
    uSignal: { value: new Vector3(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255) },
  };
  mesh.userData.tailUniforms = uniforms;
  const patch = (m: Material) => {
    const c = m.clone() as MeshStandardMaterial;
    c.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uCenter;\nuniform vec3 uLeft;\nvarying float vAcross;\nvarying float vY;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvec4 tailWorld = modelMatrix * vec4(transformed, 1.0);\nvAcross = abs(dot(tailWorld.xyz - uCenter, uLeft));\nvY = tailWorld.y;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uSweep;\nuniform float uSignalOn;\nuniform float uInner;\nuniform float uOuter;\nuniform float uYMin;\nuniform float uYMax;\nuniform vec3 uSignal;\nvarying float vAcross;\nvarying float vY;',
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>\nif (uSignalOn > 0.5 && vY >= uYMin && vY <= uYMax && vAcross <= mix(uInner, uOuter, uSweep) + 0.002) {\n  vec3 t = texture2D(emissiveMap, vEmissiveMapUv).rgb;\n  if (${WHITE_GLSL}) gl_FragColor = vec4(uSignal, 1.0);\n}`,
        );
    };
    c.customProgramCacheKey = () => 'tail-signal';
    return c;
  };
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(patch) : patch(mesh.material);
}

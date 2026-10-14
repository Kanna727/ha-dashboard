// Imperative three.js viewer for the car modal. React (CarScene.tsx) owns the
// canvas and calls into this; everything per-frame stays out of React.
//
// The model is found by node names (tyres, doors) rather than fixed
// coordinates, so any car model whose parts are named sensibly works.
import {
  ACESFilmicToneMapping,
  AnimationClip,
  AnimationMixer,
  Box3,
  CanvasTexture,
  Color,
  LoopOnce,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
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

export interface ViewerOptions {
  url: string;
  paint?: string; // body colour, e.g. '#2c3527'
  paintMaterial?: string; // case-insensitive regex for the body paint material names
  reducedMotion: boolean;
  onProgress?: (fraction: number) => void;
}

export type Corner = 'FL' | 'FR' | 'RL' | 'RR';

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
    this.scene.environmentIntensity = 0.8; // the room's ceiling lights otherwise bleach the roof and bonnet

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.autoRotate = !opts.reducedMotion;
    this.controls.autoRotateSpeed = 1; // one turn a minute
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
      window.clearTimeout(this.resumeTimer);
    });
    this.controls.addEventListener('end', () => {
      window.clearTimeout(this.resumeTimer);
      if (!this.opts.reducedMotion && !this.inside) this.resumeTimer = window.setTimeout(() => (this.controls.autoRotate = true), RESUME_MS);
    });
  }

  async load(): Promise<void> {
    const gltf = await loadModel(this.opts.url, this.opts.onProgress);
    if (this.disposed) return;
    const root = gltf.scene;
    this.model = root;
    this.normalise(root);
    this.paint(root);
    this.prepareDoors(gltf.animations);
    this.scene.add(root);
    this.addShadow();
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
        std.color = new Color(paint);
        std.metalness = 0.6;
        std.roughness = 0.35;
        if ((m as MeshPhysicalMaterial).isMeshPhysicalMaterial) {
          const phys = m as MeshPhysicalMaterial;
          phys.clearcoat = 1;
          phys.clearcoatRoughness = 0.06;
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
    window.clearTimeout(this.resumeTimer);
    this.controls.autoRotate = false;
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
      this.flyTo(from, this.outsidePose(), () => {
        this.applyOutsideLimits();
        this.controls.autoRotate = !this.opts.reducedMotion;
      });
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

  // Screen position (CSS px within the canvas) of a world point, and whether
  // it faces the camera (for callouts on the far side).
  project(p: Vector3, normal?: Vector3): { x: number; y: number; visible: boolean } {
    const v = p.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    const facing = !normal || normal.dot(this.camera.position.clone().sub(p)) > 0;
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, visible: v.z < 1 && facing && !this.inside };
  }

  tyre(corner: Corner) {
    return this.tyres.get(corner);
  }

  onFrame(cb: () => void) {
    this.onFrameCbs.add(cb);
    return () => this.onFrameCbs.delete(cb);
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
    } else if (this.controls.update(dt)) {
      this.dirty = true;
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
    if (this.model) this.scene.remove(this.model);
    this.mixer?.stopAllAction(); // also puts the doors back: the parsed model is reused
    this.scene.environment?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

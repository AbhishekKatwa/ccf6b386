import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GRID_STEP, MAJOR_GRID, ROTATE_STEP, clampToPlot, corners, type Placement, type Plot } from '@/lib/shedLayout';

/**
 * The farm site plane, drawn with three.js.
 *
 * This object owns no truth: it renders whatever `Placement` list it is handed and reports
 * pointer gestures back as patches. React and Zustand stay the source of record, so an
 * undo, a save or a second tab all behave the same way.
 */

export type SiteViewMode = 'perspective' | 'top';

export interface ShedView {
  id: string;
  code: string;
  name: string;
  geo: Placement;
  conflict: boolean;
}

export interface SceneConfig {
  plot: Plot;
  sheds: ShedView[];
  selectedId: string | null;
  snap: boolean;
  view: SiteViewMode;
  reduced: boolean;
}

export interface SceneCallbacks {
  onSelect(id: string | null): void;
  onPatch(id: string, patch: Partial<Placement>): void;
}

type DragKind = 'move' | 'length' | 'width' | 'rotate';

interface Drag {
  kind: DragKind;
  id: string;
  pointerId: number;
  /** Ground point under the cursor when the drag began, in layout coordinates. */
  grabX: number;
  grabY: number;
  start: Placement;
}

const PALETTE = {
  ground: 0xf2f4f0,
  gridMinor: 0xe4e8e3,
  gridMajor: 0xd2d8d2,
  boundary: 0x123c2a,
  wall: 0xfafaf8,
  wallLive: 0xffffff,
  roof: 0x2e6b4f,
  roofLive: 0x1b5e3b,
  accent: 0xc9972e,
  conflict: 0xb3261e,
  labelBg: 0x123c2a,
  labelFg: 0xffffff,
};

const DEG = Math.PI / 180;
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

interface ShedParts {
  group: THREE.Group;
  wall: THREE.Mesh;
  roof: THREE.Mesh;
  outline: THREE.LineLoop;
  label: THREE.Sprite;
  dims: { lengthM: number; widthM: number; heightM: number };
  text: string;
}

export class SiteScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private site = new THREE.Group();
  private parts = new Map<string, ShedParts>();
  private handles: { group: THREE.Group; length: THREE.Mesh; width: THREE.Mesh; rotate: THREE.Mesh; ring: THREE.LineLoop };
  private plotKey = '';
  private drag: Drag | null = null;
  /** The in-flight gesture's placement, held until React echoes the same numbers back. */
  private optimistic: Placement | null = null;
  private tween: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t0: number; ms: number } | null = null;
  private observer: ResizeObserver;
  private raf = 0;
  private dirty = true;
  private disposed = false;
  private cfg: SceneConfig;

  constructor(private container: HTMLElement, private cb: SceneCallbacks, initial: SceneConfig) {
    this.cfg = initial;
    this.renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio < 2,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.width(), this.height(), false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute('aria-label', 'Farm shed layout');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xf7f8f5);
    this.camera = new THREE.PerspectiveCamera(46, this.width() / this.height(), 0.5, 6000);
    this.camera.position.copy(this.homePosition());
    this.scene.add(this.camera);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xdfe6de, 1.15);
    const sun = new THREE.DirectionalLight(0xfff6e2, 1.15);
    sun.position.set(1, 1.4, 0.7).multiplyScalar(Math.max(initial.plot.lengthM, initial.plot.widthM));
    sun.castShadow = true;
    const fit = Math.max(initial.plot.lengthM, initial.plot.widthM);
    sun.shadow.mapSize.set(window.innerWidth < 700 ? 1024 : 2048, window.innerWidth < 700 ? 1024 : 2048);
    sun.shadow.camera.left = -fit; sun.shadow.camera.right = fit;
    sun.shadow.camera.top = fit; sun.shadow.camera.bottom = -fit;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = fit * 5;
    sun.shadow.bias = -0.0005;
    this.scene.add(hemi, sun);
    this.scene.add(this.site);
    this.handles = this.buildHandles();
    this.scene.add(this.handles.group);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.minDistance = fit * 0.05;
    this.controls.maxDistance = fit * 4;
    this.controls.addEventListener('change', this.markDirty);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.observer = new ResizeObserver(this.markDirty);
    this.observer.observe(container);

    this.sync(initial);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ============================== sizing ==============================

  private width() { return Math.max(1, this.container.clientWidth); }
  private height() { return Math.max(1, this.container.clientHeight); }

  private fit() { return Math.max(this.cfg.plot.lengthM, this.cfg.plot.widthM); }

  private homePosition(mode: SiteViewMode = this.cfg.view) {
    const f = this.fit();
    return mode === 'top'
      ? new THREE.Vector3(0, f * 1.35, 0.01)
      : new THREE.Vector3(f * 0.08, f * 0.78, f * 0.95);
  }

  private markDirty = () => { this.dirty = true; };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const tweening = this.stepTween();
    const damping = this.controls.update();
    if (tweening || damping || this.dirty) {
      this.dirty = false;
      this.render();
    }
  };

  private stepTween(): boolean {
    if (!this.tween) return false;
    const k = Math.min(1, (performance.now() - this.tween.t0) / this.tween.ms);
    const e = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
    this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, e);
    this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, e);
    if (k >= 1) this.tween = null;
    return true;
  }

  private render() { this.renderer.render(this.scene, this.camera); }

  /** Re-draw after a React state change, and paint immediately so hidden tabs stay correct. */
  sync(cfg: SceneConfig) {
    if (this.disposed) return;
    const prevView = this.cfg.view;
    const prevPlot = this.plotKey;
    this.cfg = cfg;
    const key = `${cfg.plot.lengthM}x${cfg.plot.widthM}`;
    if (key !== prevPlot) { this.plotKey = key; this.buildSite(cfg.plot); this.retarget(); }
    this.updateSheds(cfg);
    this.updateHandles(cfg);
    this.controls.minDistance = this.fit() * 0.05;
    this.controls.maxDistance = this.fit() * 4;
    if (cfg.view !== prevView) this.fly(cfg.view);
    this.dirty = true;
    this.render();
  }

  /** Fit the camera to the plot again, e.g. after the plot is resized. */
  private retarget() {
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(this.homePosition());
    this.controls.update();
  }

  private fly(mode: SiteViewMode) {
    const to = this.homePosition(mode);
    if (this.cfg.reduced) {
      this.camera.position.copy(to);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      this.dirty = true;
      return;
    }
    this.tween = {
      fromPos: this.camera.position.clone(), toPos: to,
      fromTarget: this.controls.target.clone(), toTarget: new THREE.Vector3(0, 0, 0),
      t0: performance.now(), ms: 620,
    };
  }

  /** Frame every shed on the plot — the "fit to site" action in the toolbar. */
  resetView() {
    this.fly(this.cfg.view);
  }

  // ============================== static geometry ==============================

  private buildSite(plot: Plot) {
    this.site.clear();
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(plot.lengthM, plot.widthM),
      new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.96, metalness: 0 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    this.site.add(plane);

    const minor: number[] = [];
    const major: number[] = [];
    const add = (arr: number[], x1: number, z1: number, x2: number, z2: number) => {
      arr.push(x1, 0.04, z1, x2, 0.04, z2);
    };
    // Centred on the origin so a snapped shed sits on the lines, not between them.
    for (let x = 0; x <= plot.lengthM / 2 + 1e-6; x += GRID_STEP) {
      const arr = x % MAJOR_GRID === 0 ? major : minor;
      for (const s of x === 0 ? [1] : [1, -1]) add(arr, s * x, -plot.widthM / 2, s * x, plot.widthM / 2);
    }
    for (let z = 0; z <= plot.widthM / 2 + 1e-6; z += GRID_STEP) {
      const arr = z % MAJOR_GRID === 0 ? major : minor;
      for (const s of z === 0 ? [1] : [1, -1]) add(arr, -plot.lengthM / 2, s * z, plot.lengthM / 2, s * z);
    }
    this.site.add(gridLines(minor, PALETTE.gridMinor), gridLines(major, PALETTE.gridMajor));

    const h = { x: plot.lengthM / 2, z: plot.widthM / 2 };
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-h.x, 0.08, -h.z), new THREE.Vector3(h.x, 0.08, -h.z),
        new THREE.Vector3(h.x, 0.08, h.z), new THREE.Vector3(-h.x, 0.08, h.z),
      ]),
      new THREE.LineBasicMaterial({ color: PALETTE.boundary }),
    );
    this.site.add(ring);
  }

  private buildHandles() {
    const r = Math.max(2, this.fit() * 0.014);
    const mat = new THREE.MeshBasicMaterial({ color: PALETTE.accent });
    const knob = (geo: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      return m;
    };
    const length = knob(new THREE.SphereGeometry(r, 20, 14));
    const width = knob(new THREE.SphereGeometry(r, 20, 14));
    const rotate = knob(new THREE.SphereGeometry(r * 0.85, 20, 14));
    length.userData.handle = 'length';
    width.userData.handle = 'width';
    rotate.userData.handle = 'rotate';
    const ring = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.35 }));
    ring.visible = false;
    const group = new THREE.Group();
    group.add(length, width, rotate, ring);
    return { group, length, width, rotate, ring };
  }

  // ============================== sheds ==============================

  private updateSheds(cfg: SceneConfig) {
    const live = new Set(cfg.sheds.map(s => s.id));
    for (const [id, p] of this.parts) {
      if (live.has(id)) continue;
      this.parts.delete(id);
      this.site.remove(p.group);
      disposeObject(p.group);
    }
    cfg.sheds.forEach(shed => {
      const geo = this.geoOf(shed.id)!;
      let p = this.parts.get(shed.id);
      if (!p) { p = this.buildShed(); this.parts.set(shed.id, p); this.site.add(p.group); }
      if (p.dims.lengthM !== geo.lengthM || p.dims.widthM !== geo.widthM || p.dims.heightM !== geo.heightM) {
        rebuildShed(p, geo);
        p.dims = { lengthM: geo.lengthM, widthM: geo.widthM, heightM: geo.heightM };
      }
      const selected = cfg.selectedId === shed.id;
      p.group.position.set(geo.layoutX, 0, -geo.layoutY);
      p.group.rotation.y = geo.rotationDeg * DEG;
      const color = shed.conflict ? PALETTE.conflict : selected ? PALETTE.accent : PALETTE.boundary;
      const wallMat = p.wall.material as THREE.MeshStandardMaterial;
      const roofMat = p.roof.material as THREE.MeshStandardMaterial;
      wallMat.color.setHex(selected ? PALETTE.wallLive : PALETTE.wall);
      roofMat.color.setHex(selected ? PALETTE.roofLive : PALETTE.roof);
      (p.outline.material as THREE.LineBasicMaterial).color.setHex(color);
      p.outline.visible = selected || shed.conflict;
      p.label.position.set(0, geo.heightM + Math.max(3, this.fit() * 0.012), 0);
      const text = `${shed.name} · ${shed.code}`;
      if (p.text !== text) { p.text = text; drawLabel(p.label, text); }
    });
  }

  private buildShed(): ShedParts {
    const group = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.82, metalness: 0 }));
    const roof = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: PALETTE.roof, roughness: 0.7, metalness: 0, flatShading: true }));
    wall.castShadow = roof.castShadow = true;
    wall.receiveShadow = roof.receiveShadow = true;
    const outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: PALETTE.accent }));
    outline.position.y = 0.12;
    outline.visible = false;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ sizeAttenuation: false, transparent: true, depthWrite: false }));
    label.scale.set(0.2, 0.028, 1);
    label.position.y = 1.02;
    label.renderOrder = 10;
    group.add(wall, roof, outline, label);
    return { group, wall, roof, outline, label, dims: { lengthM: 0, widthM: 0, heightM: 0 }, text: '' };
  }

  // ============================== pointer work ==============================

  private ndc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return this.pointer;
  }

  /** Cursor position projected onto the ground, in layout coordinates (x right, y up on plan). */
  private groundPoint(e: PointerEvent) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hit = this.raycaster.ray.intersectPlane(GROUND, new THREE.Vector3());
    return hit ? { x: hit.x, y: -hit.z } : null;
  }

  private pickHandle(e: PointerEvent): DragKind | null {
    if (!this.cfg.selectedId) return null;
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hit = this.raycaster.intersectObjects([this.handles.length, this.handles.width, this.handles.rotate], false)[0];
    return (hit?.object.userData.handle as DragKind) ?? null;
  }

  private pickShed(e: PointerEvent): string | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const meshes = [...this.parts.values()].map(p => p.wall).concat([...this.parts.values()].map(p => p.roof));
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    for (const [id, p] of this.parts) if (p.wall === hit.object || p.roof === hit.object) return id;
    return null;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.drag) return;
    const gp = this.groundPoint(e);
    if (!gp) return;
    const shedId = this.pickShed(e);
    // A handle belongs to the selected shed; every other object carries its own id.
    const id = this.pickHandle(e) ? this.cfg.selectedId : shedId;
    if (!id) {
      if (shedId === null) this.cb.onSelect(null);
      return;
    }
    if (shedId && shedId !== this.cfg.selectedId) this.cb.onSelect(shedId);
    const start = this.geoOf(id);
    if (!start) return;
    this.drag = {
      kind: this.pickHandle(e) ?? 'move', id, pointerId: e.pointerId,
      grabX: gp.x, grabY: gp.y, start: { ...start },
    };
    // Stop the camera from stealing this gesture before OrbitControls sees it.
    this.controls.enabled = false;
    e.stopPropagation();
    e.preventDefault();
    this.dirty = true;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.drag) {
      this.cursor(e);
      return;
    }
    if (e.pointerId !== this.drag.pointerId) return;
    const gp = this.groundPoint(e);
    if (!gp) return;
    const d = this.drag;
    const cur = this.geoOf(d.id);
    if (!cur) return;
    const patch = this.patchFor(d, gp);
    if (!patch) return;
    this.optimistic = clampToPlot({ ...cur, ...patch }, this.cfg.plot);
    this.cb.onPatch(d.id, this.optimistic);
    this.repaint();
  };

  /** Paint this frame's gesture straight away instead of waiting for React to echo it back. */
  private repaint() {
    this.updateSheds(this.cfg);
    this.updateHandles(this.cfg);
    this.render();
  }

  private geoOf(id: string): Placement | null {
    const shed = this.cfg.sheds.find(s => s.id === id);
    if (!shed) return null;
    return this.drag?.id === id && this.optimistic ? this.optimistic : shed.geo;
  }

  /** The gesture maths: one ground point in, a placement patch out. */
  private patchFor(d: Drag, gp: { x: number; y: number }): Partial<Placement> | null {
    const s = (v: number, step: number) => (this.cfg.snap ? Math.round(v / step) * step : v);
    const dx = gp.x - d.grabX;
    const dy = gp.y - d.grabY;
    if (d.kind === 'move') {
      return { layoutX: s(d.start.layoutX + dx, GRID_STEP), layoutY: s(d.start.layoutY + dy, GRID_STEP) };
    }
    const rad = d.start.rotationDeg * DEG;
    // Pointer relative to the shed centre, expressed back in the shed's own axes.
    const rx = gp.x - d.start.layoutX;
    const ry = gp.y - d.start.layoutY;
    const localX = rx * Math.cos(rad) + ry * Math.sin(rad);
    const localY = -rx * Math.sin(rad) + ry * Math.cos(rad);
    if (d.kind === 'length') return { lengthM: s(Math.abs(localX) * 2, 1) };
    if (d.kind === 'width') return { widthM: s(Math.abs(localY) * 2, 1) };
    const a = Math.atan2(gp.y - d.start.layoutY, gp.x - d.start.layoutX) / DEG;
    const spin = d.start.rotationDeg + (a - Math.atan2(d.grabY - d.start.layoutY, d.grabX - d.start.layoutX) / DEG);
    return { rotationDeg: s(((spin % 360) + 360) % 360, ROTATE_STEP) };
  }

  private cursor(e: PointerEvent) {
    const over = this.pickHandle(e) ?? this.pickShed(e);
    this.renderer.domElement.style.cursor = over ? 'grab' : 'default';
  }

  private onPointerUp = (e: PointerEvent) => {
    if (!this.drag) return;
    if (e.pointerId !== this.drag.pointerId) return;
    this.drag = null;
    this.optimistic = null;
    this.controls.enabled = true;
    this.repaint();
  };

  // ============================== selection chrome ==============================

  private updateHandles(cfg: SceneConfig) {
    const sel = cfg.sheds.find(s => s.id === cfg.selectedId);
    const show = !!sel && !this.drag;
    for (const m of [this.handles.length, this.handles.width, this.handles.rotate, this.handles.ring]) m.visible = show;
    if (!sel) return;
    const geo = this.geoOf(sel.id)!;
    const rad = geo.rotationDeg * DEG;
    const cx = geo.layoutX;
    const cz = -geo.layoutY;
    const dirX = { x: Math.cos(rad), z: -Math.sin(rad) };
    const dirZ = { x: Math.sin(rad), z: Math.cos(rad) };
    const off = Math.max(3, this.fit() * 0.02);
    const y = Math.max(1.5, geo.heightM * 0.55);
    this.handles.length.position.set(cx + dirX.x * (geo.lengthM / 2 + off), y, cz + dirX.z * (geo.lengthM / 2 + off));
    this.handles.width.position.set(cx + dirZ.x * (geo.widthM / 2 + off), y, cz + dirZ.z * (geo.widthM / 2 + off));
    const r = Math.max(geo.lengthM, geo.widthM) / 2 + off * 1.8;
    // The turn knob rides the ring on the shed's diagonal, never on its long axis: stacked on
    // dirX it sat barely 5 m from the length handle — closer than the two radii — so a grab
    // meant to rotate the shed resized it instead.
    const dirR = { x: (dirX.x + dirZ.x) * Math.SQRT1_2, z: (dirX.z + dirZ.z) * Math.SQRT1_2 };
    this.handles.rotate.position.set(cx + dirR.x * r, 0.6, cz + dirR.z * r);
    this.handles.ring.position.set(cx, 0.1, cz);
    this.handles.ring.geometry.dispose();
    this.handles.ring.geometry = circle(r);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown, { capture: true } as EventListenerOptions);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.controls.dispose();
    for (const p of this.parts.values()) disposeObject(p.group);
    this.parts.clear();
    disposeObject(this.site);
    disposeObject(this.handles.group);
    this.renderer.dispose();
    if (el.parentElement === this.container) this.container.removeChild(el);
  }
}

/* ============================== helpers ============================== */

function gridLines(pts: number[], color: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
}

function circle(r: number, segments = 96) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/** Walls plus a gable roof whose pitch survives a resize. */
function rebuildShed(p: ShedParts, geo: Placement) {
  const wallH = Math.max(1, geo.heightM * 0.72);
  const roofH = Math.max(0.8, geo.heightM - wallH);
  p.wall.geometry.dispose();
  const wall = new THREE.BoxGeometry(geo.lengthM, wallH, geo.widthM);
  wall.translate(0, wallH / 2, 0);
  p.wall.geometry = wall;

  const shape = new THREE.Shape();
  shape.moveTo(-geo.widthM / 2, 0);
  shape.lineTo(geo.widthM / 2, 0);
  shape.lineTo(0, roofH);
  shape.closePath();
  const roof = new THREE.ExtrudeGeometry(shape, { depth: geo.lengthM, bevelEnabled: false });
  roof.translate(0, 0, -geo.lengthM / 2);
  roof.rotateY(Math.PI / 2);
  roof.translate(0, wallH, 0);
  p.roof.geometry.dispose();
  p.roof.geometry = roof;

  const pts = corners({ ...geo, rotationDeg: 0 }).map(c => new THREE.Vector3(c.x, 0, -c.y));
  p.outline.geometry.dispose();
  p.outline.geometry = new THREE.BufferGeometry().setFromPoints(pts);
}

function drawLabel(sprite: THREE.Sprite, text: string) {
  const canvas = (sprite.material as THREE.SpriteMaterial).map?.image as HTMLCanvasElement | undefined;
  const c = canvas ?? document.createElement('canvas');
  const w = 512;
  const h = 96;
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(18,60,42,0.92)';
  roundRect(g, 6, 14, w - 12, h - 28, 16);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = '600 40px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.length > 34 ? `${text.slice(0, 33)}…` : text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mat = sprite.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  mat.map = tex;
  mat.needsUpdate = true;
  sprite.scale.set(0.052 * (w / h), 0.052, 1);
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

function disposeObject(root: THREE.Object3D) {
  root.traverse(o => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach(x => x.dispose());
    else mat?.dispose?.();
  });
}

/** Cheap capability probe so a device without WebGL gets the numeric editor instead. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

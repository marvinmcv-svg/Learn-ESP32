// The 3D workbench: an ESP32 DevKit on a breadboard, the lesson's parts,
// jumper wires, and pointer interaction. Rendering runs only while mounted.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildPart, BB_TOP } from './parts.js';
import * as T from './textures.js';
import { solutionWires } from '../wiring.js';

const BOARD_L = 5.15;
const BOARD_W = 2.8;
const PITCH = 0.254;
const ROW_Z = 1.27;
const BB_W = 5.6;
const RAIL_Z = { 'rail:gnd.b': -(5.6 / 2 - 0.2), 'rail:5v.b': -(5.6 / 2 - 0.45), 'rail:3v3.f': 5.6 / 2 - 0.45, 'rail:gnd.f': 5.6 / 2 - 0.2 };
const WIRE_KIND = { gnd: 0x26282c, v33: 0xd42020, v5: 0xf07a12 };
function wireKind(w) {
  const ends = [w.a.t, w.b.t];
  if (ends.some((t) => t.startsWith('rail:gnd') || t.startsWith('board:GND'))) return 'gnd';
  if (ends.some((t) => t === 'rail:3v3.f' || t === 'board:3V3')) return 'v33';
  if (ends.some((t) => t === 'rail:5v.b' || t === 'board:VIN')) return 'v5';
  return null;
}
const WIRE_COLORS = [0xf59e0b, 0x22c55e, 0x3b82f6, 0xa855f7, 0xec4899, 0x14b8a6, 0xeab308, 0xf97316];

const PIN_XS = Array.from({ length: 15 }, (_, i) => 1.5 - i * PITCH - 0.25); // antenna side (+x) first

function pinLocal(name, row = null) {
  if (row === 'front') { const k = T.FRONT_ROW.indexOf(name); return k >= 0 ? new THREE.Vector3(PIN_XS[k], 0, ROW_Z) : null; }
  let i = T.BACK_ROW.indexOf(name);
  if (i >= 0) return new THREE.Vector3(PIN_XS[i], 0, -ROW_Z);
  i = T.FRONT_ROW.indexOf(name);
  if (i >= 0) return new THREE.Vector3(PIN_XS[i], 0, ROW_Z);
  return null;
}

export class Stage {
  constructor(container, { interactive = true, autoRotate = false, rightInset = 0 } = {}) {
    this.rightInset = rightInset; // px covered by an overlay (the phone); framing shifts left
    this.container = container;
    this.interactive = interactive;
    this.parts = [];
    this.wires = new THREE.Group();
    this.hw = null;
    this.store = null;
    this.t0 = performance.now();
    this.running = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.maxDpr = Math.min(window.devicePixelRatio, coarse ? 1.5 : 2);
    renderer.setPixelRatio(this.maxDpr);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.className = 'stage-canvas';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const labels = new CSS2DRenderer();
    labels.domElement.className = 'stage-labels';
    container.appendChild(labels.domElement);
    this.labels = labels;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    this.scene = scene;

    this.hemi = new THREE.HemisphereLight(0xfff8ec, 0x5b5245, 0.9);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-6, 14, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 4;
    scene.add(sun);
    this.sun = sun;

    // A green self-healing cutting mat on a paper-coloured room
    scene.background = new THREE.Color(0xe7e1d3);
    scene.fog = new THREE.Fog(0xe7e1d3, 38, 80);
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(46, 30), new THREE.MeshStandardMaterial({ color: 0x2f5a46, roughness: 0.92 }));
    desk.rotation.x = -Math.PI / 2;
    desk.receiveShadow = true;
    scene.add(desk);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(120, 48), new THREE.MeshStandardMaterial({ color: 0xd9d2c2, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(46, 46, 0x6f9a84, 0x4a7863);
    grid.scale.z = 30 / 46;
    grid.position.y = 0.003;
    scene.add(grid);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    this.camera.position.set(0, 14, 16);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 60;
    this.controls.autoRotate = autoRotate;
    this.controls.autoRotateSpeed = 0.6;
    if (!interactive) { this.controls.enableZoom = false; this.controls.enablePan = false; }

    this.world = new THREE.Group();
    scene.add(this.world);
    scene.add(this.wires);

    container.stage = this; // lets automated browser tests find terminal positions
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(container);
    this.resize();
    if (interactive) this.bindPointer();

    // Render on demand: only while something is moving, and never offscreen.
    this.activeUntil = 0;
    this.lastVersion = -1;
    this.visible = true;
    this.frameTimes = [];
    this.wake = () => { this.activeUntil = performance.now() + 1500; };
    this.controls.addEventListener('change', this.wake);
    this.io = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.wantRunning) this.visible ? this.loop(true) : this.loop(false);
    });
    this.io.observe(container);
  }

  /** Builds the bench for a lesson's parts list. */
  setCircuit(parts, store, wires = null) {
    this.store = store;
    this.unsubscribe?.();
    this.unsubscribe = store.subscribe(() => this.wake());
    // Free the previous bench's GPU resources before building a new one.
    for (const group of [this.world, this.wires]) {
      group.traverse((o) => {
        o.geometry?.dispose?.();
        const m = o.material;
        for (const mm of Array.isArray(m) ? m : m ? [m] : []) { mm.map?.dispose?.(); mm.dispose?.(); }
      });
    }
    this.world.clear();
    this.wires.clear();
    for (const l of this.labelObjs ?? []) l.removeFromParent();
    this.labelObjs = [];
    // Copies: wiring results are written into these, never into the lesson data.
    this.parts = parts.map((spec) => buildPart({ ...spec }, { store }));
    this.ambientId = this.parts.find((p) => p.ambient)?.ambient ?? null;

    // Lay parts out in one or two rows to the right of the board.
    const total = this.parts.reduce((s, p) => s + p.width, 0);
    const rows = total > 12 ? [[], []] : [[]];
    if (rows.length === 2) {
      const sorted = [...this.parts].sort((a, b) => Number(!!b.back) - Number(!!a.back) || b.width - a.width);
      for (const p of sorted) {
        const w0 = rows[0].reduce((s, q) => s + q.width, 0);
        const w1 = rows[1].reduce((s, q) => s + q.width, 0);
        (p.back ? (w0 <= w1 + 4 ? rows[0] : rows[1]) : (w1 <= w0 ? rows[1] : rows[0])).push(p);
      }
    } else rows[0].push(...this.parts);
    const rowW = rows.map((r) => r.reduce((s, p) => s + p.width, 0));
    const partsW = Math.max(4, ...rowW);
    const boardX = -BOARD_L / 2 - 0.7;
    const startX = 0.6;
    const bbLen = BOARD_L + 1.6 + partsW + 0.8;
    const bbCenter = boardX - BOARD_L / 2 - 0.5 + bbLen / 2;
    const rowZ = rows.length === 2 ? [-1.25, 1.35] : [0];
    rows.forEach((row, r) => {
      let x = startX;
      for (const p of row) {
        p.group.position.set(x + p.width / 2, 0, rowZ[r]);
        x += p.width;
      }
    });

    this.world.add(this.buildBreadboard(bbLen, bbCenter));
    this.world.add(this.buildBoard(boardX));
    for (const p of this.parts) this.world.add(p.group);
    this.world.updateMatrixWorld(true);
    this.layout = { boardX };
    this.wireList = wires ?? solutionWires(parts);
    this.drawWires();
    this.buildHotspots();

    // labels
    for (const p of this.parts) {
      if (!p.spec.label) continue;
      const el = document.createElement('div');
      el.className = 'part-label';
      el.textContent = p.spec.label;
      const obj = new CSS2DObject(el);
      const box = new THREE.Box3().setFromObject(p.group);
      obj.position.set(p.group.position.x, box.max.y + 0.5, p.group.position.z);
      obj.userData.partId = p.spec.id;
      this.world.add(obj);
      this.labelObjs.push(obj);
    }

    this.fit();
    this.wake?.();
  }

  buildBreadboard(len, cx) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, BB_TOP - 0.01, BB_W), new THREE.MeshStandardMaterial({ color: 0xe4e2da, roughness: 0.8 }));
    body.position.set(cx, (BB_TOP - 0.01) / 2, 0);
    body.castShadow = true; body.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.PlaneGeometry(len, BB_W), new THREE.MeshStandardMaterial({ map: T.breadboardTexture(len, BB_W), roughness: 0.75 }));
    top.rotation.x = -Math.PI / 2;
    top.position.set(cx, BB_TOP, 0);
    top.receiveShadow = true;
    g.add(body, top);
    this.bb = { len, cx };
    return g;
  }

  buildBoard(x) {
    const g = new THREE.Group();
    const headerH = 0.85;
    const pcbY = BB_TOP + headerH;
    const pcb = new THREE.Mesh(new THREE.BoxGeometry(BOARD_L, 0.16, BOARD_W), new THREE.MeshStandardMaterial({ color: 0x10232a, roughness: 0.6 }));
    pcb.position.y = pcbY;
    pcb.castShadow = true; pcb.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_L, BOARD_W), new THREE.MeshStandardMaterial({ map: T.boardTexture(BOARD_L, BOARD_W, PIN_XS), roughness: 0.55, metalness: 0.1 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = pcbY + 0.081;
    top.receiveShadow = true;
    g.add(pcb, top);

    // WROOM module: PCB + shield can; antenna area left bare at +x
    const modPcb = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.08, 1.8), new THREE.MeshStandardMaterial({ color: 0x0d1d22, roughness: 0.5 }));
    modPcb.position.set(BOARD_L / 2 - 1.27 - 0.02, pcbY + 0.12, 0);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.3, 1.6), [
      new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.95, roughness: 0.25 }),
      new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.95, roughness: 0.25 }),
      new THREE.MeshStandardMaterial({ map: T.shieldTexture(), metalness: 0.7, roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.95, roughness: 0.25 }),
      new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.95, roughness: 0.25 }),
      new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.95, roughness: 0.25 }),
    ]);
    shield.position.set(modPcb.position.x - 0.32, pcbY + 0.31, 0);
    shield.castShadow = true;
    g.add(modPcb, shield);

    // micro-USB, buttons, regulator, LEDs
    const silver = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.3 });
    const usb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.28, 0.78), silver);
    usb.position.set(-BOARD_L / 2 + 0.22, pcbY + 0.22, 0);
    usb.castShadow = true;
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.5 });
    for (const z of [-0.6, 0.6]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.5), silver);
      b.position.set(-BOARD_L / 2 + 0.75, pcbY + 0.15, z);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 16), darkMat);
      c.position.set(-BOARD_L / 2 + 0.75, pcbY + 0.25, z);
      g.add(b, c);
    }
    const reg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.6), darkMat);
    reg.position.set(-0.75, pcbY + 0.15, 0.1);
    const uart = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.45), darkMat);
    uart.position.set(-0.05, pcbY + 0.13, -0.1);
    g.add(usb, reg, uart);

    this.ledMat = new THREE.MeshStandardMaterial({ color: 0x2a4aff, emissive: 0x2a5bff, emissiveIntensity: 0, roughness: 0.3 });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.1), this.ledMat);
    led.position.set(-BOARD_L / 2 + 1.25, pcbY + 0.12, 0.25);
    const pwr = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.1), new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff2020, emissiveIntensity: 1.6 }));
    pwr.position.set(-BOARD_L / 2 + 1.25, pcbY + 0.12, -0.25);
    this.boardGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glowTexture(), color: 0x4a6bff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    this.boardGlow.position.copy(led.position).y += 0.1;
    this.boardGlow.scale.setScalar(1.2);
    this.boardLight = new THREE.PointLight(0x3a5bff, 0, 4, 2);
    this.boardLight.position.copy(led.position).y += 0.3;
    g.add(led, pwr, this.boardGlow, this.boardLight);

    // header strips and pins
    const plastic = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.3 });
    const pinGeo = new THREE.BoxGeometry(0.064, headerH + 0.25, 0.064);
    for (const z of [-ROW_Z, ROW_Z]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(15 * PITCH, 0.25, 0.25), plastic);
      strip.position.set((PIN_XS[0] + PIN_XS[14]) / 2, BB_TOP + 0.13, z);
      strip.castShadow = true;
      g.add(strip);
      const pins = new THREE.InstancedMesh(pinGeo, gold, 15);
      const m = new THREE.Matrix4();
      PIN_XS.forEach((px, i) => { m.makeTranslation(px, BB_TOP + (headerH + 0.25) / 2 + 0.05, z); pins.setMatrixAt(i, m); });
      g.add(pins);
    }
    g.position.x = x;
    this.board = { x, pcbY };
    return g;
  }

  boardPin(name, row = null) {
    const p = pinLocal(name, row);
    if (!p) return null;
    return new THREE.Vector3(this.board.x + p.x, this.board.pcbY + 0.22, p.z);
  }

  addWire(a, b, color, { lift = 1.2, radius = 0.045 } = {}) {
    const d = a.distanceTo(b);
    const up = Math.min(3.2, lift + d * 0.12);
    const pts = [
      a.clone(),
      a.clone().add(new THREE.Vector3(0, up * 0.7, 0)),
      a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, up, 0)),
      b.clone().add(new THREE.Vector3(0, up * 0.7, 0)),
      b.clone(),
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 8, false), new THREE.MeshStandardMaterial({ color, roughness: 0.45 }));
    mesh.castShadow = true;
    this.wires.add(mesh);
    const out = [mesh];
    for (const end of [a, b]) {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.25, radius * 1.25, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }));
      tip.position.copy(end).add(new THREE.Vector3(0, 0.15, 0));
      this.wires.add(tip);
      out.push(tip);
    }
    return out;
  }

  addJumper(a, b, color) {
    // short flat jumper lying on the breadboard
    const pts = [a.clone(), a.clone().add(new THREE.Vector3(0, 0.12, 0)), b.clone().add(new THREE.Vector3(0, 0.12, 0)), b.clone()];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.045, 6, false), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    mesh.castShadow = true;
    this.wires.add(mesh);
    return [mesh];
  }

  // ---------- wires ----------

  /** World position of a wire endpoint. Rails take x from the endpoint or the other end. */
  endPos(end, other = null) {
    const t = end.t;
    if (t.startsWith('board:')) {
      const id = t.slice(6);
      if (id === 'GND.L') return this.boardPin('GND', 'back');
      if (id === 'GND.R') return this.boardPin('GND', 'front');
      return this.boardPin(id);
    }
    if (t.startsWith('rail:')) {
      const z = RAIL_Z[t];
      let x = end.x;
      if (x === undefined) x = other ? (this.endPos(other)?.x ?? 0) + 0.127 : 0;
      const half = this.bb.len / 2 - 0.3;
      x = Math.max(this.bb.cx - half, Math.min(this.bb.cx + half, x));
      return new THREE.Vector3(x, BB_TOP, z);
    }
    const [pid, term] = t.split('.');
    const part = this.parts.find((p) => p.spec.id === pid);
    const local = part?.terminals?.[term];
    return local ? part.group.localToWorld(local.clone()) : null;
  }

  /** Pixels covered by overlays on each side; the bench is centred in the rest. */
  setInsets({ left = 0, right = this.rightInset } = {}) {
    this.leftInset = left;
    this.rightInset = right;
    this.resize();
    this.wake?.();
  }

  /** Screen position (px, relative to the canvas) of a wire endpoint. */
  screenPos(end) {
    const p = this.endPos(end);
    if (!p) return null;
    p.project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  setWires(wires) {
    this.wireList = wires;
    this.drawWires();
    this.wake?.();
  }

  drawWires() {
    this.wires.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.wires.clear();
    if (!this.parts.length && !this.wiringOn) return;
    const bx = this.layout.boardX;
    // The rails are always fed from the board: GND to both GND rails, 3.3 V front, 5 V (VIN) back.
    this.addWire(this.boardPin('GND', 'back'), new THREE.Vector3(bx + 3.6, BB_TOP, RAIL_Z['rail:gnd.b']), WIRE_KIND.gnd, { lift: 0.8 });
    this.addWire(this.boardPin('GND', 'front'), new THREE.Vector3(bx + 3.9, BB_TOP, RAIL_Z['rail:gnd.f']), WIRE_KIND.gnd, { lift: 0.8 });
    this.addWire(this.boardPin('3V3'), new THREE.Vector3(bx + 3.3, BB_TOP, RAIL_Z['rail:3v3.f']), WIRE_KIND.v33, { lift: 0.8 });
    this.addWire(this.boardPin('VIN'), new THREE.Vector3(bx + 3.3, BB_TOP, RAIL_Z['rail:5v.b']), WIRE_KIND.v5, { lift: 0.8 });
    // Parts' own cables (the servo lead)
    for (const p of this.parts) {
      for (const c of p.cables ?? []) {
        this.addWire(p.group.localToWorld(c.from.clone()), p.group.localToWorld(p.terminals[c.to].clone()), c.color, { lift: 0.2, radius: 0.04 });
      }
    }
    let ci = 0;
    (this.wireList ?? []).forEach((w, i) => {
      const a = this.endPos(w.a, w.b);
      const b = this.endPos(w.b, w.a);
      if (!a || !b) return;
      const kind = wireKind(w);
      const color = kind ? WIRE_KIND[kind] : WIRE_COLORS[ci++ % WIRE_COLORS.length];
      const rail = w.a.t.startsWith('rail:') || w.b.t.startsWith('rail:');
      const meshes = rail && a.distanceTo(b) < 3.2 ? this.addJumper(a, b, color) : this.addWire(a, b, color);
      for (const m of meshes) m.userData.wireIndex = i;
    });
  }

  /**
   * Pushes wiring analysis into the parts (pins, states) and, optionally,
   * new label text per part id.
   */
  applyEffective(effective, labels = null) {
    for (const p of this.parts) {
      const e = effective.find((x) => x.id === p.spec.id);
      if (!e) continue;
      if (e.state !== 'no-resistor' || e.pin !== p.spec.pin) { p.spec.burnt = false; p.spec.overSince = undefined; }
      Object.assign(p.spec, { pin: e.pin, trig: e.trig, echo: e.echo, state: e.state, to: e.to, reversed: e.reversed });
    }
    if (labels) {
      for (const l of this.labelObjs ?? []) {
        const text = labels[l.userData.partId];
        if (text !== undefined) l.element.textContent = text;
      }
    }
    this.wake?.();
  }

  // ---------- wiring mode ----------

  buildHotspots() {
    this.hotspots?.removeFromParent();
    this.hotspots = new THREE.Group();
    this.hotspots.visible = !!this.wiringOn;
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xc2331a, transparent: true, opacity: 0.9, depthTest: false });
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const ringGeo = new THREE.RingGeometry(0.07, 0.115, 20);
    const hitGeo = new THREE.SphereGeometry(0.17, 8, 6);
    const add = (id, pos) => {
      if (!pos) return;
      const ring = new THREE.Mesh(ringGeo, ringMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(pos).add(new THREE.Vector3(0, 0.03, 0));
      ring.renderOrder = 10;
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.copy(pos);
      hit.userData.terminal = id;
      hit.userData.ring = ring;
      this.hotspots.add(ring, hit);
    };
    for (const name of [...T.BACK_ROW.map((n) => [n, 'back']), ...T.FRONT_ROW.map((n) => [n, 'front'])]) {
      const [label, row] = name;
      const id = label === 'GND' ? `board:GND.${row === 'back' ? 'L' : 'R'}` : `board:${label}`;
      add(id, this.boardPin(label, row));
    }
    for (const p of this.parts) {
      for (const [term, local] of Object.entries(p.terminals ?? {})) add(`${p.spec.id}.${term}`, p.group.localToWorld(local.clone()));
    }
    // Rails: long pickable strips; the hit point gives the x position.
    for (const [id, z] of Object.entries(RAIL_Z)) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(this.bb.len - 0.6, 0.12, 0.2), new THREE.MeshBasicMaterial({ color: id.includes('gnd') ? 0x2563eb : 0xdc2626, transparent: true, opacity: 0.18, depthTest: false }));
      strip.position.set(this.bb.cx, BB_TOP + 0.04, z);
      strip.userData.terminal = id;
      strip.userData.rail = true;
      strip.renderOrder = 9;
      this.hotspots.add(strip);
    }
    this.scene.add(this.hotspots);
    // drag preview line
    this.dragLine?.removeFromParent();
    this.dragLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0xc2331a, dashSize: 0.18, gapSize: 0.1, depthTest: false }));
    this.dragLine.visible = false;
    this.dragLine.renderOrder = 11;
    this.scene.add(this.dragLine);
    if (!this.tip) {
      const el = document.createElement('div');
      el.className = 'wire-tip';
      this.tip = new CSS2DObject(el);
      this.tip.visible = false;
    }
    this.scene.add(this.tip);
  }

  /**
   * Turns drag-to-wire on or off. Callbacks:
   *   connect(a, b)   two endpoints { t, x? } were joined
   *   remove(index)   the learner clicked wire #index
   *   label(id)       text for a terminal tooltip
   */
  setWiringMode(on, callbacks = {}) {
    this.wiringOn = on;
    this.wiringCb = callbacks;
    if (this.hotspots) this.hotspots.visible = on;
    this.pending = null;
    if (this.dragLine) this.dragLine.visible = false;
    if (this.tip) this.tip.visible = false;
    this.wake?.();
  }

  fit() {
    const box = new THREE.Box3().setFromObject(this.world);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const aspect = this.camera.aspect || 1.6;
    const span = Math.max(size.x / Math.min(aspect, 2.2), size.z * 1.4, 6);
    const dist = span * 1.25 + 3;
    this.controls.target.set(center.x, BB_TOP + 0.6, center.z);
    this.camera.position.set(center.x + span * 0.05, dist * 0.78, center.z + dist * 0.82);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.home = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
  }

  resetView() {
    if (!this.home) return;
    this.camera.position.copy(this.home.pos);
    this.controls.target.copy(this.home.target);
    this.controls.update();
  }

  setHardware(hw) { this.hw = hw; }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.labels.setSize(w, h);
    this.wake?.();
    const hadAspect = this.camera.aspect;
    this.camera.aspect = w / h;
    // Keep the bench centred in the part of the view not covered by an overlay.
    const wide = window.matchMedia('(min-width: 861px)').matches;
    const shift = wide ? (this.rightInset - (this.leftInset ?? 0)) / 2 : 0;
    if (shift) this.camera.setViewOffset(w, h, shift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    if (this.home && Math.abs(hadAspect - this.camera.aspect) > 0.3) this.fit();
  }

  bindPointer() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BB_TOP);
    const aim = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
    };
    const partHit = () => {
      const targets = this.parts.flatMap((p) => (p.pick ?? []).map((m) => Object.assign(m, { userData: { ...m.userData, part: p } })));
      return ray.intersectObjects(targets, false)[0]?.object.userData.part ?? null;
    };
    const terminalHit = () => {
      if (!this.wiringOn || !this.hotspots) return null;
      const hits = ray.intersectObjects(this.hotspots.children.filter((c) => c.userData.terminal), false);
      // Prefer pin hotspots over the long rail strips when both are under the pointer.
      const h = hits.find((x) => !x.object.userData.rail) ?? hits[0];
      if (!h) return null;
      const end = { t: h.object.userData.terminal };
      if (h.object.userData.rail) end.x = Math.round(h.point.x / 0.254) * 0.254;
      return { end, obj: h.object };
    };
    const wireHit = () => {
      if (!this.wiringOn) return null;
      const h = ray.intersectObjects(this.wires.children.filter((c) => c.userData.wireIndex !== undefined), false)[0];
      return h ? h.object.userData.wireIndex : null;
    };
    const showTip = (hit) => {
      if (!this.tip) return;
      this.tip.visible = !!hit;
      if (!hit) return;
      this.tip.element.textContent = this.wiringCb?.label?.(hit.end.t) ?? hit.end.t;
      this.tip.position.copy(hit.obj.userData.rail ? new THREE.Vector3(hit.end.x, BB_TOP, hit.obj.position.z) : hit.obj.position).add(new THREE.Vector3(0, 0.55, 0));
    };
    const highlight = (wireIndex) => {
      for (const m of this.wires.children) {
        if (m.userData.wireIndex === undefined) continue;
        m.material.emissive?.setHex(m.userData.wireIndex === wireIndex ? 0x803020 : 0x000000);
      }
    };
    const setDrag = (from, to) => {
      if (!from) { this.dragLine.visible = false; return; }
      const a = this.endPos(from).add(new THREE.Vector3(0, 0.2, 0));
      this.dragLine.geometry.setFromPoints([a, to.clone().add(new THREE.Vector3(0, 0.2, 0))]);
      this.dragLine.computeLineDistances();
      this.dragLine.visible = true;
    };

    let active = null; // pressed part
    let drag = null; // { from, x, y, moved }
    el.addEventListener('pointerdown', (e) => {
      aim(e);
      const term = terminalHit();
      if (term) {
        drag = { from: term.end, x: e.clientX, y: e.clientY, moved: false };
        this.controls.enabled = false;
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        return;
      }
      const wi = wireHit();
      if (wi !== null) { this.wiringCb?.remove?.(wi); return; }
      if (this.pending) { this.pending = null; setDrag(null); this.wake(); }
      const part = partHit();
      if (!part?.press) return;
      active = part;
      this.controls.enabled = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      part.press({ x: e.clientX, y: e.clientY });
    });
    el.addEventListener('pointermove', (e) => {
      if (active) { active.move?.({ x: e.clientX, y: e.clientY }); return; }
      aim(e);
      if (drag || this.pending) {
        if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
        const p = new THREE.Vector3();
        if (ray.ray.intersectPlane(plane, p)) setDrag((drag ?? this.pending).from, p);
        showTip(terminalHit());
        this.wake();
        return;
      }
      const term = terminalHit();
      showTip(term);
      const wi = term ? null : wireHit();
      highlight(wi);
      if (this.wiringOn) this.wake();
      el.style.cursor = term ? 'crosshair' : wi !== null ? 'not-allowed' : partHit()?.press ? (partHit().drag ? 'ew-resize' : 'pointer') : '';
      el.title = wi !== null ? 'Click to remove this wire' : '';
    });
    const end = (e) => {
      if (drag) {
        aim(e);
        const target = terminalHit();
        const from = drag.from;
        const moved = drag.moved;
        drag = null;
        this.controls.enabled = true;
        if (target && target.end.t !== from.t) { setDrag(null); this.pending = null; this.wiringCb?.connect?.(from, target.end); }
        else if (!moved && this.pending && this.pending.from.t !== from.t) { setDrag(null); const a = this.pending.from; this.pending = null; this.wiringCb?.connect?.(a, from); }
        else if (!moved) { this.pending = { from }; } // click-click wiring: wait for the second terminal
        else { setDrag(null); this.pending = null; }
        this.wake();
        return;
      }
      if (!active) return;
      active.release?.();
      active = null;
      this.controls.enabled = true;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { drag = null; this.pending = null; setDrag(null); this.controls.enabled = true; if (active) { active.release?.(); active = null; } });
    window.addEventListener('keydown', this.onKey = (e) => { if (e.key === 'Escape' && (this.pending || drag)) { this.pending = null; drag = null; setDrag(null); this.wake(); } });
  }

  start() {
    this.wantRunning = true;
    this.wake();
    this.loop(this.visible);
  }

  stop() {
    this.wantRunning = false;
    this.loop(false);
  }

  loop(on) {
    if (on === this.running) return;
    this.running = on;
    this.renderer.setAnimationLoop(on ? this.frame : null);
    if (on) this.wake();
  }

  /** True while anything on the bench can still be changing. */
  busy(now) {
    const hw = this.hw;
    if (this.controls.autoRotate) return true;
    if (hw) {
      if (hw.version !== this.lastVersion) { this.lastVersion = hw.version; this.activeUntil = now + 1500; }
      for (const p of hw.pins.values()) if (p.tone) return true;
    }
    return now < this.activeUntil;
  }

  frame() {
    const now = performance.now();
    if (!this.busy(now)) { this.frameTimes.length = 0; return; }
    this.adaptQuality(now);
    const t = (now - this.t0) / 1000;
    const hw = this.hw;
    if (hw) {
      for (const p of this.parts) p.update?.(hw, t);
      const v = hw.level(2);
      this.ledMat.emissiveIntensity = v * 3;
      this.boardGlow.material.opacity = v * 0.9;
      this.boardLight.intensity = v * 1.2;
    }
    if (this.ambientId && this.store) {
      const light = this.store.get(this.ambientId, 0.8);
      this.hemi.intensity = 0.15 + light * 0.85;
      this.sun.intensity = 0.25 + light * 2.0;
      this.scene.environmentIntensity = 0.1 + light * 0.5;
    } else {
      this.hemi.intensity = 0.9; this.sun.intensity = 2.2; this.scene.environmentIntensity = 0.55;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  /** Drops resolution when frames are slow (low-end phones, software GL). */
  adaptQuality(now) {
    const f = this.frameTimes;
    f.push(now);
    if (f.length < 40) return;
    const avg = (f[f.length - 1] - f[0]) / (f.length - 1);
    f.length = 0;
    const dpr = this.renderer.getPixelRatio();
    let next = dpr;
    if (avg > 30 && dpr > 1) next = Math.max(1, dpr - 0.5);
    else if (avg < 18 && dpr < this.maxDpr) next = Math.min(this.maxDpr, dpr + 0.25);
    if (next !== dpr) { this.renderer.setPixelRatio(next); this.resize(); }
  }

  dispose() {
    this.stop();
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    this.io.disconnect();
    this.unsubscribe?.();
    this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      for (const mm of Array.isArray(m) ? m : m ? [m] : []) { mm.map?.dispose?.(); mm.dispose?.(); }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}

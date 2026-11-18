// The 3D workbench: an ESP32 DevKit on a breadboard, the lesson's parts,
// jumper wires, and pointer interaction. Rendering runs only while mounted.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildPart, BB_TOP } from './parts.js';
import * as T from './textures.js';

const BOARD_L = 5.15;
const BOARD_W = 2.8;
const PITCH = 0.254;
const ROW_Z = 1.27;
const BB_W = 5.6;
const WIRE_COLORS = [0xf59e0b, 0x22c55e, 0x3b82f6, 0xa855f7, 0xec4899, 0x14b8a6, 0xeab308, 0xf97316];

// GPIO number -> board pin name
const GPIO_NAME = (g) => `D${g}`;
const PIN_XS = Array.from({ length: 15 }, (_, i) => 1.5 - i * PITCH - 0.25); // antenna side (+x) first

function pinLocal(name) {
  let i = T.BACK_ROW.indexOf(name);
  if (i >= 0) return new THREE.Vector3(PIN_XS[i], 0, -ROW_Z);
  i = T.FRONT_ROW.indexOf(name);
  if (i >= 0) return new THREE.Vector3(PIN_XS[i], 0, ROW_Z);
  return null;
}

export class Stage {
  constructor(container, { interactive = true, autoRotate = false } = {}) {
    this.container = container;
    this.interactive = interactive;
    this.parts = [];
    this.wires = new THREE.Group();
    this.hw = null;
    this.store = null;
    this.t0 = performance.now();
    this.running = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

    this.hemi = new THREE.HemisphereLight(0xdfe9ff, 0x2a2622, 0.9);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-6, 14, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 4;
    scene.add(sun);
    this.sun = sun;

    // desk
    const desk = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: 0x1d2a2c, roughness: 0.95 }));
    desk.rotation.x = -Math.PI / 2;
    desk.receiveShadow = true;
    scene.add(desk);
    const grid = new THREE.GridHelper(60, 60, 0x2c3d40, 0x243336);
    grid.position.y = 0.002;
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

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(container);
    this.resize();
    if (interactive) this.bindPointer();
  }

  /** Builds the bench for a lesson's parts list. */
  setCircuit(parts, store) {
    this.store = store;
    this.world.clear();
    this.wires.clear();
    for (const l of this.labelObjs ?? []) l.removeFromParent();
    this.labelObjs = [];
    this.parts = parts.map((spec) => buildPart(spec, { store }));
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
    this.buildWires(boardX, bbLen, bbCenter);

    // labels
    for (const p of this.parts) {
      if (!p.spec.label) continue;
      const el = document.createElement('div');
      el.className = 'part-label';
      el.textContent = p.spec.label;
      const obj = new CSS2DObject(el);
      const box = new THREE.Box3().setFromObject(p.group);
      obj.position.set(p.group.position.x, box.max.y + 0.5, p.group.position.z);
      this.world.add(obj);
      this.labelObjs.push(obj);
    }

    this.fit();
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

  boardPin(name) {
    const p = pinLocal(name);
    if (!p) return null;
    return new THREE.Vector3(this.board.x + p.x, this.board.pcbY + 0.22, p.z);
  }

  railPoint(kind, x, z) {
    // back side rails: gnd at -2.6, vcc at -2.35; front side: vcc 2.35, gnd 2.6
    const side = z < 0 ? -1 : 1;
    const isGnd = kind === 'gnd';
    const rz = side * (BB_W / 2 - (isGnd === (side < 0) ? 0.2 : 0.45));
    return new THREE.Vector3(x, BB_TOP, rz);
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
    for (const end of [a, b]) {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.25, radius * 1.25, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }));
      tip.position.copy(end).add(new THREE.Vector3(0, 0.15, 0));
      this.wires.add(tip);
    }
  }

  addJumper(a, b, color) {
    // short flat jumper lying on the breadboard
    const pts = [a.clone(), a.clone().add(new THREE.Vector3(0, 0.12, 0)), b.clone().add(new THREE.Vector3(0, 0.12, 0)), b.clone()];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.035, 6, false), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    mesh.castShadow = true;
    this.wires.add(mesh);
  }

  buildWires(boardX) {
    let ci = 0;
    const world = (part, v) => part.group.localToWorld(v.clone());
    let needVcc = false;
    let needVin = false;
    for (const part of this.parts) {
      for (const a of part.anchors) {
        const end = world(part, a.at);
        if (a.pin !== undefined) {
          const start = this.boardPin(GPIO_NAME(a.pin));
          if (!start) continue;
          if (a.from) {
            // servo-style cable: goes from the part body to the breadboard first
            this.addWire(world(part, a.from), end, a.color ?? 0xf08c1a, { lift: 0.2, radius: 0.04 });
          }
          this.addWire(start, end, WIRE_COLORS[ci++ % WIRE_COLORS.length]);
        } else if (a.rail) {
          const rail = a.rail === 'vin' ? 'vcc' : a.rail;
          needVcc ||= a.rail === 'vcc';
          needVin ||= a.rail === 'vin';
          if (a.from) this.addWire(world(part, a.from), end, a.color, { lift: 0.2, radius: 0.04 });
          const color = rail === 'gnd' ? 0x26282c : 0xd42020;
          const target = this.railPoint(rail, end.x + 0.127, end.z);
          if (a.from) this.addJumper(end, target, color);
          else this.addJumper(end, target, color);
        }
      }
    }
    // power the rails from the board
    if (this.parts.length) {
      const gnd = this.boardPin('GND');
      this.addWire(gnd, this.railPoint('gnd', boardX + 3.6, -1), 0x26282c, { lift: 0.8 });
      const gnd2 = gnd.clone(); gnd2.z = ROW_Z;
      this.addWire(gnd2, this.railPoint('gnd', boardX + 3.9, 1), 0x26282c, { lift: 0.8 });
      if (needVcc || needVin) {
        const v3 = this.boardPin('3V3');
        this.addWire(v3, this.railPoint('vcc', boardX + 3.3, 1), 0xd42020, { lift: 0.8 });
        const vin = this.boardPin(needVin ? 'VIN' : 'VIN');
        this.addWire(vin, this.railPoint('vcc', boardX + 3.3, -1), needVin ? 0xff7a1a : 0xd42020, { lift: 0.8 });
      }
    }
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
    const hadAspect = this.camera.aspect;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.home && Math.abs(hadAspect - this.camera.aspect) > 0.3) this.fit();
  }

  bindPointer() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const targets = this.parts.flatMap((p) => (p.pick ?? []).map((m) => Object.assign(m, { userData: { part: p } })));
      const h = ray.intersectObjects(targets, false)[0];
      return h?.object.userData.part ?? null;
    };
    let active = null;
    el.addEventListener('pointerdown', (e) => {
      const part = hit(e);
      if (!part?.press) return;
      active = part;
      this.controls.enabled = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      part.press({ x: e.clientX, y: e.clientY });
    });
    el.addEventListener('pointermove', (e) => {
      if (active) { active.move?.({ x: e.clientX, y: e.clientY }); return; }
      el.style.cursor = hit(e)?.press ? (hit(e).drag ? 'ew-resize' : 'pointer') : '';
    });
    const end = () => {
      if (!active) return;
      active.release?.();
      active = null;
      this.controls.enabled = true;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.renderer.setAnimationLoop(this.frame);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  frame() {
    const t = (performance.now() - this.t0) / 1000;
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

  dispose() {
    this.stop();
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

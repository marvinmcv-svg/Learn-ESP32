// Procedural 3D models of the parts, each with named terminals for wiring and
// an update(hw, inputs, t) hook that animates it from simulated pin state.
import * as THREE from 'three';
import * as T from './textures.js';

export const BB_TOP = 0.85; // breadboard surface height (cm)

const mats = {};
function mat(key, make) { return (mats[key] ??= make()); }

const metal = () => mat('metal', () => new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.3 }));
const black = () => mat('black', () => new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.6 }));
const leg = () => mat('leg', () => new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.35 }));

function box(w, h, d, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(r, h, material, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function plane(w, d, map) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map, roughness: 0.7 }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}
function pinLeg(x, z, h, y0 = BB_TOP) {
  const l = cyl(0.025, h, leg(), 6);
  l.position.set(x, y0 + h / 2 - 0.15, z);
  return l;
}

const LED_COLORS = {
  red: 0xff2a2a, green: 0x26e05a, blue: 0x3a7bff, amber: 0xffa21a, white: 0xf4f7ff, yellow: 0xffe22a,
};

let glowTex;
function glowSprite(color) {
  glowTex ??= T.glowTexture();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  s.scale.set(2, 2, 2);
  return s;
}

function resistor(bands, length = 0.75) {
  const g = new THREE.Group();
  const body = cyl(0.11, length, new THREE.MeshStandardMaterial({ map: T.resistorTexture(bands), roughness: 0.5 }), 16);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.32;
  g.add(body);
  for (const s of [-1, 1]) {
    const lead = cyl(0.022, 0.3, leg(), 6);
    lead.rotation.z = Math.PI / 2;
    lead.position.set(s * (length / 2 + 0.12), 0.32, 0);
    g.add(lead);
    const down = cyl(0.022, 0.42, leg(), 6);
    down.position.set(s * (length / 2 + 0.26), 0.11, 0);
    g.add(down);
  }
  return g;
}

/**
 * Every builder returns { group, width, terminals, cables?, pick?, update? }.
 * terminals: { id: Vector3 (local) } using the ids from src/wiring.js.
 * update() reads spec.pin / spec.state, which the wiring analysis keeps current.
 */
const BUILDERS = {
  led(spec) {
    const g = new THREE.Group();
    const color = LED_COLORS[spec.color] ?? LED_COLORS.red;
    const lens = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.15, transmission: 0.25, thickness: 0.3, transparent: true, opacity: 0.88 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), lens);
    const body = cyl(0.25, 0.42, lens);
    const rim = cyl(0.29, 0.07, lens);
    body.position.y = BB_TOP + 0.75; dome.position.y = BB_TOP + 0.96; rim.position.y = BB_TOP + 0.56;
    g.add(body, dome, rim, pinLeg(-0.127, 0, 0.75), pinLeg(0.127, 0, 0.62));
    const r = resistor(['red', 'red', 'brown', 'gold']);
    r.position.set(-0.75, BB_TOP, 0);
    g.add(r);
    const halo = glowSprite(color);
    halo.position.y = BB_TOP + 0.85;
    g.add(halo);
    const light = new THREE.PointLight(color, 0, 6, 2);
    light.position.y = BB_TOP + 1.1;
    g.add(light);
    const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x777066, transparent: true, depthWrite: false, opacity: 0 }));
    smoke.visible = false;
    g.add(smoke);
    let smokeAt = null;
    return {
      group: g, width: 1.9,
      terminals: { r: new THREE.Vector3(-1.385, BB_TOP, 0.508), a: new THREE.Vector3(-0.127, BB_TOP, 0.508), k: new THREE.Vector3(0.127, BB_TOP, 0.508) },
      update(hw, t) {
        // Wiring decides what the LED sees: reversed or open never lights,
        // 3.3 V straight in is always on, and no resistor burns it out.
        const state = spec.state ?? 'ok';
        let v = state === 'always' ? 1 : (state === 'ok' || state === 'no-resistor') && spec.pin !== null && spec.pin !== undefined ? hw.level(spec.pin) : 0;
        if (state === 'no-resistor' && v > 0.5 && !spec.burnt) {
          spec.overSince ??= t;
          v = Math.min(1.6, v * 1.6); // far too bright
          if (t - spec.overSince > 0.8) { spec.burnt = true; smokeAt = t; }
        } else if (state !== 'no-resistor') { spec.overSince = undefined; }
        if (spec.burnt) v = 0;
        lens.color.setHex(spec.burnt ? 0x3a3530 : color);
        lens.emissive.setHex(spec.burnt ? 0x000000 : color);
        smoke.visible = smokeAt !== null && t - smokeAt < 2.2;
        if (smoke.visible) {
          const k = (t - smokeAt) / 2.2;
          smoke.position.y = BB_TOP + 1.1 + k * 2.2;
          smoke.material.opacity = 0.65 * (1 - k);
          smoke.scale.setScalar(0.6 + k * 2);
        }
        lens.emissiveIntensity = v * 2.6;
        halo.material.opacity = Math.min(1, v * 1.1);
        halo.scale.setScalar(1.2 + v * 1.6);
        light.intensity = v * 2.5;
      },
    };
  },

  button(spec, { store }) {
    const g = new THREE.Group();
    const base = box(1.2, 0.35, 1.2, black());
    base.position.y = BB_TOP + 0.2;
    const capMat = new THREE.MeshStandardMaterial({ color: 0xd94b3d, roughness: 0.45 });
    const cap = cyl(0.36, 0.28, capMat, 32);
    cap.position.y = BB_TOP + 0.5;
    const plate = box(1.16, 0.04, 1.16, metal());
    plate.position.y = BB_TOP + 0.39;
    g.add(base, plate, cap);
    for (const [x, z] of [[-0.5, -0.38], [0.5, -0.38], [-0.5, 0.38], [0.5, 0.38]]) g.add(pinLeg(x, z, 0.3));
    return {
      group: g, width: 2.0,
      terminals: { a: new THREE.Vector3(-0.5, BB_TOP, -0.76), b: new THREE.Vector3(0.5, BB_TOP, 0.76) },
      pick: [cap, base, plate],
      press: () => store.set(spec.id, true),
      release: () => store.set(spec.id, false),
      update() {
        const down = store.get(spec.id, false);
        cap.position.y += ((BB_TOP + (down ? 0.4 : 0.5)) - cap.position.y) * 0.5;
        capMat.emissive.setHex(down ? 0x401010 : 0);
      },
    };
  },

  pot(spec, { store }) {
    const g = new THREE.Group();
    const body = box(1.0, 0.5, 1.0, new THREE.MeshStandardMaterial({ color: 0x2b5fb8, roughness: 0.55 }));
    body.position.y = BB_TOP + 0.45;
    const knobGroup = new THREE.Group();
    knobGroup.position.y = BB_TOP + 0.7;
    const knob = cyl(0.36, 0.5, new THREE.MeshStandardMaterial({ color: 0xe9e9ea, roughness: 0.5 }), 28);
    knob.position.y = 0.25;
    const mark = box(0.08, 0.04, 0.3, new THREE.MeshStandardMaterial({ color: 0x222222 }));
    mark.position.set(0, 0.51, -0.17);
    knobGroup.add(knob, mark);
    // pointer arc printed around the knob
    const arc = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.56, 48, 1, -Math.PI * 0.25, Math.PI * 1.5), new THREE.MeshBasicMaterial({ color: 0x9fb4d8, side: THREE.DoubleSide }));
    arc.rotation.x = -Math.PI / 2;
    arc.rotation.z = Math.PI;
    arc.position.y = BB_TOP + 0.705;
    g.add(body, knobGroup, arc);
    for (const x of [-0.254, 0, 0.254]) g.add(pinLeg(x, 0.38, 0.4));
    let dragStart = null;
    return {
      group: g, width: 2.0,
      terminals: { g: new THREE.Vector3(-0.254, BB_TOP, 0.76), w: new THREE.Vector3(0, BB_TOP, 0.76), v: new THREE.Vector3(0.254, BB_TOP, 0.76) },
      pick: [knob, body],
      drag: true,
      press: (p) => { dragStart = { x: p.x, v: store.get(spec.id, 0.5) }; },
      move: (p) => { if (dragStart) store.set(spec.id, Math.max(0, Math.min(1, dragStart.v + (p.x - dragStart.x) / 220))); },
      release: () => { dragStart = null; },
      update() {
        const v = store.get(spec.id, 0.5);
        knobGroup.rotation.y = -(v - 0.5) * Math.PI * 1.5;
      },
    };
  },

  ldr(spec) {
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 32), [
      new THREE.MeshStandardMaterial({ color: 0xcfb98f, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ map: T.ldrTexture(), roughness: 0.35 }),
      new THREE.MeshStandardMaterial({ color: 0xcfb98f }),
    ]);
    face.position.y = BB_TOP + 0.8;
    face.castShadow = true;
    g.add(face, pinLeg(-0.127, 0, 0.75), pinLeg(0.127, 0, 0.75));
    const r = resistor(['brown', 'black', 'orange', 'gold']);
    r.rotation.y = Math.PI / 2;
    r.position.set(0.4, BB_TOP, 0.55);
    g.add(r);
    return {
      group: g, width: 1.6,
      terminals: { o: new THREE.Vector3(-0.127, BB_TOP, -0.5), v: new THREE.Vector3(0.127, BB_TOP, -0.5), g: new THREE.Vector3(0.4, BB_TOP, 1.25) },
      ambient: spec.id,
    };
  },

  touch(spec, { store }) {
    const g = new THREE.Group();
    const copper = new THREE.MeshStandardMaterial({ color: 0xc87533, metalness: 0.85, roughness: 0.28, emissive: 0x000000 });
    const pad = box(1.4, 0.06, 1.0, copper);
    pad.position.y = BB_TOP + 0.05;
    g.add(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 40), new THREE.MeshBasicMaterial({ color: 0x8ef0ff, transparent: true, opacity: 0, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = BB_TOP + 0.1;
    g.add(ring);
    return {
      group: g, width: 2.0,
      terminals: { pad: new THREE.Vector3(-0.6, BB_TOP + 0.08, -0.3) },
      pick: [pad],
      press: () => store.set(spec.id, true),
      release: () => store.set(spec.id, false),
      update(hw, t) {
        const on = store.get(spec.id, false);
        copper.emissive.setHex(on ? 0x3a1a05 : 0);
        ring.material.opacity = on ? 0.8 : 0;
        if (on) ring.scale.setScalar(1 + ((t * 2) % 1) * 2);
        pad.position.y = BB_TOP + (on ? 0.03 : 0.05);
      },
    };
  },

  buzzer(spec) {
    const g = new THREE.Group();
    const body = cyl(0.6, 0.48, black(), 40);
    body.position.y = BB_TOP + 0.35;
    const top = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.6, 40), new THREE.MeshStandardMaterial({ color: 0x2a2b2f, roughness: 0.4 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = BB_TOP + 0.595;
    g.add(body, top, pinLeg(-0.254, 0, 0.3), pinLeg(0.254, 0, 0.3));
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.025, 6, 48), new THREE.MeshBasicMaterial({ color: 0x7cf0c6, transparent: true, opacity: 0 }));
      r.rotation.x = Math.PI / 2;
      r.position.y = BB_TOP + 0.62;
      g.add(r);
      rings.push(r);
    }
    return {
      group: g, width: 2.0,
      terminals: { p: new THREE.Vector3(-0.254, BB_TOP, -0.76), n: new THREE.Vector3(0.254, BB_TOP, 0.76) },
      update(hw, t) {
        const f = hw.toneOf(spec.pin);
        rings.forEach((r, i) => {
          const phase = (t * (0.8 + f / 900) + i / 3) % 1;
          r.scale.setScalar(1 + phase * 1.6);
          r.position.y = BB_TOP + 0.62 + phase * 0.4;
          r.material.opacity = f ? (1 - phase) * 0.8 : 0;
        });
        body.scale.y = f ? 1 + Math.sin(t * 90) * 0.015 : 1;
      },
    };
  },

  servo(spec) {
    const g = new THREE.Group();
    const blue = new THREE.MeshStandardMaterial({ color: 0x2f6fd6, roughness: 0.4, transparent: true, opacity: 0.94 });
    const body = box(2.3, 2.2, 1.2, blue);
    body.position.set(0, BB_TOP + 1.25, 0);
    const tabs = box(3.2, 0.12, 1.2, blue);
    tabs.position.set(0, BB_TOP + 1.85, 0);
    const cap = box(2.3, 0.4, 1.2, blue);
    cap.position.set(0, BB_TOP + 2.55, 0);
    const shaftBase = cyl(0.5, 0.3, blue, 32);
    shaftBase.position.set(-0.6, BB_TOP + 2.9, 0);
    const shaft = cyl(0.14, 0.25, mat('white', () => new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.5 })));
    shaft.position.set(-0.6, BB_TOP + 3.15, 0);
    g.add(body, tabs, cap, shaftBase, shaft);
    const horn = new THREE.Group();
    horn.position.set(-0.6, BB_TOP + 3.25, 0);
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 0.32, Math.PI / 2, Math.PI * 1.5, false);
    shape.lineTo(1.6, -0.14);
    shape.absarc(1.6, 0, 0.14, -Math.PI / 2, Math.PI / 2, false);
    shape.lineTo(0, 0.32);
    const hornMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }), mat('white', () => new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.5 })));
    hornMesh.rotation.x = -Math.PI / 2;
    hornMesh.castShadow = true;
    horn.add(hornMesh);
    for (let i = 0; i < 5; i++) {
      const hole = cyl(0.04, 0.14, black(), 8);
      hole.position.set(0.5 + i * 0.25, 0.07, 0);
      horn.add(hole);
    }
    g.add(horn);
    // cable to the breadboard
    const cableEnd = new THREE.Vector3(1.6, BB_TOP, 0.9);
    return {
      group: g, width: 3.8, back: true,
      terminals: { s: cableEnd.clone(), v: cableEnd.clone().add(new THREE.Vector3(0.254, 0, 0)), g: cableEnd.clone().add(new THREE.Vector3(0.508, 0, 0)) },
      // the servo's own three-wire cable, from its body to the breadboard
      cables: [
        { from: new THREE.Vector3(1.15, BB_TOP + 0.7, 0.3), to: 's', color: 0xf08c1a },
        { from: new THREE.Vector3(1.15, BB_TOP + 0.7, 0.2), to: 'v', color: 0xd42020 },
        { from: new THREE.Vector3(1.15, BB_TOP + 0.7, 0.1), to: 'g', color: 0x5a3a20 },
      ],
      update(hw) {
        const angle = spec.state === 'open' ? undefined : hw.servos.get(spec.pin);
        if (angle === undefined) return;
        const target = THREE.MathUtils.degToRad(angle - 90) - Math.PI / 2;
        horn.rotation.y += (target - horn.rotation.y) * 0.25;
      },
      init() { horn.rotation.y = -Math.PI / 2; },
    };
  },

  ultrasonic(spec, { store }) {
    const g = new THREE.Group();
    const pcb = box(4.5, 2.0, 0.16, mat('usboard', () => new THREE.MeshStandardMaterial({ color: 0x1f5fae, roughness: 0.6 })));
    pcb.position.set(0, BB_TOP + 1.45, 0);
    g.add(pcb);
    const grille = new THREE.MeshStandardMaterial({ map: T.meshTexture(), roughness: 0.8 });
    for (const x of [-1.3, 1.3]) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 40, 1, true), metal());
      can.rotation.x = Math.PI / 2;
      can.position.set(x, BB_TOP + 1.45, -0.68);
      can.castShadow = true;
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.78, 40), grille);
      face.position.set(x, BB_TOP + 1.45, -1.27);
      face.rotation.y = Math.PI;
      g.add(can, face);
    }
    const crystal = box(0.7, 0.3, 0.2, metal());
    crystal.position.set(0, BB_TOP + 2.15, -0.15);
    g.add(crystal);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), new THREE.MeshStandardMaterial({ map: T.labelTexture(['VCC TRIG ECHO GND'], { bg: '#1f5fae', size: 46 }) }));
    label.position.set(0, BB_TOP + 0.7, 0.085);
    g.add(label);
    const pinsX = [-0.381, -0.127, 0.127, 0.381];
    for (const x of pinsX) {
      const p = box(0.06, 0.6, 0.06, mat('gold', () => new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.3 })));
      p.position.set(x, BB_TOP + 0.3, 0);
      g.add(p);
    }
    // the obstacle the sensor sees, behind it (-z)
    const wall = box(5, 3, 0.4, new THREE.MeshStandardMaterial({ color: 0xf0b33a, roughness: 0.7, transparent: true, opacity: 0.85 }));
    g.add(wall);
    const pings = [];
    for (let i = 0; i < 3; i++) {
      const arc = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 32, 1, Math.PI * 0.2, Math.PI * 0.6), new THREE.MeshBasicMaterial({ color: 0x8ef0ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      arc.rotation.x = -Math.PI / 2;
      arc.position.set(-1.3, BB_TOP + 1.45, -1.3);
      g.add(arc);
      pings.push({ arc, start: -10 });
    }
    let lastEdges = 0;
    let nextPing = 0;
    return {
      group: g, width: 5.2, back: true,
      terminals: { vcc: new THREE.Vector3(-0.381, BB_TOP, 0.5), trig: new THREE.Vector3(-0.127, BB_TOP, 0.5), echo: new THREE.Vector3(0.127, BB_TOP, 0.75), gnd: new THREE.Vector3(0.381, BB_TOP, 0.5) },
      update(hw, t) {
        const cm = store.get(spec.id, 60);
        wall.visible = cm <= 400;
        const z = -1.6 - Math.min(cm, 250) * 0.05;
        wall.position.set(0, BB_TOP + 1.5, wall.position.z + (z - wall.position.z) * 0.3 || z);
        const e = hw.edges.get(spec.trig) ?? 0;
        if (e !== lastEdges && t > nextPing) {
          const p = pings.find((q) => t - q.start > 0.6) ?? pings[0];
          p.start = t; nextPing = t + 0.2;
        }
        lastEdges = e;
        for (const p of pings) {
          const k = (t - p.start) / 0.6;
          if (k < 0 || k > 1) { p.arc.material.opacity = 0; continue; }
          const dist = (-wall.position.z - 1.5) * k;
          p.arc.position.z = -1.3 - dist;
          p.arc.material.opacity = 0.7 * (1 - k);
        }
      },
    };
  },

  oled(spec) {
    const g = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.position.set(0, BB_TOP + 0.35, 0);
    tilt.rotation.x = -0.35;
    const pcb = box(2.7, 2.8, 0.14, mat('oledpcb', () => new THREE.MeshStandardMaterial({ color: 0x14365c, roughness: 0.6 })));
    pcb.position.y = 1.4;
    const glass = box(2.6, 1.5, 0.12, new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.15, metalness: 0.2 }));
    glass.position.set(0, 1.45, 0.12);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.15), screenMat);
    screen.position.set(0, 1.5, 0.185);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.32), new THREE.MeshStandardMaterial({ map: T.labelTexture(['GND VCC SCL SDA'], { bg: '#14365c', size: 46 }) }));
    label.position.set(0, 2.55, 0.075);
    tilt.add(pcb, glass, screen, label);
    g.add(tilt);
    for (const x of [-0.381, -0.127, 0.127, 0.381]) {
      const p = box(0.06, 0.5, 0.06, mat('gold', () => new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.3 })));
      p.position.set(x, BB_TOP + 0.25, 0);
      g.add(p);
    }
    let tex = null;
    let revision = -1;
    return {
      group: g, width: 3.4, back: true,
      terminals: { gnd: new THREE.Vector3(-0.381, BB_TOP, 0.5), vcc: new THREE.Vector3(-0.127, BB_TOP, 0.5), scl: new THREE.Vector3(0.127, BB_TOP, 0.5), sda: new THREE.Vector3(0.381, BB_TOP, 0.75) },
      update(hw) {
        const oled = spec.state === 'open' ? null : hw.oled;
        if (!oled) { if (tex) { screenMat.map = null; screenMat.color.setHex(0); screenMat.needsUpdate = true; tex = null; revision = -1; } return; }
        if (!tex || tex.image !== oled.canvas) {
          tex = new THREE.CanvasTexture(oled.canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.LinearFilter;
          screenMat.map = tex; screenMat.color.setHex(0xffffff); screenMat.needsUpdate = true;
        }
        if (oled.revision !== revision) { revision = oled.revision; tex.needsUpdate = true; }
      },
    };
  },
};

export function buildPart(spec, ctx) {
  const make = BUILDERS[spec.type];
  if (!make) throw new Error(`Unknown part type: ${spec.type}`);
  const part = make(spec, ctx);
  part.spec = spec;
  part.init?.();
  return part;
}

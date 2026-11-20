// Breadboard wiring: terminals, nets and electrical checks.
//
// A wire joins two endpoints ({ t: terminalId, x? }). Terminals are board pins
// ("board:D26"), power rails ("rail:gnd.f") and part legs ("led.r"). Wires are
// merged into nets; each part then learns which GPIO it is really on, and the
// learner gets errors and warnings phrased for beginners.
import { LEFT, RIGHT } from './pins.js';

// ---- board ----
const side = (list, s) => list.map((p, i) => ({ ...p, id: p.label === 'GND' ? `board:GND.${s}` : `board:${p.label}`, row: s, index: i }));
export const BOARD_PINS = [...side(LEFT, 'L'), ...side(RIGHT, 'R')];
const byId = Object.fromEntries(BOARD_PINS.map((p) => [p.id, p]));
export const boardPin = (id) => byId[id];
export const gpioId = (gpio) => BOARD_PINS.find((p) => p.gpio === gpio)?.id ?? null;

const INPUT_ONLY = new Set([34, 35, 36, 39]);
const ADC1 = new Set([32, 33, 34, 35, 36, 39]);
const ADC2 = new Set([0, 2, 4, 12, 13, 14, 15, 25, 26, 27]);
const TOUCH = new Set([0, 2, 4, 12, 13, 14, 15, 27, 32, 33]);
const STRAPPING = new Set([0, 2, 5, 12, 15]);

// ---- rails (pre-wired to the board) ----
// Front edge: 3.3 V and GND. Back edge: 5 V (VIN) and GND.
export const RAILS = {
  'rail:gnd.f': { label: 'GND rail (front)', net: 'GND' },
  'rail:3v3.f': { label: '3.3 V rail (front)', net: '3V3' },
  'rail:5v.b': { label: '5 V rail (back)', net: '5V' },
  'rail:gnd.b': { label: 'GND rail (back)', net: 'GND' },
};

// ---- parts: terminals and what each leg is for ----
export const TERMINALS = {
  led: [
    { id: 'r', label: 'resistor end (220 Ω)', role: 'signal' },
    { id: 'a', label: 'LED anode, long leg (+)', role: 'anode' },
    { id: 'k', label: 'LED cathode, short leg (−)', role: 'gnd' },
  ],
  button: [
    { id: 'a', label: 'button leg 1', role: 'switch' },
    { id: 'b', label: 'button leg 2', role: 'switch' },
  ],
  pot: [
    { id: 'g', label: 'potentiometer outer leg (GND)', role: 'gnd' },
    { id: 'w', label: 'potentiometer wiper (middle leg)', role: 'analog' },
    { id: 'v', label: 'potentiometer outer leg (3.3 V)', role: 'vcc' },
  ],
  ldr: [
    { id: 'v', label: 'photoresistor top (3.3 V)', role: 'vcc' },
    { id: 'o', label: 'divider output (to ADC pin)', role: 'analog' },
    { id: 'g', label: '10 kΩ resistor end (GND)', role: 'gnd' },
  ],
  touch: [{ id: 'pad', label: 'touch pad wire', role: 'touch' }],
  buzzer: [
    { id: 'p', label: 'buzzer + leg', role: 'signal' },
    { id: 'n', label: 'buzzer − leg', role: 'gnd' },
  ],
  servo: [
    { id: 's', label: 'servo signal (orange)', role: 'signal' },
    { id: 'v', label: 'servo power (red, 5 V)', role: 'vin' },
    { id: 'g', label: 'servo ground (brown)', role: 'gnd' },
  ],
  ultrasonic: [
    { id: 'vcc', label: 'HC-SR04 VCC (5 V)', role: 'vin' },
    { id: 'trig', label: 'HC-SR04 TRIG', role: 'signal' },
    { id: 'echo', label: 'HC-SR04 ECHO', role: 'input' },
    { id: 'gnd', label: 'HC-SR04 GND', role: 'gnd' },
  ],
  oled: [
    { id: 'gnd', label: 'OLED GND', role: 'gnd' },
    { id: 'vcc', label: 'OLED VCC (3.3 V)', role: 'vcc' },
    { id: 'scl', label: 'OLED SCL (I²C clock)', role: 'scl' },
    { id: 'sda', label: 'OLED SDA (I²C data)', role: 'sda' },
  ],
};

export function terminalLabel(t) {
  if (t.startsWith('board:')) {
    const p = byId[t];
    return p ? `${p.label}${p.gpio !== null && !String(p.label).endsWith(String(p.gpio)) ? ` (GPIO ${p.gpio})` : ''}` : t;
  }
  if (t.startsWith('rail:')) return RAILS[t]?.label ?? t;
  return t;
}

/** Every terminal on this bench: [{ id, label }]. */
export function allTerminals(parts) {
  const out = BOARD_PINS.map((p) => ({ id: p.id, label: terminalLabel(p.id), group: 'Board' }));
  for (const [id, r] of Object.entries(RAILS)) out.push({ id, label: r.label, group: 'Rails' });
  for (const p of parts) {
    for (const t of TERMINALS[p.type] ?? []) out.push({ id: `${p.id}.${t.id}`, label: `${partName(p)}: ${t.label}`, group: partName(p) });
  }
  return out;
}

export function partName(p) {
  const base = { led: `${p.color ? `${p.color[0].toUpperCase()}${p.color.slice(1)} ` : ''}LED`, button: 'Button', pot: 'Potentiometer', ldr: 'Light sensor', touch: 'Touch pad', buzzer: 'Buzzer', servo: 'Servo', ultrasonic: 'HC-SR04', oled: 'OLED' }[p.type];
  return base ?? p.type;
}

// ---- the reference wiring that matches the lesson's code ----
export function solutionWires(parts) {
  const w = [];
  const add = (a, b) => w.push({ a: { t: a }, b: { t: b } });
  const gnd = 'rail:gnd.f';
  for (const p of parts) {
    const t = (x) => `${p.id}.${x}`;
    switch (p.type) {
      case 'led': add(gpioId(p.pin), t('r')); add(t('k'), gnd); break;
      case 'button': add(gpioId(p.pin), t('a')); add(t('b'), gnd); break;
      case 'pot': add(t('g'), gnd); add(gpioId(p.pin), t('w')); add(t('v'), 'rail:3v3.f'); break;
      case 'ldr': add(t('v'), 'rail:3v3.f'); add(gpioId(p.pin), t('o')); add(t('g'), gnd); break;
      case 'touch': add(gpioId(p.pin), t('pad')); break;
      case 'buzzer': add(gpioId(p.pin), t('p')); add(t('n'), gnd); break;
      case 'servo': add(gpioId(p.pin), t('s')); add(t('v'), 'rail:5v.b'); add(t('g'), 'rail:gnd.b'); break;
      case 'ultrasonic': add(t('vcc'), 'rail:5v.b'); add(gpioId(p.trig), t('trig')); add(gpioId(p.echo), t('echo')); add(t('gnd'), 'rail:gnd.b'); break;
      case 'oled': add(t('gnd'), gnd); add(t('vcc'), 'rail:3v3.f'); add('board:D22', t('scl')); add('board:D21', t('sda')); break;
      default: break;
    }
  }
  return w;
}

// ---- nets ----
function nets(parts, wires) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a, b) => { add(a); add(b); const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  // power: board pins and their rails are joined by the pre-wired jumpers
  for (const p of BOARD_PINS) add(p.id);
  union('board:GND.L', 'board:GND.R');
  union('rail:gnd.f', 'board:GND.L');
  union('rail:gnd.b', 'board:GND.L');
  union('rail:3v3.f', 'board:3V3');
  union('rail:5v.b', 'board:VIN');
  for (const p of parts) for (const t of TERMINALS[p.type] ?? []) add(`${p.id}.${t.id}`);
  for (const w of wires) union(w.a.t, w.b.t);
  const groups = new Map();
  for (const x of parent.keys()) {
    const r = find(x);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(x);
  }
  const netOf = new Map();
  for (const members of groups.values()) {
    const info = { members, gnd: false, v33: false, v5: false, gpios: [] };
    for (const m of members) {
      if (m === 'board:GND.L' || m === 'board:GND.R') info.gnd = true;
      else if (m === 'board:3V3') info.v33 = true;
      else if (m === 'board:VIN') info.v5 = true;
      else if (byId[m]?.gpio !== null && byId[m]?.gpio !== undefined) info.gpios.push(byId[m].gpio);
    }
    for (const m of members) netOf.set(m, info);
  }
  return netOf;
}

const describeNet = (n) => (n.gnd ? 'GND' : n.v33 ? '3.3 V' : n.v5 ? '5 V' : n.gpios.length ? `GPIO ${n.gpios[0]}` : 'nothing');

/**
 * Works out what the circuit really does.
 * Returns { effective: parts with resolved pins/state, issues: [{ level, part, text }], ok }.
 */
export function analyze(parts, wires, { wifi = false } = {}) {
  const netOf = nets(parts, wires);
  const issues = [];
  const err = (part, text) => issues.push({ level: 'error', part, text });
  const warn = (part, text) => issues.push({ level: 'warn', part, text });
  const net = (p, t) => netOf.get(`${p.id}.${t}`);
  const used = (n) => n.members.length > 1;
  const oneGpio = (p, n, what) => {
    if (n.gpios.length > 1) { err(p, `${what} is connected to two GPIO pins (${n.gpios.join(' and ')}) at once.`); return null; }
    return n.gpios[0] ?? null;
  };
  const outputOk = (p, gpio, what) => {
    if (gpio !== null && INPUT_ONLY.has(gpio)) { err(p, `GPIO ${gpio} is input-only, so it cannot drive the ${what}. Pick an output pin such as 25, 26 or 27.`); return false; }
    return true;
  };
  const pinNotes = (p, gpio) => {
    if (gpio === 1 || gpio === 3) warn(p, `GPIO ${gpio} carries USB serial (TX0/RX0). Using it breaks the Serial Monitor and uploads.`);
    else if (gpio === 12) warn(p, 'GPIO 12 is a strapping pin: if it is pulled HIGH at boot, the flash voltage is set wrong and the board may not start.');
    else if (gpio !== null && STRAPPING.has(gpio) && gpio !== 2) warn(p, `GPIO ${gpio} is a strapping pin. It works, but anything that pulls it at power-on can change how the board boots.`);
  };

  // Board-level shorts
  const seen = new Set();
  for (const n of netOf.values()) {
    if (seen.has(n)) continue;
    seen.add(n);
    const supplies = [n.gnd && 'GND', n.v33 && '3.3 V', n.v5 && '5 V'].filter(Boolean);
    if (supplies.length > 1) err(null, `Short circuit: ${supplies.join(' and ')} are wired together. On a real board this gets hot fast.`);
    if (n.gpios.length && supplies.length) err(null, `GPIO ${n.gpios.join(', ')} is wired straight to ${supplies[0]}. Driving it the other way is a short circuit.`);
    if (n.gpios.length > 1 && !supplies.length && n.members.every((m) => m.startsWith('board:'))) err(null, `GPIO ${n.gpios.join(' and ')} are wired to each other.`);
  }

  const effective = parts.map((p) => {
    const e = { ...p, state: 'ok' };
    switch (p.type) {
      case 'led': {
        const r = net(p, 'r'); const a = net(p, 'a'); const k = net(p, 'k');
        const rG = oneGpio(p, r, 'The resistor'); const aG = oneGpio(p, a, 'The LED anode');
        const kG = oneGpio(p, k, 'The LED cathode');
        e.pin = null;
        if (!used(r) && !used(a) && !used(k)) { e.state = 'open'; break; }
        if (k.gnd && rG !== null) { e.pin = rG; }
        else if (k.gnd && aG !== null) { e.pin = aG; e.state = 'no-resistor'; err(p, `The ${partName(p)} is wired to GPIO ${aG} without its resistor. Without one it draws too much current and burns out. Connect the GPIO to the resistor end instead.`); }
        else if (k.gnd && (r.v33 || a.v33)) { e.state = 'always'; warn(p, `The ${partName(p)} is powered from 3.3 V, so it is always on and the code cannot switch it.`); }
        else if (kG !== null && (r.gnd || a.gnd)) { e.state = 'reversed'; err(p, `The ${partName(p)} is backwards. Current only flows from the long leg (anode) to the short leg (cathode): the GPIO side goes to the resistor, the short leg to GND.`); }
        else if (!k.gnd) { e.state = 'open'; err(p, `The ${partName(p)}'s short leg (cathode) is not connected to GND, so no current can flow.`); }
        else { e.state = 'open'; err(p, `The ${partName(p)} is not connected to a GPIO pin. Wire a GPIO to the resistor end.`); }
        if (e.pin !== null && !outputOk(p, e.pin, partName(p))) { e.pin = null; e.state = 'open'; }
        if (e.pin !== null) pinNotes(p, e.pin);
        break;
      }
      case 'button': {
        const a = net(p, 'a'); const b = net(p, 'b');
        const sides = [a, b];
        const sig = sides.find((n) => n.gpios.length && !n.gnd && !n.v33);
        const other = sides.find((n) => n !== sig);
        e.pin = sig ? oneGpio(p, sig, 'The button') : null;
        if (e.pin === null) { if (used(a) || used(b)) err(p, 'The button is not connected to a GPIO pin.'); e.state = 'open'; break; }
        if (other?.gnd) e.to = 'gnd';
        else if (other?.v33) e.to = 'vcc';
        else if (other?.v5) { e.to = 'vcc'; err(p, 'The button connects the pin to 5 V. ESP32 pins take 3.3 V at most: use the 3.3 V rail.'); }
        else { e.state = 'open'; err(p, 'The other side of the button goes nowhere. Connect it to GND (and use INPUT_PULLUP in the code).'); }
        if (e.to === 'vcc') warn(p, 'The button goes to 3.3 V, so pressing it reads HIGH. Use INPUT_PULLDOWN, and remember the logic is not inverted.');
        if (INPUT_ONLY.has(e.pin)) warn(p, `GPIO ${e.pin} has no internal pull resistors, so INPUT_PULLUP does nothing there: the pin floats when the button is released. Add a 10 kΩ resistor or choose another pin.`);
        pinNotes(p, e.pin);
        break;
      }
      case 'pot':
      case 'ldr': {
        const o = net(p, p.type === 'pot' ? 'w' : 'o');
        e.pin = oneGpio(p, o, `The ${partName(p).toLowerCase()} output`);
        const hi = net(p, 'v'); const lo = net(p, 'g');
        if (e.pin === null) { if (used(o) || used(hi) || used(lo)) err(p, `The ${partName(p).toLowerCase()}'s ${p.type === 'pot' ? 'middle leg (wiper)' : 'output'} is not connected to an ADC pin.`); e.state = 'open'; break; }
        if (!ADC1.has(e.pin) && !ADC2.has(e.pin)) { err(p, `GPIO ${e.pin} cannot read analog voltages. Use an ADC pin: GPIO 32–39 are the best choice.`); e.state = 'open'; break; }
        if (ADC2.has(e.pin)) warn(p, `GPIO ${e.pin} is on ADC2, which stops working while Wi-Fi is on.${wifi ? ' This lesson uses Wi-Fi, so it will read nothing.' : ' Prefer GPIO 32–39 (ADC1).'}`);
        if (hi.v5 || lo.v5) err(p, `The ${partName(p).toLowerCase()} is powered from 5 V, which can push more than 3.3 V into the ADC pin. Use the 3.3 V rail.`);
        if (p.type === 'pot' && hi.gnd && lo.v33) e.reversed = true;
        else if (!(hi.v33 || hi.v5) || !lo.gnd) {
          e.state = 'open';
          if (!(hi.v33 || hi.v5) && !(lo.v33 && p.type === 'pot')) err(p, `The ${partName(p).toLowerCase()} has no 3.3 V connection, so the reading stays near 0.`);
          if (!lo.gnd && !(hi.gnd && p.type === 'pot')) err(p, `The ${partName(p).toLowerCase()} has no GND connection, so the reading floats.`);
        }
        break;
      }
      case 'touch': {
        e.pin = oneGpio(p, net(p, 'pad'), 'The touch pad');
        if (e.pin === null) { e.state = 'open'; break; }
        if (!TOUCH.has(e.pin)) { err(p, `GPIO ${e.pin} is not a touch pin. Touch works on T0–T9: GPIO 4, 0, 2, 15, 13, 12, 14, 27, 33, 32.`); e.state = 'open'; }
        break;
      }
      case 'buzzer': {
        const pp = net(p, 'p'); const n = net(p, 'n');
        const pG = oneGpio(p, pp, 'The buzzer'); const nG = n.gpios[0] ?? null;
        e.pin = null;
        if (pG !== null && n.gnd) e.pin = pG;
        else if (nG !== null && pp.gnd) { e.pin = nG; warn(p, 'The buzzer is in backwards. A passive buzzer still beeps either way, but polarised (active) buzzers would not.'); }
        else { if (used(pp) || used(n)) err(p, 'The buzzer needs one leg on a GPIO pin and the other on GND.'); e.state = 'open'; }
        if (e.pin !== null && !outputOk(p, e.pin, 'buzzer')) { e.pin = null; e.state = 'open'; }
        break;
      }
      case 'servo': {
        const s = net(p, 's'); const v = net(p, 'v'); const g = net(p, 'g');
        e.pin = oneGpio(p, s, 'The servo signal');
        if (e.pin !== null && !outputOk(p, e.pin, 'servo')) e.pin = null;
        if (!g.gnd) { if (used(s) || used(v) || used(g)) err(p, 'The servo’s brown wire must go to GND, or its signal has no reference and it will not move.'); e.state = 'open'; }
        else if (!(v.v5 || v.v33)) { err(p, 'The servo has no power: connect the red wire to the 5 V rail.'); e.state = 'open'; }
        else if (v.v33) warn(p, 'The servo is on 3.3 V. Hobby servos are made for 5 V; on 3.3 V they are weak and jittery.');
        if (e.pin === null) e.state = 'open';
        break;
      }
      case 'ultrasonic': {
        const vcc = net(p, 'vcc'); const g = net(p, 'gnd');
        e.trig = oneGpio(p, net(p, 'trig'), 'TRIG');
        e.echo = oneGpio(p, net(p, 'echo'), 'ECHO');
        if (e.trig !== null && !outputOk(p, e.trig, 'TRIG input')) e.trig = null;
        if (!g.gnd || !(vcc.v5 || vcc.v33)) { if ([vcc, g, net(p, 'trig'), net(p, 'echo')].some(used)) err(p, 'The HC-SR04 needs VCC on the 5 V rail and GND on a GND rail.'); e.state = 'open'; }
        else if (vcc.v33) { warn(p, 'The classic HC-SR04 needs 5 V. On 3.3 V it often returns nothing; the HC-SR04P variant works at 3.3 V.'); e.state = 'open'; }
        else if (e.echo !== null) warn(p, `ECHO outputs 5 V into GPIO ${e.echo}, above the ESP32's 3.3 V limit. On real hardware add a divider (1 kΩ + 2 kΩ) on ECHO.`);
        if (e.trig === null || e.echo === null) e.state = 'open';
        break;
      }
      case 'oled': {
        const g = net(p, 'gnd'); const v = net(p, 'vcc');
        const scl = oneGpio(p, net(p, 'scl'), 'SCL'); const sda = oneGpio(p, net(p, 'sda'), 'SDA');
        if (!g.gnd || !(v.v33 || v.v5)) { if (['gnd', 'vcc', 'scl', 'sda'].some((t) => used(net(p, t)))) err(p, 'The OLED needs power: GND to a GND rail and VCC to 3.3 V.'); e.state = 'open'; break; }
        if (scl === 21 && sda === 22) { err(p, 'SDA and SCL are swapped. SDA goes to GPIO 21, SCL to GPIO 22.'); e.state = 'open'; break; }
        if (scl !== 22 || sda !== 21) {
          err(p, `The sketch uses the default I²C pins: SDA on GPIO 21 and SCL on GPIO 22.${scl !== null || sda !== null ? ' (To use other pins you would call Wire.begin(sda, scl) first.)' : ''}`);
          e.state = 'open';
        }
        break;
      }
      default: break;
    }
    return e;
  });

  return { effective, issues, ok: !issues.some((i) => i.level === 'error') };
}

/** True when the wiring is valid and every part sits on the pins the code expects. */
export function matchesCode(parts, result) {
  if (!result.ok) return false;
  return parts.every((p, i) => {
    const e = result.effective[i];
    if (e.state !== 'ok') return false;
    if (p.type === 'ultrasonic') return e.trig === p.trig && e.echo === p.echo;
    if (p.type === 'oled') return true;
    if (p.type === 'button') return e.pin === p.pin && e.to === 'gnd';
    if (p.type === 'pot') return e.pin === p.pin && !e.reversed;
    return e.pin === p.pin;
  });
}

// Connects the parts on the virtual breadboard to the simulated pins.
// The InputStore holds what the learner is doing (pressing, turning, dimming)
// and is shared by the 3D scene and the on-screen controls.

export const DEFAULTS = { button: false, touch: false, pot: 0.5, ldr: 0.8, ultrasonic: 60 };

export class InputStore {
  constructor() {
    this.values = new Map();
    this.counts = new Map();
    this.listeners = new Set();
  }

  get(id, fallback) { return this.values.has(id) ? this.values.get(id) : fallback; }

  set(id, value) {
    if (this.values.get(id) === value) return;
    this.values.set(id, value);
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    for (const fn of this.listeners) fn(id, value);
  }

  /** How many times the learner changed an input (for lesson goals). */
  changes(id) { return this.counts.get(id) ?? 0; }
  resetCounts() { this.counts.clear(); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

const NO_PULLS = new Set([34, 35, 36, 39]); // input-only pins have no internal pull resistors
const floating = () => (Math.random() < 0.5 ? 1 : 0);

/**
 * Registers each part's signal source on the hardware model. Parts may carry
 * the results of wiring analysis (pin, state, to, reversed); unwired parts
 * contribute nothing, and miswired inputs float the way real ones do.
 */
export function bindCircuit(parts, hw, store) {
  for (const part of parts) {
    const { id } = part;
    const open = part.state === 'open';
    switch (part.type) {
      case 'button':
        if (part.pin === null || part.pin === undefined || open) break;
        hw.digital.set(part.pin, () => {
          const toVcc = part.to === 'vcc';
          if (store.get(id, DEFAULTS.button)) return toVcc ? 1 : 0;
          const mode = hw.pin(part.pin).mode;
          if (NO_PULLS.has(part.pin)) return floating();
          if (mode === 'INPUT_PULLUP') return 1;
          if (mode === 'INPUT_PULLDOWN') return 0;
          return floating();
        });
        break;
      case 'pot':
        if (part.pin === null || part.pin === undefined) break;
        hw.analog.set(part.pin, () => {
          if (open) return Math.random() * 4095; // floating input picks up noise
          const v = store.get(id, DEFAULTS.pot);
          return (part.reversed ? 1 - v : v) * 4095 + (Math.random() - 0.5) * 6;
        });
        break;
      case 'ldr':
        if (part.pin === null || part.pin === undefined) break;
        // Voltage divider: 3.3 V -> LDR -> pin -> 10k -> GND. More light, higher reading.
        hw.analog.set(part.pin, () => {
          if (open) return Math.random() * 4095;
          const light = store.get(id, DEFAULTS.ldr);
          const rLdr = 200 + 60000 * (1 - light) ** 2; // ohms, rough photoresistor curve
          return (10000 / (10000 + rLdr)) * 4095 + (Math.random() - 0.5) * 30;
        });
        break;
      case 'touch':
        if (part.pin === null || part.pin === undefined || open) break;
        hw.touch.set(part.pin, () => store.get(id, DEFAULTS.touch));
        break;
      case 'ultrasonic':
        if (part.echo === null || part.echo === undefined || open) break;
        hw.echo.set(part.echo, () => store.get(id, DEFAULTS.ultrasonic));
        break;
      default:
        break;
    }
  }
}

/** Re-binds after the wiring changed while a sketch may be running. */
export function rebindCircuit(parts, hw, store) {
  hw.digital.clear();
  hw.analog.clear();
  hw.touch.clear();
  hw.echo.clear();
  bindCircuit(parts, hw, store);
  hw.version++;
}

/** On-screen controls a lesson needs, derived from its parts. */
export function controlsFor(parts) {
  const out = [];
  for (const p of parts) {
    if (p.type === 'button') out.push({ id: p.id, kind: 'hold', label: 'Button', hint: p.label });
    if (p.type === 'touch') out.push({ id: p.id, kind: 'hold', label: 'Touch pad', hint: p.label });
    if (p.type === 'pot') out.push({ id: p.id, kind: 'range', label: 'Knob', min: 0, max: 1, step: 0.001, value: DEFAULTS.pot, format: (v) => `${Math.round(v * 100)}%` });
    if (p.type === 'ldr') out.push({ id: p.id, kind: 'range', label: 'Room light', min: 0, max: 1, step: 0.01, value: DEFAULTS.ldr, format: (v) => `${Math.round(v * 100)}%` });
    if (p.type === 'ultrasonic') out.push({ id: p.id, kind: 'range', label: 'Obstacle distance', min: 3, max: 450, step: 1, value: DEFAULTS.ultrasonic, format: (v) => (v > 400 ? 'out of range' : `${Math.round(v)} cm`) });
  }
  return out;
}

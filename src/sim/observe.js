// Watches a running sketch so lesson goals and challenges can be checked:
// serial output (with line timestamps), sampled input/output pairs, OLED text,
// HTTP traffic, and the hardware's timestamped event log.

export class Observer {
  constructor(hw, store, parts) {
    this.hw = hw;
    this.store = store;
    this.parts = parts;
    this.reset();
  }

  reset() {
    this.serial = '';
    this.lineTimes = [];
    this.samples = [];
    this.oledTexts = [];
    this.http = [];
    clearInterval(this.timer);
    this.timer = null;
  }

  start() {
    this.reset();
    this.timer = setInterval(() => this.sample(), 50);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  onSerial(text) {
    this.serial += text;
    if (this.serial.length > 40000) this.serial = this.serial.slice(-30000);
    const t = this.hw.clock();
    for (const ch of text) if (ch === '\n') this.lineTimes.push(t);
    if (this.lineTimes.length > 400) this.lineTimes.splice(0, 100);
  }

  onHttp(entry) {
    this.http.push(entry);
    if (this.http.length > 200) this.http.shift();
  }

  sample() {
    const { hw, store } = this;
    const s = { t: this.hw.clock(), in: {}, lvl: {}, servo: {} };
    for (const p of this.parts) {
      if (p.id) s.in[p.id] = store.get(p.id, undefined);
      if (p.pin !== undefined) s.lvl[p.pin] = hw.level(p.pin);
      if (p.type === 'servo' && hw.servos.has(p.pin)) s.servo[p.pin] = hw.servos.get(p.pin);
    }
    s.lvl[2] = hw.level(2);
    this.samples.push(s);
    if (this.samples.length > 800) this.samples.splice(0, 200);
    const text = hw.oled?.textContent().trim();
    if (text && text !== this.oledTexts[this.oledTexts.length - 1]) {
      this.oledTexts.push(text);
      if (this.oledTexts.length > 200) this.oledTexts.shift();
    }
  }

  /** The object goal/challenge checks receive. */
  ctx() {
    const { hw, store } = this;
    return {
      hw,
      serial: this.serial,
      lines: this.lineTimes.length,
      lineTimes: this.lineTimes,
      samples: this.samples,
      oledTexts: this.oledTexts,
      http: this.http,
      changes: (id) => store.changes(id),
    };
  }
}

// ---------- analysis helpers for checks ----------

export const edges = (ctx, gpio) => ctx.hw.edges.get(gpio) ?? 0;
export const pwmRange = (ctx, gpio) => { const s = ctx.hw.pwmSeen.get(gpio); return s ? s.max - s.min : 0; };
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };

/** On-pulses of a pin: [{ start, on, off }] where off is the gap after the pulse. */
export function pulses(ctx, gpio, threshold = 0.5) {
  const ev = ctx.hw.log.filter((e) => e.kind === 'level' && e.gpio === gpio);
  const out = [];
  let high = false;
  let start = 0;
  for (const e of ev) {
    const isHigh = e.v > threshold;
    if (isHigh && !high) {
      if (out.length) out[out.length - 1].off = e.t - out[out.length - 1].end;
      start = e.t;
      high = true;
    } else if (!isHigh && high) {
      out.push({ start, on: e.t - start, end: e.t, off: null });
      high = false;
    }
  }
  return out;
}

/** The last n complete pulses (with a measured gap after them). */
export const lastPulses = (ctx, gpio, n) => pulses(ctx, gpio).filter((p) => p.off !== null).slice(-n);

export const within = (x, lo, hi) => x >= lo && x <= hi;

/** Median interval between the last n serial lines. */
export function lineInterval(ctx, n = 6) {
  const t = ctx.lineTimes.slice(-n);
  if (t.length < n) return NaN;
  return median(t.slice(1).map((x, i) => x - t[i]));
}

/** True if the on-durations contain the Morse pattern for SOS. */
export function hasSOS(ctx, gpio) {
  const ons = pulses(ctx, gpio).map((p) => p.on);
  for (let i = 0; i + 9 <= ons.length; i++) {
    const w = ons.slice(i, i + 9);
    const dots = [...w.slice(0, 3), ...w.slice(6, 9)];
    const dashes = w.slice(3, 6);
    if (Math.min(...dashes) >= 2 * Math.max(...dots)) return true;
  }
  return false;
}

/**
 * Of the samples taken while `when` holds and the inputs have been steady for
 * `settle` ms, the fraction where `expect` holds. Returns { n, ok } counts.
 */
export function agreement(ctx, when, expect, settle = 200) {
  const s = ctx.samples;
  let n = 0;
  let ok = 0;
  for (let i = 0; i < s.length; i++) {
    if (!when(s[i])) continue;
    // inputs unchanged for `settle` ms?
    let steady = true;
    for (let j = i - 1; j >= 0 && s[i].t - s[j].t <= settle; j--) {
      if (JSON.stringify(s[j].in) !== JSON.stringify(s[i].in)) { steady = false; break; }
    }
    if (!steady) continue;
    n++;
    if (expect(s[i])) ok++;
  }
  return { n, ok, ratio: n ? ok / n : 0 };
}

/** Times (ms) at which a pin's level rose through `level`. */
export function peaks(ctx, gpio, level = 0.95) {
  const out = [];
  let below = true;
  for (const e of ctx.hw.log) {
    if (e.kind !== 'level' || e.gpio !== gpio) continue;
    if (below && e.v >= level) { out.push(e.t); below = false; } else if (e.v < level * 0.6) below = true;
  }
  return out;
}

/** Durations of servo sweeps between the ends of travel: { up: [...], down: [...] }. */
export function servoSweeps(ctx, gpio, lo = 15, hi = 165) {
  const up = [];
  const down = [];
  let lastEnd = null; // { t, at: 'lo' | 'hi' }
  for (const e of ctx.hw.log) {
    if (e.kind !== 'servo' || e.gpio !== gpio) continue;
    const at = e.v <= lo ? 'lo' : e.v >= hi ? 'hi' : null;
    if (!at) continue;
    if (lastEnd && lastEnd.at !== at) (at === 'hi' ? up : down).push(e.t - lastEnd.t);
    if (!lastEnd || lastEnd.at !== at) lastEnd = { t: e.t, at };
    else lastEnd.t = e.t; // still at the same end: measure from when it leaves
  }
  return { up, down };
}

/** Number of separate presses (false -> true transitions) of an input. */
export const presses = (ctx, id) => Math.floor((ctx.changes(id) + 1) / 2);

// Two bench instruments drawn on canvases in the dark serial pane:
//  - Plotter: graphs the numbers printed on each serial line (like the Arduino
//    Serial Plotter). "a:1 b:2" lines become named series.
//  - LogicAnalyzer: the last few seconds of each pin, from the hardware's
//    timestamped log, with measured frequency and duty cycle.

const SERIES = ['#ff9f6b', '#7cc4f2', '#b6e388', '#e6b6f2', '#f2d16b', '#7ce0cf'];
const INK = { text: '#e9e3d6', dim: '#9c9383', grid: '#38332a', bg: '#191712' };

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = INK.bg;
  g.fillRect(0, 0, w, h);
  g.font = '11px "JetBrains Mono", ui-monospace, monospace';
  g.textBaseline = 'middle';
  return { g, w, h };
}

const niceStep = (span) => {
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p * 10;
};
const fmt = (v) => (Math.abs(v) >= 1000 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(Math.abs(v) < 10 ? 2 : 1));

export class Plotter {
  constructor(canvas, { max = 240 } = {}) {
    this.canvas = canvas;
    this.max = max;
    this.clear();
  }

  clear() { this.series = new Map(); this.partial = ''; this.count = 0; }

  /** Feed raw serial text; complete lines are parsed. */
  feed(text) {
    this.partial += text;
    const lines = this.partial.split('\n');
    this.partial = lines.pop();
    for (const line of lines) this.addLine(line);
  }

  addLine(line) {
    const named = [...line.matchAll(/([A-Za-z_][\w ]*?)\s*[:=]\s*(-?\d+(?:\.\d+)?)/g)];
    const pairs = named.length
      ? named.map((m) => [m[1].trim(), Number(m[2])])
      : [...line.matchAll(/-?\d+(?:\.\d+)?/g)].map((m, i) => [`value ${i + 1}`, Number(m[0])]);
    if (!pairs.length) return;
    this.count++;
    for (const [name, v] of pairs.slice(0, SERIES.length)) {
      if (!this.series.has(name)) this.series.set(name, []);
      const s = this.series.get(name);
      s.push({ i: this.count, v });
      if (s.length > this.max) s.shift();
    }
  }

  draw() {
    const { g, w, h } = setup(this.canvas);
    const all = [...this.series.values()].flat();
    if (!all.length) {
      g.fillStyle = INK.dim;
      g.textAlign = 'center';
      g.fillText('Print numbers to plot them, e.g. Serial.println(analogRead(34));', w / 2, h / 2 - 8);
      g.fillText('Several per line? Use labels: Serial.printf("pot:%d light:%d\\n", a, b);', w / 2, h / 2 + 10);
      return;
    }
    let lo = Math.min(...all.map((p) => p.v));
    let hi = Math.max(...all.map((p) => p.v));
    if (hi === lo) { hi += 1; lo -= 1; }
    const step = niceStep(hi - lo);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const left = 48; const right = 10; const top = 26; const bottom = 14;
    const x0 = Math.max(1, this.count - this.max + 1);
    const X = (i) => left + ((i - x0) / Math.max(1, this.max - 1)) * (w - left - right);
    const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * (h - top - bottom);
    g.textAlign = 'right';
    for (let v = lo; v <= hi + step / 2; v += step) {
      g.strokeStyle = INK.grid;
      g.beginPath(); g.moveTo(left, Y(v)); g.lineTo(w - right, Y(v)); g.stroke();
      g.fillStyle = INK.dim;
      g.fillText(fmt(v), left - 6, Y(v));
    }
    let lx = left;
    g.textAlign = 'left';
    [...this.series.entries()].forEach(([name, pts], k) => {
      const color = SERIES[k % SERIES.length];
      g.strokeStyle = color;
      g.lineWidth = 1.75;
      g.beginPath();
      pts.forEach((p, j) => (j ? g.lineTo(X(p.i), Y(p.v)) : g.moveTo(X(p.i), Y(p.v))));
      g.stroke();
      g.lineWidth = 1;
      const last = pts[pts.length - 1];
      const label = `${name} ${fmt(last.v)}`;
      g.fillStyle = color;
      g.fillRect(lx, 9, 8, 3);
      g.fillStyle = INK.text;
      g.fillText(label, lx + 12, 11);
      lx += g.measureText(label).width + 28;
    });
  }
}

export class LogicAnalyzer {
  constructor(canvas, { windowMs = 4000 } = {}) {
    this.canvas = canvas;
    this.windowMs = windowMs;
    this.hw = null;
    this.pins = [];
  }

  attach(hw, pins) { this.hw = hw; this.pins = pins; }

  /** Pins to show: the lesson's, plus any other pin the sketch has driven. */
  channels() {
    const set = new Map(this.pins.map((p) => [p.gpio, p.label]));
    for (const e of this.hw?.log ?? []) {
      if (!set.has(e.gpio) && set.size < 8) set.set(e.gpio, e.gpio === 2 ? 'built-in LED' : '');
    }
    return [...set.entries()].map(([gpio, label]) => ({ gpio, label }));
  }

  draw() {
    const { g, w, h } = setup(this.canvas);
    const hw = this.hw;
    const chans = hw ? this.channels() : [];
    if (!hw || !hw.log.length) {
      g.fillStyle = INK.dim;
      g.textAlign = 'center';
      g.fillText('Run a sketch: every pin it drives shows up here as a trace.', w / 2, h / 2);
      return;
    }
    const now = hw.clock();
    const t0 = now - this.windowMs;
    const left = 92; const right = 96; const top = 8; const axis = 18;
    const rowH = Math.max(26, Math.min(48, (h - top - axis) / Math.max(1, chans.length)));
    const X = (t) => left + ((t - t0) / this.windowMs) * (w - left - right);
    // time grid
    g.textAlign = 'center';
    // grid every 500 ms of the sketch's own clock; labels at whole seconds back from now
    for (let s = Math.ceil(t0 / 500) * 500; s <= now; s += 500) {
      g.strokeStyle = INK.grid;
      g.beginPath(); g.moveTo(X(s), top); g.lineTo(X(s), h - axis); g.stroke();
    }
    g.fillStyle = INK.dim;
    for (let k = 0; k <= this.windowMs / 1000; k++) {
      const x = X(now - k * 1000);
      if (x < left + 10) break;
      g.fillText(k ? `−${k} s` : 'now', x, h - axis / 2);
    }
    chans.forEach(({ gpio, label }, k) => {
      const y = top + k * rowH;
      const hiY = y + 6; const loY = y + rowH - 6;
      const color = SERIES[k % SERIES.length];
      const events = hw.log.filter((e) => e.gpio === gpio);
      const kind = events.some((e) => e.kind === 'servo') ? 'servo' : events.some((e) => e.kind === 'tone') ? 'tone' : 'level';
      g.textAlign = 'left';
      g.fillStyle = INK.text;
      g.fillText(`GPIO ${gpio}`, 8, y + rowH / 2 - (label ? 6 : 0));
      if (label) { g.fillStyle = INK.dim; g.fillText(label.slice(0, 12), 8, y + rowH / 2 + 7); }
      // value at the start of the window
      let v = 0;
      for (const e of events) { if (e.t > t0) break; if (e.kind === kind) v = e.v; }
      const norm = (val) => (kind === 'servo' ? val / 180 : kind === 'tone' ? (val ? 1 : 0) : val);
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.beginPath();
      let x = left;
      let yv = loY - norm(v) * (loY - hiY);
      g.moveTo(x, yv);
      for (const e of events) {
        if (e.kind !== kind || e.t <= t0) continue;
        const nx = X(e.t);
        if (kind === 'servo') g.lineTo(nx, loY - norm(e.v) * (loY - hiY));
        else { g.lineTo(nx, yv); yv = loY - norm(e.v) * (loY - hiY); g.lineTo(nx, yv); }
        if (kind === 'servo') yv = loY - norm(e.v) * (loY - hiY);
        x = nx;
      }
      g.lineTo(X(now), yv);
      g.stroke();
      g.lineWidth = 1;
      // PWM: shade the duty level
      if (kind === 'level' && events.some((e) => e.v > 0 && e.v < 1)) {
        g.fillStyle = `${color}22`;
        g.fillRect(left, yv, X(now) - left, loY - yv);
      }
      // readout
      g.textAlign = 'left';
      g.fillStyle = INK.text;
      g.fillText(readout(events, kind, now), w - right + 8, y + rowH / 2);
      g.strokeStyle = INK.grid;
      g.beginPath(); g.moveTo(left, y + rowH); g.lineTo(w - right, y + rowH); g.stroke();
    });
  }
}

/** Short measurement text for a channel: frequency/duty, PWM %, angle or tone. */
function readout(events, kind, now) {
  const last = events.filter((e) => e.kind === kind).pop();
  if (!last) return '';
  if (kind === 'servo') return `${Math.round(last.v)}°`;
  if (kind === 'tone') return last.v ? `${Math.round(last.v)} Hz` : 'silent';
  if (last.v > 0 && last.v < 1) return `PWM ${Math.round(last.v * 100)}%`;
  // digital: measure the last complete high+low period
  const edges = events.filter((e) => e.kind === 'level' && (e.v === 0 || e.v === 1));
  const rises = [];
  for (let i = 1; i < edges.length; i++) if (edges[i].v === 1 && edges[i - 1].v === 0) rises.push(i);
  if (rises.length >= 2) {
    const a = rises[rises.length - 2]; const b = rises[rises.length - 1];
    const period = edges[b].t - edges[a].t;
    const fall = edges.slice(a, b).find((e) => e.v === 0);
    if (period > 0 && fall && now - edges[b].t < period * 3) {
      const duty = Math.round(((fall.t - edges[a].t) / period) * 100);
      const f = 1000 / period;
      return `${f >= 10 ? f.toFixed(0) : f.toFixed(2)} Hz ${duty}%`;
    }
  }
  return last.v ? 'HIGH' : 'LOW';
}

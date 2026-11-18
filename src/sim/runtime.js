// A virtual ESP32: pin state, the Arduino API the lessons use, and a runner
// that executes a transpiled sketch until it is stopped.

import { transpile } from './transpile.js';

export class StopSignal extends Error {}

/** Pin levels, PWM duty, tones and attached devices, observed by the 3D scene. */
export class Hardware {
  constructor() { this.reset(); }

  reset() {
    this.pins = new Map();     // gpio -> { mode, value, pwm, tone }
    this.servos = new Map();   // gpio -> angle
    this.inputs = new Map();   // input id -> value (set by the UI)
    this.analog = new Map();   // gpio -> () => raw 0..4095
    this.digital = new Map();  // gpio -> () => 0 | 1
    this.touch = new Map();    // gpio -> () => touched?
    this.echo = new Map();     // echo gpio -> () => distance in cm
    this.oled = null;          // OledCanvas once a display starts
    this.edges = new Map();    // gpio -> number of level changes (used by lesson goals)
    this.pwmSeen = new Map();  // gpio -> { min, max } duty seen
    this.ledcBits = new Map(); // gpio -> ledc resolution in bits
    this.tonesSeen = new Set();// frequencies played
    this.servoSeen = { min: Infinity, max: -Infinity };
    this.version = 0;
  }

  pin(gpio) {
    if (!this.pins.has(gpio)) this.pins.set(gpio, { mode: 'INPUT', value: 0, pwm: null, tone: 0 });
    return this.pins.get(gpio);
  }

  /** Brightness 0..1 a component connected to this pin would see. */
  level(gpio) {
    const p = this.pins.get(gpio);
    if (!p || p.mode !== 'OUTPUT') return 0;
    return p.pwm !== null ? p.pwm / 255 : p.value;
  }

  toneOf(gpio) { return this.pins.get(gpio)?.tone ?? 0; }
  input(id, fallback = 0) { return this.inputs.has(id) ? this.inputs.get(id) : fallback; }
}

const FONT_W = 6;
const FONT_H = 8;

/** A 128x64 monochrome display drawn on a canvas, like an SSD1306. */
export class OledCanvas {
  constructor(width = 128, height = 64) {
    this.width = width;
    this.height = height;
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx = this.canvas.getContext('2d');
    }
    this.ops = [];
    this.shown = [];
    this.cursor = [0, 0];
    this.size = 1;
    this.revision = 0;
  }

  clear() { this.ops = []; this.cursor = [0, 0]; }

  text(str) {
    for (const ch of String(str)) {
      if (ch === '\n') { this.cursor = [0, this.cursor[1] + FONT_H * this.size]; continue; }
      this.ops.push(['char', ch, this.cursor[0], this.cursor[1], this.size]);
      this.cursor[0] += FONT_W * this.size;
    }
  }

  /** Copies the drawing buffer to the visible screen, like display(). */
  show() {
    this.shown = this.ops.slice();
    this.revision++;
    const c = this.ctx;
    if (!c) return;
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.width, this.height);
    c.fillStyle = c.strokeStyle = '#9fe3ff';
    c.textBaseline = 'top';
    for (const op of this.shown) {
      const [kind, ...a] = op;
      if (kind === 'char') {
        c.font = `${FONT_H * a[3]}px ui-monospace, monospace`;
        c.fillText(a[0], a[1], a[2]);
      } else if (kind === 'rect') c.strokeRect(a[0] + 0.5, a[1] + 0.5, a[2] - 1, a[3] - 1);
      else if (kind === 'fill') c.fillRect(a[0], a[1], a[2], a[3]);
      else if (kind === 'line') { c.beginPath(); c.moveTo(a[0] + 0.5, a[1] + 0.5); c.lineTo(a[2] + 0.5, a[3] + 0.5); c.stroke(); }
      else if (kind === 'circle') { c.beginPath(); c.arc(a[0], a[1], a[2], 0, Math.PI * 2); c.stroke(); }
    }
  }

  /** Plain-text view of the screen, used by tests and screen readers. */
  textContent() { return this.shown.filter((o) => o[0] === 'char').map((o) => o[1]).join(''); }
}

function formatNumber(v, digits) {
  if (typeof v !== 'number') return String(v);
  if (digits !== undefined) return v.toFixed(digits);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function printf(fmt, ...args) {
  let i = 0;
  return String(fmt).replace(/%(-?\d*)(?:\.(\d+))?([dilufsxXc%])/g, (m, width, prec, conv) => {
    if (conv === '%') return '%';
    const v = args[i++];
    let s;
    if (conv === 'f') s = Number(v).toFixed(prec === undefined ? 6 : Number(prec));
    else if ('dilu'.includes(conv)) s = String(Math.trunc(Number(v)));
    else if (conv === 'x' || conv === 'X') { s = Math.trunc(Number(v)).toString(16); if (conv === 'X') s = s.toUpperCase(); }
    else if (conv === 'c') s = typeof v === 'number' ? String.fromCharCode(v) : String(v);
    else s = String(v);
    const w = Math.abs(Number(width) || 0);
    return width.startsWith('-') ? s.padEnd(w) : s.padStart(w);
  });
}

/**
 * Runs one sketch. `onSerial(text)` receives monitor output; `audio` (optional)
 * plays tones. Call stop() to end it; run() resolves when it has ended.
 */
export class Sketch {
  constructor(source, { hw, onSerial = () => {}, audio = null, now = () => performance.now() }) {
    this.hw = hw;
    this.onSerial = onSerial;
    this.audio = audio;
    this.now = now;
    this.stopped = false;
    this.timers = new Set();
    this.wakers = new Set();
    this.yields = 0;
    this.compiled = transpile(source);
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const wake of this.wakers) wake();
    this.wakers.clear();
    for (const [gpio, p] of this.hw.pins) if (p.tone) { p.tone = 0; this.audio?.stop(gpio); }
  }

  sleep(ms) {
    if (this.stopped) throw new StopSignal();
    return new Promise((resolve, reject) => {
      const wake = () => { this.timers.delete(t); this.wakers.delete(wake); this.stopped ? reject(new StopSignal()) : resolve(); };
      const t = setTimeout(wake, Math.max(0, ms));
      this.timers.add(t);
      this.wakers.add(wake);
    });
  }

  api() {
    const hw = this.hw;
    const sk = this;
    const start = this.now();
    const write = (gpio, value) => {
      const p = hw.pin(gpio);
      const v = value ? 1 : 0;
      if (v !== p.value || p.pwm !== null) hw.edges.set(gpio, (hw.edges.get(gpio) ?? 0) + 1);
      p.value = v; p.pwm = null; hw.version++;
    };
    const pwm = (gpio, duty) => {
      const p = hw.pin(gpio);
      p.mode = 'OUTPUT';
      p.pwm = Math.max(0, Math.min(255, duty));
      const seen = hw.pwmSeen.get(gpio) ?? { min: Infinity, max: -Infinity };
      seen.min = Math.min(seen.min, p.pwm); seen.max = Math.max(seen.max, p.pwm);
      hw.pwmSeen.set(gpio, seen);
      hw.version++;
    };
    const tone = (gpio, freq, duration) => {
      hw.pin(gpio).tone = freq;
      if (freq) hw.tonesSeen.add(Math.round(freq));
      hw.version++;
      sk.audio?.play(gpio, freq);
      if (duration) {
        const t = setTimeout(() => { sk.timers.delete(t); if (hw.pin(gpio).tone === freq) noTone(gpio); }, duration);
        sk.timers.add(t);
      }
    };
    const noTone = (gpio) => { hw.pin(gpio).tone = 0; hw.version++; sk.audio?.stop(gpio); };
    const digitalRead = (gpio) => {
      const src = hw.digital.get(gpio);
      if (src) return src() ? 1 : 0;
      const p = hw.pin(gpio);
      if (p.mode === 'OUTPUT') return p.value;
      return p.mode === 'INPUT_PULLUP' ? 1 : 0;
    };
    const analogRead = (gpio) => Math.max(0, Math.min(4095, Math.round(hw.analog.get(gpio)?.() ?? 0)));

    class Servo {
      constructor() { this.gpio = null; this.angle = 90; }
      setPeriodHertz() {}
      attach(gpio) { this.gpio = gpio; hw.pin(gpio).mode = 'OUTPUT'; hw.servos.set(gpio, this.angle); hw.version++; return 1; }
      detach() { if (this.gpio !== null) hw.servos.delete(this.gpio); this.gpio = null; }
      attached() { return this.gpio !== null; }
      write(angle) {
        this.angle = Math.max(0, Math.min(180, Number(angle)));
        hw.servoSeen.min = Math.min(hw.servoSeen.min, this.angle); hw.servoSeen.max = Math.max(hw.servoSeen.max, this.angle);
        if (this.gpio !== null) { hw.servos.set(this.gpio, this.angle); hw.version++; } }
      read() { return Math.round(this.angle); }
    }

    class Adafruit_SSD1306 {
      constructor(w = 128, h = 64) { this.screen = new OledCanvas(w, h); }
      begin() { hw.oled = this.screen; hw.version++; return true; }
      clearDisplay() { this.screen.clear(); }
      display() { this.screen.show(); hw.version++; }
      setTextSize(s) { this.screen.size = Math.max(1, Math.trunc(s)); }
      setTextColor() {}
      setCursor(x, y) { this.screen.cursor = [x, y]; }
      print(v, d) { this.screen.text(formatNumber(v, d)); }
      println(v = '', d) { this.screen.text(`${formatNumber(v, d)}\n`); }
      drawRect(x, y, w, h) { this.screen.ops.push(['rect', x, y, w, h]); }
      fillRect(x, y, w, h) { this.screen.ops.push(['fill', x, y, w, h]); }
      drawLine(x0, y0, x1, y1) { this.screen.ops.push(['line', x0, y0, x1, y1]); }
      drawCircle(x, y, r) { this.screen.ops.push(['circle', x, y, r]); }
    }

    const Serial = {
      begin() {},
      print: (v, d) => sk.onSerial(formatNumber(v, d)),
      println: (v = '', d) => sk.onSerial(`${formatNumber(v, d)}\n`),
      printf: (fmt, ...a) => sk.onSerial(printf(fmt, ...a)),
      available: () => 0,
      read: () => -1,
    };

    return {
      HIGH: 1, LOW: 0, INPUT: 'INPUT', OUTPUT: 'OUTPUT', INPUT_PULLUP: 'INPUT_PULLUP', INPUT_PULLDOWN: 'INPUT_PULLDOWN',
      LED_BUILTIN: 2, true: true, false: false, PI: Math.PI,
      SSD1306_SWITCHCAPVCC: 2, SSD1306_WHITE: 1, SSD1306_BLACK: 0, WHITE: 1, BLACK: 0, Wire: {},
      T0: 4, T2: 2, T3: 15, T4: 13, T5: 12, T6: 14, T7: 27, T8: 33, T9: 32,
      Serial, Servo, Adafruit_SSD1306,
      F: (s) => s,
      String: (v, d) => formatNumber(v, d),
      pinMode: (gpio, mode) => { hw.pin(gpio).mode = mode; hw.version++; },
      digitalWrite: write,
      digitalRead,
      analogWrite: (gpio, duty) => pwm(gpio, Math.trunc(duty)),
      ledcAttach: (gpio, freq, bits = 8) => { hw.ledcBits.set(gpio, bits); hw.pin(gpio).mode = 'OUTPUT'; hw.version++; return true; },
      ledcWrite: (gpio, duty) => { const bits = hw.ledcBits.get(gpio) ?? 8; pwm(gpio, (duty / (2 ** bits - 1)) * 255); return true; },
      ledcWriteTone: (gpio, freq) => (freq ? tone(gpio, freq) : noTone(gpio)),
      analogRead,
      analogReadMilliVolts: (gpio) => Math.round(analogRead(gpio) * 3300 / 4095),
      analogReadResolution() {}, analogSetAttenuation() {},
      touchRead: (gpio) => (hw.touch.get(gpio)?.() ? 12 : 72),
      tone, noTone,
      millis: () => Math.floor(sk.now() - start),
      micros: () => Math.floor((sk.now() - start) * 1000),
      delay: (ms) => sk.sleep(ms),
      delayMicroseconds: async () => { await sk.sleep(0); },
      pulseIn: async (gpio) => {
        const cm = hw.echo.get(gpio)?.();
        await sk.sleep(Math.min(30, (cm ?? 0) / 17));
        return cm === undefined || cm > 400 ? 0 : Math.round(cm * 58.3);
      },
      map: (x, a, b, c, d) => Math.trunc((x - a) * (d - c) / (b - a) + c),
      constrain: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
      abs: Math.abs, min: Math.min, max: Math.max, sqrt: Math.sqrt, pow: Math.pow,
      sin: Math.sin, cos: Math.cos, round: Math.round, floor: Math.floor, ceil: Math.ceil,
      random: (a, b) => (b === undefined ? Math.floor(Math.random() * a) : a + Math.floor(Math.random() * (b - a))),
      randomSeed() {},
      __int: (v) => (typeof v === 'number' ? Math.trunc(v) : v),
      __yield: async () => {
        if (sk.stopped) throw new StopSignal();
        if (++sk.yields % 64 === 0) await sk.sleep(0);
      },
    };
  }

  /** Compiles and runs setup() once, then loop() until stopped. */
  async run() {
    let program;
    try {
      // `with` resolves Arduino names (pinMode, HIGH, Serial…) from the API object.
      // eslint-disable-next-line no-new-func
      const factory = new Function('__api', `with (__api) {\n${this.compiled.code}\nreturn {
        setup: typeof setup === 'function' ? setup : null,
        loop: typeof loop === 'function' ? loop : null };\n}`);
      program = factory(this.api());
    } catch (err) {
      throw Object.assign(new Error(`Compile error: ${err.message}`), { compile: true });
    }
    if (!program.loop) throw Object.assign(new Error('Compile error: the sketch needs a loop() function.'), { compile: true });
    try {
      if (program.setup) await program.setup();
      while (!this.stopped) {
        await program.loop();
        await this.sleep(0);
      }
    } catch (err) {
      if (!(err instanceof StopSignal)) throw err;
    }
  }
}

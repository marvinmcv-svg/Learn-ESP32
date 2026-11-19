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
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v !== 'number') return String(v);
  if (Number.isInteger(v) && (digits === 2 || digits === 8 || digits === 16)) {
    return (v < 0 ? v >>> 0 : v).toString(digits).toUpperCase();
  }
  if (Number.isInteger(v) && digits === 10) return String(v);
  if (digits !== undefined) return v.toFixed(digits);
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

const wrapInt = (bits, signed) => (v) => {
  if (typeof v !== 'number') v = Number(v) || 0;
  if (!Number.isFinite(v)) return 0;
  const t = BigInt.asUintN(bits, BigInt(Math.trunc(v)));
  const n = Number(t);
  return signed && n >= 2 ** (bits - 1) ? n - 2 ** bits : n;
};
const toCharStr = (v) => (typeof v === 'number' ? String.fromCharCode(((v % 256) + 256) % 256) : String(v ?? '').charAt(0));

// Arduino String methods with no JavaScript equivalent (non-enumerable, prefixed).
if (!String.prototype.__equals) {
  const def = (name, value) => Object.defineProperty(String.prototype, name, { value });
  def('__equals', function equals(o) { return String(this) === String(o); });
  def('__toInt', function toInt() { const n = parseInt(this, 10); return Number.isNaN(n) ? 0 : n; });
  def('__toFloat', function toFloat() { const n = parseFloat(this); return Number.isNaN(n) ? 0 : n; });
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
    this.serialIn = '';
    this.interrupts = new Map(); // gpio -> { fn, mode, last }
    this.source = source;
    this.compiled = transpile(source);
  }

  /** Text typed into the Serial Monitor's send box. */
  sendSerial(text) { this.serialIn += text; }

  stop() {
    this.stopped = true;
    clearInterval(this.irqTimer);
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

    const takeUntil = (stop) => {
      const i = sk.serialIn.indexOf(stop);
      const end = i === -1 ? sk.serialIn.length : i;
      const out = sk.serialIn.slice(0, end);
      sk.serialIn = sk.serialIn.slice(i === -1 ? end : end + 1);
      return out;
    };
    const Serial = {
      begin() {}, end() {}, flush() {}, setTimeout() {},
      print: (v, d) => sk.onSerial(formatNumber(v, d)),
      println: (v = '', d) => sk.onSerial(`${formatNumber(v, d)}\n`),
      printf: (fmt, ...a) => sk.onSerial(printf(fmt, ...a)),
      write: (v) => sk.onSerial(typeof v === 'number' ? String.fromCharCode(v) : String(v)),
      available: () => sk.serialIn.length,
      read: () => { if (!sk.serialIn) return -1; const c = sk.serialIn.charCodeAt(0); sk.serialIn = sk.serialIn.slice(1); return c; },
      peek: () => (sk.serialIn ? sk.serialIn.charCodeAt(0) : -1),
      readString: () => takeUntil('\u0000'),
      readStringUntil: (c) => takeUntil(typeof c === 'number' ? String.fromCharCode(c) : c),
      parseInt: () => { const m = sk.serialIn.match(/-?\d+/); if (!m) return 0; sk.serialIn = sk.serialIn.slice(m.index + m[0].length); return Number(m[0]); },
      parseFloat: () => { const m = sk.serialIn.match(/-?\d+(\.\d+)?/); if (!m) return 0; sk.serialIn = sk.serialIn.slice(m.index + m[0].length); return Number(m[0]); },
    };
    const attachInterrupt = (gpio, fn, mode) => {
      sk.interrupts.set(gpio, { fn, mode, last: digitalRead(gpio) });
      if (!sk.irqTimer) {
        // Inputs change from the UI, so sample them often and fire on edges.
        sk.irqTimer = setInterval(() => {
          if (sk.stopped) return;
          for (const [pin, irq] of sk.interrupts) {
            const now = digitalRead(pin);
            const rising = irq.last === 0 && now === 1;
            const falling = irq.last === 1 && now === 0;
            irq.last = now;
            if ((irq.mode === 'RISING' && rising) || (irq.mode === 'FALLING' && falling) || (irq.mode === 'CHANGE' && (rising || falling))
              || (irq.mode === 'LOW' && now === 0) || (irq.mode === 'HIGH' && now === 1)) {
              Promise.resolve().then(() => irq.fn()).catch((e) => { if (!(e instanceof StopSignal)) sk.onSerial(`\n[ISR error] ${e.message}\n`); });
            }
          }
        }, 2);
      }
    };

    return {
      HIGH: 1, LOW: 0, INPUT: 'INPUT', OUTPUT: 'OUTPUT', INPUT_PULLUP: 'INPUT_PULLUP', INPUT_PULLDOWN: 'INPUT_PULLDOWN',
      LED_BUILTIN: 2, true: true, false: false, PI: Math.PI,
      SSD1306_SWITCHCAPVCC: 2, SSD1306_WHITE: 1, SSD1306_BLACK: 0, WHITE: 1, BLACK: 0, Wire: {},
      T0: 4, T2: 2, T3: 15, T4: 13, T5: 12, T6: 14, T7: 27, T8: 33, T9: 32,
      DEC: 10, HEX: 16, OCT: 8, BIN: 2, RISING: 'RISING', FALLING: 'FALLING', CHANGE: 'CHANGE',
      A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, A10: 4, A12: 2, A13: 15, A14: 13, A15: 12, A16: 14, A17: 27, A18: 25, A19: 26, DAC1: 25, DAC2: 26,
      Serial, Servo, Adafruit_SSD1306,
      attachInterrupt, detachInterrupt: (gpio) => sk.interrupts.delete(gpio),
      digitalPinToInterrupt: (g) => g, interrupts() {}, noInterrupts() {},
      dacWrite: (gpio, v) => pwm(gpio, Math.max(0, Math.min(255, Math.trunc(v)))),
      bitRead: (x, n) => (x >> n) & 1, bitSet: (x, n) => x | (1 << n), bitClear: (x, n) => x & ~(1 << n),
      bitWrite: (x, n, b) => (b ? x | (1 << n) : x & ~(1 << n)), bit: (n) => 1 << n,
      lowByte: (x) => x & 0xff, highByte: (x) => (x >> 8) & 0xff,
      sq: (x) => x * x, radians: (d) => d * Math.PI / 180, degrees: (r) => r * 180 / Math.PI,
      isnan: Number.isNaN, isinf: (x) => !Number.isFinite(x) && !Number.isNaN(x), fabs: Math.abs, log: Math.log, exp: Math.exp, tan: Math.tan, atan2: Math.atan2,
      yield: async () => { await sk.sleep(0); },
      __u8: wrapInt(8, false), __i8: wrapInt(8, true), __u16: wrapInt(16, false), __i16: wrapInt(16, true),
      __u32: wrapInt(32, false), __i32: wrapInt(32, true), __char: toCharStr,
      __idiv: (a, b) => { if (b === 0) throw new Error('Division by zero (the real ESP32 would crash and reboot here)'); return Math.trunc(a / b); },

      F: (s) => s,
      String: (v = '', d) => formatNumber(v, d),
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
    let factory;
    try {
      // `with` resolves Arduino names (pinMode, HIGH, Serial…) from the API object.
      factory = new AsyncFunction('__api', `with (__api) {\n${this.compiled.code}\nreturn {
        setup: typeof setup === 'function' ? setup : null,
        loop: typeof loop === 'function' ? loop : null };\n}`);
    } catch (err) {
      const line = await syntaxErrorLine(this.compiled.code);
      throw sketchError(`Compile error: ${friendly(err.message)}`, line, true);
    }
    let program;
    try {
      program = await factory(this.api());
      if (!program.loop) throw sketchError('Compile error: the sketch needs a loop() function.', null, true);
      if (program.setup) await program.setup();
      while (!this.stopped) {
        await program.loop();
        await this.sleep(0);
      }
    } catch (err) {
      if (err instanceof StopSignal) return;
      if (err.sketch) throw err;
      throw sketchError(`Runtime error: ${friendly(err.message)}`, runtimeLine(err), false);
    } finally {
      clearInterval(this.irqTimer);
    }
  }
}

const AsyncFunction = (async () => {}).constructor;

function sketchError(message, line, compile) {
  return Object.assign(new Error(line ? `${message} (line ${line})` : message), { compile, line, sketch: true });
}

const NOT_SIMULATED = /^(WiFi|WiFiClient|WiFiServer|WebServer|HTTPClient|BLEDevice|BluetoothSerial|Preferences|EEPROM|SPIFFS|LittleFS|SD|DHT|esp_deep_sleep_start|xTaskCreate|xTaskCreatePinnedToCore|Adafruit_NeoPixel|LiquidCrystal_I2C|SPI)$/;

/** Rewrites JavaScript engine messages into something a beginner can act on. */
export function friendly(msg) {
  let m = msg.match(/^(\w+) is not defined$/);
  if (m) {
    if (NOT_SIMULATED.test(m[1])) return `${m[1]} is not simulated here yet. It works on a real board, but this sandbox only models the parts on the breadboard.`;
    return `'${m[1]}' was not declared. Check the spelling and capitalisation, or declare it before you use it.`;
  }
  m = msg.match(/^(.+?) is not a function$/);
  if (m) return `'${m[1].replace(/^__api\./, '')}' is not a function the simulator knows. Check the spelling, or define it.`;
  if (/Unexpected end of input/.test(msg)) return 'the sketch ends too early. Is a closing } or ) missing?';
  if (/missing \) after argument list/.test(msg)) return 'a ")" is missing in a function call.';
  if (/Unexpected token '}'/.test(msg)) return 'unexpected "}". Check for a missing semicolon or an extra brace.';
  if (/Unexpected identifier/.test(msg)) return `${msg}. A semicolon may be missing at the end of the previous statement.`;
  if (/Cannot read properties of undefined/.test(msg)) return `${msg}. An array index may be out of range.`;
  return msg;
}

/** Sketch line of a runtime error, from the engine's stack trace. */
function runtimeLine(err) {
  const m = String(err.stack ?? '').match(/(?:<anonymous>|anonymous):(\d+):\d+/);
  if (!m) return null;
  const line = Number(m[1]) - 3; // async function header (2 lines) + `with` line
  return line > 0 ? line : null;
}

/** Locates a syntax error precisely with a real JavaScript parser (loaded on demand). */
async function syntaxErrorLine(code) {
  try {
    const { parse } = await import('acorn');
    parse(`(async function (__api) { with (__api) {\n${code}\n} })`, { ecmaVersion: 'latest', sourceType: 'script' });
  } catch (e) {
    if (e.loc) return Math.max(1, e.loc.line - 1);
  }
  return null;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hardware, Sketch } from '../src/sim/runtime.js';
import { transpile } from '../src/sim/transpile.js';
import { bindCircuit, InputStore } from '../src/circuit.js';
import { LESSONS, PLAYGROUND } from '../src/lessons.js';

async function runFor(lesson, ms, drive = () => {}) {
  const hw = new Hardware();
  const store = new InputStore();
  bindCircuit(lesson.parts, hw, store);
  let serial = '';
  const sketch = new Sketch(lesson.code, { hw, onSerial: (t) => { serial += t; } });
  const done = sketch.run();
  const timer = setInterval(() => drive(store), 40);
  await new Promise((r) => setTimeout(r, ms));
  clearInterval(timer);
  sketch.stop();
  await done;
  const ctx = { hw, serial, lines: serial.split('\n').length - 1, changes: (id) => store.changes(id) };
  return ctx;
}

for (const lesson of [...LESSONS, PLAYGROUND]) {
  test(`${lesson.id} transpiles to valid JavaScript`, () => {
    const { code } = transpile(lesson.code);
    // eslint-disable-next-line no-new-func
    assert.doesNotThrow(() => new Function('__api', `with (__api) { ${code} }`), code);
  });
}

// Drives each lesson's inputs the way a learner would, then checks its goal.
const wiggle = (store, ids) => {
  const t = Date.now() / 1000;
  for (const id of ids) {
    const kind = id.split(':')[1];
    const key = id.split(':')[0];
    if (kind === 'press') store.set(key, Math.floor(t * 6) % 2 === 0);
    else if (kind === 'turn') store.set(key, (Math.sin(t * 9) + 1) / 2);
    else if (kind === 'dist') store.set(key, 5 + ((Math.sin(t * 9) + 1) / 2) * 100);
  }
};

const DRIVERS = {
  button: ['btn:press'],
  toggle: ['btn:press'],
  potentiometer: ['pot:turn'],
  dimmer: ['pot:turn'],
  'night-light': ['ldr:turn'],
  'knob-servo': ['pot:turn'],
  ultrasonic: ['sonar:dist'],
  touch: ['pad:press'],
  dashboard: ['sonar:dist'],
};

const LONG = { 'traffic-light': null, buzzer: 2600, servo: 2200 };

for (const lesson of LESSONS) {
  if (LONG[lesson.id] === null) continue; // too slow in real time; checked by transpile test
  test(`${lesson.id} reaches its goal`, async () => {
    const ctx = await runFor(lesson, LONG[lesson.id] ?? 3200, (s) => wiggle(s, DRIVERS[lesson.id] ?? []));
    assert.ok(lesson.goal.check(ctx), `goal not met; serial:\n${ctx.serial.slice(-400)}`);
  });
}

test('declarations with commas in the initialiser stay intact', async () => {
  const lesson = { parts: [], code: 'void setup(){ int a = map(50, 0, 100, 0, 10), b = 3; Serial.println(a + b); }\nvoid loop(){ delay(1000); }' };
  const ctx = await runFor(lesson, 50);
  assert.equal(ctx.serial, '8\n');
});

test('integer variables truncate like C', async () => {
  const lesson = { parts: [], code: 'int x = 7 / 2; float y = 7 / 2.0;\nvoid setup(){ Serial.println(x); Serial.println(y); }\nvoid loop(){ delay(1000); }' };
  const ctx = await runFor(lesson, 50);
  assert.equal(ctx.serial, '3\n3.50\n');
});

test('for-loop increments are not rewritten across statements', () => {
  const { code } = transpile('void loop(){ for (int v = 0; v <= 255; v += 5) { analogWrite(2, v); } }');
  assert.match(code, /v = __i32\(v \+ \(5\)\)\) \{ await __yield\(\); analogWrite\(2, v\);/);
});

// ---- C/Arduino semantics the simulator must get right ----
async function serialOf(code, { input = '', ms = 200 } = {}) {
  const hw = new Hardware();
  let out = '';
  const sketch = new Sketch(code, { hw, onSerial: (t) => { out += t; } });
  if (input) sketch.sendSerial(input);
  let error = null;
  const done = sketch.run().catch((e) => { error = e; });
  await new Promise((r) => setTimeout(r, ms));
  sketch.stop();
  const hung = await Promise.race([done.then(() => false), new Promise((r) => setTimeout(() => r(true), 500))]);
  return { out, error, hung };
}

const SEMANTICS = {
  'integer division truncates': ['void setup(){ int a = 7, b = 2; Serial.println(a / b); float f = a / 2.0; Serial.println(f); Serial.println(7 / 2); Serial.println("km/h 3/4"); } void loop(){ delay(1000); }', '3\n3.50\n3\nkm/h 3/4\n'],
  'byte wraps at 256': ['byte b = 250; void setup(){ b = b + 10; Serial.println(b); b++; Serial.println(b); } void loop(){ delay(1000); }', '4\n5\n'],
  'int and unsigned long wrap at 32 bits': ['int x = 2147483647; void setup(){ x = x + 1; Serial.println(x); unsigned long u = 0; u = u - 1; Serial.println(u); } void loop(){ delay(1000); }', '-2147483648\n4294967295\n'],
  'static locals keep their value': ['void loop(){ static int n = 0; n++; Serial.println(n); if (n == 3) delay(100000); } void setup(){}', '1\n2\n3\n'],
  'function prototypes': ['void blink(int t);\nvoid setup(){ blink(1); Serial.println("ok"); }\nvoid loop(){ delay(1000); }\nvoid blink(int t){ delay(t); }', 'ok\n'],
  '#define macros': ['#define SQ(x) ((x)*(x))\n#define DEBUG\nvoid setup(){ Serial.println(SQ(3) + DEBUG); } void loop(){ delay(1000); }', '10\n'],
  'structs': ['struct P { int x; int y; }; P p = {1,2}; P q; void setup(){ q.x = 5; Serial.println(p.y + q.x); } void loop(){ delay(1000); }', '7\n'],
  'enums': ['enum State { IDLE, RUN, DONE = 5, AFTER }; State s = RUN; void setup(){ Serial.println(s); Serial.println(AFTER); } void loop(){ delay(1000); }', '1\n6\n'],
  'String methods': ['void setup(){ String s = "abc"; s += "d"; Serial.println(s.length()); s.toUpperCase(); Serial.println(s); Serial.println(String("42").toInt() + 1); } void loop(){ delay(1000); }', '4\nABCD\n43\n'],
  'print bases and digits': ['void setup(){ Serial.println(255, HEX); Serial.println(5, BIN); Serial.println(3.14159, 3); } void loop(){ delay(1000); }', 'FF\n101\n3.142\n'],
  'do-while loops': ['void setup(){ int i = 0; do { i++; } while (i < 3); Serial.println(i); } void loop(){ delay(1000); }', '3\n'],
};
for (const [name, [code, want]] of Object.entries(SEMANTICS)) {
  test(`C semantics: ${name}`, async () => {
    const r = await serialOf(code);
    assert.equal(r.error, null, r.error?.message);
    assert.equal(r.out.slice(0, want.length), want);
  });
}

test('serial input reaches Serial.read() as chars', async () => {
  const r = await serialOf("void setup(){} void loop(){ if (Serial.available() > 0) { char c = Serial.read(); Serial.print(c); if (c >= '0' && c <= '9') Serial.print(c - '0'); } }", { input: 'h5' });
  assert.equal(r.out, 'h55');
});

test('readStringUntil + equals handles commands', async () => {
  const r = await serialOf("void setup(){} void loop(){ if (Serial.available()) { String cmd = Serial.readStringUntil('\\n'); cmd.trim(); if (cmd.equals(\"on\")) Serial.println(\"LED ON\"); } }", { input: '  on \n' });
  assert.equal(r.out, 'LED ON\n');
});

for (const [name, code] of Object.entries({
  'empty-body busy wait': 'void setup(){ pinMode(19, INPUT_PULLUP); while (digitalRead(19) == HIGH) ; } void loop(){}',
  'brace-less infinite for': 'void setup(){} void loop(){ for(;;) digitalWrite(2, HIGH); }',
  'brace-less while': 'void setup(){ int i = 0; while (true) i++; } void loop(){}',
})) {
  test(`stop always works: ${name}`, async () => {
    const r = await serialOf(code);
    assert.equal(r.hung, false);
  });
}

test('errors carry the sketch line number', async () => {
  const runtime = await serialOf('void setup(){\n  Serial.println(1);\n  fooBar();\n} void loop(){}');
  assert.equal(runtime.error.line, 3);
  assert.match(runtime.error.message, /'fooBar' was not declared/);
  const syntax = await serialOf('void setup() {\n  int x = 1;\n  Serial.println(x\n}\nvoid loop() {}');
  assert.ok(syntax.error.compile);
  assert.ok([3, 4].includes(syntax.error.line), `line ${syntax.error.line}`);
  const wifi = await serialOf('#include <WiFi.h>\nvoid setup(){ WiFi.begin("a", "b"); } void loop(){}');
  assert.match(wifi.error.message, /not simulated here yet/);
});

test('interrupts fire on button edges', async () => {
  const hw = new Hardware();
  const store = new InputStore();
  bindCircuit([{ type: 'button', id: 'b', pin: 19 }], hw, store);
  let out = '';
  const sk = new Sketch('volatile int n = 0; void IRAM_ATTR isr(){ n++; } void setup(){ pinMode(19, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(19), isr, FALLING); } void loop(){ Serial.println(n); delay(30); }', { hw, onSerial: (t) => { out += t; } });
  const done = sk.run();
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 30)); store.set('b', true);
    await new Promise((r) => setTimeout(r, 30)); store.set('b', false);
  }
  await new Promise((r) => setTimeout(r, 60));
  sk.stop(); await done;
  assert.equal(out.trim().split('\n').pop(), '3');
});

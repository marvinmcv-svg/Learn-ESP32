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
  assert.match(code, /v = __int\(v \+ \(5\)\)\) \{ await __yield\(\); analogWrite\(2, v\);/);
});

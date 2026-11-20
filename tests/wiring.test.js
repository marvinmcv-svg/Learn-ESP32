import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, matchesCode, solutionWires, allTerminals } from '../src/wiring.js';
import { LESSONS, PLAYGROUND } from '../src/lessons.js';

const W = (a, b) => ({ a: { t: a }, b: { t: b } });
const LED = [{ type: 'led', id: 'led', pin: 26, color: 'red' }];
const texts = (r) => r.issues.map((i) => `${i.level}: ${i.text}`).join('\n');

for (const lesson of [...LESSONS, PLAYGROUND]) {
  if (!lesson.parts.length) continue;
  test(`${lesson.id}: the reference wiring is valid and matches the code`, () => {
    const r = analyze(lesson.parts, solutionWires(lesson.parts), { wifi: !!lesson.wifi });
    assert.ok(r.ok, texts(r));
    assert.ok(matchesCode(lesson.parts, r), JSON.stringify(r.effective));
  });
}

test('every terminal has a unique id', () => {
  const ids = allTerminals(PLAYGROUND.parts).map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('nothing wired: parts are open, no false alarms', () => {
  const r = analyze(LED, []);
  assert.equal(r.effective[0].state, 'open');
  assert.equal(r.issues.length, 0);
});

test('LED straight to the GPIO, skipping the resistor', () => {
  const r = analyze(LED, [W('board:D26', 'led.a'), W('led.k', 'rail:gnd.f')]);
  assert.equal(r.effective[0].state, 'no-resistor');
  assert.match(texts(r), /without its resistor/);
});

test('LED backwards', () => {
  const r = analyze(LED, [W('led.r', 'rail:gnd.f'), W('led.k', 'board:D26')]);
  assert.equal(r.effective[0].state, 'reversed');
  assert.match(texts(r), /backwards/);
});

test('LED on an input-only pin', () => {
  const r = analyze(LED, [W('board:D34', 'led.r'), W('led.k', 'rail:gnd.b')]);
  assert.equal(r.effective[0].pin, null);
  assert.match(texts(r), /input-only/);
});

test('LED on the wrong (but valid) pin works, yet does not match the code', () => {
  const r = analyze(LED, [W('board:D25', 'led.r'), W('led.k', 'rail:gnd.f')]);
  assert.ok(r.ok);
  assert.equal(r.effective[0].pin, 25);
  assert.equal(matchesCode(LED, r), false);
});

test('shorts are caught', () => {
  assert.match(texts(analyze([], [W('board:3V3', 'board:GND.L')])), /Short circuit/);
  assert.match(texts(analyze([], [W('board:D26', 'rail:gnd.f')])), /straight to GND/);
});

test('button to 3.3 V needs a pull-down and reads HIGH', () => {
  const r = analyze([{ type: 'button', id: 'btn', pin: 19 }], [W('board:D19', 'btn.a'), W('btn.b', 'rail:3v3.f')]);
  assert.equal(r.effective[0].to, 'vcc');
  assert.match(texts(r), /INPUT_PULLDOWN/);
});

test('potentiometer on a pin without an ADC', () => {
  const r = analyze([{ type: 'pot', id: 'pot', pin: 34 }], [W('pot.g', 'rail:gnd.f'), W('pot.w', 'board:D19'), W('pot.v', 'rail:3v3.f')]);
  assert.match(texts(r), /cannot read analog/);
});

test('potentiometer with power legs swapped reads in reverse', () => {
  const r = analyze([{ type: 'pot', id: 'pot', pin: 34 }], [W('pot.v', 'rail:gnd.f'), W('pot.w', 'board:D34'), W('pot.g', 'rail:3v3.f')]);
  assert.ok(r.ok, texts(r));
  assert.equal(r.effective[0].reversed, true);
});

test('ADC2 pin is flagged in a Wi-Fi lesson', () => {
  const r = analyze([{ type: 'pot', id: 'pot', pin: 26 }], [W('pot.g', 'rail:gnd.f'), W('pot.w', 'board:D26'), W('pot.v', 'rail:3v3.f')], { wifi: true });
  assert.match(texts(r), /ADC2/);
});

test('OLED with SDA and SCL swapped', () => {
  const r = analyze([{ type: 'oled', id: 'oled' }], [W('oled.gnd', 'rail:gnd.f'), W('oled.vcc', 'rail:3v3.f'), W('oled.scl', 'board:D21'), W('oled.sda', 'board:D22')]);
  assert.match(texts(r), /swapped/);
});

test('servo on 3.3 V warns but works', () => {
  const r = analyze([{ type: 'servo', id: 's', pin: 13 }], [W('s.s', 'board:D13'), W('s.v', 'rail:3v3.f'), W('s.g', 'rail:gnd.f')]);
  assert.ok(r.ok);
  assert.equal(r.effective[0].pin, 13);
  assert.match(texts(r), /jittery/);
});

test('HC-SR04 on 5 V warns about the 5 V echo', () => {
  const parts = [{ type: 'ultrasonic', id: 'u', trig: 5, echo: 18 }];
  const r = analyze(parts, solutionWires(parts));
  assert.match(texts(r), /divider/);
});

test('touch pad on a non-touch pin', () => {
  const r = analyze([{ type: 'touch', id: 'pad', pin: 4 }], [W('pad.pad', 'board:D19')]);
  assert.match(texts(r), /not a touch pin/);
});

test('strapping pin 12 gets a boot warning', () => {
  const r = analyze(LED, [W('board:D12', 'led.r'), W('led.k', 'rail:gnd.f')]);
  assert.match(texts(r), /strapping/);
});

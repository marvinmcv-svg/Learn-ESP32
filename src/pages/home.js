import { LESSONS, TRACKS } from '../lessons.js';
import { progress } from '../progress.js';
import { icon } from '../ui/icons.js';
import { Hardware, Sketch } from '../sim/runtime.js';
import { bindCircuit, InputStore } from '../circuit.js';

const HERO_PARTS = [
  { type: 'led', id: 'r', pin: 26, color: 'red' },
  { type: 'led', id: 'a', pin: 27, color: 'amber' },
  { type: 'led', id: 'g', pin: 14, color: 'green' },
  { type: 'servo', id: 's', pin: 13 },
];
const HERO_CODE = `
#include <ESP32Servo.h>
Servo arm;
int pins[] = { 14, 27, 26 };
void setup() {
  for (int i = 0; i < 3; i++) pinMode(pins[i], OUTPUT);
  arm.attach(13);
}
void loop() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(2, i == 1);
    for (int k = 0; k < 3; k++) digitalWrite(pins[k], k == i);
    arm.write(i * 90);
    delay(900);
  }
}`;

export function renderHome(root) {
  const done = progress.doneCount();
  const nextLesson = LESSONS.find((l) => !progress.isDone(l.id)) ?? LESSONS[0];
  let n = 0;

  root.innerHTML = `
  <section class="hero">
    <div class="hero-copy">
      <p class="eyebrow">${icon('chip')} Free · runs in your browser · no board needed</p>
      <h1>Learn the <span class="accent">ESP32</span> by building it in 3D.</h1>
      <p class="lede">Write real Arduino code, press Run, and watch LEDs, servos, buzzers and an OLED respond on a virtual breadboard. ${LESSONS.length} hands-on lessons take you from your first blink to a working parking sensor.</p>
      <div class="hero-cta">
        <a class="btn primary lg" href="/learn/${nextLesson.id}">${done ? 'Continue' : 'Start lesson 1'} ${icon('arrow')}</a>
        <a class="btn lg" href="/playground">Open the playground</a>
      </div>
      ${done ? `<div class="progress-line"><div class="bar"><i style="width:${(done / LESSONS.length) * 100}%"></i></div><span>${done} of ${LESSONS.length} lessons complete</span></div>` : ''}
    </div>
    <div class="hero-stage" data-hero role="img" aria-label="Animated 3D ESP32 on a breadboard running a traffic-light sketch"></div>
  </section>

  <section class="features">
    <div class="feature"><b>Real sketches</b><p>The same <code>setup()</code> and <code>loop()</code> you would flash to a board, so everything carries over.</p></div>
    <div class="feature"><b>A bench you can touch</b><p>Press buttons, turn knobs, dim the room and move obstacles right in the 3D scene.</p></div>
    <div class="feature"><b>Checks your work</b><p>Each lesson has a goal the simulator verifies while your code runs.</p></div>
    <div class="feature"><b>Hardware-honest</b><p>Safe pins, 3.3 V logic, ADC quirks and wiring tips for when you build it for real.</p></div>
  </section>

  <section class="curriculum" id="lessons">
    <h2>The course</h2>
    ${TRACKS.map((t) => {
      const items = LESSONS.filter((l) => l.track === t.id);
      return `<div class="track">
        <div class="track-head"><h3>${t.title}</h3><p>${t.blurb}</p></div>
        <div class="cards">${items.map((l) => {
          n = LESSONS.indexOf(l) + 1;
          const isDone = progress.isDone(l.id);
          return `<a class="card${isDone ? ' done' : ''}" href="/learn/${l.id}">
            <span class="card-num">${isDone ? icon('check') : String(n).padStart(2, '0')}</span>
            <span class="card-title">${l.title}</span>
            <span class="card-sum">${l.summary}</span>
            <span class="card-meta">${icon('clock')} ${l.minutes} min${l.parts.length ? ` · ${[...new Set(l.parts.map((p) => partName(p.type)))].join(', ')}` : ''}</span>
          </a>`;
        }).join('')}</div>
      </div>`;
    }).join('')}
  </section>

  <section class="cta-band">
    <div>
      <h2>Know your pins</h2>
      <p>Which pins are input-only? Which ones break booting? Where is touch? The interactive pinout answers it at a glance.</p>
    </div>
    <a class="btn lg" href="/pinout">Explore the pinout ${icon('arrow')}</a>
  </section>`;

  // Hero 3D scene, loaded after first paint.
  let stage = null;
  let sketch = null;
  let disposed = false;
  const heroEl = root.querySelector('[data-hero]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Start the 3D hero once the page is idle, so it never delays first paint.
  const whenIdle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));
  whenIdle(() => import('../scene/stage.js').then(({ Stage }) => {
    if (disposed) return;
    try {
      stage = new Stage(heroEl, { interactive: false, autoRotate: !reduceMotion });
      const hw = new Hardware();
      const store = new InputStore();
      bindCircuit(HERO_PARTS, hw, store);
      stage.setHardware(hw);
      stage.setCircuit(HERO_PARTS, store);
      stage.start();
      sketch = new Sketch(HERO_CODE, { hw });
      sketch.run().catch(() => {});
    } catch {
      heroEl.classList.add('no-webgl');
    }
  }));

  return () => { disposed = true; sketch?.stop(); stage?.dispose(); };
}

function partName(type) {
  return { led: 'LED', button: 'button', pot: 'potentiometer', ldr: 'light sensor', buzzer: 'buzzer', servo: 'servo', ultrasonic: 'HC-SR04', touch: 'touch pad', oled: 'OLED' }[type] ?? type;
}

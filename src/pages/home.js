import { LESSONS, TRACKS } from '../lessons.js';
import { progress } from '../progress.js';
import { Hardware, Sketch } from '../sim/runtime.js';
import { bindCircuit, InputStore } from '../circuit.js';
import { downloadSketch } from '../realworld.js';
import { toast } from '../ui/toast.js';

const PART_NAMES = { led: 'LED', button: 'button', pot: 'potentiometer', ldr: 'light sensor', buzzer: 'buzzer', servo: 'servo', ultrasonic: 'HC-SR04', touch: 'touch pad', oled: 'OLED' };
const LETTERS = 'ABCDEFGH';

const totalMinutes = LESSONS.reduce((n, l) => n + l.minutes, 0);
const totalChallenges = LESSONS.reduce((n, l) => n + (l.challenges?.length ?? 0), 0);

function stars(lesson) {
  const n = lesson.challenges?.length ?? 0;
  if (!n) return '';
  const done = progress.challengesDone(lesson.id);
  return `<span><span class="stars" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i class="${i < done ? 'on' : ''}">■</i>`).join('')}</span> ${done}/${n} challenge${n > 1 ? 's' : ''}</span>`;
}

export function renderHome(root) {
  const done = progress.doneCount();
  const next = LESSONS.find((l) => !progress.isDone(l.id)) ?? LESSONS[0];
  const nextNum = LESSONS.indexOf(next) + 1;

  root.innerHTML = `
  <header class="masthead">
    <div class="masthead-inner">
      <h1>Learn<span>ESP32</span></h1>
      <div class="masthead-copy">
        <p>${LESSONS.length} short lessons. Each one is a real circuit on a breadboard and a sketch you edit and run right here. When the code works, the parts move.</p>
        <div class="masthead-actions">
          <a class="btn primary lg" href="/learn/${next.id}">${done ? `Continue with ${String(nextNum).padStart(2, '0')}` : 'Start with lesson 01'} →</a>
          <a class="btn lg" href="/playground">Open the playground</a>
        </div>
        <dl class="specs">
          <div><dt>Lessons</dt><dd>${LESSONS.length}</dd></div>
          <div><dt>Time</dt><dd>~${Math.round(totalMinutes / 60)} h</dd></div>
          <div><dt>Challenges</dt><dd>${progress.totalChallengesDone()}/${totalChallenges}</dd></div>
          <div><dt>Install</dt><dd>Nothing</dd></div>
        </dl>
      </div>
    </div>
  </header>

  <div class="syllabus-wrap">
    <section class="syllabus" aria-label="Course syllabus">
      ${TRACKS.map((t, ti) => `
        <div class="track-head"><span class="track-letter">${LETTERS[ti]}</span><div><h2>${t.title}</h2><p>${t.blurb}</p></div></div>
        ${LESSONS.filter((l) => l.track === t.id).map((l) => {
          const num = LESSONS.indexOf(l) + 1;
          const isDone = progress.isDone(l.id);
          const parts = [...new Set(l.parts.map((p) => PART_NAMES[p.type]))];
          if (l.wifi) parts.push('Wi-Fi');
          return `<a class="row${isDone ? ' done' : ''}" href="/learn/${l.id}" data-id="${l.id}">
            <span class="row-num">${String(num).padStart(2, '0')}</span>
            <span class="row-title">${l.title}</span>
            <span class="row-state">${isDone ? '✓ done' : `${l.minutes} min`}</span>
            <span class="row-sum">${l.summary}</span>
            <span class="row-meta">${parts.length ? `<span>${parts.join(' · ')}</span>` : '<span>board only</span>'}${stars(l)}</span>
          </a>`;
        }).join('')}`).join('')}
    </section>
    <aside class="preview-col" aria-label="Live preview">
      <div class="preview-frame">
        <div class="preview-stage" data-preview role="img" aria-label="3D preview of the selected lesson's circuit"></div>
        <div class="preview-caption"><b data-cap-title></b><span data-cap-num></span></div>
      </div>
      <p class="preview-note">Point at a lesson to see its circuit running.</p>
    </aside>
  </div>

  <section class="colophon">
    <div><h3>Real Arduino code</h3><p>The same <code>setup()</code> and <code>loop()</code> you would flash to a board. Copy it into the Arduino IDE when you get the hardware.</p></div>
    <div><h3>Checked, not just read</h3><p>Every lesson has a goal and harder challenges. The simulator watches the pins and timing to see whether your code really does it.</p></div>
    <div><h3>Honest about hardware</h3><p>Safe pins, 3.3 V logic, ADC quirks and boot traps, so nothing surprises you on the bench. See the <a href="/pinout">pinout</a>.</p></div>
  </section>

  <section class="backup" aria-label="Your progress">
    <p><b>Your progress lives in this browser.</b> No account needed. Clearing site data erases it, so keep a backup if it matters to you.</p>
    <div class="backup-actions">
      <button type="button" class="btn quiet" data-export>Export backup</button>
      <label class="btn quiet">Import backup<input type="file" accept="application/json,.json" data-import hidden></label>
      <button type="button" class="btn quiet" data-reset-all>Reset</button>
    </div>
  </section>`;

  root.querySelector('[data-export]').addEventListener('click', () => {
    downloadSketch(`learn-esp32-progress-${new Date().toISOString().slice(0, 10)}.json`, progress.exportAll());
  });
  root.querySelector('[data-import]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      progress.importAll(await file.text());
      toast('Progress restored.');
      window.dispatchEvent(new PopStateEvent('popstate')); // re-render via the router (cleans up the 3D preview)
    } catch (err) {
      toast(`Could not import: ${err.message}`);
    }
  });
  root.querySelector('[data-reset-all]').addEventListener('click', () => {
    if (!confirm('Erase all progress, saved code and wiring in this browser? This cannot be undone.')) return;
    progress.reset();
    toast('Progress reset.');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  // ---- live preview: hovering a row runs that lesson's starter sketch ----
  const el = root.querySelector('[data-preview]');
  const capTitle = root.querySelector('[data-cap-title]');
  const capNum = root.querySelector('[data-cap-num]');
  let stage = null;
  let sketch = null;
  let driver = null;
  let current = null;
  let disposed = false;

  const show = (lesson) => {
    if (!lesson || lesson === current) return;
    current = lesson;
    root.querySelectorAll('.row.preview').forEach((r) => r.classList.remove('preview'));
    root.querySelector(`.row[data-id="${lesson.id}"]`)?.classList.add('preview');
    capTitle.textContent = lesson.title;
    capNum.textContent = `${String(LESSONS.indexOf(lesson) + 1).padStart(2, '0')} / ${LESSONS.length}`;
    if (!stage) return;
    sketch?.stop();
    clearInterval(driver);
    const hw = new Hardware();
    const store = new InputStore();
    bindCircuit(lesson.parts, hw, store);
    stage.setHardware(hw);
    stage.setCircuit(lesson.parts, store);
    // Animate the inputs so input-driven lessons visibly do something.
    const t0 = performance.now();
    driver = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      for (const p of lesson.parts) {
        if (p.type === 'button' || p.type === 'touch') store.set(p.id, Math.floor(t / 0.9) % 2 === 1);
        if (p.type === 'pot') store.set(p.id, (Math.sin(t * 1.4) + 1) / 2);
        if (p.type === 'ldr') store.set(p.id, (Math.sin(t * 0.9) + 1) / 2);
        if (p.type === 'ultrasonic') store.set(p.id, 8 + ((Math.sin(t * 0.8) + 1) / 2) * 110);
      }
    }, 60);
    sketch = new Sketch(lesson.code, { hw });
    sketch.run().catch(() => {});
  };

  let hoverTimer = null;
  const onPoint = (e) => {
    const row = e.target.closest('.row[data-id]');
    if (!row) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => show(LESSONS.find((l) => l.id === row.dataset.id)), 120);
  };
  root.querySelector('.syllabus').addEventListener('pointerover', onPoint);
  root.querySelector('.syllabus').addEventListener('focusin', onPoint);

  capTitle.textContent = next.title;
  capNum.textContent = `${String(nextNum).padStart(2, '0')} / ${LESSONS.length}`;
  const wide = window.matchMedia('(min-width: 861px)').matches;
  const whenIdle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));
  if (wide) {
    whenIdle(() => import('../scene/stage.js').then(({ Stage }) => {
      if (disposed) return;
      try {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        stage = new Stage(el, { interactive: false, autoRotate: !reduce });
        stage.start();
        current = null;
        show(next);
      } catch {
        el.classList.add('no-webgl');
      }
    }));
  }

  return () => {
    disposed = true;
    clearTimeout(hoverTimer);
    clearInterval(driver);
    sketch?.stop();
    stage?.dispose();
  };
}

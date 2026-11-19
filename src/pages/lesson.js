import { LESSONS, TRACKS, findLesson, lessonIndex } from '../lessons.js';
import { Hardware, Sketch } from '../sim/runtime.js';
import { bindCircuit, controlsFor, InputStore } from '../circuit.js';
import { Editor } from '../ui/editor.js';
import { progress } from '../progress.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

const MAX_SERIAL = 20000;

export function renderLesson(root, id, audio) {
  const lesson = findLesson(id);
  if (!lesson) return null;
  const idx = lessonIndex(id);
  const track = TRACKS.find((t) => t.id === lesson.track);
  const prev = idx > 0 ? LESSONS[idx - 1] : null;
  const next = idx >= 0 && idx < LESSONS.length - 1 ? LESSONS[idx + 1] : null;
  const isPlayground = !lesson.goal;

  root.innerHTML = `
  <div class="lesson">
    <article class="lesson-text" tabindex="-1">
      <div class="crumbs">${isPlayground ? 'Sandbox' : `${track?.title ?? ''} · Lesson ${idx + 1} of ${LESSONS.length}`}</div>
      <h1>${lesson.title}</h1>
      <p class="summary">${lesson.summary}</p>
      ${lesson.goal ? `<div class="goal" data-goal><span class="goal-icon">${icon('target')}</span><div><div class="goal-label">Goal</div><div>${lesson.goal.text}</div></div></div>` : ''}
      <div class="prose">${lesson.body}</div>
      <nav class="pager">
        ${prev ? `<a class="pager-link" href="/learn/${prev.id}"><span>Previous</span>${prev.title}</a>` : '<span></span>'}
        ${next ? `<a class="pager-link next" href="/learn/${next.id}"><span>Next</span>${next.title}</a>` : (isPlayground ? '' : '<a class="pager-link next" href="/playground"><span>Finished?</span>Open the playground</a>')}
      </nav>
    </article>
    <section class="bench">
      <div class="stage-wrap">
        <div class="stage" data-stage></div>
        <p class="sr-only" data-bench-desc aria-live="polite"></p>
        <div class="stage-hud">
          <span class="status" data-status><i></i><b>Stopped</b></span>
          <button class="icon-btn" data-view title="Reset view" aria-label="Reset view">${icon('focus')}</button>
        </div>
        <div class="stage-hint">Drag to orbit · scroll to zoom${lesson.parts.some((p) => ['button', 'touch', 'pot'].includes(p.type)) ? ' · click parts to use them' : ''}</div>
      </div>
      <div class="toolbar">
        <button class="btn primary" data-run>${icon('play')}<span>Run</span></button>
        <button class="btn" data-reset title="Restore the lesson's original code">${icon('undo')}<span>Reset code</span></button>
        <button class="btn ghost" data-sound aria-pressed="${audio.enabled}" title="Sound for tone()">${icon(audio.enabled ? 'sound' : 'mute')}<span>Sound</span></button>
        <div class="controls" data-controls></div>
      </div>
      <div class="workspace">
        <div class="pane code-pane">
          <div class="pane-head"><span>sketch.ino</span><span class="muted">Ctrl/⌘ + Enter to run</span></div>
          <div data-editor class="editor-host"></div>
        </div>
        <div class="pane serial-pane">
          <div class="pane-head"><span>Serial Monitor <span class="muted">115200 baud</span></span><button class="link-btn" data-clear>Clear</button></div>
          <pre class="serial" data-serial aria-live="polite"></pre>
          <form class="serial-send" data-send>
            <label class="sr-only" for="serial-in">Send to the ESP32</label>
            <input id="serial-in" autocomplete="off" spellcheck="false" placeholder="Send text to Serial (Enter)…" />
            <button class="btn" type="submit">Send</button>
          </form>
        </div>
      </div>
    </section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  const serialEl = $('[data-serial]');
  const runBtn = $('[data-run]');
  const statusEl = $('[data-status]');
  const goalEl = $('[data-goal]');

  const store = new InputStore();
  const hw = new Hardware();
  let sketch = null;
  let serial = '';
  let goalTimer = null;
  let stage = null;
  let disposed = false;

  if (goalEl && progress.isDone(lesson.id)) goalEl.classList.add('done');

  // Serial output is batched to one DOM update per frame.
  let pending = '';
  let flushQueued = false;
  const flush = () => {
    flushQueued = false;
    if (!pending) return;
    const atBottom = serialEl.scrollHeight - serialEl.scrollTop - serialEl.clientHeight < 30;
    serial += pending;
    const last = serialEl.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) last.appendData(pending);
    else serialEl.append(document.createTextNode(pending));
    pending = '';
    // Keep the monitor bounded: drop the oldest output.
    if (serial.length > MAX_SERIAL) {
      serial = serial.slice(-MAX_SERIAL * 0.75);
      serialEl.textContent = serial;
    }
    if (atBottom) serialEl.scrollTop = serialEl.scrollHeight;
  };
  const onSerial = (text) => {
    pending += text;
    if (!flushQueued) { flushQueued = true; requestAnimationFrame(flush); }
  };
  const lineCount = () => (serial + pending).split('\n').length - 1;

  const systemMsg = (text, kind = 'info') => {
    flush();
    const span = document.createElement('span');
    span.className = `sys ${kind}`;
    span.textContent = `${text}\n`;
    serialEl.append(span);
    serialEl.scrollTop = serialEl.scrollHeight;
  };

  const editor = new Editor($('[data-editor]'), {
    value: progress.draft(lesson.id) ?? lesson.code,
    onChange: (code) => progress.saveDraft(lesson.id, code),
    onRun: () => (sketch ? restart() : start()),
  });

  // Inputs under the scene
  const controlsEl = $('[data-controls]');
  for (const c of controlsFor(lesson.parts)) {
    const wrap = document.createElement('div');
    wrap.className = `control ${c.kind}`;
    if (c.kind === 'hold') {
      wrap.innerHTML = `<button class="btn hold" aria-pressed="false">${icon(c.label === 'Button' ? 'press' : 'hand')}<span>${c.label}</span></button>`;
      const b = wrap.querySelector('button');
      const set = (v) => store.set(c.id, v);
      b.addEventListener('pointerdown', (e) => { try { b.setPointerCapture(e.pointerId); } catch { /* synthetic event */ } set(true); });
      b.addEventListener('pointerup', () => set(false));
      b.addEventListener('pointercancel', () => set(false));
      b.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); set(true); } });
      b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') set(false); });
      store.subscribe((id, v) => { if (id === c.id) b.setAttribute('aria-pressed', String(v)); });
    } else {
      wrap.innerHTML = `<label><span>${c.label}</span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}"><output>${c.format(c.value)}</output></label>`;
      const input = wrap.querySelector('input');
      const out = wrap.querySelector('output');
      input.addEventListener('input', () => store.set(c.id, Number(input.value)));
      store.subscribe((id, v) => { if (id === c.id) { if (Number(input.value) !== v) input.value = v; out.textContent = c.format(v); } });
    }
    controlsEl.append(wrap);
  }

  const setStatus = (running) => {
    statusEl.classList.toggle('on', running);
    statusEl.querySelector('b').textContent = running ? 'Running' : 'Stopped';
    runBtn.innerHTML = running ? `${icon('stop')}<span>Stop</span>` : `${icon('play')}<span>Run</span>`;
    runBtn.classList.toggle('danger', running);
  };

  const checkGoal = () => {
    if (!lesson.goal || !sketch) return;
    const ctx = { hw, serial: serial + pending, lines: lineCount(), changes: (k) => store.changes(k) };
    let ok = false;
    try { ok = lesson.goal.check(ctx); } catch { ok = false; }
    if (ok) {
      clearInterval(goalTimer); goalTimer = null;
      goalEl?.classList.add('done');
      if (progress.markDone(lesson.id)) {
        toast(`Goal complete: ${lesson.title}`, next ? { href: `/learn/${next.id}`, label: 'Next lesson' } : null);
      }
    }
  };

  async function start() {
    stop();
    hw.reset();
    store.resetCounts();
    bindCircuit(lesson.parts, hw, store);
    serial = ''; pending = '';
    serialEl.textContent = '';
    editor.markError(null);
    let current;
    try {
      current = new Sketch(editor.value, { hw, onSerial, audio });
    } catch (err) {
      systemMsg(`Compile error: ${err.message}`, 'error');
      return;
    }
    sketch = current;
    setStatus(true);
    systemMsg('▸ Uploading sketch… done. Booting.', 'info');
    goalTimer = setInterval(checkGoal, 200);
    try {
      await current.run();
    } catch (err) {
      if (sketch === current) {
        systemMsg(err.message, 'error');
        if (err.line) editor.markError(err.line);
        if (err.compile) systemMsg('Tip: check the marked line and the one before it for a missing semicolon, bracket or quote.', 'info');
      }
    }
    if (sketch === current) { sketch = null; setStatus(false); clearInterval(goalTimer); }
  }

  function stop() {
    if (!sketch) return;
    const s = sketch;
    sketch = null;
    s.stop();
    clearInterval(goalTimer);
    setStatus(false);
    if (!disposed) systemMsg('■ Stopped.', 'info');
  }

  function restart() { start(); }

  runBtn.addEventListener('click', () => (sketch ? stop() : start()));
  $('[data-reset]').addEventListener('click', () => {
    if (editor.value !== lesson.code && !confirm('Replace your code with the original lesson code?')) return;
    editor.value = lesson.code;
    progress.clearDraft(lesson.id);
  });
  const sendForm = $('[data-send]');
  sendForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = sendForm.querySelector('input');
    if (!input.value) return;
    if (!sketch) { systemMsg('Run the sketch first, then send it text.', 'info'); return; }
    sketch.sendSerial(`${input.value}\n`);
    systemMsg(`→ ${input.value}`, 'info');
    input.value = '';
  });
  $('[data-clear]').addEventListener('click', () => { serial = ''; pending = ''; serialEl.textContent = ''; });
  const soundBtn = $('[data-sound]');
  soundBtn.addEventListener('click', () => {
    audio.setEnabled(!audio.enabled);
    soundBtn.setAttribute('aria-pressed', String(audio.enabled));
    soundBtn.innerHTML = `${icon(audio.enabled ? 'sound' : 'mute')}<span>Sound</span>`;
  });

  // The 3D stage loads lazily so the text and editor appear immediately.
  const stageEl = $('[data-stage]');
  stageEl.innerHTML = '<div class="stage-loading">Loading 3D bench…</div>';
  import('../scene/stage.js').then(({ Stage }) => {
    if (disposed) return;
    stageEl.innerHTML = '';
    try {
      stage = new Stage(stageEl);
      stage.setHardware(hw);
      stage.setCircuit(lesson.parts, store);
      stage.start();
      $('[data-view]').addEventListener('click', () => stage.resetView());
    } catch (err) {
      stageEl.innerHTML = `<div class="stage-loading">3D view unavailable: ${err.message}. The simulator still runs; watch the Serial Monitor.</div>`;
    }
  });

  // Text description of the bench for screen readers, refreshed at most once a second.
  const descEl = $('[data-bench-desc]');
  const describe = () => {
    const bits = [];
    const builtin = hw.level(2);
    if (builtin) bits.push('On-board LED on');
    for (const p of lesson.parts) {
      if (p.type === 'led') {
        const v = hw.level(p.pin);
        bits.push(`${p.color ?? ''} LED on GPIO ${p.pin} ${v === 0 ? 'off' : v === 1 ? 'on' : `at ${Math.round(v * 100)}%`}`);
      } else if (p.type === 'buzzer') {
        const f = hw.toneOf(p.pin);
        bits.push(f ? `Buzzer playing ${Math.round(f)} hertz` : 'Buzzer silent');
      } else if (p.type === 'servo' && hw.servos.has(p.pin)) {
        bits.push(`Servo at ${Math.round(hw.servos.get(p.pin))} degrees`);
      } else if (p.type === 'oled' && hw.oled) {
        const text = hw.oled.textContent().trim();
        if (text) bits.push(`OLED shows: ${text}`);
      }
    }
    return bits.join('. ');
  };
  const descTimer = setInterval(() => {
    if (!sketch) return;
    const text = describe();
    if (text !== descEl.textContent) descEl.textContent = text;
  }, 1000);

  return () => {
    clearInterval(descTimer);
    disposed = true;
    stop();
    for (const gpio of [...hw.pins.keys()]) audio.stop(gpio);
    stage?.dispose();
  };
}

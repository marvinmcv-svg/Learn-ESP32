import { LESSONS, TRACKS, findLesson, lessonIndex } from '../lessons.js';
import { Hardware, Sketch } from '../sim/runtime.js';
import { bindCircuit, controlsFor, InputStore } from '../circuit.js';
import { Observer } from '../sim/observe.js';
import { Editor } from '../ui/editor.js';
import { Phone } from '../ui/phone.js';
import { progress } from '../progress.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { shareUrl, sharedCodeFromUrl } from '../share.js';

const MAX_SERIAL = 20000;
const pad = (n) => String(n).padStart(2, '0');

export function renderLesson(root, id, audio) {
  const lesson = findLesson(id);
  if (!lesson) return null;
  const idx = lessonIndex(id);
  const track = TRACKS.find((t) => t.id === lesson.track);
  const prev = idx > 0 ? LESSONS[idx - 1] : null;
  const next = idx >= 0 && idx < LESSONS.length - 1 ? LESSONS[idx + 1] : null;
  const isPlayground = !lesson.goal;
  const path = isPlayground ? '/playground' : `/learn/${lesson.id}`;

  const checks = [
    ...(lesson.goal ? [{ kind: 'Goal', text: lesson.goal.text, check: lesson.goal.check, key: 'goal' }] : []),
    ...(lesson.challenges ?? []).map((c, i) => ({ kind: `Challenge ${i + 1}`, text: c.text, check: c.check, key: i })),
  ];
  const isPassed = (c) => (c.key === 'goal' ? progress.isDone(lesson.id) : progress.isChallengeDone(lesson.id, c.key));

  root.innerHTML = `
  <div class="lesson">
    <article class="lesson-text" tabindex="-1">
      <div class="crumbs">
        <span class="label">${isPlayground ? 'Sandbox' : `<b>${pad(idx + 1)}</b> / ${LESSONS.length} · ${track?.title ?? ''}`}</span>
        ${isPlayground ? '' : `<span class="step-nav">${prev ? `<a href="/learn/${prev.id}" title="Previous: ${prev.title}" aria-label="Previous lesson">←</a>` : '<span></span>'}${next ? `<a href="/learn/${next.id}" title="Next: ${next.title}" aria-label="Next lesson">→</a>` : ''}</span>`}
      </div>
      <h1>${lesson.title}</h1>
      <p class="summary">${lesson.summary}</p>
      ${checks.length ? `<section class="checks" aria-label="Goal and challenges">
        <div class="checks-head"><span class="label">Test plan</span><span class="label" data-score></span></div>
        ${checks.map((c, i) => `<div class="check${isPassed(c) ? ' pass' : ''}" data-check="${i}"><span class="box" aria-hidden="true"></span><span>${c.text}</span><span class="check-kind">${c.kind}</span></div>`).join('')}
      </section>` : ''}
      <div class="prose">${lesson.body}</div>
      <nav class="pager">
        ${prev ? `<a class="pager-link" href="/learn/${prev.id}"><span>← Previous</span>${prev.title}</a>` : '<span></span>'}
        ${next ? `<a class="pager-link next" href="/learn/${next.id}"><span>Next →</span>${next.title}</a>` : (isPlayground ? '' : '<a class="pager-link next" href="/playground"><span>Finished</span>Open the playground</a>')}
      </nav>
    </article>
    <section class="bench">
      <div class="stage-wrap${lesson.wifi ? ' has-phone' : ''}">
        <div class="stage" data-stage></div>
        <p class="sr-only" data-bench-desc aria-live="polite"></p>
        <div class="stage-hud">
          <span class="status" data-status><i></i><b>Stopped</b></span>
          <button class="icon-btn" data-view title="Reset view" aria-label="Reset view">${icon('focus')}</button>
        </div>
        <div class="stage-hint">Drag to orbit · scroll to zoom${lesson.parts.some((p) => ['button', 'touch', 'pot'].includes(p.type)) ? ' · click parts to use them' : ''}</div>
        ${lesson.wifi ? '<div class="phone" data-phone></div>' : ''}
      </div>
      <div class="toolbar">
        <button class="btn run" data-run>${icon('play')}<span>Run</span></button>
        <button class="btn quiet" data-share title="Copy a link to this exact code">${icon('link')}<span>Share</span></button>
        <button class="btn quiet" data-reset title="Restore the lesson's original code">${icon('undo')}<span>Reset</span></button>
        <button class="btn quiet" data-sound aria-pressed="${audio.enabled}" title="Sound for tone()">${icon(audio.enabled ? 'sound' : 'mute')}<span>Sound</span></button>
        <div class="controls" data-controls></div>
      </div>
      <div class="workspace">
        <div class="pane code-pane">
          <div class="pane-head"><span>sketch.ino</span><span class="muted">Ctrl/⌘ + Enter runs</span></div>
          <div data-shared></div>
          <div data-editor class="editor-host"></div>
        </div>
        <div class="pane serial-pane">
          <div class="pane-head"><span>Serial monitor <span class="muted">· 115200 baud</span></span><button class="link-btn" data-clear>Clear</button></div>
          <pre class="serial" data-serial aria-live="polite"></pre>
          <form class="serial-send" data-send>
            <label class="sr-only" for="serial-in">Send to the ESP32</label>
            <input id="serial-in" autocomplete="off" spellcheck="false" placeholder="Send text to Serial…" />
            <button type="submit">Send</button>
          </form>
        </div>
      </div>
    </section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  const serialEl = $('[data-serial]');
  const runBtn = $('[data-run]');
  const statusEl = $('[data-status]');

  const store = new InputStore();
  const hw = new Hardware();
  const observer = new Observer(hw, store, lesson.parts);
  let sketch = null;
  let goalTimer = null;
  let stage = null;
  let disposed = false;

  const updateScore = () => {
    const el = $('[data-score]');
    if (el) el.textContent = `${checks.filter(isPassed).length} / ${checks.length} passed`;
  };
  updateScore();

  // Serial output is batched to one DOM update per frame.
  let serialText = '';
  let pending = '';
  let flushQueued = false;
  const flush = () => {
    flushQueued = false;
    if (!pending) return;
    const atBottom = serialEl.scrollHeight - serialEl.scrollTop - serialEl.clientHeight < 30;
    serialText += pending;
    const last = serialEl.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) last.appendData(pending);
    else serialEl.append(document.createTextNode(pending));
    pending = '';
    if (serialText.length > MAX_SERIAL) {
      serialText = serialText.slice(-MAX_SERIAL * 0.75);
      serialEl.textContent = serialText;
    }
    if (atBottom) serialEl.scrollTop = serialEl.scrollHeight;
  };
  const onSerial = (text) => {
    observer.onSerial(text);
    pending += text;
    if (!flushQueued) { flushQueued = true; requestAnimationFrame(flush); }
  };
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
    onRun: () => start(),
  });

  // A shared link (#code=...) opens that code without overwriting the learner's draft.
  sharedCodeFromUrl().then((shared) => {
    if (disposed || shared === null || shared === editor.value) return;
    const mine = editor.value;
    editor.value = shared;
    const banner = $('[data-shared]');
    banner.innerHTML = '<div class="shared-banner"><span>You are looking at shared code. Your own version is safe.</span><button type="button">Back to my code</button></div>';
    banner.querySelector('button').addEventListener('click', () => { editor.value = mine; banner.innerHTML = ''; });
    history.replaceState(null, '', path);
  });

  // Simulated phone for Wi-Fi lessons
  const phone = lesson.wifi ? new Phone($('[data-phone]'), { request: (url) => sketch?.httpRequest(url) ?? Promise.resolve({ status: 0, error: 'Press Run to start the ESP32.' }) }) : null;

  // Inputs under the scene
  const controlsEl = $('[data-controls]');
  for (const c of controlsFor(lesson.parts)) {
    const wrap = document.createElement('div');
    wrap.className = `control ${c.kind}`;
    if (c.kind === 'hold') {
      wrap.innerHTML = `<button class="btn hold" aria-pressed="false">${icon(c.label === 'Button' ? 'press' : 'hand')}<span>Hold ${c.label.toLowerCase()}</span></button>`;
      const b = wrap.querySelector('button');
      const set = (v) => store.set(c.id, v);
      b.addEventListener('pointerdown', (e) => { try { b.setPointerCapture(e.pointerId); } catch { /* synthetic event */ } set(true); });
      b.addEventListener('pointerup', () => set(false));
      b.addEventListener('pointercancel', () => set(false));
      b.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); set(true); } });
      b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') set(false); });
      store.subscribe((sid, v) => { if (sid === c.id) b.setAttribute('aria-pressed', String(v)); });
    } else {
      wrap.innerHTML = `<label><span>${c.label}</span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}"><output>${c.format(c.value)}</output></label>`;
      const input = wrap.querySelector('input');
      const out = wrap.querySelector('output');
      input.addEventListener('input', () => store.set(c.id, Number(input.value)));
      store.subscribe((sid, v) => { if (sid === c.id) { if (Number(input.value) !== v) input.value = v; out.textContent = c.format(v); } });
    }
    controlsEl.append(wrap);
  }

  const setStatus = (running) => {
    statusEl.classList.toggle('on', running);
    statusEl.querySelector('b').textContent = running ? 'Running' : 'Stopped';
    runBtn.innerHTML = running ? `${icon('stop')}<span>Stop</span>` : `${icon('play')}<span>Run</span>`;
    runBtn.classList.toggle('running', running);
  };

  const checkAll = () => {
    if (!sketch || !checks.length) return;
    const ctx = observer.ctx();
    checks.forEach((c, i) => {
      if (isPassed(c)) return;
      let ok = false;
      try { ok = !!c.check(ctx); } catch { ok = false; }
      if (!ok) return;
      const fresh = c.key === 'goal' ? progress.markDone(lesson.id) : progress.markChallenge(lesson.id, c.key);
      const row = root.querySelector(`[data-check="${i}"]`);
      row?.classList.add('pass', 'just-passed');
      updateScore();
      if (fresh) {
        const allDone = checks.every(isPassed);
        const msg = c.key === 'goal' ? `Goal passed: ${lesson.title}` : `${c.kind} passed`;
        toast(allDone ? `${msg}. Lesson complete.` : msg, next && (c.key === 'goal' || allDone) ? { href: `/learn/${next.id}`, label: 'Next lesson →' } : null);
      }
    });
  };

  async function start() {
    stop(true);
    hw.reset();
    store.resetCounts();
    bindCircuit(lesson.parts, hw, store);
    serialText = ''; pending = '';
    serialEl.textContent = '';
    editor.markError(null);
    let current;
    try {
      current = new Sketch(editor.value, { hw, onSerial, onHttp: (h) => observer.onHttp(h), audio });
    } catch (err) {
      systemMsg(`Compile error: ${err.message}`, 'error');
      return;
    }
    sketch = current;
    observer.start();
    phone?.boot();
    setStatus(true);
    systemMsg('— uploading sketch… done. Booting.', 'info');
    goalTimer = setInterval(checkAll, 250);
    try {
      await current.run();
    } catch (err) {
      if (sketch === current) {
        systemMsg(err.message, 'error');
        if (err.line) editor.markError(err.line);
        if (err.compile) systemMsg('Check the marked line and the one before it for a missing semicolon, bracket or quote.', 'info');
      }
    }
    if (sketch === current) { checkAll(); sketch = null; setStatus(false); clearInterval(goalTimer); observer.stop(); phone?.off(); }
  }

  function stop(quiet = false) {
    if (!sketch) return;
    checkAll();
    const s = sketch;
    sketch = null;
    s.stop();
    clearInterval(goalTimer);
    observer.stop();
    phone?.off();
    setStatus(false);
    if (!disposed && !quiet) systemMsg('— stopped.', 'info');
  }

  runBtn.addEventListener('click', () => (sketch ? stop() : start()));
  $('[data-reset]').addEventListener('click', () => {
    if (editor.value !== lesson.code && !confirm('Replace your code with the original lesson code?')) return;
    editor.value = lesson.code;
    progress.clearDraft(lesson.id);
  });
  $('[data-share]').addEventListener('click', async () => {
    const url = await shareUrl(path, editor.value);
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied. Anyone who opens it sees this exact code.');
    } catch {
      prompt('Copy this link:', url);
    }
  });
  $('[data-send]').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.currentTarget.querySelector('input');
    if (!input.value) return;
    if (!sketch) { systemMsg('Run the sketch first, then send it text.', 'info'); return; }
    sketch.sendSerial(`${input.value}\n`);
    systemMsg(`→ ${input.value}`, 'info');
    input.value = '';
  });
  $('[data-clear]').addEventListener('click', () => { serialText = ''; pending = ''; serialEl.textContent = ''; });
  const soundBtn = $('[data-sound]');
  soundBtn.addEventListener('click', () => {
    audio.setEnabled(!audio.enabled);
    soundBtn.setAttribute('aria-pressed', String(audio.enabled));
    soundBtn.innerHTML = `${icon(audio.enabled ? 'sound' : 'mute')}<span>Sound</span>`;
  });

  // The 3D stage loads lazily so the text and editor appear immediately.
  const stageEl = $('[data-stage]');
  stageEl.innerHTML = '<div class="stage-loading">Loading the bench…</div>';
  import('../scene/stage.js').then(({ Stage }) => {
    if (disposed) return;
    stageEl.innerHTML = '';
    try {
      stage = new Stage(stageEl, { rightInset: lesson.wifi ? 270 : 0 });
      stage.setHardware(hw);
      stage.setCircuit(lesson.parts, store);
      stage.start();
      $('[data-view]').addEventListener('click', () => stage.resetView());
    } catch (err) {
      stageEl.innerHTML = `<div class="stage-loading">3D view unavailable (${err.message}). The simulator still runs: watch the serial monitor.</div>`;
    }
  });

  // Text description of the bench for screen readers, refreshed at most once a second.
  const descEl = $('[data-bench-desc]');
  const describe = () => {
    const bits = [];
    if (hw.level(2)) bits.push('On-board LED on');
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
    stop(true);
    for (const gpio of [...hw.pins.keys()]) audio.stop(gpio);
    stage?.dispose();
  };
}

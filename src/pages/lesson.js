import { LESSONS, TRACKS, findLesson, lessonIndex } from '../lessons.js';
import { Hardware, Sketch } from '../sim/runtime.js';
import { bindCircuit, rebindCircuit, controlsFor, InputStore } from '../circuit.js';
import { analyze, matchesCode, solutionWires, allTerminals, partName } from '../wiring.js';
import { Observer } from '../sim/observe.js';
import { Editor } from '../ui/editor.js';
import { Phone } from '../ui/phone.js';
import { Plotter, LogicAnalyzer } from '../ui/instruments.js';
import { progress } from '../progress.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { shareUrl, sharedFromUrl } from '../share.js';
import { billOfMaterials, wiringTable, librariesFor, downloadSketch } from '../realworld.js';

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
    ...(lesson.wiring ? [{ kind: 'Wiring', text: 'Wire the circuit yourself so it matches the code.', key: 'wiring' }] : []),
    ...(lesson.goal ? [{ kind: 'Goal', text: lesson.goal.text, check: lesson.goal.check, key: 'goal' }] : []),
    ...(lesson.challenges ?? []).map((c, i) => ({ kind: `Challenge ${i + 1}`, text: c.text, hint: c.hint, check: c.check, key: i })),
  ];
  const isPassed = (c) => (c.key === 'goal' ? progress.isDone(lesson.id) : progress.isChallengeDone(lesson.id, c.key));
  const hasParts = lesson.parts.length > 0;

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
        ${checks.map((c, i) => `<div class="check${isPassed(c) ? ' pass' : ''}" data-check="${i}"><span class="box" aria-hidden="true"></span><span>${c.text}${c.hint ? `<details class="hint"><summary>Hint</summary><p>${c.hint}</p></details>` : ''}</span><span class="check-kind">${c.kind}</span></div>`).join('')}
      </section>` : ''}
      <div class="prose">${lesson.body}</div>
      <section class="real" data-real></section>
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
        ${hasParts ? '<section class="wiring-panel" data-wiring hidden aria-label="Wiring"></section>' : ''}
      </div>
      <div class="toolbar">
        <button class="btn run" data-run>${icon('play')}<span>Run</span></button>
        <button class="btn quiet" data-share title="Copy a link to this exact code">${icon('link')}<span>Share</span></button>
        <button class="btn quiet" data-reset title="Restore the lesson's original code">${icon('undo')}<span>Reset</span></button>
        <button class="btn quiet" data-sound aria-pressed="${audio.enabled}" title="Sound for tone()">${icon(audio.enabled ? 'sound' : 'mute')}<span>Sound</span></button>
        ${hasParts ? `<div class="seg" role="group" aria-label="Wiring mode"><button type="button" data-mode="pre">Pre-wired</button><button type="button" data-mode="self">Wire it</button></div>` : ''}
        <div class="controls" data-controls></div>
      </div>
      <div class="workspace">
        <div class="pane code-pane">
          <div class="pane-head"><span>sketch.ino</span><span class="muted">Ctrl/⌘ + Enter runs</span></div>
          <div data-shared></div>
          <div data-editor class="editor-host"></div>
        </div>
        <div class="pane serial-pane">
          <div class="pane-head tabs">
            <div class="tablist" role="tablist" aria-label="Instruments">
              <button role="tab" class="tab" aria-selected="true" aria-controls="panel-monitor" data-tab="monitor">Monitor</button>
              <button role="tab" class="tab" aria-selected="false" aria-controls="panel-plotter" data-tab="plotter">Plotter</button>
              <button role="tab" class="tab" aria-selected="false" aria-controls="panel-logic" data-tab="logic">Logic</button>
            </div>
            <span class="muted tab-note" data-tab-note>115200 baud</span>
            <button class="link-btn" data-clear>Clear</button>
          </div>
          <pre class="serial" id="panel-monitor" role="tabpanel" data-serial aria-live="polite" data-panel="monitor"></pre>
          <canvas class="instrument" id="panel-plotter" role="tabpanel" data-panel="plotter" hidden aria-label="Serial plotter: a graph of the numbers the sketch prints"></canvas>
          <canvas class="instrument" id="panel-logic" role="tabpanel" data-panel="logic" hidden aria-label="Logic analyzer: pin levels over the last 4 seconds"></canvas>
          <form class="serial-send" data-send data-panel="monitor">
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

  const plotter = new Plotter($('[data-panel="plotter"]'));
  const logic = new LogicAnalyzer($('[data-panel="logic"]'));
  let tab = 'monitor';
  const pinList = [];
  for (const p of lesson.parts) {
    if (p.type === 'ultrasonic') pinList.push({ gpio: p.trig, label: 'TRIG' }, { gpio: p.echo, label: 'ECHO' });
    else if (p.pin !== undefined && ['led', 'buzzer', 'servo', 'button', 'touch'].includes(p.type)) pinList.push({ gpio: p.pin, label: p.type === 'led' ? `${p.color ?? ''} LED` : p.type });
  }
  const store = new InputStore();
  const hw = new Hardware();
  const observer = new Observer(hw, store, lesson.parts);
  let sketch = null;
  let goalTimer = null;

  // ---- wiring ----
  let wireMode = hasParts ? (lesson.wiring ? 'self' : 'pre') : null;
  let userWires = progress.wires(lesson.id) ?? [];
  let wiresSaved = true; // false while showing someone else's shared wiring
  const currentWires = () => (wireMode === 'self' ? userWires : solutionWires(lesson.parts));
  let wiring = analyze(lesson.parts, currentWires(), { wifi: !!lesson.wifi });
  const terminals = allTerminals(lesson.parts);
  const termLabel = (id) => terminals.find((t) => t.id === id)?.label ?? id;
  const wiringMatches = () => wireMode !== 'self' || matchesCode(lesson.parts, wiring);
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
    plotter.feed(text);
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

  // A shared link (#code=...) opens that code (and wiring) without overwriting the learner's own.
  sharedFromUrl().then((shared) => {
    if (disposed || !shared) return;
    history.replaceState(null, '', path);
    const sameCode = shared.code === editor.value;
    if (sameCode && !shared.wires) return;
    const mine = { code: editor.value, wires: userWires, mode: wireMode };
    editor.setValue(shared.code, { save: false });
    if (shared.wires && hasParts) { userWires = shared.wires; wiresSaved = false; setMode('self', { keep: true }); }
    const banner = $('[data-shared]');
    banner.innerHTML = `<div class="shared-banner"><span>You are looking at a shared ${shared.wires ? 'circuit' : 'sketch'}. Your own version is safe.</span><button type="button">Back to mine</button></div>`;
    banner.querySelector('button').addEventListener('click', () => {
      editor.setValue(mine.code, { save: false });
      userWires = mine.wires; wiresSaved = true;
      if (hasParts) setMode(mine.mode, { keep: true });
      banner.innerHTML = '';
    });
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
      if (isPassed(c) || c.key === 'wiring') return;
      // With your own wiring, results only count once the circuit matches the code.
      if (!wiringMatches()) return;
      let ok = false;
      try { ok = !!c.check(ctx); } catch { ok = false; }
      if (!ok) return;
      passCheck(c, i);
    });
  };

  // Handle for automated browser tests.
  root.lessonState = { hw, observer, get wiring() { return wiring; }, get sketch() { return sketch; }, checks };

  function passCheck(c, i) {
    {
      const fresh = c.key === 'goal' ? progress.markDone(lesson.id) : progress.markChallenge(lesson.id, c.key);
      const row = root.querySelector(`[data-check="${i}"]`);
      row?.classList.add('pass', 'just-passed');
      updateScore();
      if (fresh) {
        const allDone = checks.every(isPassed);
        const msg = c.key === 'goal' ? `Goal passed: ${lesson.title}` : c.key === 'wiring' ? 'Wiring check passed. Now press Run.' : `${c.kind} passed`;
        toast(allDone ? `${msg}. Lesson complete.` : msg, next && (c.key === 'goal' || allDone) ? { href: `/learn/${next.id}`, label: 'Next lesson →' } : null);
      }
    }
  }

  async function start() {
    stop(true);
    hw.reset();
    store.resetCounts();
    bindCircuit(wiring.effective, hw, store);
    serialText = ''; pending = '';
    serialEl.textContent = '';
    plotter.clear();
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
    const url = await shareUrl(path, editor.value, wireMode === 'self' ? userWires : null);
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
  $('[data-clear]').addEventListener('click', () => { serialText = ''; pending = ''; serialEl.textContent = ''; plotter.clear(); drawInstrument(); });

  // ---- build it for real ----
  function renderReal() {
    const el = $('[data-real]');
    const bom = billOfMaterials(lesson);
    const table = wiringTable(lesson);
    const libs = librariesFor(editor.value);
    el.innerHTML = `
      <details>
        <summary><span class="label">Build it for real</span><span class="real-sub">Parts, wiring and upload steps</span></summary>
        <div class="real-body">
          <h3>Parts</h3>
          <table class="bom"><tbody>${bom.map(([n, q]) => `<tr><td>${q}×</td><td>${n}</td></tr>`).join('')}</tbody></table>
          ${table.length ? `<h3>Wiring</h3><table class="wires"><thead><tr><th>From</th><th>To</th></tr></thead><tbody>${table.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table>` : ''}
          <h3>Upload from the Arduino IDE</h3>
          <ol>
            <li>Once: in <em>Boards Manager</em>, install <strong>esp32 by Espressif Systems</strong>.</li>
            ${libs.install.length ? `<li>In <em>Library Manager</em>, install ${libs.install.map((l) => `<strong>${l}</strong>`).join(' and ')}.</li>` : ''}
            <li>Choose the board <strong>ESP32 Dev Module</strong> and the USB port it appears on.</li>
            <li>Download the sketch below, open it, and press Upload. If it stalls at <code>Connecting…</code>, hold the board's <strong>BOOT</strong> button until it starts.</li>
            <li>Open the Serial Monitor at <strong>115200 baud</strong>.</li>
          </ol>
          ${libs.builtIn.length ? `<p class="muted">${libs.builtIn.join(', ')} come${libs.builtIn.length === 1 ? 's' : ''} with the ESP32 board package.</p>` : ''}
          <button type="button" class="btn" data-download>Download ${lesson.id}.ino</button>
          <p class="muted">The Arduino IDE wants each sketch in a folder of the same name; it offers to create one when you open the file.</p>
        </div>
      </details>`;
    el.querySelector('[data-download]').addEventListener('click', () => downloadSketch(`${lesson.id}.ino`, editor.value));
  }
  renderReal();

  // ---- instrument tabs ----
  const notes = { monitor: '115200 baud', plotter: 'numbers printed', logic: 'last 4 s' };
  function drawInstrument() {
    if (tab === 'plotter') plotter.draw();
    else if (tab === 'logic') logic.draw();
  }
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    root.querySelectorAll('[data-panel]').forEach((el) => { el.hidden = el.dataset.panel !== tab; });
    $('[data-tab-note]').textContent = notes[tab];
    drawInstrument();
  }));
  logic.attach(hw, pinList);
  const instrumentTimer = setInterval(() => { if (sketch && tab !== 'monitor') drawInstrument(); }, 100);
  const soundBtn = $('[data-sound]');
  soundBtn.addEventListener('click', () => {
    audio.setEnabled(!audio.enabled);
    soundBtn.setAttribute('aria-pressed', String(audio.enabled));
    soundBtn.innerHTML = `${icon(audio.enabled ? 'sound' : 'mute')}<span>Sound</span>`;
  });

  // ---- wiring panel and mode ----
  const panel = $('[data-wiring]');
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const labelsFor = () => Object.fromEntries(lesson.parts.map((p, k) => {
    if (wireMode !== 'self') return [p.id, p.label];
    const e = wiring.effective[k];
    const pin = p.type === 'ultrasonic' ? (e.trig !== null && e.echo !== null ? `TRIG ${e.trig} · ECHO ${e.echo}` : null) : e.pin;
    return [p.id, `${partName(p)}${pin !== null && pin !== undefined && e.state !== 'open' ? ` · ${typeof pin === 'number' ? `GPIO ${pin}` : pin}` : ''}`];
  }));
  const mismatches = () => lesson.parts.map((p, k) => {
    const e = wiring.effective[k];
    if (p.type === 'oled') return null;
    if (p.type === 'ultrasonic') return e.trig !== p.trig || e.echo !== p.echo ? `${partName(p)}: the code expects TRIG on GPIO ${p.trig} and ECHO on GPIO ${p.echo}.` : null;
    if (e.state === 'open' || e.pin === null || e.pin === undefined) return `${partName(p)}: not wired yet (the code uses GPIO ${p.pin}).`;
    if (e.pin !== p.pin) return `${partName(p)} is on GPIO ${e.pin}, but the code uses GPIO ${p.pin}. Move the wire, or change the pin number in the code.`;
    if (p.type === 'button' && e.to !== 'gnd') return `${partName(p)}: the code uses INPUT_PULLUP, so the other leg should go to GND.`;
    if (p.type === 'pot' && e.reversed) return `${partName(p)}: the outer legs are swapped, so the reading runs backwards. Not wrong, just mirrored.`;
    return null;
  }).filter(Boolean);

  function renderPanel() {
    if (!panel) return;
    panel.hidden = wireMode !== 'self';
    if (panel.hidden) return;
    const errors = wiring.issues.filter((x) => x.level === 'error');
    const warns = wiring.issues.filter((x) => x.level === 'warn');
    const miss = wiring.ok ? mismatches() : [];
    const good = wiring.ok && !miss.length;
    const state = !userWires.length ? 'empty' : good ? 'good' : errors.length ? 'bad' : 'todo';
    const status = { empty: 'No wires yet', good: 'Matches the code', bad: `${errors.length} problem${errors.length > 1 ? 's' : ''}`, todo: 'Not finished' }[state];
    const open = panel.querySelector('details')?.open ?? false;
    panel.innerHTML = `
      <div class="wp-head"><span class="label">Wiring check</span><span class="wp-status wp-${state}">${status}</span><button type="button" class="link-btn" data-wp-min aria-expanded="${!panel.classList.contains('min')}">${panel.classList.contains('min') ? 'Show' : 'Hide'}</button></div>
      <div class="wp-body">
        ${!userWires.length ? '<p class="wp-help">Drag from a red dot to another to add a wire, or click one dot and then the other. Hover a dot to see what it is. Click a wire to remove it.</p>' : ''}
        <ul class="wp-issues">
          ${errors.map((x) => `<li class="err">${esc(x.text)}</li>`).join('')}
          ${miss.map((t) => `<li class="todo">${esc(t)}</li>`).join('')}
          ${warns.map((x) => `<li class="warn">${esc(x.text)}</li>`).join('')}
          ${good ? '<li class="ok">Everything is connected the way the code expects.</li>' : ''}
        </ul>
        <details${open ? ' open' : ''}><summary>Wires (${userWires.length})</summary>
          <ol class="wp-wires">${userWires.map((w, k) => `<li><span>${esc(termLabel(w.a.t))} → ${esc(termLabel(w.b.t))}</span><button type="button" class="link-btn" data-del="${k}" aria-label="Remove wire ${k + 1}">Remove</button></li>`).join('')}</ol>
          <form class="wp-add" data-add>
            <label class="sr-only" for="w-from">From</label>
            <select id="w-from">${terminalOptions()}</select>
            <label class="sr-only" for="w-to">To</label>
            <select id="w-to">${terminalOptions()}</select>
            <button class="btn quiet" type="submit">Add wire</button>
          </form>
        </details>
        <div class="wp-actions"><button type="button" class="btn quiet" data-solution>Show solution</button><button type="button" class="btn quiet" data-clear-wires ${userWires.length ? '' : 'disabled'}>Clear all</button></div>
      </div>`;
  }
  function terminalOptions() {
    const groups = [...new Set(terminals.map((t) => t.group))];
    return groups.map((g) => `<optgroup label="${esc(g)}">${terminals.filter((t) => t.group === g).map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</optgroup>`).join('');
  }
  panel?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) removeWire(Number(del.dataset.del));
    else if (e.target.closest('[data-solution]')) {
      if (userWires.length && !confirm('Replace your wires with the reference wiring?')) return;
      setWires(solutionWires(lesson.parts));
    } else if (e.target.closest('[data-clear-wires]')) {
      const before = userWires;
      setWires([]);
      toast('All wires removed.', { label: 'Undo', onClick: () => setWires(before) });
    } else if (e.target.closest('[data-wp-min]')) {
      panel.classList.toggle('min');
      renderPanel();
    }
  });
  panel?.addEventListener('submit', (e) => {
    e.preventDefault();
    const a = panel.querySelector('#w-from').value;
    const b = panel.querySelector('#w-to').value;
    if (a === b) { toast('Pick two different points.'); return; }
    connect({ t: a }, { t: b });
  });

  function setWires(wires) {
    userWires = wires;
    if (wiresSaved) progress.saveWires(lesson.id, userWires);
    applyWiring();
  }
  function connect(a, b) {
    const same = (w) => (w.a.t === a.t && w.b.t === b.t) || (w.a.t === b.t && w.b.t === a.t);
    if (userWires.some(same)) return;
    setWires([...userWires, { a, b }]);
  }
  function removeWire(k) {
    const removed = userWires[k];
    if (!removed) return;
    setWires(userWires.filter((_, j) => j !== k));
    toast(`Removed ${termLabel(removed.a.t)} → ${termLabel(removed.b.t)}.`, { label: 'Undo', onClick: () => setWires([...userWires, removed]) }, { ms: 4000 });
  }

  /** Re-analyses the circuit and pushes the result everywhere. */
  function applyWiring() {
    wiring = analyze(lesson.parts, currentWires(), { wifi: !!lesson.wifi });
    stage?.setWires(currentWires());
    stage?.applyEffective(wiring.effective, labelsFor());
    if (sketch) rebindCircuit(wiring.effective, hw, store);
    renderPanel();
    const row = checks.findIndex((c) => c.key === 'wiring');
    if (row !== -1 && wireMode === 'self' && !isPassed(checks[row]) && matchesCode(lesson.parts, wiring)) passCheck(checks[row], row);
  }

  function setMode(mode, { keep = false } = {}) {
    if (!hasParts) return;
    wireMode = mode;
    if (!keep && mode === 'self' && !userWires.length) userWires = progress.wires(lesson.id) ?? [];
    root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    stage?.setWiringMode(mode === 'self', wiringCallbacks);
    stage?.setInsets({ left: mode === 'self' ? 312 : 0 });
    applyWiring();
  }
  const wiringCallbacks = { connect, remove: removeWire, label: termLabel };
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  if (hasParts) setMode(wireMode, { keep: true });

  // The 3D stage loads lazily so the text and editor appear immediately.
  const stageEl = $('[data-stage]');
  stageEl.innerHTML = '<div class="stage-loading">Loading the bench…</div>';
  import('../scene/stage.js').then(({ Stage }) => {
    if (disposed) return;
    stageEl.innerHTML = '';
    try {
      stage = new Stage(stageEl, { rightInset: lesson.wifi ? 270 : 0 });
      stage.setHardware(hw);
      stage.setCircuit(lesson.parts, store, currentWires());
      if (hasParts) { stage.setWiringMode(wireMode === 'self', wiringCallbacks); stage.setInsets({ left: wireMode === 'self' ? 312 : 0 }); stage.applyEffective(wiring.effective, labelsFor()); }
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
    clearInterval(instrumentTimer);
    disposed = true;
    stop(true);
    for (const gpio of [...hw.pins.keys()]) audio.stop(gpio);
    stage?.dispose();
  };
}

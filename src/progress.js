// Per-browser progress and code drafts. Storage can be unavailable (private
// mode, blocked cookies), so every access is guarded and failures are ignored.
const KEY = 'learn-esp32:v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}
function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

let state = load();
state.done ??= [];
state.code ??= {};
state.ch ??= {}; // lesson id -> completed challenge indexes (and 'wiring')
state.wires ??= {}; // lesson id -> the learner's own wires

const listeners = new Set();
export const progress = {
  isDone: (id) => state.done.includes(id),
  doneCount: () => state.done.length,
  markDone(id) {
    if (state.done.includes(id)) return false;
    state.done.push(id);
    save(state);
    listeners.forEach((fn) => fn());
    return true;
  },
  isChallengeDone: (id, i) => (state.ch[id] ?? []).includes(i),
  challengesDone: (id) => (state.ch[id] ?? []).length,
  totalChallengesDone: () => Object.values(state.ch).reduce((n, a) => n + a.length, 0),
  markChallenge(id, i) {
    const list = (state.ch[id] ??= []);
    if (list.includes(i)) return false;
    list.push(i);
    save(state);
    listeners.forEach((fn) => fn());
    return true;
  },
  wires: (id) => state.wires[id] ?? null,
  saveWires(id, wires) { state.wires[id] = wires; save(state); },
  clearWires(id) { delete state.wires[id]; save(state); },
  /** Everything, for backup/restore. */
  exportAll: () => JSON.stringify({ app: 'learn-esp32', version: 1, saved: new Date().toISOString(), state }, null, 2),
  importAll(text) {
    const data = JSON.parse(text);
    if (data?.app !== 'learn-esp32' || typeof data.state !== 'object') throw new Error('This file is not a Learn ESP32 backup.');
    state = { done: [], code: {}, ch: {}, wires: {}, ...data.state };
    save(state);
    listeners.forEach((fn) => fn());
  },
  draft: (id) => state.code[id] ?? null,
  saveDraft(id, code) { state.code[id] = code; save(state); },
  clearDraft(id) { delete state.code[id]; save(state); },
  reset() { state = { done: [], code: {}, ch: {}, wires: {} }; save(state); listeners.forEach((fn) => fn()); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

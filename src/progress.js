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
  draft: (id) => state.code[id] ?? null,
  saveDraft(id, code) { state.code[id] = code; save(state); },
  clearDraft(id) { delete state.code[id]; save(state); },
  reset() { state = { done: [], code: {} }; save(state); listeners.forEach((fn) => fn()); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

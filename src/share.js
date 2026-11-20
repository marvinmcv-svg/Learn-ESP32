// Shareable sketch links: the code is deflate-compressed and stored in the URL
// fragment (#code=...), so it never reaches a server and needs no backend.

const toB64Url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeSketch(code) {
  const raw = new TextEncoder().encode(code);
  if (typeof CompressionStream === 'undefined') return `u${toB64Url(raw)}`;
  return `z${toB64Url(await pipe(raw, new CompressionStream('deflate-raw')))}`;
}

export async function decodeSketch(token) {
  const kind = token[0];
  const bytes = fromB64Url(token.slice(1));
  const raw = kind === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return new TextDecoder().decode(raw);
}

/** Link to `path` that opens with `code` (and optionally the wiring) loaded. */
export async function shareUrl(path, code, wires = null) {
  const payload = wires ? JSON.stringify({ c: code, w: wires }) : code;
  return `${location.origin}${path}#code=${await encodeSketch(payload)}`;
}

/** Shared { code, wires } in the current URL, or null. */
export async function sharedFromUrl() {
  const m = location.hash.match(/^#code=([\w-]+)$/);
  if (!m) return null;
  let text;
  try { text = await decodeSketch(m[1]); } catch { return null; }
  if (text.startsWith('{"c":')) {
    try { const o = JSON.parse(text); return { code: String(o.c), wires: Array.isArray(o.w) ? o.w : null }; } catch { /* plain code */ }
  }
  return { code: text, wires: null };
}

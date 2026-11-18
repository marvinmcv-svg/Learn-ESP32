// Translates the small subset of Arduino C++ used by the lessons into async
// JavaScript that the runtime can execute step by step.
//
// It is a source-to-source rewrite, not a compiler: it understands
// declarations, functions, arrays, casts and the blocking calls (delay,
// pulseIn) well enough for beginner sketches, and reports anything it cannot
// run as an ordinary JavaScript syntax error.

const TYPE =
  '(?:unsigned\\s+long\\s+long|unsigned\\s+long|unsigned\\s+int|unsigned\\s+char|long\\s+long|unsigned|long|int|short|float|double|bool|boolean|byte|char|String|word|size_t|u?int(?:8|16|32|64)_t)';
const INT_TYPE = /^(?:unsigned\s+long\s+long|unsigned\s+long|unsigned\s+int|unsigned\s+char|long\s+long|unsigned|long|int|short|byte|char|word|size_t|u?int(?:8|16|32|64)_t)$/;
const CLASSES = ['Servo', 'Adafruit_SSD1306'];
const BLOCKING = ['delay', 'delayMicroseconds', 'pulseIn'];

/** Removes comments while leaving string and character literals intact. */
export function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const block = src.slice(i, end === -1 ? src.length : end + 2);
      out += block.replace(/[^\n]/g, ' '); // keep line numbers stable
      i = end === -1 ? src.length : end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

/** Index of the bracket matching the one at `open`, or -1. */
function matching(src, open, a, b) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      i++;
      while (i < src.length && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
    } else if (src[i] === a) depth++;
    else if (src[i] === b && --depth === 0) return i;
  }
  return -1;
}

function paramNames(params) {
  return params
    .split(',')
    .map((p) => p.replace(/\[\s*\]/g, '').trim())
    .filter((p) => p && p !== 'void')
    .map((p) => p.match(/(\w+)\s*(?:=.*)?$/)[1]);
}

export function transpile(source) {
  let src = stripComments(source);

  // Preprocessor
  src = src.replace(/^[ \t]*#include.*$/gm, '');
  src = src.replace(/^[ \t]*#define[ \t]+(\w+)[ \t]+(.+)$/gm, 'const $1 = $2;');

  // Numeric suffixes: 1000UL, 5.0f
  src = src.replace(/\b(0x[0-9a-fA-F]+|\d+\.\d+|\d+)(?:ULL|UL|LL|ul|L|l|U|u)\b/g, '$1');
  src = src.replace(/\b(\d+\.\d*|\d+)[fF]\b/g, '$1');

  // Library objects: `Servo arm;`, `Adafruit_SSD1306 display(128, 64, &Wire, -1);`
  const classRe = new RegExp(`(^|[;{}\\n])\\s*(${CLASSES.join('|')})\\s+(\\w+)\\s*(?:\\(([^)]*)\\))?\\s*;`, 'g');
  src = src.replace(classRe, (_, pre, cls, name, args = '') =>
    `${pre}\nlet ${name} = new ${cls}(${args.replace(/&/g, '')});`);

  // Function definitions
  const fns = new Set();
  const fnRe = new RegExp(`(^|[;}\\n])\\s*(?:static\\s+|inline\\s+)*(void|${TYPE})\\s*\\*?\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*\\{`, 'g');
  src = src.replace(fnRe, (_, pre, _type, name, params) => {
    fns.add(name);
    return `${pre}\nasync function ${name}(${paramNames(params).join(', ')}) {`;
  });

  // Variable declarations (arrays first)
  const ints = new Set();
  const arrRe = new RegExp(`\\b(?:const\\s+|static\\s+|volatile\\s+)*${TYPE}\\s+(\\w+)\\s*((?:\\[[^\\]]*\\])+)\\s*(=|;)`, 'g');
  src = src.replace(arrRe, (_, name, dims, tail) => {
    if (tail === '=') return `let ${name} =`;
    const sizes = [...dims.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1].trim() || '0');
    const build = (k) => (k === sizes.length - 1
      ? `new Array(${sizes[k]}).fill(0)`
      : `Array.from({ length: ${sizes[k]} }, () => ${build(k + 1)})`);
    return `let ${name} = ${build(0)};`;
  });
  // Brace initialisers that follow `let x =` become array literals
  src = src.replace(/let (\w+) =\s*\{/g, (m, name, offset) => `let ${name} = \u0000{`);
  for (let i = src.indexOf('\u0000'); i !== -1; i = src.indexOf('\u0000')) {
    const open = i + 1;
    const close = matching(src, open, '{', '}');
    const body = src.slice(open, close + 1).replace(/\{/g, '[').replace(/\}/g, ']');
    src = src.slice(0, i) + body + src.slice(close + 1);
  }

  const declRe = new RegExp(`\\b(?:const\\s+|static\\s+|volatile\\s+)*(${TYPE})\\s*\\*?\\s+(\\w+)(?=\\s*[=;,)])`, 'g');
  src = src.replace(declRe, (m, type, name) => {
    if (INT_TYPE.test(type.replace(/\s+/g, ' '))) ints.add(name);
    return `let ${name}`;
  });

  // Casts: (int)x truncates, (float)x is a no-op in JavaScript
  src = src.replace(new RegExp(`\\(\\s*(?:${TYPE})\\s*\\)`, 'g'), (m) =>
    (/float|double/.test(m) ? '' : '~~'));

  // Integer variables keep integer values, as they would on the chip
  src = wrapIntAssignments(src, ints);

  // Blocking calls and user functions are awaited
  for (const name of [...fns, ...BLOCKING]) {
    src = src.replace(new RegExp(`(?<![\\w.])(?<!function\\s)${name}\\s*\\(`, 'g'), `await ${name}(`);
  }

  // Every loop body yields so the page stays responsive and Stop works
  src = injectYields(src);
  src = src.replace(/\bNULL\b/g, 'null');

  return { code: src, functions: [...fns] };
}

/**
 * Rewrites `x = expr` and `x op= expr` for integer variables so the result is
 * truncated. The expression ends at `;`, `,` or an unbalanced `)`, so loop
 * headers like `for (...; i += 2)` are handled.
 */
function wrapIntAssignments(src, ints) {
  if (!ints.size) return src;
  const re = /(^|[;{}\n(]\s*|\blet\s+)(\w+)\s*([+\-*/%]?)=(?!=)/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    const [whole, pre, name, op] = m;
    if (!ints.has(name)) continue;
    const start = m.index + whole.length;
    let depth = 0;
    let k = start;
    for (; k < src.length; k++) {
      const c = src[k];
      if (c === '"' || c === "'") {
        k++;
        while (k < src.length && src[k] !== c) k += src[k] === '\\' ? 2 : 1;
      } else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') { if (depth === 0) break; depth--; }
      else if ((c === ';' || c === ',') && depth === 0) break;
    }
    const expr = src.slice(start, k).trim();
    out += src.slice(last, m.index) + pre + (op
      ? `${name} = __int(${name} ${op} (${expr}))`
      : `${name} = __int(${expr})`);
    last = k;
    re.lastIndex = k;
  }
  return out + src.slice(last);
}

function injectYields(src) {
  const re = /\b(while|for)\s*\(|\bdo\s*\{/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    let brace;
    if (m[0].startsWith('do')) {
      brace = m.index + m[0].length - 1;
    } else {
      const close = matching(src, m.index + m[0].length - 1, '(', ')');
      if (close === -1) continue;
      let k = close + 1;
      while (/\s/.test(src[k])) k++;
      if (src[k] !== '{') continue; // `do { } while (x);` tail or single-statement loop
      brace = k;
    }
    out += src.slice(last, brace + 1) + ' await __yield();';
    last = brace + 1;
    re.lastIndex = brace + 1;
  }
  return out + src.slice(last);
}

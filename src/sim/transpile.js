// Translates the beginner subset of Arduino C++ into async JavaScript that the
// runtime can execute step by step.
//
// It is a source-to-source rewrite, not a compiler. It handles declarations,
// functions and prototypes, arrays, structs, enums, #define macros, static
// locals, casts, C integer semantics (truncating division and fixed-width
// overflow) and the blocking calls (delay, pulseIn). Every rewrite keeps the
// number of lines unchanged, so a JavaScript error line is the sketch line.

const BASE_TYPES = [
  'unsigned\\s+long\\s+long', 'unsigned\\s+long', 'unsigned\\s+int', 'unsigned\\s+short', 'unsigned\\s+char',
  'signed\\s+char', 'long\\s+long', 'long\\s+int', 'unsigned', 'long', 'int', 'short', 'float', 'double', 'bool',
  'boolean', 'byte', 'char', 'String', 'word', 'size_t', 'u?int(?:8|16|32|64)_t',
];
const CLASSES = ['Servo', 'Adafruit_SSD1306', 'WebServer'];
const BLOCKING = ['delay', 'delayMicroseconds', 'pulseIn'];
const BLOCKING_METHODS = ['handleClient'];

/** Integer types and the wrapper that gives them C overflow behaviour. */
function intWrapper(type) {
  const t = type.replace(/\s+/g, ' ').trim();
  if (/^(byte|uint8_t|unsigned char)$/.test(t)) return '__u8';
  if (/^(int8_t|signed char)$/.test(t)) return '__i8';
  if (/^(uint16_t|word|unsigned short)$/.test(t)) return '__u16';
  if (/^(int16_t|short)$/.test(t)) return '__i16';
  if (/^(int|int32_t|long|long int)$/.test(t)) return '__i32';
  if (/^(unsigned|unsigned int|unsigned long|uint32_t|size_t)$/.test(t)) return '__u32';
  if (/^(long long|unsigned long long|u?int64_t)$/.test(t)) return '__int';
  return null;
}

/** Removes comments while leaving string and character literals intact. */
export function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
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

/** Pads a replacement with newlines so it spans as many lines as the original. */
function sameLines(original, replacement) {
  const want = (original.match(/\n/g) ?? []).length;
  const have = (replacement.match(/\n/g) ?? []).length;
  if (have <= want) return replacement + '\n'.repeat(want - have);
  // More lines than the original: fold the extra ones from the end.
  let out = replacement;
  for (let k = have - want; k > 0; k--) out = out.replace(/\n(?![\s\S]*\n)/, ' ');
  return out;
}

/** Applies `fn` to the code between string/char literals only. */
function outsideStrings(src, fn) {
  let out = '';
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '"' || src[i] === "'") {
      out += fn(src.slice(start, i));
      const q = src[i];
      let j = i + 1;
      while (j < src.length && src[j] !== q && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
      start = j + 1;
    }
  }
  return out + fn(src.slice(start));
}

function paramNames(params) {
  return params
    .split(',')
    .map((p) => p.replace(/\[\s*\w*\s*\]/g, '').replace(/[&*]/g, ' ').trim())
    .filter((p) => p && p !== 'void')
    .map((p) => {
      const m = p.match(/(\w+)\s*(=\s*(.+))?$/);
      return m[2] ? `${m[1]} = ${m[3]}` : m[1];
    });
}

export function transpile(source) {
  // C++ raw strings R"delim(...)delim" (often used for HTML) become template
  // literals. They are swapped out first so comment stripping cannot touch them.
  const raws = [];
  let src = source.replace(/\r\n?/g, '\n').replace(/\bR"([^(\s]*)\(([\s\S]*?)\)\1"/g, (m, delim, body) => {
    raws.push(body);
    return `__RAW${raws.length - 1}__${'\n'.repeat((body.match(/\n/g) ?? []).length)}`;
  });
  src = stripComments(src);

  // ---- Preprocessor ----
  src = src.replace(/^[ \t]*#(include|pragma|ifndef|ifdef|endif|if|else|elif|undef)\b.*$/gm, '');
  src = src.replace(/^[ \t]*#define[ \t]+(\w+)\(([^)]*)\)[ \t]+(.+)$/gm, 'const $1 = ($2) => ($3);');
  src = src.replace(/^[ \t]*#define[ \t]+(\w+)[ \t]+(.+)$/gm, 'const $1 = $2;');
  src = src.replace(/^[ \t]*#define[ \t]+(\w+)[ \t]*$/gm, 'const $1 = 1;');
  src = src.replace(/\bIRAM_ATTR\s+/g, '');

  // Numeric suffixes and binary literals: 1000UL, 5.0f, B1010
  src = outsideStrings(src, (code) => code
    .replace(/\b(0x[0-9a-fA-F]+|\d+\.\d+|\d+)(?:ULL|UL|LL|ul|ull|L|l|U|u)\b/g, '$1')
    .replace(/\b(\d+\.\d*|\d+)[fF]\b/g, '$1')
    .replace(/\bB([01]{1,8})\b/g, '0b$1'));

  // ---- User types: enums and structs ----
  const typeNames = [];
  src = src.replace(/\b(?:typedef\s+)?enum\s+(?:class\s+)?(\w+)?\s*(?::\s*\w+\s*)?\{([^}]*)\}\s*(\w+)?\s*;/g, (m, name, body, alias) => {
    let next = 0;
    const consts = body.split(',').map((s) => s.trim()).filter(Boolean).map((item) => {
      const [, id, val] = item.match(/^(\w+)\s*(?:=\s*(.+))?$/) ?? [];
      const v = val !== undefined ? val : String(next);
      next = (Number.isFinite(Number(v)) ? Number(v) : next) + 1;
      return `${id} = ${v}`;
    });
    for (const n of [name, alias]) if (n) typeNames.push({ name: n, kind: 'enum' });
    const enumObj = name ? ` const ${name} = { ${consts.map((c) => c.replace(' =', ':')).join(', ')} };` : '';
    return sameLines(m, `const ${consts.join(', ')};${enumObj}`);
  });
  src = src.replace(/\b(?:typedef\s+)?struct\s+(\w+)?\s*\{([^}]*)\}\s*(\w+)?\s*;/g, (m, name, body, alias) => {
    const cls = name ?? alias;
    const fields = [];
    for (const decl of body.split(';')) {
      const d = decl.trim();
      if (!d) continue;
      const mm = d.match(/^(?:const\s+)?[\w\s]+?\s+(\w+\s*(?:\[[^\]]*\])?(?:\s*,\s*\w+\s*(?:\[[^\]]*\])?)*)$/);
      if (!mm) continue;
      for (const f of mm[1].split(',')) {
        const [, fname, size] = f.trim().match(/^(\w+)\s*(?:\[([^\]]*)\])?$/) ?? [];
        if (fname) fields.push({ fname, size });
      }
    }
    for (const n of [cls, alias]) if (n) typeNames.push({ name: n, kind: 'struct' });
    const init = fields.map(({ fname, size }, i) => (size
      ? `this.${fname} = a[${i}] ?? new Array(${size}).fill(0);`
      : `this.${fname} = a[${i}] ?? 0;`)).join(' ');
    const aliasDecl = alias && name && alias !== name ? ` const ${alias} = ${name};` : '';
    return sameLines(m, `class ${cls} { constructor(...a) { ${init} } }${aliasDecl}`);
  });
  const STRUCTS = typeNames.filter((t) => t.kind === 'struct').map((t) => t.name);
  const ENUMS = typeNames.filter((t) => t.kind === 'enum').map((t) => t.name);
  const TYPE = `(?:${[...BASE_TYPES, ...ENUMS, ...STRUCTS].join('|')})`;

  // Struct variables: `Point p = {1, 2};` and `Point p;`
  if (STRUCTS.length) {
    const sRe = new RegExp(`(^|[;{}\\n(])(\\s*)(?:const\\s+|static\\s+)*(${STRUCTS.join('|')})\\s+(\\w+)\\s*(?:=\\s*\\{([^}]*)\\}|(?=;))`, 'g');
    src = src.replace(sRe, (m, pre, ws, cls, name, args = '') => `${pre}${ws}let ${name} = new ${cls}(${args})`);
  }

  // Library objects: `Servo arm;`, `Adafruit_SSD1306 display(128, 64, &Wire, -1);`
  const classRe = new RegExp(`(^|[;{}\\n])([ \\t]*)(${CLASSES.join('|')})\\s+(\\w+)\\s*(?:\\(([^)]*)\\))?\\s*;`, 'g');
  src = src.replace(classRe, (m, pre, ws, cls, name, args = '') =>
    sameLines(m, `${pre}${ws}let ${name} = new ${cls}(${args.replace(/&/g, '')});`));

  // Function prototypes are not needed in JavaScript.
  const protoRe = new RegExp(`(^|[;}\\n])[ \\t]*(?:static\\s+|inline\\s+)*(?:void|${TYPE})\\s*[*&]?\\s+\\w+\\s*\\([^)]*\\)\\s*;`, 'g');
  src = src.replace(protoRe, (m, pre) => sameLines(m, pre));

  // Hoist `static` locals out of functions so they keep their value.
  const hoisted = [];
  const headRe = new RegExp(`(^|[;}\\n])\\s*(?:static\\s+|inline\\s+)*(?:void|${TYPE})\\s*[*&]?\\s+(\\w+)\\s*\\([^)]*\\)\\s*\\{`, 'g');
  for (let m = headRe.exec(src); m; m = headRe.exec(src)) {
    const open = m.index + m[0].length - 1;
    const close = matching(src, open, '{', '}');
    if (close === -1) break;
    let body = src.slice(open, close + 1);
    const staticRe = new RegExp(`\\bstatic\\s+((?:const\\s+)?${TYPE})\\s+(\\w+)\\s*((?:\\[[^\\]]*\\])*)\\s*(=\\s*[^;]+)?;`, 'g');
    body = body.replace(staticRe, (sm, type, name, dims, init = '') => {
      const g = `__static_${m[2]}_${name}`;
      hoisted.push(`${type} ${g}${dims}${init ? ` ${init}` : ''};`);
      return sameLines(sm, '');
    });
    for (const h of hoisted.filter((x) => x.includes(`__static_${m[2]}_`))) {
      const local = h.match(/__static_\w+?_(\w+)\b/)[1];
      body = body.replace(new RegExp(`(?<![\\w.])${local}\\b`, 'g'), `__static_${m[2]}_${local}`);
    }
    src = src.slice(0, open) + body + src.slice(close + 1);
    headRe.lastIndex = open + body.length;
  }
  if (hoisted.length) src += ` ${hoisted.join(' ')}`; // on the last line, so line numbers stay put

  // Function definitions
  const fns = new Set();
  const fnRe = new RegExp(`(^|[;}\\n])(\\s*)(?:static\\s+|inline\\s+)*(?:void|${TYPE})\\s*[*&]?\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*\\{`, 'g');
  src = src.replace(fnRe, (m, pre, ws, name, params) => {
    fns.add(name);
    return sameLines(m, `${pre}${ws}async function ${name}(${paramNames(params).join(', ')}) {`);
  });

  // Variable declarations (arrays first)
  const ints = new Map(); // name -> wrapper
  const arrRe = new RegExp(`\\b(?:const\\s+|static\\s+|volatile\\s+)*(${TYPE})\\s+(\\w+)\\s*((?:\\[[^\\]]*\\])+)\\s*(=|;)`, 'g');
  src = src.replace(arrRe, (_, type, name, dims, tail) => {
    if (tail === '=') return `let ${name} =`;
    const sizes = [...dims.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1].trim() || '0');
    const cell = STRUCTS.includes(type) ? `new ${type}()` : '0';
    const build = (k) => (k === sizes.length - 1
      ? `Array.from({ length: ${sizes[k]} }, () => ${cell})`
      : `Array.from({ length: ${sizes[k]} }, () => ${build(k + 1)})`);
    return `let ${name} = ${build(0)};`;
  });
  // Brace initialisers that follow `let x =` become array literals
  src = src.replace(/let (\w+) =\s*\{/g, (m, name) => `let ${name} = \u0000{`);
  for (let i = src.indexOf('\u0000'); i !== -1; i = src.indexOf('\u0000')) {
    const open = i + 1;
    const close = matching(src, open, '{', '}');
    if (close === -1) { src = src.slice(0, i) + src.slice(i + 1); continue; }
    const body = src.slice(open, close + 1).replace(/\{/g, '[').replace(/\}/g, ']');
    src = src.slice(0, i) + body + src.slice(close + 1);
  }

  const declRe = new RegExp(`\\b(?:const\\s+|static\\s+|volatile\\s+)*(${TYPE})\\s*([*&]?)\\s*(?:const\\s+)?(\\w+)(?=\\s*[=;,)])`, 'g');
  src = src.replace(declRe, (m, type, ptr, name) => {
    const t = type.replace(/\s+/g, ' ');
    if (ptr === '*') return `let ${name}`; // pointers (char* strings) stay plain values
    if (t === 'char') ints.set(name, '__char');
    else if (ENUMS.includes(t)) ints.set(name, '__i32');
    else {
      const w = intWrapper(t);
      if (w) ints.set(name, w);
    }
    return `let ${name}`;
  });
  // `int a = 1, b = 2;` declares b as an int too
  src = src.replace(/\blet (\w+)\b([^;]*);/g, (m, first, rest) => {
    const w = ints.get(first);
    if (w && rest.includes(',')) {
      let depth = 0;
      for (let i = 0; i < rest.length; i++) {
        const c = rest[i];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        else if (c === ',' && depth === 0) {
          const nm = rest.slice(i + 1).match(/^\s*(\w+)/);
          if (nm && !ints.has(nm[1])) ints.set(nm[1], w);
        }
      }
    }
    return m;
  });

  // Casts: (int)x truncates, (float)x is a no-op in JavaScript
  src = src.replace(new RegExp(`\\(\\s*(?:${BASE_TYPES.join('|')})\\s*\\)`, 'g'), (m) =>
    (/float|double/.test(m) ? '' : '~~'));

  // Integer division: int / int truncates in C
  src = outsideStrings(src, (code) => code.replace(
    /(^|[^\w.*/%\])\s])(\s*)([A-Za-z_]\w*|\d+)(\s*)\/(\s*)([A-Za-z_]\w*|\d+)\b(?!\s*[.(\[])/g,
    (m, pre, ws, a, s1, s2, b) => {
      const isInt = (x) => /^\d+$/.test(x) || (ints.has(x) && ints.get(x) !== '__char');
      return isInt(a) && isInt(b) ? `${pre}${ws}__idiv(${a}, ${b})` : m;
    },
  ));

  // Arduino String methods that differ from JavaScript
  src = outsideStrings(src, (code) => code
    .replace(/\.length\(\)/g, '.length')
    .replace(/\.toInt\(\)/g, '.__toInt()')
    .replace(/\.toFloat\(\)/g, '.__toFloat()')
    .replace(/\.c_str\(\)/g, '')
    .replace(/\.equals\(/g, '.__equals(')
    .replace(/(^|[;{}\n]\s*)(\w+)\.(toUpperCase|toLowerCase|trim)\(\)\s*;/g, '$1$2 = $2.$3();'));

  // Integer variables keep C integer values, as they would on the chip
  src = wrapIntAssignments(src, ints);
  // ++ and -- on fixed-width integers wrap around too
  src = outsideStrings(src, (code) => code.replace(/(?<![\w.])(\w+)\s*(\+\+|--)(?!\w)|(\+\+|--)\s*(\w+)\b/g, (m, a, op1, op2, b) => {
    const name = a ?? b;
    const w = ints.get(name);
    if (!w || !/__u8|__i8|__u16|__i16|__i32|__u32/.test(w)) return m;
    return `(${name} = ${w}(${name} ${(op1 ?? op2) === '++' ? '+' : '-'} 1))`;
  }));

  // Blocking calls and user functions are awaited
  for (const name of [...fns, ...BLOCKING]) {
    src = src.replace(new RegExp(`(?<![\\w.])(?<!function\\s)${name}\\s*\\(`, 'g'), `await ${name}(`);
  }

  for (const m of BLOCKING_METHODS) src = src.replace(new RegExp(`(\\b\\w+)\\.${m}\\s*\\(`, 'g'), `await $1.${m}(`);

  // C++ lambdas: [](){ ... } and [&](args){ ... }
  src = src.replace(/(?<![\w\])])\[[&=]?\]\s*\(([^)]*)\)\s*\{/g, (m, params) => `async (${paramNames(params).join(', ')}) => {`);

  // Every loop yields so the page stays responsive and Stop works
  src = injectYields(src);
  src = src.replace(/\bNULL\b/g, 'null');

  // Put raw strings back as template literals. Each placeholder is followed by
  // the raw string's own newlines, which the literal now carries itself.
  src = src.replace(/__RAW(\d+)__(\n*)/g, (m, i, nl) => {
    const body = raws[Number(i)];
    const own = (body.match(/\n/g) ?? []).length;
    const literal = body.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    return `\`${literal}\`${nl.slice(own)}`;
  });

  return { code: src, functions: [...fns] };
}

/**
 * Rewrites `x = expr` and `x op= expr` for integer variables so the result is
 * truncated and wrapped. The expression ends at `;`, `,` or an unbalanced `)`,
 * so loop headers like `for (...; i += 2)` are handled.
 */
function wrapIntAssignments(src, ints) {
  if (!ints.size) return src;
  const re = /(^|[;{}\n(]\s*|\blet\s+)(\w+)\s*([+\-*/%&|^]|<<|>>)?=(?!=)/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    const [whole, pre, name, op] = m;
    const wrap = ints.get(name);
    if (!wrap) continue;
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
    const value = op === '/' && wrap !== '__char' ? `__idiv(${name}, (${expr}))` : op ? `${name} ${op} (${expr})` : expr;
    out += src.slice(last, m.index) + pre + `${name} = ${wrap}(${value})`;
    last = k;
    re.lastIndex = k;
  }
  return out + src.slice(last);
}

/** Index just past the single statement starting at `k` (ends at `;` depth 0). */
function statementEnd(src, k) {
  let depth = 0;
  for (let i = k; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return i + 1;
  }
  return -1;
}

/** True when the `while` at `idx` is the tail of a `do { ... } while (x);`. */
function isDoWhileTail(src, idx) {
  let k = idx - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  if (src[k] !== '}') return false;
  let depth = 0;
  for (let i = k; i >= 0; i--) {
    if (src[i] === '}') depth++;
    else if (src[i] === '{' && --depth === 0) {
      return /\bdo\s*$/.test(src.slice(Math.max(0, i - 10), i));
    }
  }
  return false;
}

function injectYields(src) {
  const re = /\b(while|for)\s*\(|\bdo\s*\{/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('do')) {
      const brace = m.index + m[0].length - 1;
      out += `${src.slice(last, brace + 1)} await __yield();`;
      last = brace + 1;
      re.lastIndex = brace + 1;
      continue;
    }
    if (m[1] === 'while' && isDoWhileTail(src, m.index)) continue;
    const close = matching(src, m.index + m[0].length - 1, '(', ')');
    if (close === -1) continue;
    let k = close + 1;
    while (/\s/.test(src[k])) k++;
    if (src[k] === '{') {
      out += `${src.slice(last, k + 1)} await __yield();`;
      last = k + 1;
      re.lastIndex = k + 1;
    } else {
      // Single-statement or empty body: `while (x) ;` or `for (;;) f();`
      const end = src[k] === ';' ? k + 1 : statementEnd(src, k);
      if (end === -1) continue;
      const stmt = src[k] === ';' ? '' : src.slice(k, end);
      out += `${src.slice(last, k)}{ await __yield(); ${stmt} }`;
      last = end;
      re.lastIndex = k; // nested loops inside the statement are still visited
      // Re-scan the statement itself for nested loops by splicing it back in.
      if (stmt && /\b(while|for|do)\b/.test(stmt)) {
        const inner = injectYields(stmt);
        out = out.slice(0, out.length - stmt.length - 2) + inner + ' }';
      }
      re.lastIndex = end;
    }
  }
  return out + src.slice(last);
}

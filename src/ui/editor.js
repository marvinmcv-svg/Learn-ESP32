// A lightweight code editor: a transparent textarea over a highlighted <pre>.
const KEYWORDS = new Set(('void int float double long unsigned bool boolean char byte short const static volatile if else for while do return break continue switch case default true false String word size_t uint8_t uint16_t uint32_t int8_t int16_t int32_t').split(' '));
const CONSTANTS = new Set(('HIGH LOW INPUT OUTPUT INPUT_PULLUP INPUT_PULLDOWN LED_BUILTIN Serial PI T0 T2 T3 T4 T5 T6 T7 T8 T9 SSD1306_WHITE SSD1306_BLACK SSD1306_SWITCHCAPVCC Wire NULL').split(' '));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlight(src) {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(^[ \t]*#\w+[^\n]*)|\b(0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?[fFuUlL]*)\b|\b([A-Za-z_]\w*)\b(\s*\()?/gm;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    const [whole, comment, str, pre, num, word, call] = m;
    if (comment) out += `<span class="t-com">${esc(comment)}</span>`;
    else if (str) out += `<span class="t-str">${esc(str)}</span>`;
    else if (pre) out += `<span class="t-pre">${esc(pre)}</span>`;
    else if (num) out += `<span class="t-num">${esc(num)}</span>`;
    else if (word) {
      const cls = KEYWORDS.has(word) ? 't-kw' : CONSTANTS.has(word) ? 't-const' : call ? 't-fn' : '';
      out += cls ? `<span class="${cls}">${word}</span>` : word;
      if (call) out += esc(call);
    } else out += esc(whole);
    last = m.index + whole.length;
  }
  return `${out + esc(src.slice(last))}\n`;
}

export class Editor {
  constructor(root, { value = '', onChange = () => {}, onRun = () => {} } = {}) {
    root.classList.add('editor');
    root.innerHTML = '<div class="editor-gutter" aria-hidden="true"></div><div class="editor-body"><pre class="editor-hl" aria-hidden="true"></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Sketch code"></textarea></div>';
    this.gutter = root.querySelector('.editor-gutter');
    this.hl = root.querySelector('.editor-hl');
    this.ta = root.querySelector('textarea');
    this.onChange = onChange;
    this.ta.value = value;
    this.ta.addEventListener('input', () => { this.render(); this.onChange(this.ta.value); });
    this.ta.addEventListener('scroll', () => this.sync());
    this.ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onRun(); return; }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        this.insert('  ');
      } else if (e.key === 'Enter' && !e.isComposing) {
        const { selectionStart: s, value: v } = this.ta;
        const lineStart = v.lastIndexOf('\n', s - 1) + 1;
        const indent = v.slice(lineStart, s).match(/^[ \t]*/)[0];
        const extra = v[s - 1] === '{' ? '  ' : '';
        e.preventDefault();
        this.insert(`\n${indent}${extra}`);
      }
    });
    this.render();
  }

  insert(text) {
    // execCommand keeps the browser's undo stack working; fall back if unavailable.
    if (!document.execCommand?.('insertText', false, text)) {
      const { selectionStart: s, selectionEnd: e, value: v } = this.ta;
      this.ta.value = v.slice(0, s) + text + v.slice(e);
      this.ta.selectionStart = this.ta.selectionEnd = s + text.length;
      this.ta.dispatchEvent(new Event('input'));
    }
  }

  get value() { return this.ta.value; }
  set value(v) { this.ta.value = v; this.render(); }

  render() {
    this.hl.innerHTML = highlight(this.ta.value);
    const n = this.ta.value.split('\n').length;
    if (n !== this.lines) {
      this.lines = n;
      this.gutter.innerHTML = Array.from({ length: n }, (_, i) => `<span>${i + 1}</span>`).join('');
    }
    this.sync();
  }

  /** Highlights a line in the gutter and scrolls it into view; null clears it. */
  markError(line) {
    [...this.gutter.children].forEach((el, i) => el.classList.toggle('err', i + 1 === line));
    if (!line) return;
    const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 21;
    const top = (line - 1) * lh;
    if (top < this.ta.scrollTop || top > this.ta.scrollTop + this.ta.clientHeight - lh * 2) {
      this.ta.scrollTop = Math.max(0, top - this.ta.clientHeight / 3);
    }
  }

  sync() {
    this.hl.scrollTop = this.ta.scrollTop;
    this.hl.scrollLeft = this.ta.scrollLeft;
    this.gutter.scrollTop = this.ta.scrollTop;
  }
}

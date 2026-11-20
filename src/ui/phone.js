// A pretend phone on the same Wi-Fi as the simulated ESP32. It shows the HTML
// the sketch serves in a sandboxed frame (no scripts run) and turns link taps
// and form submits into requests to the sketch's WebServer.

const HOST = '192.168.1.42';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class Phone {
  constructor(root, { request }) {
    this.root = root;
    this.request = request;
    this.path = '/';
    this.history = [];
    this.bootTimer = null;
    root.innerHTML = `
      <div class="phone-screen">
        <div class="phone-bar">
          <button type="button" data-back title="Back" aria-label="Back">‹</button>
          <form data-go><input aria-label="Address" spellcheck="false" autocomplete="off" value="http://${HOST}/"></form>
          <button type="button" data-reload title="Reload" aria-label="Reload">↻</button>
        </div>
        <div class="phone-view" data-view style="flex:1;display:flex;min-height:0"></div>
      </div>`;
    this.view = root.querySelector('[data-view]');
    this.input = root.querySelector('input');
    root.querySelector('[data-go]').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = this.input.value.trim().replace(/^https?:\/\/[^/]+/, '') || '/';
      this.go(v.startsWith('/') ? v : `/${v}`);
    });
    root.querySelector('[data-reload]').addEventListener('click', () => this.go(this.path, { replace: true }));
    root.querySelector('[data-back]').addEventListener('click', () => {
      const prev = this.history.pop();
      if (prev) this.go(prev, { replace: true });
    });
    this.off();
  }

  message(title, text) {
    this.view.innerHTML = `<div class="phone-msg"><div><b>${esc(title)}</b>${esc(text)}</div></div>`;
  }

  /** The sketch started: wait for it to join the network, then open "/". */
  boot() {
    clearTimeout(this.bootTimer);
    this.history = [];
    this.message('Waiting for the ESP32…', 'The page opens once the board joins the network and starts its server.');
    let tries = 0;
    const attempt = async () => {
      const res = await this.request('/');
      if (res.status === 0 && /not on the network|no web server/.test(res.error ?? '') && tries++ < 12) {
        this.bootTimer = setTimeout(attempt, 600);
        return;
      }
      this.show('/', res);
    };
    this.bootTimer = setTimeout(attempt, 900);
  }

  off() {
    clearTimeout(this.bootTimer);
    this.message('ESP32 is off', 'Press Run. When the sketch serves a web page, it appears here.');
  }

  async go(path, { replace = false } = {}) {
    if (!replace && this.path !== path) this.history.push(this.path);
    this.input.value = `http://${HOST}${path}`;
    this.message('Loading…', '');
    this.show(path, await this.request(path));
  }

  show(path, res, redirects = 0) {
    this.path = path;
    this.input.value = `http://${HOST}${path}`;
    if (res.status === 0) { this.message('Can’t reach the page', res.error ?? 'No response.'); return; }
    if (res.status >= 300 && res.status < 400 && res.location && redirects < 5) {
      this.request(res.location).then((r) => this.show(res.location, r, redirects + 1));
      return;
    }
    if (/html/i.test(res.type ?? '')) {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-same-origin'); // no scripts; lets us intercept links
      frame.setAttribute('title', 'Page served by the ESP32');
      frame.srcdoc = res.body;
      frame.addEventListener('load', () => this.wire(frame));
      this.view.replaceChildren(frame);
    } else {
      this.view.innerHTML = `<pre style="margin:0;padding:12px;font:12px/1.5 var(--mono);white-space:pre-wrap;flex:1;overflow:auto">${res.status === 200 ? '' : `HTTP ${res.status}\n\n`}${esc(res.body ?? '')}</pre>`;
    }
  }

  /** Routes clicks and form submits inside the served page back to the sketch. */
  wire(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    const local = (href) => {
      try {
        const u = new URL(href, `http://${HOST}${this.path}`);
        return u.hostname === HOST || u.protocol === 'about:' ? `${u.pathname}${u.search}` : null;
      } catch { return null; }
    };
    doc.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a) return;
      e.preventDefault();
      const to = local(a.getAttribute('href'));
      if (to) this.go(to);
    });
    doc.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const params = new URLSearchParams(new FormData(form, e.submitter));
      const action = local(form.getAttribute('action') || this.path) ?? this.path;
      this.go(`${action.split('?')[0]}?${params}`);
    });
  }
}

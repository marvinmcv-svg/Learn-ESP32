import './styles.css';
import { renderHome } from './pages/home.js';
import { renderLesson } from './pages/lesson.js';
import { renderPinout } from './pages/pinout.js';
import { LESSONS, PLAYGROUND } from './lessons.js';
import { progress } from './progress.js';
import { pageMeta } from './meta.js';
import { ToneAudio } from './ui/audio.js';

const audio = new ToneAudio();
const app = document.getElementById('app');
const main = document.getElementById('main');
let cleanup = null;

function header() {
  const total = LESSONS.reduce((n, l) => n + (l.challenges?.length ?? 0), 0);
  document.getElementById('nav-progress').innerHTML =
    `<span class="tally" title="Lessons passed · challenges passed"><b>${progress.doneCount()}</b>/${LESSONS.length}<span class="tally-long"> lessons · <b>${progress.totalChallengesDone()}</b>/${total} challenges</span></span>`;
}

function route() {
  cleanup?.();
  cleanup = null;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const [, page = '', id] = path.split('/');
  app.dataset.page = page || 'home';
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === (page || 'home')));
  const meta = pageMeta(path);
  document.title = meta.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', `${location.origin}${path === '/' ? '/' : path}`);

  if (!page) cleanup = renderHome(main);
  else if (page === 'learn' && id && LESSONS.some((l) => l.id === id)) cleanup = renderLesson(main, id, audio);
  else if (page === 'learn') { navigate(`/learn/${LESSONS[0].id}`, true); return; }
  else if (page === 'playground') cleanup = renderLesson(main, PLAYGROUND.id, audio);
  else if (page === 'pinout') cleanup = renderPinout(main);
  else {
    main.innerHTML = '<div class="notfound"><h1>404</h1><p>That page is not on the breadboard.</p><a class="btn primary" href="/">Back home</a></div>';
  }
  main.focus({ preventScroll: true });
}

function navigate(to, replace = false) {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  window.scrollTo(0, 0);
  route();
}

// Same-origin links navigate without a full page load.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.hash && url.pathname === location.pathname) return;
  e.preventDefault();
  navigate(url.pathname);
});

// Old #/ links keep working.
if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1) || '/');

progress.subscribe(header);
window.addEventListener('popstate', route);
// A share link opened while already on that page only changes the hash.
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#code=')) route(); });
header();
route();

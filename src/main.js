import './styles.css';
import { renderHome } from './pages/home.js';
import { renderLesson } from './pages/lesson.js';
import { renderPinout } from './pages/pinout.js';
import { LESSONS, PLAYGROUND } from './lessons.js';
import { progress } from './progress.js';
import { ToneAudio } from './ui/audio.js';
import { icon } from './ui/icons.js';

const audio = new ToneAudio();
const app = document.getElementById('app');
const main = document.getElementById('main');
let cleanup = null;

function header() {
  const done = progress.doneCount();
  document.getElementById('nav-progress').innerHTML =
    `<span class="pill" title="Lessons completed">${icon('check')} ${done}/${LESSONS.length}</span>`;
}

function route() {
  cleanup?.();
  cleanup = null;
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, id] = hash.split('/');
  app.dataset.page = page || 'home';
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === (page || 'home')));
  window.scrollTo(0, 0);

  if (!page) cleanup = renderHome(main);
  else if (page === 'learn' && id && LESSONS.some((l) => l.id === id)) cleanup = renderLesson(main, id, audio);
  else if (page === 'learn') { location.replace(`#/learn/${LESSONS[0].id}`); return; }
  else if (page === 'playground') cleanup = renderLesson(main, PLAYGROUND.id, audio);
  else if (page === 'pinout') cleanup = renderPinout(main);
  else {
    document.title = 'Not found · Learn ESP32';
    main.innerHTML = `<div class="notfound"><h1>404</h1><p>That page is not on the breadboard.</p><a class="btn primary" href="#/">Back home</a></div>`;
  }
  main.focus({ preventScroll: true });
}

progress.subscribe(header);
window.addEventListener('hashchange', route);
header();
route();

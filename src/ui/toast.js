import { icon } from './icons.js';

let host;
export function toast(message, action = null, { ms = 6000 } = {}) {
  host ??= Object.assign(document.createElement('div'), { className: 'toasts' });
  if (!host.isConnected) document.body.append(host);
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="toast-icon">${icon('check')}</span><span>${message}</span>`;
  if (action?.href) {
    const a = document.createElement('a');
    a.href = action.href;
    a.textContent = action.label;
    a.className = 'toast-action';
    el.append(a);
  } else if (action?.onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.className = 'toast-action';
    b.addEventListener('click', () => { action.onClick(); el.remove(); });
    el.append(b);
  }
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ms);
}

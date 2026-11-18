import { icon } from './icons.js';

let host;
export function toast(message, action = null) {
  host ??= Object.assign(document.createElement('div'), { className: 'toasts' });
  if (!host.isConnected) document.body.append(host);
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="toast-icon">${icon('check')}</span><span>${message}</span>`;
  if (action) {
    const a = document.createElement('a');
    a.href = action.href;
    a.textContent = action.label;
    a.className = 'toast-action';
    el.append(a);
  }
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, 6000);
}

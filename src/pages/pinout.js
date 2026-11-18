import { CAPS, LEFT, RIGHT, FACTS } from '../pins.js';

export function renderPinout(root) {
  document.title = 'ESP32 pinout · Learn ESP32';
  const pinHtml = (pin, side, i) => `
    <button class="pin ${side}" data-side="${side}" data-i="${i}" data-caps="${pin.caps.join(' ')}">
      <span class="pin-name">${pin.label}</span>
      <span class="pin-caps">${pin.caps.filter((c) => c !== 'power').map((c) => `<i class="cap cap-${c}">${CAPS[c]}</i>`).join('')}</span>
    </button>`;

  root.innerHTML = `
  <div class="pinout-page">
    <header class="page-head">
      <h1>ESP32 DevKit pinout</h1>
      <p>The common 30-pin DevKit with an ESP32-WROOM-32 module. Pick a capability to highlight pins, or select a pin for details. Pin positions vary between board makers, so always check the silkscreen on yours.</p>
    </header>
    <div class="filters" role="group" aria-label="Highlight pins by capability">
      <button class="chip on" data-filter="all">All</button>
      ${Object.entries(CAPS).map(([k, v]) => `<button class="chip cap-${k}" data-filter="${k}">${v}</button>`).join('')}
    </div>
    <div class="pinout">
      <div class="pin-col left">${LEFT.map((p, i) => pinHtml(p, 'left', i)).join('')}</div>
      <div class="board-2d" aria-hidden="true">
        <div class="b-antenna"></div>
        <div class="b-module"><span>ESP32-WROOM-32</span></div>
        <div class="b-buttons"><i>EN</i><i>BOOT</i></div>
        <div class="b-usb"></div>
      </div>
      <div class="pin-col right">${RIGHT.map((p, i) => pinHtml(p, 'right', i)).join('')}</div>
    </div>
    <div class="pin-detail" data-detail aria-live="polite"><p class="muted">Select a pin to see what it can do.</p></div>
    <section class="facts">
      <h2>Chip at a glance</h2>
      <dl>${FACTS.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    </section>
    <section class="rules">
      <h2>Five rules that save boards</h2>
      <ol>
        <li><b>3.3 V only.</b> Never feed 5 V into a GPIO. Use a level shifter or a divider for 5 V sensors.</li>
        <li><b>Leave GPIO 6–11 alone.</b> They connect to the flash chip and are not on most headers for a reason.</li>
        <li><b>Mind the strapping pins</b> (0, 2, 5, 12, 15). External pull-ups or pull-downs on them can stop the board from booting or flashing.</li>
        <li><b>GPIO 34–39 are inputs only</b>, with no internal pull resistors.</li>
        <li><b>Use ADC1 with Wi-Fi.</b> ADC2 pins cannot be read while Wi-Fi is active.</li>
      </ol>
    </section>
  </div>`;

  const detail = root.querySelector('[data-detail]');
  root.querySelectorAll('.pin').forEach((el) => {
    el.addEventListener('click', () => {
      root.querySelectorAll('.pin.sel').forEach((p) => p.classList.remove('sel'));
      el.classList.add('sel');
      const pin = (el.dataset.side === 'left' ? LEFT : RIGHT)[Number(el.dataset.i)];
      detail.innerHTML = `
        <h3>${pin.label}${pin.gpio !== null ? ` <span class="muted">GPIO ${pin.gpio}</span>` : ''}</h3>
        <p>${pin.detail}</p>
        ${pin.note ? `<p class="note">${pin.note}</p>` : ''}
        <div class="pin-caps">${pin.caps.map((c) => `<i class="cap cap-${c}">${CAPS[c]}</i>`).join('')}</div>`;
    });
  });
  root.querySelectorAll('[data-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const f = chip.dataset.filter;
      root.querySelectorAll('[data-filter]').forEach((c) => c.classList.toggle('on', c === chip));
      root.querySelector('.pinout').classList.toggle('filtering', f !== 'all');
      root.querySelectorAll('.pin').forEach((p) => p.classList.toggle('match', f !== 'all' && p.dataset.caps.split(' ').includes(f)));
    });
  });
  return null;
}

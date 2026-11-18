// Canvas-drawn textures: silkscreen, breadboard holes, resistor bands.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function texture(c, { srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export const BACK_ROW = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN'];
export const FRONT_ROW = ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3'];

/**
 * Top of the dev board PCB. The board's long axis is x; the antenna is at +x.
 * u runs along x, v along z (front row at the bottom of the image).
 */
export function boardTexture(lengthCm, widthCm, pinXs) {
  const S = 200; // px per cm
  const [c, g] = canvas(Math.round(lengthCm * S), Math.round(widthCm * S));
  const W = c.width; const H = c.height;
  g.fillStyle = '#10232a';
  g.fillRect(0, 0, W, H);
  // subtle copper pour texture
  g.globalAlpha = 0.06;
  for (let i = 0; i < 900; i++) {
    g.fillStyle = i % 2 ? '#2c5f6b' : '#081418';
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 30, 2);
  }
  g.globalAlpha = 1;
  const px = (x) => (x + lengthCm / 2) * S; // board-local x (cm) -> px
  const pz = (z) => (z + widthCm / 2) * S;

  // traces
  g.strokeStyle = 'rgba(80,160,170,0.22)';
  g.lineWidth = 6;
  for (let i = 0; i < 15; i += 2) {
    g.beginPath();
    g.moveTo(px(pinXs[i]), pz(-1.27));
    g.lineTo(px(pinXs[i]), pz(-0.85));
    g.lineTo(px(pinXs[i]) + 30, pz(-0.65));
    g.stroke();
    g.beginPath();
    g.moveTo(px(pinXs[i]), pz(1.27));
    g.lineTo(px(pinXs[i]), pz(0.85));
    g.lineTo(px(pinXs[i]) - 30, pz(0.65));
    g.stroke();
  }

  // pin pads and labels
  g.textAlign = 'center';
  g.font = '600 34px "IBM Plex Mono", ui-monospace, monospace';
  for (let i = 0; i < 15; i++) {
    for (const [z, label, dir] of [[-1.27, BACK_ROW[i], 1], [1.27, FRONT_ROW[i], -1]]) {
      g.fillStyle = '#c9a54a';
      g.beginPath();
      g.arc(px(pinXs[i]), pz(z), 17, 0, Math.PI * 2);
      g.fill();
      g.save();
      g.translate(px(pinXs[i]), pz(z) + dir * 44);
      g.rotate(-Math.PI / 2);
      g.fillStyle = '#e8f1f2';
      g.textBaseline = 'middle';
      g.textAlign = dir > 0 ? 'right' : 'left';
      g.fillText(label, 0, 0);
      g.restore();
    }
  }

  // antenna keep-out zone with a meandered trace
  const ax = px(lengthCm / 2 - 0.62);
  g.fillStyle = '#0b1a1f';
  g.fillRect(ax, pz(-0.92), W - ax, pz(0.92) - pz(-0.92));
  g.strokeStyle = '#c9a54a';
  g.lineWidth = 10;
  g.beginPath();
  let y = pz(-0.8);
  g.moveTo(ax + 20, y);
  for (let k = 0; k < 7; k++) {
    const x = ax + 20 + (k % 2 ? 0 : 70);
    g.lineTo(x, y);
    y += 46;
    g.lineTo(x, y);
  }
  g.stroke();

  // board name
  g.fillStyle = 'rgba(232,241,242,0.8)';
  g.font = '600 30px "IBM Plex Mono", ui-monospace, monospace';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText('ESP32 DEVKIT', px(-2.25), pz(0.62));
  g.font = '500 24px "IBM Plex Mono", ui-monospace, monospace';
  g.fillText('EN', px(-2.33), pz(-0.42));
  g.fillText('BOOT', px(-2.38), pz(0.46));
  return texture(c);
}

/** Top of the metal RF shield on the WROOM module. */
export function shieldTexture() {
  const [c, g] = canvas(512, 512);
  const grad = g.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, '#d7dade');
  grad.addColorStop(1, '#a9aeb4');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = 'rgba(40,46,52,0.75)';
  g.save();
  g.translate(256, 256);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.font = '700 46px "IBM Plex Mono", ui-monospace, monospace';
  g.fillText('ESP32-WROOM-32', 0, -40);
  g.font = '500 30px "IBM Plex Mono", ui-monospace, monospace';
  g.fillText('Wi-Fi + BT', 0, 10);
  g.fillText('240 MHz  2 cores', 0, 52);
  g.restore();
  return texture(c);
}

/** Breadboard top with holes, rails and coloured rail stripes. */
export function breadboardTexture(lengthCm, widthCm) {
  const S = 120;
  const [c, g] = canvas(Math.round(lengthCm * S), Math.round(widthCm * S));
  const W = c.width; const H = c.height;
  g.fillStyle = '#ecebe4';
  g.fillRect(0, 0, W, H);
  const pitch = 0.254 * S;
  const hole = (x, y) => { g.fillStyle = '#4b4a45'; g.fillRect(x - 5, y - 5, 10, 10); g.fillStyle = '#2a2925'; g.fillRect(x - 3, y - 3, 6, 6); };
  const cols = Math.floor((lengthCm - 0.6) / 0.254);
  const x0 = (W - (cols - 1) * pitch) / 2;
  const zc = H / 2;
  // centre channel
  g.fillStyle = '#d4d2c9';
  g.fillRect(0, zc - 0.15 * S, W, 0.3 * S);
  // terminal strips: 5 holes each side of the channel
  for (let i = 0; i < cols; i++) {
    const x = x0 + i * pitch;
    for (let r = 0; r < 5; r++) {
      hole(x, zc - 0.33 * S - r * pitch);
      hole(x, zc + 0.33 * S + r * pitch);
    }
  }
  // power rails along both long edges
  const railZ = [0.2, 0.45, widthCm - 0.45, widthCm - 0.2];
  const colors = ['#2563eb', '#dc2626', '#dc2626', '#2563eb'];
  railZ.forEach((z, k) => {
    const y = z * S;
    for (let i = 0; i < cols; i++) if (i % 6 !== 5) hole(x0 + i * pitch, y);
    g.fillStyle = colors[k];
    const stripe = k < 2 ? y + (k === 0 ? -0.12 * S : 0.12 * S) : y + (k === 3 ? 0.12 * S : -0.12 * S);
    g.fillRect(x0 - pitch, stripe - 2, (cols + 1) * pitch, 4);
  });
  g.fillStyle = '#8b8a84';
  g.font = '600 26px "IBM Plex Mono", ui-monospace, monospace';
  for (let i = 0; i < cols; i += 5) g.fillText(String(i + 1), x0 + i * pitch - 8, zc - 0.33 * S - 5 * pitch - 6);
  return texture(c);
}

/** Resistor body with colour bands, e.g. ['red','red','brown','gold']. */
export function resistorTexture(bands) {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#d9c39a';
  g.fillRect(0, 0, 256, 64);
  const map = { black: '#111', brown: '#7a4a1f', red: '#d42020', orange: '#f07a10', yellow: '#f2d21b', green: '#1f9d3a', blue: '#1f4fd1', violet: '#7a3bc9', grey: '#888', white: '#f5f5f5', gold: '#c9a54a' };
  const xs = [56, 92, 128, 196];
  bands.forEach((b, i) => { g.fillStyle = map[b]; g.fillRect(xs[i], 0, 18, 64); });
  return texture(c);
}

/** Squiggly track on a photoresistor face. */
export function ldrTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#e8d6b0';
  g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#c0392b';
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(22, 30);
  for (let i = 0; i < 6; i++) { const y = 30 + i * 14; g.lineTo(i % 2 ? 22 : 106, y); g.lineTo(i % 2 ? 22 : 106, y + 14); }
  g.stroke();
  return texture(c);
}

/** Radial glow sprite used for LEDs. */
export function glowTexture() {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return texture(c);
}

/** Speaker grille for ultrasonic transducers. */
export function meshTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#1b1d20';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#555a60';
  g.lineWidth = 2;
  for (let i = 0; i < 128; i += 8) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
  }
  return texture(c);
}

/** Small text label printed on a PCB (e.g. pin names on a module). */
export function labelTexture(lines, { w = 512, h = 128, bg = '#1b4d7a', fg = '#eef4fa', size = 40 } = {}) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `600 ${size}px "IBM Plex Mono", ui-monospace, monospace`;
  lines.forEach((t, i) => g.fillText(t, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.15));
  return texture(c);
}

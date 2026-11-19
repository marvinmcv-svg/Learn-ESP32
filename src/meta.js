// Page titles and descriptions, shared by the client router and the build-time
// prerenderer (scripts/prerender.mjs) so both agree.
import { LESSONS, PLAYGROUND, TRACKS } from './lessons.js';

export const SITE_NAME = 'Learn ESP32';

export function routes() {
  return [
    '/',
    ...LESSONS.map((l) => `/learn/${l.id}`),
    '/playground',
    '/pinout',
  ];
}

export function pageMeta(path) {
  const [, page, id] = path.split('/');
  if (!page) {
    return {
      title: 'Learn ESP32 · Interactive 3D lessons',
      description: `Learn the ESP32 microcontroller with ${LESSONS.length} free, interactive 3D lessons. Write real Arduino code and run it on a simulated breadboard in your browser. No hardware needed.`,
    };
  }
  if (page === 'learn') {
    const l = LESSONS.find((x) => x.id === id);
    if (l) {
      const track = TRACKS.find((t) => t.id === l.track)?.title ?? '';
      return {
        title: `${l.title} · ESP32 lesson ${LESSONS.indexOf(l) + 1} · ${SITE_NAME}`,
        description: `${l.summary} An interactive ESP32 lesson (${track}, about ${l.minutes} minutes) with a live 3D simulator. Write the code, run it, and watch the circuit respond.`,
      };
    }
  }
  if (page === 'playground') {
    return { title: `ESP32 simulator playground · ${SITE_NAME}`, description: `${PLAYGROUND.summary} An in-browser ESP32 simulator with LEDs, a button, potentiometer, light sensor, buzzer, servo, ultrasonic sensor, touch pad and OLED.` };
  }
  if (page === 'pinout') {
    return { title: `ESP32 DevKit pinout (30-pin) · ${SITE_NAME}`, description: 'Interactive ESP32 DevKit pinout: ADC, touch, DAC, PWM, I²C, SPI and UART pins, input-only and strapping pins, and the five rules that keep your board alive.' };
  }
  return { title: `Not found · ${SITE_NAME}`, description: 'That page is not on the breadboard.' };
}

# Learn ESP32

Free, interactive ESP32 lessons that run entirely in the browser. Write real Arduino-style
sketches, press **Run**, and watch them drive LEDs, buttons, a potentiometer, a light sensor,
a buzzer, a servo, an HC-SR04 ultrasonic sensor, a capacitive touch pad and an SSD1306 OLED
on a 3D breadboard.

- **17 lessons** in five tracks, from "Hello, ESP32" to a parking-sensor capstone.
- **Goals checked live** by the simulator; progress and code drafts are saved in the browser.
- **Playground** with every part wired up.
- **Interactive pinout** for the 30-pin ESP32 DevKit.

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # simulator + lesson tests
npm run build    # production build in dist/
```

## How it works

- `src/sim/transpile.js` rewrites the beginner subset of Arduino C++ into async JavaScript:
  C integer semantics (truncating division, fixed-width overflow), structs, enums, macros,
  static locals and prototypes, awaited `delay()`/`pulseIn()`, and yielding loops so Stop
  always works. Rewrites keep line numbers, so errors point at the sketch line.
- `src/sim/runtime.js` is the virtual ESP32: pins, PWM/LEDC, ADC, touch, tone, Servo and
  SSD1306 APIs.
- `src/circuit.js` connects breadboard parts to pins; `src/scene/` renders them with three.js.
- `src/lessons.js` holds all lesson content, starter code, parts and goals.
- `scripts/prerender.mjs` runs after `vite build` and writes a static, indexable HTML page per
  route (title, description, canonical, social card, lesson text) plus `sitemap.xml`.

The simulator is simplified: timing is approximate and only the APIs used in the lessons exist.
Not affiliated with Espressif Systems.

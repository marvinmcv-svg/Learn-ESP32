# Learn ESP32

Free, interactive ESP32 lessons that run entirely in the browser. Write real Arduino-style
sketches, press **Run**, and watch them drive LEDs, buttons, a potentiometer, a light sensor,
a buzzer, a servo, an HC-SR04 ultrasonic sensor, a capacitive touch pad and an SSD1306 OLED
on a 3D breadboard.

- **19 lessons** in six tracks, from "Hello, ESP32" to a web server you control from a phone.
- **A goal plus harder challenges per lesson**, checked live from what the simulated pins
  actually do (timing, Morse patterns, input -> output). Every challenge has a reference
  solution in `tests/challenges.test.js`, and the starter code is proven not to pass it.
- **Simulated Wi-Fi and `WebServer`**, with a pretend phone that browses the sketch's pages.
- **Share links**: the sketch (and your wiring) is compressed into the URL fragment, so no
  backend is needed.
- **Wire it yourself**: drag wires between board pins, power rails and part legs in 3D (or
  use the keyboard-accessible form). A netlist analysis explains mistakes in plain words
  (missing resistor, reversed LED, input-only pins, ADC2 with Wi-Fi, shorts, 5 V signals,
  swapped SDA/SCL), and the simulation follows the actual wiring: a reversed LED stays dark,
  one without its resistor burns out.
- **Instruments**: serial monitor with input, a serial plotter and a logic analyzer with
  frequency and duty-cycle readouts.
- **Build it for real**: parts list, wiring table, library list, IDE steps and `.ino` download
  per lesson. Progress can be exported and imported as a backup file.
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
- The runtime keeps a **virtual clock**: `delay(ms)` advances simulated time by exactly `ms`,
  so timing goals pass even when a slow device fires timers late.
- `src/sim/observe.js` records what a running sketch does and holds the analysis helpers
  goals and challenges use.
- `src/wiring.js` models terminals and nets and produces the effective pins and diagnostics;
  `tests/wiring.test.js` checks every lesson's reference wiring and the common mistakes.
- `src/circuit.js` connects breadboard parts to pins; `src/scene/` renders them with three.js.
- `src/lessons.js` holds all lesson content, starter code, parts and goals.
- `scripts/prerender.mjs` runs after `vite build` and writes a static, indexable HTML page per
  route (title, description, canonical, social card, lesson text) plus `sitemap.xml`.

The simulator is simplified: timing is approximate and only the APIs used in the lessons exist.
Not affiliated with Espressif Systems.

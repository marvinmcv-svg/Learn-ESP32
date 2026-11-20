// "Build it for real": parts list, wiring table, libraries and IDE notes for a
// lesson, derived from its parts and its reference wiring.
import { solutionWires, allTerminals } from './wiring.js';

const BASE = [
  ['ESP32 DevKit board (30-pin, ESP32-WROOM-32)', 1],
  ['USB cable that carries data (not charge-only)', 1],
];
const PART_BOM = {
  led: (p) => [[`${p.color ?? 'red'} LED, 5 mm`, 1], ['220 Ω resistor', 1]],
  button: () => [['Tactile pushbutton, 6 × 6 mm', 1]],
  pot: () => [['10 kΩ potentiometer', 1]],
  ldr: () => [['Photoresistor (e.g. GL5528)', 1], ['10 kΩ resistor', 1]],
  touch: () => [['Anything metal for the pad: a coin, foil or a screw', 1]],
  buzzer: () => [['Passive piezo buzzer', 1]],
  servo: () => [['SG90 micro servo', 1]],
  ultrasonic: () => [['HC-SR04 ultrasonic sensor (or HC-SR04P for 3.3 V)', 1], ['1 kΩ + 2 kΩ resistors for the ECHO divider', 1]],
  oled: () => [['0.96" SSD1306 I²C OLED, 128 × 64', 1]],
};
const LIBRARIES = {
  'ESP32Servo.h': 'ESP32Servo (by Kevin Harrington)',
  'Adafruit_SSD1306.h': 'Adafruit SSD1306, plus Adafruit GFX Library when asked',
  'Adafruit_GFX.h': 'Adafruit GFX Library',
};
const BUILT_IN = ['WiFi.h', 'WebServer.h', 'Wire.h'];

export function billOfMaterials(lesson) {
  const rows = new Map(BASE);
  if (lesson.parts.length) rows.set('Breadboard (full size, 830 points)', 1).set('Male-to-male jumper wires', 10);
  for (const p of lesson.parts) {
    for (const [name, n] of PART_BOM[p.type]?.(p) ?? []) rows.set(name, (rows.get(name) ?? 0) + n);
  }
  return [...rows.entries()];
}

export function wiringTable(lesson) {
  const terms = allTerminals(lesson.parts);
  const name = (id) => terms.find((t) => t.id === id)?.label ?? id;
  return solutionWires(lesson.parts).map((w) => [name(w.a.t), name(w.b.t)]);
}

export function librariesFor(code) {
  const incs = [...code.matchAll(/#include\s*<([\w.]+)>/g)].map((m) => m[1]);
  return {
    install: [...new Set(incs.filter((i) => LIBRARIES[i]).map((i) => LIBRARIES[i]))],
    builtIn: incs.filter((i) => BUILT_IN.includes(i)),
  };
}

export function downloadSketch(filename, code) {
  const blob = new Blob([code], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

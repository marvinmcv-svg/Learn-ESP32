// Every challenge must be passable by a correct solution and must NOT be passed
// by the unmodified starter code. Solutions run in real time, concurrently.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Hardware, Sketch } from '../src/sim/runtime.js';
import { bindCircuit, InputStore } from '../src/circuit.js';
import { Observer } from '../src/sim/observe.js';
import { LESSONS } from '../src/lessons.js';

async function run(lesson, code, ms, drive = () => {}, client = null) {
  const hw = new Hardware();
  const store = new InputStore();
  bindCircuit(lesson.parts, hw, store);
  const obs = new Observer(hw, store, lesson.parts);
  const sketch = new Sketch(code, { hw, onSerial: (t) => obs.onSerial(t), onHttp: (h) => obs.onHttp(h) });
  obs.start();
  const done = sketch.run().catch((e) => { throw new Error(`${e.message}\n${code}`); });
  if (client) setTimeout(() => client(sketch), 1500);
  const t0 = Date.now();
  const timer = setInterval(() => drive(store, (Date.now() - t0) / 1000), 40);
  await new Promise((r) => setTimeout(r, ms));
  clearInterval(timer);
  obs.stop();
  sketch.stop();
  await done;
  return obs.ctx();
}

// Input drivers: (store, seconds since start)
const toggleEvery = (id, period) => (s, t) => s.set(id, Math.floor(t / period) % 2 === 1);
const sweep = (id, lo, hi, period) => (s, t) => s.set(id, Math.floor(t / period) % 2 ? hi : lo);
const ramp = (id, period) => (s, t) => s.set(id, (Math.sin((t / period) * Math.PI * 2) + 1) / 2);

const SOLUTIONS = {
  'hello-serial': [{ ms: 2000, code: 'void setup(){ Serial.begin(115200); } void loop(){ Serial.println(millis()); delay(250); }' }],
  blink: [
    { ms: 2600, code: 'void setup(){ pinMode(2, OUTPUT); } void loop(){ digitalWrite(2, HIGH); delay(250); digitalWrite(2, LOW); delay(250); }' },
    { ms: 4500, code: 'void setup(){ pinMode(2, OUTPUT); } void loop(){ for (int i = 0; i < 2; i++) { digitalWrite(2, HIGH); delay(120); digitalWrite(2, LOW); delay(150); } delay(900); }' },
  ],
  'external-led': [{ ms: 7000, code: `void dot(){ digitalWrite(26, HIGH); delay(150); digitalWrite(26, LOW); delay(150); }
void dash(){ digitalWrite(26, HIGH); delay(450); digitalWrite(26, LOW); delay(150); }
void setup(){ pinMode(26, OUTPUT); }
void loop(){ dot(); dot(); dot(); dash(); dash(); dash(); dot(); dot(); dot(); delay(700); }` }],
  'traffic-light': [{ ms: 3500, code: 'void setup(){ pinMode(27, OUTPUT); } void loop(){ for (int i = 0; i < 5; i++) { digitalWrite(27, HIGH); delay(200); digitalWrite(27, LOW); delay(200); } delay(500); }' }],
  button: [{ ms: 3000, drive: toggleEvery('btn', 0.6), code: 'void setup(){ pinMode(19, INPUT_PULLUP); pinMode(26, OUTPUT); } void loop(){ digitalWrite(26, digitalRead(19)); delay(20); }' }],
  toggle: [{ ms: 3000, drive: toggleEvery('btn', 0.35), code: `int presses = 0; int last = HIGH;
void setup(){ Serial.begin(115200); pinMode(19, INPUT_PULLUP); }
void loop(){ int r = digitalRead(19); if (r != last) { if (r == LOW) { presses++; Serial.println(presses); } last = r; } delay(10); }` }],
  fade: [{ ms: 10000, code: 'void setup(){} void loop(){ for (int v = 0; v <= 255; v += 5) { analogWrite(26, v); delay(39); } for (int v = 255; v >= 0; v -= 5) { analogWrite(26, v); delay(39); } }' }],
  potentiometer: [{ ms: 3000, drive: ramp('pot', 1.5), code: 'void setup(){ Serial.begin(115200); } void loop(){ int n = map(analogRead(34), 0, 4095, 0, 40); String bar = ""; for (int i = 0; i < n; i++) { bar += "#"; } Serial.println(bar); delay(100); }' }],
  dimmer: [{ ms: 3000, drive: sweep('pot', 0.05, 0.95, 0.7), code: 'void setup(){ ledcAttach(26, 5000, 12); } void loop(){ ledcWrite(26, 4095 - analogRead(34)); delay(10); }' }],
  'night-light': [{ ms: 3500, drive: (s, t) => s.set('ldr', [0.1, 0.5, 0.95][Math.floor(t / 0.7) % 3]), code: 'void setup(){} void loop(){ int level = analogRead(35); analogWrite(26, map(level, 0, 4095, 255, 0)); delay(20); }' }],
  buzzer: [{ ms: 2500, code: 'int notes[] = { 262, 294, 330, 349, 392, 440, 494, 523 }; void setup(){} void loop(){ for (int i = 0; i < 8; i++) { tone(25, notes[i]); delay(120); } noTone(25); delay(300); }' }],
  servo: [{ ms: 5000, code: `#include <ESP32Servo.h>
Servo s; void setup(){ s.attach(13); }
void loop(){ for (int a = 0; a <= 180; a += 10) { s.write(a); delay(10); } for (int a = 180; a >= 0; a -= 2) { s.write(a); delay(10); } }` }],
  'knob-servo': [{ ms: 3500, drive: sweep('pot', 0.05, 0.95, 0.9), code: '#include <ESP32Servo.h>\nServo s; void setup(){ s.attach(13); } void loop(){ s.write(map(analogRead(34), 0, 4095, 180, 0)); delay(20); }' }],
  ultrasonic: [{ ms: 2500, drive: (s, t) => s.set('sonar', t > 0.8 ? 430 : 60), code: `void setup(){ Serial.begin(115200); pinMode(5, OUTPUT); pinMode(18, INPUT); }
void loop(){ digitalWrite(5, HIGH); delayMicroseconds(10); digitalWrite(5, LOW); long d = pulseIn(18, HIGH, 30000);
  if (d == 0) { Serial.println("out of range"); } else { Serial.println(d * 0.0343 / 2); } delay(200); }` }],
  touch: [{ ms: 3500, drive: (s, t) => s.set('pad', [false, true, false, false, false, true, false, false][Math.floor(t / 0.4) % 8]), code: `bool on = false; bool was = false;
void setup(){ pinMode(26, OUTPUT); }
void loop(){ bool now = touchRead(T0) < 40; if (now && !was) { on = !on; digitalWrite(26, on); } was = now; delay(20); }` }],
  oled: [{ ms: 3500, code: `#include <Adafruit_SSD1306.h>
Adafruit_SSD1306 display(128, 64, &Wire, -1);
void setup(){ display.begin(SSD1306_SWITCHCAPVCC, 0x3C); }
void loop(){ display.clearDisplay(); display.setCursor(0, 0); display.print(millis() / 1000); display.println(" s"); display.display(); delay(200); }` }],
  dashboard: [{ ms: 2000, drive: (s) => s.set('sonar', 6), code: `void setup(){ pinMode(5, OUTPUT); }
void loop(){ digitalWrite(5, HIGH); digitalWrite(5, LOW); long d = pulseIn(18, HIGH, 30000); if (d * 0.0343 / 2 < 10) { tone(25, 1800); } else { noTone(25); } delay(100); }` }],
  'wifi-connect': [{ ms: 6500, code: `#include <WiFi.h>
void setup(){ Serial.begin(115200); WiFi.begin("BenchNet", "pw"); while (WiFi.status() != WL_CONNECTED) { delay(200); } }
void loop(){ Serial.print("RSSI: "); Serial.print(WiFi.RSSI()); Serial.println(" dBm"); delay(2000); }` }],
  'web-led': [
    { ms: 3000, client: async (sk) => { for (let i = 0; i < 3; i++) await sk.httpRequest('/toggle'); }, code: `#include <WiFi.h>
#include <WebServer.h>
WebServer server(80); bool on = false;
void setup(){ pinMode(26, OUTPUT); WiFi.begin("a", "b"); while (WiFi.status() != WL_CONNECTED) delay(100);
  server.on("/toggle", [](){ on = !on; digitalWrite(26, on); server.send(200, "text/plain", on ? "ON" : "OFF"); });
  server.begin(); }
void loop(){ server.handleClient(); }` },
    { ms: 3000, client: async (sk) => { await sk.httpRequest('/'); await sk.httpRequest('/on'); await sk.httpRequest('/'); await sk.httpRequest('/off'); await sk.httpRequest('/'); }, code: `#include <WiFi.h>
#include <WebServer.h>
WebServer server(80); bool on = false;
void page(){ String html = "<h1>LED is "; html += on ? "ON" : "OFF"; html += "</h1>"; server.send(200, "text/html", html); }
void setup(){ pinMode(26, OUTPUT); WiFi.begin("a", "b"); while (WiFi.status() != WL_CONNECTED) delay(100);
  server.on("/", page);
  server.on("/on", [](){ on = true; digitalWrite(26, HIGH); server.sendHeader("Location", "/"); server.send(303); });
  server.on("/off", [](){ on = false; digitalWrite(26, LOW); server.sendHeader("Location", "/"); server.send(303); });
  server.begin(); }
void loop(){ server.handleClient(); }` },
  ],
};

// Inputs to apply while running the unmodified starter code.
const STARTER_DRIVE = {
  button: toggleEvery('btn', 0.6),
  toggle: toggleEvery('btn', 0.35),
  potentiometer: ramp('pot', 1.5),
  dimmer: sweep('pot', 0.05, 0.95, 0.7),
  'night-light': (s, t) => s.set('ldr', [0.1, 0.5, 0.95][Math.floor(t / 0.7) % 3]),
  'knob-servo': sweep('pot', 0.05, 0.95, 0.9),
  ultrasonic: (s, t) => s.set('sonar', t > 0.8 ? 430 : 60),
  touch: (s, t) => s.set('pad', [false, true, false, false, false, true, false, false][Math.floor(t / 0.4) % 8]),
  dashboard: (s) => s.set('sonar', 6),
};

describe('challenges', { concurrency: true }, () => {
  for (const lesson of LESSONS) {
    (lesson.challenges ?? []).forEach((ch, i) => {
      const sol = SOLUTIONS[lesson.id]?.[i];
      test(`${lesson.id} #${i + 1}: a solution passes`, async () => {
        assert.ok(sol, 'missing reference solution');
        const ctx = await run(lesson, sol.code, sol.ms, sol.drive, sol.client);
        assert.ok(ch.check(ctx), `"${ch.text}" not met. Serial tail:\n${ctx.serial.slice(-300)}`);
      });
      test(`${lesson.id} #${i + 1}: the starter code does not pass`, async () => {
        const ctx = await run(lesson, lesson.code, Math.min(sol?.ms ?? 3000, 6000), STARTER_DRIVE[lesson.id], sol?.client);
        assert.equal(ch.check(ctx), false, `starter code already satisfies "${ch.text}"`);
      });
    });
  }
});

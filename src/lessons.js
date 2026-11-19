// Lesson catalogue. Each lesson has prose (HTML), a starter sketch, the parts
// on the virtual breadboard, and a goal the simulator checks while it runs.
//
// Pins are chosen to be safe on a real ESP32 DevKit: outputs avoid the strapping
// and flash pins, and analog inputs use ADC1 (GPIO 32-39) so Wi-Fi never blocks them.

const edges = (ctx, gpio) => ctx.hw.edges.get(gpio) ?? 0;
const pwmRange = (ctx, gpio) => { const s = ctx.hw.pwmSeen.get(gpio); return s ? s.max - s.min : 0; };

export const TRACKS = [
  { id: 'first-steps', title: 'First steps', blurb: 'Talk to the chip and make light happen.' },
  { id: 'inputs', title: 'Reading the world', blurb: 'Buttons, knobs and light: getting signals in.' },
  { id: 'analog', title: 'Shades in between', blurb: 'PWM, dimming and the ADC.' },
  { id: 'motion', title: 'Sound & motion', blurb: 'Buzzers, melodies and servos.' },
  { id: 'sensors', title: 'Sensors & screens', blurb: 'Distance, touch and a tiny OLED.' },
];

export const LESSONS = [
  {
    id: 'hello-serial',
    track: 'first-steps',
    title: 'Hello, ESP32',
    minutes: 5,
    summary: 'Send your first message from the chip to your computer over the serial port.',
    parts: [],
    goal: { text: 'Print at least 3 lines to the Serial Monitor.', check: (c) => c.lines >= 3 },
    body: `
<p>Every Arduino-style program has two functions. <code>setup()</code> runs once when the board powers on or resets. <code>loop()</code> then runs again and again, forever, as fast as it can.</p>
<p>The quickest way to see what your code is doing is the <strong>serial port</strong>: the USB cable carries text from the ESP32 back to your computer. <code>Serial.begin(115200)</code> opens the line at 115&nbsp;200 bits per second, and <code>Serial.println()</code> sends a line of text.</p>
<h2>What the code does</h2>
<ul>
<li>Opens the serial port once in <code>setup()</code>.</li>
<li>Every second, prints a counter and how long the board has been running with <code>millis()</code>.</li>
</ul>
<p>Press <kbd>Run</kbd> and watch the <em>Serial Monitor</em> fill up.</p>
<div class="tip"><strong>On a real board:</strong> set the Serial Monitor in the Arduino IDE to <code>115200 baud</code>. If you see garbage characters, the speeds do not match.</div>
<h2>Try this</h2>
<p>Change <code>1000</code> to <code>250</code>. What happens to the counter? Then try printing your name.</p>`,
    code: `// Lesson 1: say hello over USB serial
int count = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("Hello from the ESP32!");
}

void loop() {
  count = count + 1;
  Serial.print("Tick #");
  Serial.print(count);
  Serial.print("  uptime ms: ");
  Serial.println(millis());
  delay(1000);
}
`,
  },
  {
    id: 'blink',
    track: 'first-steps',
    title: 'Blink the built-in LED',
    minutes: 5,
    summary: 'Use digitalWrite() to switch the on-board blue LED on GPIO 2.',
    parts: [],
    goal: { text: 'Toggle the on-board LED (GPIO 2) at least 6 times.', check: (c) => edges(c, 2) >= 6 },
    body: `
<p>Most ESP32 DevKit boards have a small blue LED wired to <strong>GPIO&nbsp;2</strong>. A GPIO (general-purpose input/output) pin can be an <em>output</em> that you drive <code>HIGH</code> (3.3&nbsp;V) or <code>LOW</code> (0&nbsp;V).</p>
<ol>
<li><code>pinMode(LED, OUTPUT)</code> tells the chip the pin will drive something.</li>
<li><code>digitalWrite(LED, HIGH)</code> puts 3.3&nbsp;V on it and the LED lights.</li>
<li><code>delay(500)</code> pauses for half a second.</li>
<li><code>digitalWrite(LED, LOW)</code> turns it off again.</li>
</ol>
<p>Find the LED next to the USB port in the 3D view. Drag to orbit, scroll to zoom.</p>
<div class="tip"><strong>Board differences:</strong> not every board has its LED on GPIO 2. Some clones use GPIO 5 or have no user LED at all. <code>LED_BUILTIN</code> is defined for boards that have one.</div>
<h2>Try this</h2>
<p>Make the LED flash a heartbeat: two quick blinks, then a long pause.</p>`,
    code: `// Lesson 2: blink the on-board LED
const int LED = 2;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(LED, HIGH);
  delay(500);
  digitalWrite(LED, LOW);
  delay(500);
}
`,
  },
  {
    id: 'external-led',
    track: 'first-steps',
    title: 'Your first circuit',
    minutes: 10,
    summary: 'Wire an LED and resistor to GPIO 26 on a breadboard.',
    parts: [{ type: 'led', id: 'led', pin: 26, color: 'red', label: 'GPIO 26' }],
    goal: { text: 'Blink the red LED on GPIO 26 at least 6 times.', check: (c) => edges(c, 26) >= 6 },
    body: `
<p>Time to build something. An LED only lets current flow one way: its long leg (the <em>anode</em>) goes towards the GPIO pin, the short leg (the <em>cathode</em>) towards ground.</p>
<p>An LED by itself would draw too much current, so we put a <strong>220&nbsp;Ω resistor</strong> in series. With 3.3&nbsp;V from the pin and roughly 2&nbsp;V dropped by a red LED, that limits the current to about (3.3&nbsp;−&nbsp;2)&nbsp;/&nbsp;220&nbsp;≈&nbsp;6&nbsp;mA. Bright enough, and kind to the pin.</p>
<h2>Wiring</h2>
<ul>
<li>GPIO 26 → 220&nbsp;Ω resistor → LED anode (long leg)</li>
<li>LED cathode (short leg) → GND rail</li>
</ul>
<div class="tip"><strong>Safe pins:</strong> GPIO 6–11 are wired to the flash chip and will crash the board if you touch them. GPIO 0, 2, 12 and 15 affect boot. Pins like 25, 26, 27, 32 and 33 are good picks for outputs.</div>
<h2>Try this</h2>
<p>Blink <strong>SOS</strong> in Morse code: three short, three long, three short.</p>`,
    code: `// Lesson 3: an external LED on GPIO 26
const int LED = 26;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(LED, HIGH);
  delay(300);
  digitalWrite(LED, LOW);
  delay(300);
}
`,
  },
  {
    id: 'traffic-light',
    track: 'first-steps',
    title: 'Traffic light',
    minutes: 10,
    summary: 'Sequence three LEDs and write your own helper function.',
    parts: [
      { type: 'led', id: 'red', pin: 26, color: 'red', label: 'GPIO 26' },
      { type: 'led', id: 'amber', pin: 27, color: 'amber', label: 'GPIO 27' },
      { type: 'led', id: 'green', pin: 14, color: 'green', label: 'GPIO 14' },
    ],
    goal: {
      text: 'Cycle through all three lights at least twice.',
      check: (c) => edges(c, 26) >= 3 && edges(c, 27) >= 3 && edges(c, 14) >= 3,
    },
    body: `
<p>Three LEDs, three pins. Real traffic lights follow a fixed sequence, which makes them a perfect first <em>state machine</em>.</p>
<p>Instead of repeating three <code>digitalWrite</code> calls for every step, this sketch defines a helper, <code>show(r, a, g)</code>, that sets all three lights at once. Functions keep <code>loop()</code> short and readable.</p>
<h2>The sequence</h2>
<ol>
<li>Green for 3 seconds</li>
<li>Amber for 1 second</li>
<li>Red for 3 seconds</li>
<li>Red + amber for 1 second (used in the UK and parts of Europe)</li>
</ol>
<h2>Try this</h2>
<p>Add a pedestrian phase: after red, flash the amber light five times quickly before going green.</p>`,
    code: `// Lesson 4: a traffic light
const int RED = 26;
const int AMBER = 27;
const int GREEN = 14;

void show(int r, int a, int g) {
  digitalWrite(RED, r);
  digitalWrite(AMBER, a);
  digitalWrite(GREEN, g);
}

void setup() {
  pinMode(RED, OUTPUT);
  pinMode(AMBER, OUTPUT);
  pinMode(GREEN, OUTPUT);
}

void loop() {
  show(LOW, LOW, HIGH);   delay(3000);
  show(LOW, HIGH, LOW);   delay(1000);
  show(HIGH, LOW, LOW);   delay(3000);
  show(HIGH, HIGH, LOW);  delay(1000);
}
`,
  },
  {
    id: 'button',
    track: 'inputs',
    title: 'Push the button',
    minutes: 10,
    summary: 'Read a pushbutton with digitalRead() and the internal pull-up resistor.',
    parts: [
      { type: 'button', id: 'btn', pin: 19, label: 'GPIO 19' },
      { type: 'led', id: 'led', pin: 26, color: 'green', label: 'GPIO 26' },
    ],
    goal: {
      text: 'Press the button and light the LED with it.',
      check: (c) => c.changes('btn') >= 2 && edges(c, 26) >= 2,
    },
    body: `
<p>A pin can also be an <strong>input</strong>. <code>digitalRead()</code> returns <code>HIGH</code> or <code>LOW</code> depending on the voltage it sees.</p>
<p>Our button connects GPIO 19 to ground when pressed. When it is <em>not</em> pressed, the pin is connected to nothing: it <strong>floats</strong> and reads random noise. The fix is a pull-up resistor that gently holds the pin at 3.3&nbsp;V. The ESP32 has one built in: <code>INPUT_PULLUP</code>.</p>
<ul>
<li>Released → pulled up → reads <code>HIGH</code></li>
<li>Pressed → shorted to ground → reads <code>LOW</code></li>
</ul>
<p>So the logic is inverted: <em>LOW means pressed</em>.</p>
<p><strong>Click and hold the button</strong> in the 3D view (or use the control under the scene).</p>
<h2>Try this</h2>
<p>Change <code>INPUT_PULLUP</code> to <code>INPUT</code> and run again. Watch the Serial Monitor: the floating pin flickers between 0 and 1 by itself. That is why pull-ups matter.</p>`,
    code: `// Lesson 5: a button with the internal pull-up
const int BUTTON = 19;
const int LED = 26;

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
}

void loop() {
  int state = digitalRead(BUTTON);
  if (state == LOW) {
    digitalWrite(LED, HIGH);   // pressed
  } else {
    digitalWrite(LED, LOW);    // released
  }
  Serial.println(state);
  delay(100);
}
`,
  },
  {
    id: 'toggle',
    track: 'inputs',
    title: 'Toggle & debounce',
    minutes: 12,
    summary: 'Turn one press into one toggle by detecting edges and ignoring bounce.',
    parts: [
      { type: 'button', id: 'btn', pin: 19, label: 'GPIO 19' },
      { type: 'led', id: 'led', pin: 26, color: 'blue', label: 'GPIO 26' },
    ],
    goal: {
      text: 'Toggle the LED on and off with separate presses.',
      check: (c) => c.changes('btn') >= 4 && edges(c, 26) >= 2,
    },
    body: `
<p>In the last lesson the LED was only on while you held the button. Usually you want a press to <em>toggle</em>: press once for on, again for off.</p>
<p>The trick is to react to the moment the button <strong>changes</strong> from released to pressed (an <em>edge</em>), not to its current level. We remember the previous reading and compare.</p>
<p>Real buttons also <strong>bounce</strong>: the metal contacts rattle for a few milliseconds and produce several fake presses. We ignore changes that happen within 50&nbsp;ms of the last one, using <code>millis()</code> instead of <code>delay()</code> so the loop never freezes.</p>
<div class="tip"><strong>Why not delay()?</strong> While <code>delay()</code> runs, your sketch is deaf. Comparing timestamps from <code>millis()</code> lets one loop handle many things at once.</div>
<h2>Try this</h2>
<p>Count the presses and print the total over serial. Can you make every third press blink the LED three times?</p>`,
    code: `// Lesson 6: toggle an LED, with debouncing
const int BUTTON = 19;
const int LED = 26;

bool ledOn = false;
int lastReading = HIGH;
unsigned long lastChange = 0;

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
}

void loop() {
  int reading = digitalRead(BUTTON);
  if (reading != lastReading && millis() - lastChange > 50) {
    lastChange = millis();
    if (reading == LOW) {          // a fresh press
      ledOn = !ledOn;
      digitalWrite(LED, ledOn);
      Serial.println(ledOn ? "LED on" : "LED off");
    }
    lastReading = reading;
  }
}
`,
  },
  {
    id: 'fade',
    track: 'analog',
    title: 'Breathing LED (PWM)',
    minutes: 10,
    summary: 'Fake an analog voltage by switching very fast: pulse-width modulation.',
    parts: [{ type: 'led', id: 'led', pin: 26, color: 'white', label: 'GPIO 26' }],
    goal: { text: 'Fade the LED through most of its range.', check: (c) => pwmRange(c, 26) >= 200 },
    body: `
<p>A digital pin is either on or off. So how do you dim an LED? You switch it on and off <strong>thousands of times per second</strong> and vary how long it stays on in each cycle. Your eye averages the flicker into brightness.</p>
<p>That fraction of on-time is the <strong>duty cycle</strong>. <code>analogWrite(pin, value)</code> takes a value from 0 (always off) to 255 (always on); 64 is about 25&nbsp;% brightness.</p>
<p>This sketch ramps the value up and down in small steps for a calm breathing effect.</p>
<div class="tip"><strong>Under the hood:</strong> the ESP32 does PWM with its <em>LEDC</em> peripheral: 16 channels with adjustable frequency and up to 16-bit resolution. <code>analogWrite()</code> picks sensible defaults for you. You will drive LEDC directly in the dimmer lesson.</div>
<h2>Try this</h2>
<p>Our eyes are not linear: the fade looks fast at the bottom and slow at the top. Square the brightness (<code>value * value / 255</code>) to make it look smoother.</p>`,
    code: `// Lesson 7: a breathing LED with PWM
const int LED = 26;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  for (int value = 0; value <= 255; value += 5) {
    analogWrite(LED, value);
    delay(20);
  }
  for (int value = 255; value >= 0; value -= 5) {
    analogWrite(LED, value);
    delay(20);
  }
}
`,
  },
  {
    id: 'potentiometer',
    track: 'analog',
    title: 'Turn the knob (ADC)',
    minutes: 10,
    summary: 'Measure a voltage with analogRead() and the 12-bit ADC.',
    parts: [{ type: 'pot', id: 'pot', pin: 34, label: 'GPIO 34' }],
    goal: {
      text: 'Turn the knob and print at least 10 readings.',
      check: (c) => c.changes('pot') >= 3 && c.lines >= 10,
    },
    body: `
<p>A <strong>potentiometer</strong> is a resistor with a sliding contact. Its outer legs go to 3.3&nbsp;V and GND; the middle leg (the <em>wiper</em>) outputs any voltage in between as you turn it.</p>
<p>The ESP32's <strong>analog-to-digital converter</strong> turns that voltage into a number. It has 12 bits of resolution, so <code>analogRead()</code> returns 0 to <strong>4095</strong> (not 1023 like an Arduino Uno).</p>
<p>Drag the knob in the 3D view, or use the slider, and watch the numbers change.</p>
<div class="tip"><strong>Pick ADC1 pins:</strong> the ESP32 has two ADCs. ADC2 stops working when Wi-Fi is on, so prefer ADC1: GPIO 32–39. GPIO 34–39 are input-only, which suits sensors perfectly.</div>
<div class="tip"><strong>Not perfectly linear:</strong> the ESP32 ADC flattens out near 0 V and 3.3 V. <code>analogReadMilliVolts()</code> applies factory calibration and is more accurate.</div>
<h2>Try this</h2>
<p>Print the voltage too: <code>analogReadMilliVolts(POT)</code>. Then print a bar of <code>#</code> characters whose length follows the knob.</p>`,
    code: `// Lesson 8: read a potentiometer
const int POT = 34;

void setup() {
  Serial.begin(115200);
}

void loop() {
  int raw = analogRead(POT);              // 0..4095
  int percent = map(raw, 0, 4095, 0, 100);
  Serial.printf("raw=%4d  %3d%%\\n", raw, percent);
  delay(200);
}
`,
  },
  {
    id: 'dimmer',
    track: 'analog',
    title: 'Knob-controlled dimmer',
    minutes: 10,
    summary: 'Combine input and output, and drive the LEDC PWM hardware directly.',
    parts: [
      { type: 'pot', id: 'pot', pin: 34, label: 'GPIO 34' },
      { type: 'led', id: 'led', pin: 26, color: 'amber', label: 'GPIO 26' },
    ],
    goal: {
      text: 'Sweep the LED from dim to bright with the knob.',
      check: (c) => c.changes('pot') >= 3 && pwmRange(c, 26) >= 150,
    },
    body: `
<p>Now connect the two halves: read the knob, set the brightness. Every embedded project is some version of this <em>read → decide → act</em> loop.</p>
<p>Here we talk to the ESP32's <strong>LEDC</strong> peripheral directly. <code>ledcAttach(pin, frequency, bits)</code> sets up PWM on a pin. With 12-bit resolution the duty cycle runs from 0 to 4095, exactly the range of <code>analogRead()</code>, so no <code>map()</code> is needed.</p>
<div class="tip"><strong>Core version:</strong> <code>ledcAttach()</code> and <code>ledcWrite(pin, duty)</code> are the Arduino-ESP32 3.x API. Older 2.x code uses <code>ledcSetup()</code> and <code>ledcAttachPin()</code> with channel numbers.</div>
<h2>Try this</h2>
<p>Reverse the knob so turning right dims the LED. Then add a dead zone: below 5&nbsp;% the LED should be fully off.</p>`,
    code: `// Lesson 9: dimmer with LEDC PWM
const int POT = 34;
const int LED = 26;

void setup() {
  ledcAttach(LED, 5000, 12);   // 5 kHz, 12-bit duty (0..4095)
}

void loop() {
  int raw = analogRead(POT);
  ledcWrite(LED, raw);
  delay(10);
}
`,
  },
  {
    id: 'night-light',
    track: 'inputs',
    title: 'Automatic night light',
    minutes: 12,
    summary: 'Read a light sensor and switch an LED on when it gets dark, with hysteresis.',
    parts: [
      { type: 'ldr', id: 'ldr', pin: 35, label: 'GPIO 35' },
      { type: 'led', id: 'led', pin: 26, color: 'amber', label: 'GPIO 26' },
    ],
    goal: {
      text: 'Dim the room until the light switches on, then brighten it again.',
      check: (c) => c.changes('ldr') >= 2 && edges(c, 26) >= 2,
    },
    body: `
<p>A <strong>photoresistor</strong> (LDR) changes resistance with light: bright light, low resistance. Paired with a fixed 10&nbsp;kΩ resistor it forms a <em>voltage divider</em>, so more light means a higher reading on GPIO 35.</p>
<p>Use the <strong>room light</strong> slider to dim the scene.</p>
<p>A single threshold has a problem: near the edge, sensor noise makes the LED flicker on and off. The fix is <strong>hysteresis</strong>: switch on below one level, but only switch off again above a <em>higher</em> one.</p>
<h2>Wiring</h2>
<ul><li>3.3&nbsp;V → LDR → GPIO 35 → 10&nbsp;kΩ → GND</li></ul>
<h2>Try this</h2>
<p>Instead of on/off, make the LED brighter the darker it gets, using <code>analogWrite()</code> and <code>map()</code>.</p>`,
    code: `// Lesson 10: a night light with hysteresis
const int LDR = 35;
const int LED = 26;
const int DARK = 1200;     // switch on below this
const int BRIGHT = 1600;   // switch off above this

bool lightOn = false;

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
}

void loop() {
  int level = analogRead(LDR);
  if (!lightOn && level < DARK) {
    lightOn = true;
    Serial.println("It's dark - light on");
  } else if (lightOn && level > BRIGHT) {
    lightOn = false;
    Serial.println("Daylight - light off");
  }
  digitalWrite(LED, lightOn);
  delay(100);
}
`,
  },
  {
    id: 'buzzer',
    track: 'motion',
    title: 'Play a melody',
    minutes: 10,
    summary: 'Make sound with tone() and store a tune in arrays.',
    parts: [{ type: 'buzzer', id: 'buzzer', pin: 25, label: 'GPIO 25' }],
    goal: { text: 'Play at least 4 different notes.', check: (c) => c.hw.tonesSeen.size >= 4 },
    body: `
<p>A <strong>passive buzzer</strong> is a tiny speaker. Feed it a square wave and it vibrates at that frequency. <code>tone(pin, frequency)</code> generates one; <code>noTone(pin)</code> stops it.</p>
<p>A melody is two lists: which notes, and how long each lasts. Arrays keep them side by side, and a <code>for</code> loop plays them in order.</p>
<table class="notes"><tr><th>Note</th><td>C4</td><td>D4</td><td>E4</td><td>F4</td><td>G4</td><td>A4</td><td>B4</td><td>C5</td></tr>
<tr><th>Hz</th><td>262</td><td>294</td><td>330</td><td>349</td><td>392</td><td>440</td><td>494</td><td>523</td></tr></table>
<p>Turn on sound with the speaker button in the toolbar.</p>
<div class="tip"><strong>Active vs passive:</strong> an <em>active</em> buzzer has its own oscillator and only beeps at one pitch when you apply power. For melodies you need a <em>passive</em> one.</div>
<h2>Try this</h2>
<p>Write your own tune. A rest is just a note with frequency 0. Handle it with <code>noTone()</code>.</p>`,
    code: `// Lesson 11: a melody on a passive buzzer
const int BUZZER = 25;

int melody[] = { 262, 262, 392, 392, 440, 440, 392, 349, 349, 330, 330, 294, 294, 262 };
int beats[]  = { 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2 };
const int NOTES = 14;
const int BEAT = 300;   // milliseconds

void setup() {
}

void loop() {
  for (int i = 0; i < NOTES; i++) {
    int length = beats[i] * BEAT;
    tone(BUZZER, melody[i]);
    delay(length * 0.85);
    noTone(BUZZER);
    delay(length * 0.15);   // tiny gap between notes
  }
  delay(1500);
}
`,
  },
  {
    id: 'servo',
    track: 'motion',
    title: 'Sweep a servo',
    minutes: 10,
    summary: 'Position a hobby servo motor with the ESP32Servo library.',
    parts: [{ type: 'servo', id: 'servo', pin: 13, label: 'GPIO 13' }],
    goal: { text: 'Sweep the servo across at least 150°.', check: (c) => c.hw.servoSeen.max - c.hw.servoSeen.min >= 150 },
    body: `
<p>A hobby <strong>servo</strong> has a motor, a gearbox and a position sensor in one box. You tell it an angle from 0° to 180° and it holds that angle.</p>
<p>The command is a pulse sent 50 times a second: about 0.5&nbsp;ms for 0° and 2.4&nbsp;ms for 180°. The <code>ESP32Servo</code> library generates it for you with the LEDC hardware.</p>
<h2>Wiring</h2>
<ul>
<li>Brown/black → GND</li>
<li>Red → 5&nbsp;V (the board's <code>VIN</code> pin when powered by USB)</li>
<li>Orange/yellow signal → GPIO 13</li>
</ul>
<div class="tip"><strong>Power warning:</strong> servos draw large current spikes. A small SG90 is fine from USB, but bigger servos need their own supply. Always connect the grounds together.</div>
<h2>Try this</h2>
<p>Make the servo move like a windshield wiper: fast one way, slowly back.</p>`,
    code: `// Lesson 12: sweep a servo
#include <ESP32Servo.h>

Servo arm;
const int SERVO_PIN = 13;

void setup() {
  arm.setPeriodHertz(50);
  arm.attach(SERVO_PIN, 500, 2400);
}

void loop() {
  for (int angle = 0; angle <= 180; angle += 2) {
    arm.write(angle);
    delay(15);
  }
  for (int angle = 180; angle >= 0; angle -= 2) {
    arm.write(angle);
    delay(15);
  }
}
`,
  },
  {
    id: 'knob-servo',
    track: 'motion',
    title: 'Steer a servo with a knob',
    minutes: 8,
    summary: 'Map a 0–4095 reading onto 0–180 degrees.',
    parts: [
      { type: 'pot', id: 'pot', pin: 34, label: 'GPIO 34' },
      { type: 'servo', id: 'servo', pin: 13, label: 'GPIO 13' },
    ],
    goal: {
      text: 'Use the knob to move the servo across at least 120°.',
      check: (c) => c.changes('pot') >= 3 && c.hw.servoSeen.max - c.hw.servoSeen.min >= 120,
    },
    body: `
<p><code>map(value, fromLow, fromHigh, toLow, toHigh)</code> rescales a number from one range into another. It is the glue between almost every sensor and actuator.</p>
<pre class="snippet">map(2048, 0, 4095, 0, 180)  →  90</pre>
<p>Raw ADC readings jitter by a few counts, which makes the servo twitch. Averaging several readings smooths it out. Here we use a simple <em>exponential moving average</em>: each new reading nudges the smoothed value a little.</p>
<h2>Try this</h2>
<p>Change the smoothing factor from <code>0.2</code> to <code>0.05</code>. The servo becomes silky but sluggish. Engineering is choosing the right trade-off.</p>`,
    code: `// Lesson 13: knob → servo
#include <ESP32Servo.h>

Servo arm;
const int POT = 34;
float smooth = 0;

void setup() {
  Serial.begin(115200);
  arm.attach(13, 500, 2400);
  smooth = analogRead(POT);
}

void loop() {
  smooth = smooth + 0.2 * (analogRead(POT) - smooth);
  int angle = map(smooth, 0, 4095, 0, 180);
  arm.write(angle);
  Serial.println(angle);
  delay(20);
}
`,
  },
  {
    id: 'ultrasonic',
    track: 'sensors',
    title: 'Measure distance',
    minutes: 12,
    summary: 'Time an ultrasonic echo with pulseIn() and turn it into centimetres.',
    parts: [{ type: 'ultrasonic', id: 'sonar', trig: 5, echo: 18, label: 'TRIG 5 · ECHO 18' }],
    goal: {
      text: 'Move the obstacle and log at least 8 distance readings.',
      check: (c) => c.changes('sonar') >= 2 && c.lines >= 8,
    },
    body: `
<p>The HC-SR04 sensor works like a bat. Pulse its <code>TRIG</code> pin for 10&nbsp;µs and it chirps at 40&nbsp;kHz, then holds <code>ECHO</code> high until the sound comes back.</p>
<p><code>pulseIn(ECHO, HIGH)</code> measures how long ECHO stayed high, in microseconds. Sound travels about <strong>0.0343&nbsp;cm per µs</strong>, and it went there <em>and</em> back, so:</p>
<pre class="snippet">distance_cm = duration × 0.0343 / 2</pre>
<p>Drag the <strong>obstacle distance</strong> slider to move the wall behind the sensor.</p>
<div class="tip"><strong>5 V caution:</strong> the classic HC-SR04 runs on 5&nbsp;V and its ECHO output is 5&nbsp;V too, more than the ESP32's 3.3&nbsp;V pins are rated for. Use a voltage divider (1&nbsp;kΩ + 2&nbsp;kΩ) on ECHO, or buy the 3.3&nbsp;V-friendly HC-SR04P.</div>
<h2>Try this</h2>
<p>The third argument to <code>pulseIn</code> is a timeout. When nothing is in range it returns 0. Print "out of range" in that case instead of 0&nbsp;cm.</p>`,
    code: `// Lesson 14: HC-SR04 distance sensor
const int TRIG = 5;
const int ECHO = 18;

void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
}

void loop() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);       // 10 µs trigger pulse
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);

  long duration = pulseIn(ECHO, HIGH, 30000);
  float cm = duration * 0.0343 / 2;
  Serial.print("Distance: ");
  Serial.print(cm, 1);
  Serial.println(" cm");
  delay(250);
}
`,
  },
  {
    id: 'touch',
    track: 'sensors',
    title: 'Touch without buttons',
    minutes: 8,
    summary: 'Use the ESP32’s built-in capacitive touch sensing on GPIO 4.',
    parts: [
      { type: 'touch', id: 'pad', pin: 4, label: 'T0 · GPIO 4' },
      { type: 'led', id: 'led', pin: 26, color: 'blue', label: 'GPIO 26' },
    ],
    goal: {
      text: 'Touch the pad to light the LED.',
      check: (c) => c.changes('pad') >= 2 && edges(c, 26) >= 2,
    },
    body: `
<p>This one is special to the ESP32: ten of its pins can sense <strong>touch</strong> with no extra parts. Each touch pin measures its own capacitance. Your finger adds capacitance, and <code>touchRead()</code> returns a <em>lower</em> number.</p>
<p>Any piece of metal works as a pad: a coin, foil, a screw. Just connect it to the pin with a wire.</p>
<p>Touch pins have names: <code>T0</code> is GPIO 4, <code>T3</code> is GPIO 15, <code>T9</code> is GPIO 32, and so on. Check the <a href="/pinout">pinout</a> for the rest.</p>
<p><strong>Click and hold the copper pad</strong> in the 3D view to touch it.</p>
<div class="tip"><strong>Calibrate:</strong> untouched readings vary with wire length and humidity. Print the values first, then pick a threshold roughly halfway between touched and untouched.</div>
<h2>Try this</h2>
<p>Make a touch toggle like Lesson 6, or count how long the pad was held.</p>`,
    code: `// Lesson 15: capacitive touch
const int LED = 26;
const int THRESHOLD = 40;

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
}

void loop() {
  int value = touchRead(T0);    // T0 = GPIO 4
  Serial.println(value);
  digitalWrite(LED, value < THRESHOLD ? HIGH : LOW);
  delay(100);
}
`,
  },
  {
    id: 'oled',
    track: 'sensors',
    title: 'Hello, OLED',
    minutes: 12,
    summary: 'Draw text and shapes on a 128×64 SSD1306 display over I²C.',
    parts: [{ type: 'oled', id: 'oled', label: 'SDA 21 · SCL 22' }],
    goal: { text: 'Show text on the OLED screen.', check: (c) => (c.hw.oled?.textContent() ?? '').trim().length >= 3 },
    body: `
<p>The little SSD1306 OLED has 128&nbsp;×&nbsp;64 pixels that glow on their own, no backlight. It talks <strong>I²C</strong>: just two signal wires shared by many devices. On the ESP32 the default I²C pins are <strong>SDA&nbsp;=&nbsp;21</strong> and <strong>SCL&nbsp;=&nbsp;22</strong>.</p>
<p>Drawing happens in two steps. Commands like <code>print()</code> and <code>drawRect()</code> change a buffer in the ESP32's memory. Nothing appears until <code>display()</code> sends the whole buffer to the screen. This avoids flicker.</p>
<h2>Libraries</h2>
<p>In the Arduino IDE install <em>Adafruit SSD1306</em> and <em>Adafruit GFX</em>. The display's I²C address is usually <code>0x3C</code>.</p>
<h2>Try this</h2>
<p>Show <code>millis() / 1000</code> as a running seconds counter. Remember: <code>clearDisplay()</code> first, <code>display()</code> last.</p>`,
    code: `// Lesson 16: text on an SSD1306 OLED
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.println("Hello,");
  display.println("ESP32!");
  display.setTextSize(1);
  display.setCursor(0, 44);
  display.println("128x64 OLED via I2C");
  display.drawRect(0, 40, 128, 24, SSD1306_WHITE);
  display.display();
}

void loop() {
}
`,
  },
  {
    id: 'dashboard',
    track: 'sensors',
    title: 'Capstone: parking sensor',
    minutes: 20,
    summary: 'Distance on the OLED, a bar graph, and beeps that speed up as you get closer.',
    parts: [
      { type: 'ultrasonic', id: 'sonar', trig: 5, echo: 18, label: 'TRIG 5 · ECHO 18' },
      { type: 'buzzer', id: 'buzzer', pin: 25, label: 'GPIO 25' },
      { type: 'oled', id: 'oled', label: 'SDA 21 · SCL 22' },
    ],
    goal: {
      text: 'Bring the obstacle closer than 20 cm and hear the warning.',
      check: (c) => c.changes('sonar') >= 2 && c.hw.tonesSeen.size >= 1 && (c.hw.oled?.revision ?? 0) > 5,
    },
    body: `
<p>Everything comes together: a sensor, a display and a sound, all running in one loop <em>without</em> long <code>delay()</code> calls.</p>
<ul>
<li>Measure distance every 100&nbsp;ms.</li>
<li>Draw the number and a bar on the OLED: the closer the obstacle, the longer the bar.</li>
<li>Beep with a gap proportional to distance. Under 10&nbsp;cm, sound continuously.</li>
</ul>
<p>The beeping uses the same <code>millis()</code> timing pattern as the debounce lesson. Each task checks "is it my turn yet?" and returns immediately if not.</p>
<h2>Try this</h2>
<ul>
<li>Add the LED from earlier lessons as a visual warning.</li>
<li>Draw a small car icon with <code>fillRect()</code> and <code>drawCircle()</code>.</li>
</ul>`,
    code: `// Lesson 17: parking sensor capstone
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

const int TRIG = 5;
const int ECHO = 18;
const int BUZZER = 25;

Adafruit_SSD1306 display(128, 64, &Wire, -1);
float cm = 100;
unsigned long lastBeep = 0;

float measure() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 30000);
  if (us == 0) return 400;
  return us * 0.0343 / 2;
}

void draw() {
  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.print(cm, 0);
  display.println(" cm");
  int bar = map(constrain(cm, 0, 100), 0, 100, 128, 0);
  display.drawRect(0, 40, 128, 16, SSD1306_WHITE);
  display.fillRect(0, 40, bar, 16, SSD1306_WHITE);
  display.display();
}

void setup() {
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
}

void loop() {
  cm = measure();
  draw();
  if (cm < 10) {
    tone(BUZZER, 880);
  } else if (cm < 60 && millis() - lastBeep > cm * 12) {
    lastBeep = millis();
    tone(BUZZER, 880, 60);
  } else if (cm >= 60) {
    noTone(BUZZER);
  }
  delay(100);
}
`,
  },
];

export const PLAYGROUND = {
  id: 'playground',
  track: null,
  title: 'Playground',
  minutes: 0,
  summary: 'Every part on one breadboard. Write anything.',
  parts: [
    { type: 'led', id: 'red', pin: 26, color: 'red', label: 'GPIO 26' },
    { type: 'led', id: 'green', pin: 27, color: 'green', label: 'GPIO 27' },
    { type: 'button', id: 'btn', pin: 19, label: 'GPIO 19' },
    { type: 'pot', id: 'pot', pin: 34, label: 'GPIO 34' },
    { type: 'ldr', id: 'ldr', pin: 35, label: 'GPIO 35' },
    { type: 'touch', id: 'pad', pin: 4, label: 'T0 · GPIO 4' },
    { type: 'buzzer', id: 'buzzer', pin: 25, label: 'GPIO 25' },
    { type: 'servo', id: 'servo', pin: 13, label: 'GPIO 13' },
    { type: 'ultrasonic', id: 'sonar', trig: 5, echo: 18, label: 'TRIG 5 · ECHO 18' },
    { type: 'oled', id: 'oled', label: 'SDA 21 · SCL 22' },
  ],
  goal: null,
  body: `
<p>All the parts from the course, wired and ready:</p>
<table class="pins">
<tr><td>Red LED</td><td>GPIO 26</td></tr>
<tr><td>Green LED</td><td>GPIO 27</td></tr>
<tr><td>On-board LED</td><td>GPIO 2</td></tr>
<tr><td>Button (to GND)</td><td>GPIO 19</td></tr>
<tr><td>Potentiometer</td><td>GPIO 34</td></tr>
<tr><td>Light sensor</td><td>GPIO 35</td></tr>
<tr><td>Touch pad</td><td>T0 / GPIO 4</td></tr>
<tr><td>Buzzer</td><td>GPIO 25</td></tr>
<tr><td>Servo</td><td>GPIO 13</td></tr>
<tr><td>Ultrasonic</td><td>TRIG 5, ECHO 18</td></tr>
<tr><td>OLED (I²C)</td><td>SDA 21, SCL 22</td></tr>
</table>
<p>Your code is saved in this browser as you type.</p>
<h2>Supported API</h2>
<p><code>pinMode digitalWrite digitalRead analogRead analogReadMilliVolts analogWrite ledcAttach ledcWrite dacWrite tone noTone touchRead pulseIn attachInterrupt millis micros delay map constrain random bitRead/bitWrite</code></p>
<p><code>Serial</code>: <code>print/println/printf/write</code> with <code>HEX</code>, <code>BIN</code> and decimal places, plus input from the box under the monitor via <code>available read readStringUntil parseInt</code>.</p>
<p>Language: functions and prototypes, arrays, <code>struct</code>, <code>enum</code>, <code>#define</code> macros, <code>static</code> locals, <code>String</code> methods, and real C integer maths (<code>7 / 2 == 3</code>, <code>byte</code> wraps at 256).</p>
<p>Libraries: <code>Servo</code> (ESP32Servo) and <code>Adafruit_SSD1306</code> text and shapes. Wi-Fi and Bluetooth are not simulated yet.</p>`,
  code: `// Playground: everything is connected. Have fun!
const int RED = 26;
const int GREEN = 27;
const int BUTTON = 19;
const int POT = 34;

void setup() {
  Serial.begin(115200);
  pinMode(RED, OUTPUT);
  pinMode(GREEN, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
}

void loop() {
  bool pressed = digitalRead(BUTTON) == LOW;
  digitalWrite(RED, pressed);
  analogWrite(GREEN, analogRead(POT) / 16);
  delay(20);
}
`,
};

export function findLesson(id) {
  if (id === PLAYGROUND.id) return PLAYGROUND;
  return LESSONS.find((l) => l.id === id) ?? null;
}

export function lessonIndex(id) { return LESSONS.findIndex((l) => l.id === id); }

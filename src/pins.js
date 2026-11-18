// Pin reference for the 30-pin ESP32 DevKit (ESP32-WROOM-32).
// Rows are listed from the antenna end towards the USB connector.
export const CAPS = {
  adc: 'ADC', touch: 'Touch', dac: 'DAC', pwm: 'PWM', i2c: 'I²C', spi: 'SPI', uart: 'UART',
  input: 'Input only', strap: 'Strapping', power: 'Power',
};

const p = (label, gpio, caps, detail, note = '') => ({ label, gpio, caps, detail, note });

export const LEFT = [
  p('EN', null, ['power'], 'Chip enable. Pulling it LOW resets the ESP32 (that is what the EN button does).'),
  p('VP', 36, ['input', 'adc'], 'GPIO 36 · ADC1_CH0', 'Input only, no internal pull-up or pull-down.'),
  p('VN', 39, ['input', 'adc'], 'GPIO 39 · ADC1_CH3', 'Input only, no internal pull-up or pull-down.'),
  p('D34', 34, ['input', 'adc'], 'GPIO 34 · ADC1_CH6', 'Input only. Great for potentiometers and sensors.'),
  p('D35', 35, ['input', 'adc'], 'GPIO 35 · ADC1_CH7', 'Input only. Great for analog sensors.'),
  p('D32', 32, ['adc', 'touch', 'pwm'], 'GPIO 32 · ADC1_CH4 · T9', 'Also a crystal pin for an optional 32 kHz RTC crystal.'),
  p('D33', 33, ['adc', 'touch', 'pwm'], 'GPIO 33 · ADC1_CH5 · T8'),
  p('D25', 25, ['adc', 'dac', 'pwm'], 'GPIO 25 · ADC2_CH8 · DAC1', 'True 8-bit analog output with dacWrite().'),
  p('D26', 26, ['adc', 'dac', 'pwm'], 'GPIO 26 · ADC2_CH9 · DAC2', 'A safe all-round output pin.'),
  p('D27', 27, ['adc', 'touch', 'pwm'], 'GPIO 27 · ADC2_CH7 · T7'),
  p('D14', 14, ['adc', 'touch', 'pwm'], 'GPIO 14 · ADC2_CH6 · T6', 'Outputs a PWM signal briefly at boot.'),
  p('D12', 12, ['adc', 'touch', 'pwm', 'strap'], 'GPIO 12 · ADC2_CH5 · T5', 'Strapping pin (flash voltage). Must be LOW at boot or the board may not start.'),
  p('D13', 13, ['adc', 'touch', 'pwm'], 'GPIO 13 · ADC2_CH4 · T4'),
  p('GND', null, ['power'], 'Ground.'),
  p('VIN', null, ['power'], '5 V input/output. Connected to USB 5 V through a diode when powered by USB.'),
];

export const RIGHT = [
  p('D23', 23, ['pwm', 'spi'], 'GPIO 23 · VSPI MOSI'),
  p('D22', 22, ['pwm', 'i2c'], 'GPIO 22 · default I²C SCL'),
  p('TX0', 1, ['uart'], 'GPIO 1 · UART0 TX', 'Used by USB serial. Avoid for other things.'),
  p('RX0', 3, ['uart'], 'GPIO 3 · UART0 RX', 'Used by USB serial. Avoid for other things.'),
  p('D21', 21, ['pwm', 'i2c'], 'GPIO 21 · default I²C SDA'),
  p('D19', 19, ['pwm', 'spi'], 'GPIO 19 · VSPI MISO'),
  p('D18', 18, ['pwm', 'spi'], 'GPIO 18 · VSPI SCK'),
  p('D5', 5, ['pwm', 'spi', 'strap'], 'GPIO 5 · VSPI SS', 'Strapping pin; outputs PWM briefly at boot.'),
  p('TX2', 17, ['pwm', 'uart'], 'GPIO 17 · UART2 TX'),
  p('RX2', 16, ['pwm', 'uart'], 'GPIO 16 · UART2 RX'),
  p('D4', 4, ['adc', 'touch', 'pwm'], 'GPIO 4 · ADC2_CH0 · T0'),
  p('D2', 2, ['adc', 'touch', 'pwm', 'strap'], 'GPIO 2 · ADC2_CH2 · T2 · on-board LED', 'Strapping pin: must be LOW or floating to enter flashing mode.'),
  p('D15', 15, ['adc', 'touch', 'pwm', 'strap'], 'GPIO 15 · ADC2_CH3 · T3', 'Strapping pin: LOW at boot silences the boot log.'),
  p('GND', null, ['power'], 'Ground.'),
  p('3V3', null, ['power'], '3.3 V regulated output. All GPIOs are 3.3 V logic, not 5 V tolerant.'),
];

export const FACTS = [
  ['CPU', 'Dual-core Xtensa LX6, up to 240 MHz'],
  ['Memory', '520 KB SRAM, typically 4 MB flash'],
  ['Wireless', 'Wi-Fi 802.11 b/g/n and Bluetooth (Classic + LE)'],
  ['Logic level', '3.3 V. GPIOs are not 5 V tolerant'],
  ['ADC', '18 channels, 12-bit (ADC2 unavailable while Wi-Fi is on)'],
  ['PWM (LEDC)', '16 channels, up to 16-bit resolution'],
  ['Touch', '10 capacitive touch pins (T0–T9)'],
  ['DAC', '2 × 8-bit (GPIO 25 and 26)'],
];

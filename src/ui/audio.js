// Square-wave tones for tone()/noTone(), muted until the learner opts in.
export class ToneAudio {
  constructor() {
    this.ctx = null;
    this.voices = new Map();
    this.enabled = false;
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume();
    } else {
      for (const gpio of [...this.voices.keys()]) this.stop(gpio);
    }
  }

  play(gpio, freq) {
    if (!this.enabled || !this.ctx || !freq) return;
    let v = this.voices.get(gpio);
    if (!v) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      gain.gain.value = 0;
      osc.connect(gain).connect(this.ctx.destination);
      osc.start();
      v = { osc, gain };
      this.voices.set(gpio, v);
    }
    const now = this.ctx.currentTime;
    v.osc.frequency.setValueAtTime(freq, now);
    v.gain.gain.setTargetAtTime(0.045, now, 0.005);
  }

  stop(gpio) {
    const v = this.voices.get(gpio);
    if (!v || !this.ctx) return;
    const now = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(0, now, 0.01);
    v.osc.stop(now + 0.08);
    this.voices.delete(gpio);
  }
}

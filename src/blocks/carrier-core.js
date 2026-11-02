// Carrier recovery: a PLL that locks a sine oscillator (NCO) to the strongest tone near `frequency`.
// Imported by the AudioWorklet (carrier-processor.js) and by the tests, so it has no dependencies and
// touches no DOM.
//
// The input is multiplied by the oscillator's cosine and sine and each product is low-passed, which leaves
// Q = A/2 sin(d) and I = A/2 cos(d), where d is the phase of the input minus the phase of the oscillator
// (the products' components at twice the frequency are what the low-pass removes). atan2(Q, I) is d itself,
// whatever the amplitude A, so the loop gain doesn't depend on the level. A PI loop filter turns d into a
// phase correction (proportional) and a frequency correction (integral); the output is sin(phase), in step
// with the input's own sine.
//
// Lock detector: cos(d) = I / sqrt(I² + Q²) is 1 when the oscillator is in step with the input, whatever the
// level, so a slow average of it says how well the loop is locked. It counts as locked above LOCK_ON and
// stops being locked below LOCK_OFF (hysteresis, so it doesn't flicker), and never without a carrier.
const TWO_PI = 2 * Math.PI;
const ZETA = Math.SQRT1_2;
const LOCK_ON = 0.95, LOCK_OFF = 0.85;
const LOCK_TAU = 0.05;   // seconds the lock average takes to follow

export class CarrierPLL {
  constructor({ sampleRate, frequency, bandwidth, amplitude }) {
    this.sampleRate = sampleRate;
    this.phase = 0;
    this.freq = 0;                  // correction to the oscillator's step found by the loop (rad / sample)
    this.i1 = this.i2 = this.q1 = this.q2 = 0;   // two one-pole low-passes per branch
    this.d = 0;                     // last phase error (rad), for display / tests
    this.cosAvg = 0;                // slow average of cos(d): near 1 when locked
    this.locked = false;
    this.lockAlpha = 1 - Math.exp(-1 / (LOCK_TAU * sampleRate));
    this.set(frequency, bandwidth, amplitude);
  }

  // frequency: free-running frequency (Hz); bandwidth: loop noise bandwidth (Hz); amplitude: of the output
  set(frequency, bandwidth, amplitude) {
    const fs = this.sampleRate;
    this.step = (TWO_PI * frequency) / fs;
    this.amplitude = amplitude;
    const theta = bandwidth / fs / (ZETA + 1 / (4 * ZETA));
    const den = 1 + 2 * ZETA * theta + theta * theta;
    this.kp = (4 * ZETA * theta) / den;
    this.ki = (4 * theta * theta) / den;
    // the low-pass must be well above the loop's own bandwidth (or it would add lag and ring) and well
    // below the product at twice the carrier frequency
    const cutoff = Math.min(8 * bandwidth, frequency / 2);
    this.alpha = 1 - Math.exp((-TWO_PI * cutoff) / fs);
    this.maxFreq = this.step / 2;
  }

  // phase (optional): receives the phase error d / pi, so +-1 is +-180 degrees (0 when locked or with no carrier)
  process(input, output, phase) {
    for (let n = 0; n < input.length; n++) {
      const x = input[n];
      const c = Math.cos(this.phase), s = Math.sin(this.phase);
      this.q1 += this.alpha * (x * c - this.q1);
      this.q2 += this.alpha * (this.q1 - this.q2);
      this.i1 += this.alpha * (x * s - this.i1);
      this.i2 += this.alpha * (this.i1 - this.i2);
      // with no carrier there is nothing to measure: leave the loop alone and let it free-run
      const mag2 = this.q2 * this.q2 + this.i2 * this.i2;
      if (mag2 > 1e-10) {
        this.d = Math.atan2(this.q2, this.i2);
        this.cosAvg += this.lockAlpha * (this.i2 / Math.sqrt(mag2) - this.cosAvg);
        this.locked = this.cosAvg > (this.locked ? LOCK_OFF : LOCK_ON);
        this.freq = Math.max(-this.maxFreq, Math.min(this.maxFreq, this.freq + this.ki * this.d));
        this.phase += this.kp * this.d;
      } else {
        this.d = 0;
        this.cosAvg = 0;
        this.locked = false;
      }
      output[n] = this.amplitude * s;
      if (phase) phase[n] = this.d / Math.PI;
      this.phase += this.step + this.freq;
      if (this.phase >= TWO_PI) this.phase -= TWO_PI;
      else if (this.phase < 0) this.phase += TWO_PI;
    }
  }

  // the frequency the oscillator is running at now, in Hz
  get hz() { return ((this.step + this.freq) * this.sampleRate) / TWO_PI; }
}

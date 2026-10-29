// Symbol timing recovery: a PLL whose oscillator (NCO) ticks once per symbol. Imported by the AudioWorklet
// (timing-processor.js) and by the tests, so it has no dependencies and touches no DOM.
//
// Every sample advances the NCO phase by baud / sampleRate. When it passes 0.5 the signal is read halfway
// between two symbols, and when it passes 1 the signal is read at the symbol instant (both by linear
// interpolation) and that value becomes a bit. A Gardner detector measures the timing error from the
// two: mid-sample times the change between this symbol and the last one. At a transition the mid-sample
// should sit on the decision level, so any other value means the strobes are early or late. A PI loop
// filter turns that error into a phase correction (proportional) and a frequency correction (integral).
const FLAT = 1e-6;   // a change smaller than this counts as no change

export class SymbolTimer {
  constructor({ sampleRate, baud, bandwidth = 0.005, onBit }) {
    this.sampleRate = sampleRate;
    this.onBit = onBit;
    this.flat = Infinity; // samples for which the input hasn't changed: starts "silent" so nothing is sent before a signal
    this.set(baud, bandwidth);
    this.phase = 0;
    this.freq = 0;        // correction to the NCO step found by the loop (cycles per sample)
    this.prev = 0;        // previous input sample
    this.mid = 0;
    this.lastStrobe = 0;  // signal value at the previous symbol instant
    this.hi = 0;          // slow peak followers: the signal's top and bottom levels
    this.lo = 0;
    this.top = 0;         // the same, measured only at symbol instants
    this.bottom = 0;
    this.error = 0;       // last timing error, for display / tests
  }

  // bandwidth: loop noise bandwidth as a fraction of the baud rate (small = slow and quiet)
  set(baud, bandwidth) {
    this.step = baud / this.sampleRate;
    const zeta = Math.SQRT1_2;
    const d = 1 + 2 * zeta * bandwidth + bandwidth * bandwidth;
    this.kp = (4 * zeta * bandwidth) / d;
    this.ki = (4 * bandwidth * bandwidth) / d;
    this.decay = this.step / 64;   // the level followers forget over about 64 symbols
    this.maxFreq = this.step * 0.1;
  }

  process(input) {
    for (let n = 0; n < input.length; n++) {
      const x = input[n];
      // Silence is a signal that doesn't move at all (what a Squelch block leaves when it closes) for more
      // than 32 symbols: nothing is sent, and the level followers start again from the next signal.
      this.flat = Math.abs(x - this.prev) > FLAT ? 0 : this.flat + 1;
      const silent = this.flat * this.step > 32;
      if (silent) this.hi = this.lo = this.top = this.bottom = x;
      this.hi = x > this.hi ? x : this.hi + (x - this.hi) * this.decay;
      this.lo = x < this.lo ? x : this.lo + (x - this.lo) * this.decay;
      const w = this.step + this.freq;
      const before = this.phase;
      this.phase += w;
      if (before < 0.5 && this.phase >= 0.5) this.mid = this.prev + ((0.5 - before) / w) * (x - this.prev);
      if (this.phase >= 1) {
        const y = this.prev + ((1 - before) / w) * (x - this.prev);
        const amp = this.hi - this.lo;
        if (!silent && amp > FLAT) {
          // The decision level sits halfway between the levels seen at symbol instants, not between the
          // waveform's extremes: a sinc overshoots, which would push the level up and misread zeros.
          this.top = y > this.top ? y : this.top + (y - this.top) * 0.03;
          this.bottom = y < this.bottom ? y : this.bottom + (y - this.bottom) * 0.03;
          const level = (this.top + this.bottom) / 2;
          // normalised by the signal's swing, so the loop gain doesn't depend on the amplitude
          const e = ((y - this.lastStrobe) * (this.mid - level) * 4) / (amp * amp);
          this.error = Math.max(-1, Math.min(1, e));
          this.freq = Math.max(-this.maxFreq, Math.min(this.maxFreq, this.freq + this.ki * this.error * this.step));
          this.phase += this.kp * this.error;
          this.onBit(y > level ? 1 : 0);
        }
        this.lastStrobe = y;
        this.phase -= 1;
      }
      this.prev = x;
    }
  }
}

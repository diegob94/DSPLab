// Squelch: lets the signal through while its peak-to-peak swing, followed over a short window, is above a
// threshold, and outputs exact zeros otherwise. Imported by the AudioWorklet (squelch-processor.js) and by
// the tests, so it has no dependencies and touches no DOM.
export class Squelch {
  constructor({ sampleRate, threshold, window }) {
    this.sampleRate = sampleRate;
    this.hi = 0;          // peak followers: the top and bottom of the signal, forgotten over `window`
    this.lo = 0;
    this.open = false;
    this.set(threshold, window);
  }

  // threshold: swing (peak to peak) that opens the gate; window: ms over which the levels are forgotten
  set(threshold, window) {
    this.threshold = threshold;
    this.decay = 1 / Math.max(1, (window / 1000) * this.sampleRate);
  }

  process(input, output) {
    for (let n = 0; n < input.length; n++) {
      const x = input[n];
      this.hi = x > this.hi ? x : this.hi + (x - this.hi) * this.decay;
      this.lo = x < this.lo ? x : this.lo + (x - this.lo) * this.decay;
      this.open = this.hi - this.lo > this.threshold;
      output[n] = this.open ? x : 0;
    }
  }
}

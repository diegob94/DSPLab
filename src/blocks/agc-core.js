// AGC (automatic gain control): scales the signal so its envelope settles at a target level. Imported by the
// AudioWorklet (agc-processor.js) and by the tests, so it has no dependencies and touches no DOM.
export class Agc {
  constructor({ sampleRate, target, attack, release, maxGain }) {
    this.sampleRate = sampleRate;
    this.env = 0;         // peak envelope follower
    this.gain = 0;        // gain applied to the last sample (read by tests)
    this.set(target, attack, release, maxGain);
  }

  // target: output peak level; attack/release: ms the envelope takes to rise/fall (about 63% of the way);
  // maxGain: dB, so silence and noise are not amplified without limit
  set(target, attack, release, maxGain) {
    this.target = target;
    this.up = 1 - Math.exp(-1 / Math.max(1, (attack / 1000) * this.sampleRate));
    this.down = 1 - Math.exp(-1 / Math.max(1, (release / 1000) * this.sampleRate));
    this.maxGain = Math.pow(10, maxGain / 20);
  }

  process(input, output) {
    for (let n = 0; n < input.length; n++) {
      const x = input[n];
      const a = Math.abs(x);
      this.env += (a - this.env) * (a > this.env ? this.up : this.down);
      this.gain = Math.min(this.maxGain, this.target / Math.max(this.env, 1e-9));
      output[n] = x * this.gain;
    }
  }
}

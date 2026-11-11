// The maths of the AWGN block, with no Web Audio in it so that it can be tested alone. Imported by the AudioWorklet
// (awgn-processor.js) and by the tests.
//
// out = in + σ·N(0, 1), where σ is set so that the signal-to-noise ratio is `snr` dB: σ² = P / 10^(snr / 10), P being the
// mean power (the mean of the squares, DC included) of the input. P is followed with a moving average over `window` ms
// (a plain average of everything heard until a whole window has passed), so the noise level follows the signal's.
// A silent input has no power and so gets no noise.
export class Awgn {
  constructor({ sampleRate, snr, window, random = Math.random }) {
    this.sampleRate = sampleRate;
    this.random = random;
    this.power = 0;
    this.heard = 0;      // samples averaged so far, up to one window
    this.spare = null;   // Box-Muller makes Gaussians in pairs
    this.set(snr, window);
  }

  // snr: dB; window: ms over which the signal's power is averaged
  set(snr, window) {
    this.ratio = 10 ** (-snr / 10);   // noise power / signal power
    this.length = Math.max(1, (window / 1000) * this.sampleRate);
  }

  gaussian() {
    if (this.spare !== null) { const g = this.spare; this.spare = null; return g; }
    const r = Math.sqrt(-2 * Math.log(1 - this.random()));
    const a = 2 * Math.PI * this.random();
    this.spare = r * Math.sin(a);
    return r * Math.cos(a);
  }

  process(input, output) {
    for (let n = 0; n < input.length; n++) {
      const x = input[n];
      this.heard = Math.min(this.heard + 1, this.length);
      this.power += (x * x - this.power) / this.heard;
      output[n] = x + Math.sqrt(this.power * this.ratio) * this.gaussian();
    }
  }
}

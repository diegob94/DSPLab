// The maths of the AWGN block, with no Web Audio in it so that it can be tested alone. Imported by the AudioWorklet
// (awgn-processor.js) and by the tests.
//
// out = in + σ·N(0, 1), where σ is set so that the signal-to-noise ratio is `snr` dB: σ² = P / 10^(snr / 10), P being the
// mean power (the mean of the squares, DC included) of the input. P is followed with a moving average over `window` ms
// (a plain average of everything heard until a whole window has passed), so the noise level follows the signal's.
// A silent input has no power and so gets no noise.
// The input is a signal at sample rate `inRate` (each sample held for sampleRate / inRate output samples, as in
// serializer-core.js): the noise is made per input sample and held with it, so a slow signal gets slow noise.
export class Awgn {
  constructor({ sampleRate, inRate = sampleRate, snr, window, random = Math.random }) {
    this.sampleRate = sampleRate;
    this.inRate = inRate;
    this.symbol = -1;    // the input sample being held
    this.noise = 0;      // its noise
    this.random = random;
    this.power = 0;
    this.heard = 0;      // samples averaged so far, up to one window
    this.spare = null;   // Box-Muller makes Gaussians in pairs
    this.set(snr, window);
  }

  // snr: dB; window: ms over which the signal's power is averaged; inRate: the input's samples per second
  set(snr, window, inRate = this.inRate) {
    this.inRate = inRate;
    this.ratio = 10 ** (-snr / 10);   // noise power / signal power
    this.length = Math.max(1, (window / 1000) * inRate);
  }

  gaussian() {
    if (this.spare !== null) { const g = this.spare; this.spare = null; return g; }
    const r = Math.sqrt(-2 * Math.log(1 - this.random()));
    const a = 2 * Math.PI * this.random();
    this.spare = r * Math.sin(a);
    return r * Math.cos(a);
  }

  // frame: the context frame of the first sample
  process(input, output, frame = 0) {
    for (let n = 0; n < input.length; n++) {
      const x = input[n];
      const symbol = Math.floor((frame + n) * this.inRate / this.sampleRate);
      if (symbol !== this.symbol) {
        this.symbol = symbol;
        this.heard = Math.min(this.heard + 1, this.length);
        this.power += (x * x - this.power) / this.heard;
        this.noise = Math.sqrt(this.power * this.ratio) * this.gaussian();
      }
      output[n] = x + this.noise;
    }
  }
}

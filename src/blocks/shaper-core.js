import { pulseSamples } from './pulse-shaper.js';

// The signal behind the Pulse Shaper, with no Web Audio in it so that it can be tested alone: the input signal
// (a signal at sample rate inRate, each sample held for sampleRate / inRate output samples, as in serializer-core.js)
// convolved with the kernel of the pulse, at the rate of the input. The kernel is the pulse of one symbol of
// `sps` samples, times the amplitude. Samples are taken on the grid that starts at frame 0 of the audio context.
export function shaperKernel(pulse, sps, amplitude) {
  const s = pulseSamples(pulse, 0, sps, 1, amplitude);
  return s ? s.data : new Float32Array(1);
}

export class ShaperSignal {
  constructor(sampleRate, inRate, pulse, sps, amplitude) {
    this.sampleRate = sampleRate;
    this.history = new Float32Array(0);
    this.head = 0;
    this.symbol = -1;
    this.value = 0;
    this.set(inRate, pulse, sps, amplitude);
  }

  set(inRate, pulse, sps, amplitude) {
    this.inRate = inRate;
    this.kernel = shaperKernel(pulse, sps, amplitude);
    if (this.history.length !== this.kernel.length) {   // keep what was heard so far
      const next = new Float32Array(this.kernel.length);
      for (let k = 0; k < Math.min(next.length, this.history.length); k++) next[k] = this.history[(this.head - k + this.history.length) % this.history.length];
      this.history = next;
      this.head = 0;
    }
  }

  // inp: the input samples; out: filled; frame: the context frame of the first sample
  process(inp, out, frame = 0) {
    const n = this.history.length, h = this.kernel;
    for (let i = 0; i < out.length; i++) {
      const symbol = Math.floor((frame + i) * this.inRate / this.sampleRate);
      if (symbol !== this.symbol) {
        this.symbol = symbol;
        this.head = (this.head + 1) % n;
        this.history[this.head] = inp[i];
        let y = 0;
        for (let k = 0; k < n; k++) y += h[k] * this.history[(this.head - k + n) % n];
        this.value = y;
      }
      out[i] = this.value;
    }
  }
}

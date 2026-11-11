// The signal behind the Upsampler, with no Web Audio in it so that it can be tested alone. Its input is a signal with a
// sample rate inRate (every sample held for sampleRate / inRate output samples, see serializer-core.js); its output is a
// signal at factor * inRate samples per second: the input samples with factor - 1 zeros inserted after each, so every
// symbol of the input is followed by factor - 1 symbols that are 0. Both signals have their symbols on the grid that starts
// at frame 0 of the audio context, so the output symbol that carries an input sample starts at the same frame as that
// input sample, whenever the processors were created. process(inp, out, frame): `frame` is the context frame of the
// first sample of the block.
export class UpsamplerSignal {
  constructor(sampleRate, inRate, factor) {
    this.sampleRate = sampleRate;
    this.set(inRate, factor);
    this.symbol = -1;
    this.value = 0;
  }

  set(inRate, factor) {
    this.inRate = inRate;
    this.factor = factor;
  }

  process(inp, out, frame = 0) {
    for (let i = 0; i < out.length; i++) {
      const f = frame + i;
      const symbol = Math.floor(f * this.inRate * this.factor / this.sampleRate);
      if (symbol !== this.symbol) {
        this.symbol = symbol;
        // the first of the factor output symbols that make up an input symbol carries the input sample, the others are 0
        this.value = symbol === this.factor * Math.floor(f * this.inRate / this.sampleRate) ? inp[i] : 0;
      }
      out[i] = this.value;
    }
  }
}

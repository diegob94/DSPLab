// The signal behind the Upsampler, with no Web Audio in it so that it can be tested alone. Its input is a signal with a
// sample rate inRate (every sample held for sampleRate / inRate output samples, see serializer-core.js); its output is a
// signal at factor * inRate samples per second: the input samples with factor - 1 zeros inserted after each, so every
// symbol of the input is followed by factor - 1 symbols that are 0. All the signals of a diagram start together, so the
// symbols of the input start at the same output samples as every factor-th symbol of the output.
export class UpsamplerSignal {
  constructor(sampleRate, inRate, factor) {
    this.sampleRate = sampleRate;
    this.set(inRate, factor);
    this.acc = sampleRate;   // counts output symbols per output sample, as in SerializerSignal
    this.index = 0;          // output symbols so far
    this.value = 0;
  }

  set(inRate, factor) {
    this.inRate = inRate;
    this.factor = factor;
  }

  // in: the input samples (a block of the same length as out); out: filled
  process(inp, out) {
    const rate = this.inRate * this.factor;
    for (let i = 0; i < out.length; i++) {
      if (this.acc >= this.sampleRate) {
        this.acc -= this.sampleRate;
        this.value = this.index % this.factor === 0 ? inp[i] : 0;
        this.index++;
      }
      this.acc += rate;
      out[i] = this.value;
    }
  }
}

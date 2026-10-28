// AudioWorklet processor behind the oscilloscope: one input per channel. It batches the samples
// of every input and posts them to the main thread together, so the channels stay time-aligned
// (an unconnected input has no channels and is sent as silence).
class ScopeCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.inputCount = options.numberOfInputs;
    this.batch = 1024;
    this.bufs = Array.from({ length: this.inputCount }, () => new Float32Array(this.batch * 2));
    this.fill = 0;
  }

  process(inputs) {
    const frames = inputs.reduce((m, input) => (input[0] ? Math.max(m, input[0].length) : m), 0) || 128;
    for (let c = 0; c < this.inputCount; c++) {
      const ch = inputs[c] && inputs[c][0];
      if (ch) this.bufs[c].set(ch, this.fill);
      else this.bufs[c].fill(0, this.fill, this.fill + frames);
    }
    this.fill += frames;
    if (this.fill >= this.batch) {
      const chunks = this.bufs.map((b) => b.slice(0, this.fill));
      this.port.postMessage(chunks, chunks.map((c) => c.buffer));
      this.fill = 0;
    }
    return true;
  }
}

registerProcessor('dsplab-scope', ScopeCapture);

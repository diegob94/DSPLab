// The signal behind the Serializer, with no Web Audio in it so that it can be tested alone. It holds a buffer of
// numbers and produces a sample every sampleRate / baud output samples (a zero-order hold): the next number of the
// buffer, or 0 when it is empty. Symbols are placed on a grid that starts at frame 0 of the audio context, the same for
// every signal of the diagram, so signals at related rates stay aligned however late each of their processors started.
// process(out, frame) fills a block of output samples, `frame` being the context frame of the first one.
export class SerializerSignal {
  constructor(sampleRate, baud) {
    this.sampleRate = sampleRate;
    this.baud = baud;
    this.queue = [];
    this.head = 0;
    this.symbol = -1;   // the symbol being held (-1: none yet, so the first sample takes one at once)
    this.value = 0;
  }

  push(items) { for (const x of items) this.queue.push(x); }

  // a new rate takes effect from the next sample; what is already held stays
  set(baud) { this.baud = baud; }

  process(out, frame = 0) {
    for (let i = 0; i < out.length; i++) {
      // symbol k starts at the first frame f with f * baud >= k * sampleRate (integers: exact)
      const symbol = Math.floor((frame + i) * this.baud / this.sampleRate);
      if (symbol !== this.symbol) {
        this.symbol = symbol;
        this.value = this.head < this.queue.length ? this.queue[this.head++] : 0;
        if (this.head > 4096 && this.head * 2 > this.queue.length) { this.queue.splice(0, this.head); this.head = 0; }
      }
      out[i] = this.value;
    }
  }
}

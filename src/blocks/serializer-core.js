// The signal behind the Serializer, with no Web Audio in it so that it can be tested alone. It holds a buffer of
// numbers and produces a sample every sampleRate / baud output samples (a zero-order hold): the next number of the
// buffer, or 0 when it is empty (the first one is taken at once). process(out) fills a block of output samples.
export class SerializerSignal {
  constructor(sampleRate, baud) {
    this.sampleRate = sampleRate;
    this.baud = baud;
    this.queue = [];
    this.head = 0;
    this.acc = sampleRate;   // counts baud per output sample; reaching sampleRate means a new symbol (integer arithmetic: exact)
    this.value = 0;
  }

  push(items) { for (const x of items) this.queue.push(x); }

  // a new rate takes effect from the next sample; what is already held stays
  set(baud) { this.baud = baud; }

  process(out) {
    for (let i = 0; i < out.length; i++) {
      if (this.acc >= this.sampleRate) {
        this.acc -= this.sampleRate;
        this.value = this.head < this.queue.length ? this.queue[this.head++] : 0;
        if (this.head > 4096 && this.head * 2 > this.queue.length) { this.queue.splice(0, this.head); this.head = 0; }
      }
      this.acc += this.baud;
      out[i] = this.value;
    }
  }
}

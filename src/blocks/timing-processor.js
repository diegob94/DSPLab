// AudioWorklet processor behind Symbol Recovery: runs the PLL (timing-core.js) on the input and
// posts the recovered bits to the main thread, a batch per render quantum that produced any, and the lock
// state when it changes. Its audio output is the timing error.
import { SymbolTimer } from './timing-core.js';

class TimingRecovery extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { baud, bandwidth } = options.processorOptions;
    this.bits = [];
    this.locked = false;
    this.timer = new SymbolTimer({ sampleRate, baud, bandwidth, onBit: (b) => this.bits.push(b) });
    this.port.onmessage = ({ data }) => this.timer.set(data.baud, data.bandwidth);
  }

  process(inputs, outputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.timer.process(ch, outputs[0][0]);
    if (this.bits.length || this.timer.locked !== this.locked) {
      this.locked = this.timer.locked;
      this.port.postMessage({ bits: this.bits, locked: this.locked });
      this.bits = [];
    }
    return true;
  }
}

registerProcessor('dsplab-timing', TimingRecovery);

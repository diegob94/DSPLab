// AudioWorklet processor behind Symbol Timing Recovery: runs the PLL (timing-core.js) on the input and
// posts the recovered bits to the main thread, a batch per render quantum that produced any.
import { SymbolTimer } from './timing-core.js';

class TimingRecovery extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { baud, bandwidth, squelch } = options.processorOptions;
    this.bits = [];
    this.timer = new SymbolTimer({ sampleRate, baud, bandwidth, squelch, onBit: (b) => this.bits.push(b) });
    this.port.onmessage = ({ data }) => {
      this.timer.squelch = data.squelch;
      this.timer.set(data.baud, data.bandwidth);
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.timer.process(ch);
    if (this.bits.length) { this.port.postMessage(this.bits); this.bits = []; }
    return true;
  }
}

registerProcessor('dsplab-timing', TimingRecovery);

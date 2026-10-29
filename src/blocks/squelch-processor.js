// AudioWorklet processor behind the Squelch block: runs the gate (squelch-core.js) on its input.
import { Squelch } from './squelch-core.js';

class SquelchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { threshold, window } = options.processorOptions;
    this.gate = new Squelch({ sampleRate, threshold, window });
    this.port.onmessage = ({ data }) => this.gate.set(data.threshold, data.window);
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.gate.process(ch, out);   // an unconnected input leaves the output silent
    return true;
  }
}

registerProcessor('dsplab-squelch', SquelchProcessor);

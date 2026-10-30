// AudioWorklet processor behind the AGC block: runs the gain control (agc-core.js) on its input.
import { Agc } from './agc-core.js';

class AgcProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { target, attack, release, maxGain } = options.processorOptions;
    this.agc = new Agc({ sampleRate, target, attack, release, maxGain });
    this.port.onmessage = ({ data }) => this.agc.set(data.target, data.attack, data.release, data.maxGain);
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.agc.process(ch, out);   // an unconnected input leaves the output silent
    return true;
  }
}

registerProcessor('dsplab-agc', AgcProcessor);

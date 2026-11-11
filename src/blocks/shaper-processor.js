// AudioWorklet processor behind the Pulse Shaper: its output is the ShaperSignal (shaper-core.js) of its input.
import { ShaperSignal } from './shaper-core.js';

class ShaperProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { inRate, pulse, sps, amplitude } = options.processorOptions;
    this.signal = new ShaperSignal(sampleRate, inRate, pulse, sps, amplitude);
    this.silence = new Float32Array(128);
    this.port.onmessage = ({ data }) => this.signal.set(data.inRate, data.pulse, data.sps, data.amplitude);
  }

  process(inputs, outputs) {
    const ch = inputs[0] && inputs[0][0];
    this.signal.process(ch || this.silence, outputs[0][0], currentFrame);
    return true;
  }
}

registerProcessor('dsplab-shaper', ShaperProcessor);

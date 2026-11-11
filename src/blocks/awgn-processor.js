// AudioWorklet processor behind the AWGN block: adds noise (awgn-core.js) at the set SNR to its input.
import { Awgn } from './awgn-core.js';

class AwgnProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { snr, window } = options.processorOptions;
    this.noise = new Awgn({ sampleRate, snr, window });
    this.silence = new Float32Array(128);
    this.port.onmessage = ({ data }) => this.noise.set(data.snr, data.window);
  }

  process(inputs, outputs) {
    this.noise.process((inputs[0] && inputs[0][0]) || this.silence, outputs[0][0]);
    return true;
  }
}

registerProcessor('dsplab-awgn', AwgnProcessor);

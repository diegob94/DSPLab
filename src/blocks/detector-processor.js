// AudioWorklet processor behind the Detector block: compares every sample with the threshold (detector-core.js).
import { detect } from './detector-core.js';

class DetectorProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.threshold = options.processorOptions.threshold;
    this.silence = new Float32Array(128);
    this.port.onmessage = ({ data }) => { this.threshold = data.threshold; };
  }

  process(inputs, outputs) {
    // an unconnected input is silence (0), which is below any positive threshold and above any negative one
    detect((inputs[0] && inputs[0][0]) || this.silence, outputs[0][0], this.threshold);
    return true;
  }
}

registerProcessor('dsplab-detector', DetectorProcessor);

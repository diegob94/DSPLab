// AudioWorklet processor behind the Upsampler: its output is the UpsamplerSignal (upsampler-core.js) of its input.
import { UpsamplerSignal } from './upsampler-core.js';

class UpsamplerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { inRate, factor } = options.processorOptions;
    this.signal = new UpsamplerSignal(sampleRate, inRate, factor);
    this.silence = new Float32Array(128);
    this.port.onmessage = ({ data }) => this.signal.set(data.inRate, data.factor);
  }

  process(inputs, outputs) {
    const ch = inputs[0] && inputs[0][0];
    this.signal.process(ch || this.silence, outputs[0][0], currentFrame);
    return true;
  }
}

registerProcessor('dsplab-upsampler', UpsamplerProcessor);

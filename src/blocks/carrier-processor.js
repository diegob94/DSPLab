// AudioWorklet processor behind Carrier Recovery: runs the PLL (carrier-core.js); its output is the
// recovered carrier
// (channel 0) and its phase error (channel 1); it tells the main thread when the lock state changes.
import { CarrierPLL } from './carrier-core.js';

class CarrierRecovery extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { frequency, bandwidth, amplitude } = options.processorOptions;
    this.pll = new CarrierPLL({ sampleRate, frequency, bandwidth, amplitude });
    this.silence = new Float32Array(128);
    this.locked = false;
    this.port.onmessage = ({ data }) => this.pll.set(data.frequency, data.bandwidth, data.amplitude);
  }

  process(inputs, outputs) {
    // an unconnected input has no channels: the loop sees silence and free-runs
    const ch = inputs[0] && inputs[0][0];
    this.pll.process(ch || this.silence, outputs[0][0], outputs[0][1]);
    if (this.pll.locked !== this.locked) {
      this.locked = this.pll.locked;
      this.port.postMessage({ locked: this.locked });
    }
    return true;
  }
}

registerProcessor('dsplab-carrier', CarrierRecovery);

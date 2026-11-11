// AudioWorklet processor behind the Serializer: its output is the SerializerSignal (serializer-core.js), a signal that
// changes at the baud rate. The main thread sends it the numbers to put in the buffer and the baud rate.
import { SerializerSignal } from './serializer-core.js';

class SerializerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.signal = new SerializerSignal(sampleRate, options.processorOptions.baud);
    this.port.onmessage = ({ data }) => {
      if (data.items) this.signal.push(data.items);
      if (data.baud) this.signal.set(data.baud);
    };
  }

  process(inputs, outputs) {
    this.signal.process(outputs[0][0], currentFrame);
    return true;
  }
}

registerProcessor('dsplab-serializer', SerializerProcessor);

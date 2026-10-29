import { messageOutput, bitMessage } from './message.js';

export const symbolTiming = {
  title: 'Symbol Timing Recovery',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['msg'],
  messagePorts: ['msg'],
  params: [
    { key: 'baud',      label: 'Baud rate',      show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
    { key: 'bandwidth', label: 'Loop bandwidth', type: 'range', scale: 'log', min: 0.001, max: 0.1, step: 0.001, default: 0.005 },
    { key: 'squelch',   label: 'Squelch',        type: 'range', min: 0, max: 1, step: 0.01, default: 0.1 },
  ],
  // the processor must be registered before build() can create the worklet node
  setup(ctx) {
    return ctx.audioWorklet.addModule(new URL('./timing-processor.js', import.meta.url).href);
  },
  build(ctx, p) {
    const msg = messageOutput();
    const node = new AudioWorkletNode(ctx, 'dsplab-timing', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { baud: p.baud, bandwidth: p.bandwidth, squelch: p.squelch },
    });
    // the node only runs if it reaches the destination, so route its (silent) output there
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
    node.port.onmessage = ({ data }) => data.forEach((b) => msg.send(bitMessage(b)));
    return {
      inputs: { in: node },
      outputs: { msg },
      update(p) { node.port.postMessage({ baud: p.baud, bandwidth: p.bandwidth, squelch: p.squelch }); },
      dispose() { node.port.onmessage = null; node.disconnect(); mute.disconnect(); msg.disconnect(); },
    };
  },
};

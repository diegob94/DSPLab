import { lockLed } from './lock-led.js';
import { messageOutput, bitMessage } from './message.js';

export const symbolTiming = {
  title: 'Symbol Recovery',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['msg', 'phase'],   // phase: the timing error (0 when locked)
  messagePorts: ['msg'],
  params: [
    { key: 'baud',      label: 'Baud rate',      show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
    { key: 'bandwidth', label: 'Loop bandwidth', type: 'range', scale: 'log', min: 0.001, max: 0.1, step: 0.001, default: 0.005 },
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
      processorOptions: { baud: p.baud, bandwidth: p.bandwidth },
    });
    // the node only runs if it reaches the destination, so keep a muted copy of its output (the timing error) going there
    // even when nothing is cabled to the phase port
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
    const inst = {
      locked: false,
      inputs: { in: node },
      outputs: { msg, phase: node },
      update(p) { node.port.postMessage({ baud: p.baud, bandwidth: p.bandwidth }); },
      dispose() { node.port.onmessage = null; node.disconnect(); mute.disconnect(); msg.disconnect(); },
    };
    node.port.onmessage = ({ data }) => {
      inst.locked = data.locked;
      data.bits.forEach((b) => msg.send(bitMessage(b)));
    };
    return inst;
  },
  ui: lockLed,
};

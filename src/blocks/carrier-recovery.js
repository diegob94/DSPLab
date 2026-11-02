import { lockLed } from './lock-led.js';

export const carrierRecovery = {
  title: 'Carrier Recovery',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out', 'phase'],   // phase: the loop's phase error / pi (0 when locked)
  params: [
    { key: 'frequency', label: 'Frequency', show: true, type: 'range', scale: 'log', min: 20, max: 20000, step: 1, unit: 'Hz', default: 440 },
    { key: 'bandwidth', label: 'Loop bandwidth', show: true, type: 'range', scale: 'log', min: 1, max: 500, step: 1, unit: 'Hz', default: 20 },
    { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  // the processor must be registered before build() can create the worklet node
  setup(ctx) {
    return ctx.audioWorklet.addModule(new URL('./carrier-processor.js', import.meta.url).href);
  },
  build(ctx, p) {
    const node = new AudioWorkletNode(ctx, 'dsplab-carrier', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],   // channel 0: the carrier, 1: the phase error
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { frequency: p.frequency, bandwidth: p.bandwidth, amplitude: p.amplitude },
    });
    // one output node per port: split the two channels
    const split = ctx.createChannelSplitter(2);
    const out = ctx.createGain(), phase = ctx.createGain();
    node.connect(split);
    // the node only runs if it reaches the destination, so the led works even with no cable on the outputs
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
    split.connect(out, 0);
    split.connect(phase, 1);
    const inst = {
      locked: false,
      inputs: { in: node },
      outputs: { out, phase },
      update(p) { node.port.postMessage({ frequency: p.frequency, bandwidth: p.bandwidth, amplitude: p.amplitude }); },
      dispose() { node.port.onmessage = null; node.disconnect(); split.disconnect(); mute.disconnect(); out.disconnect(); phase.disconnect(); },
    };
    node.port.onmessage = ({ data }) => { inst.locked = data.locked; };
    return inst;
  },
  ui: lockLed,
};

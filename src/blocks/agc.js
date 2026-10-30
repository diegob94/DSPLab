export const agc = {
  title: 'Automatic Gain Control',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  params: [
    { key: 'target',  label: 'Target',   show: true, type: 'range', min: 0.01, max: 1, step: 0.01, default: 0.5 },
    { key: 'attack',  label: 'Attack',   type: 'range', scale: 'log', min: 0.1, max: 100, step: 0.1, unit: 'ms', default: 5 },
    { key: 'release', label: 'Release',  type: 'range', scale: 'log', min: 10, max: 5000, step: 1, unit: 'ms', default: 500 },
    { key: 'maxGain', label: 'Max gain', type: 'range', min: 0, max: 60, step: 1, unit: 'dB', default: 40 },
  ],
  // the processor must be registered before build() can create the worklet node
  setup(ctx) {
    return ctx.audioWorklet.addModule(new URL('./agc-processor.js', import.meta.url).href);
  },
  build(ctx, p) {
    const send = (p) => ({ target: p.target, attack: p.attack, release: p.release, maxGain: p.maxGain });
    const node = new AudioWorkletNode(ctx, 'dsplab-agc', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: send(p),
    });
    return {
      inputs: { in: node },
      outputs: { out: node },
      update(p) { node.port.postMessage(send(p)); },
      dispose() { node.port.onmessage = null; node.disconnect(); },
    };
  },
};

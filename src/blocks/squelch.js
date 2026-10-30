export const squelch = {
  title: 'Squelch',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  params: [
    { key: 'threshold', label: 'Threshold', show: true, type: 'range', min: 0, max: 1, step: 0.01, default: 0.1 },
    { key: 'window',    label: 'Window',    type: 'range', scale: 'log', min: 1, max: 500, step: 1, unit: 'ms', default: 20 },
  ],
  // the processor must be registered before build() can create the worklet node
  setup(ctx) {
    return ctx.audioWorklet.addModule(new URL('./squelch-processor.js', import.meta.url).href);
  },
  build(ctx, p) {
    const node = new AudioWorkletNode(ctx, 'dsplab-squelch', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { threshold: p.threshold, window: p.window },
    });
    return {
      inputs: { in: node },
      outputs: { out: node },
      update(p) { node.port.postMessage({ threshold: p.threshold, window: p.window }); },
      dispose() { node.port.onmessage = null; node.disconnect(); },
    };
  },
};

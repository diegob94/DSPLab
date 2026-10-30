export const carrierRecovery = {
  title: 'Carrier Recovery',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
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
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { frequency: p.frequency, bandwidth: p.bandwidth, amplitude: p.amplitude },
    });
    return {
      inputs: { in: node },
      outputs: { out: node },
      update(p) { node.port.postMessage({ frequency: p.frequency, bandwidth: p.bandwidth, amplitude: p.amplitude }); },
      dispose() { node.port.onmessage = null; node.disconnect(); },
    };
  },
};

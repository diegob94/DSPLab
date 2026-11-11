// Additive white Gaussian noise at a given signal-to-noise ratio: out = in + σ·N(0, 1), with σ following the power of
// the input (see awgn-core.js).
export const awgn = {
  title: 'AWGN',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  params: [
    { key: 'snr',    label: 'SNR',    show: true, type: 'range', min: -20, max: 60, step: 0.5, unit: 'dB', default: 20 },
    { key: 'window', label: 'Window', type: 'range', scale: 'log', min: 10, max: 5000, step: 1, unit: 'ms', default: 500 },
  ],
  // the processor must be registered before build() can create the worklet node
  setup(ctx) {
    return ctx.audioWorklet.addModule(new URL('./awgn-processor.js', import.meta.url).href);
  },
  build(ctx, p) {
    const worklet = new AudioWorkletNode(ctx, 'dsplab-awgn', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { snr: p.snr, window: p.window },
    });
    return {
      inputs: { in: worklet },
      outputs: { out: worklet },
      update(p) { worklet.port.postMessage({ snr: p.snr, window: p.window }); },
      dispose() { worklet.port.onmessage = null; worklet.disconnect(); },
    };
  },
};

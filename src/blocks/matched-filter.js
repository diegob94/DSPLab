import { shaperKernel } from './shaper-core.js';

// The impulse response of a matched filter is the pulse reversed in time. Both pulse shapes are symmetric,
// so it is the pulse itself, scaled by 1 / (its energy): a symbol sent with amplitude A then comes out of the
// filter with a peak of A, and the peak falls on the last sample of the symbol (a square pulse) or one
// SPAN after the pulse's centre (a sinc), which is the filter's delay.
export const matchedKernel = (pulse, sps) => shaperKernel(pulse, sps, true);

// A simple convolutional filter, like the Pulse Shaper (it runs in the same worklet): its input is a signal and its
// output is that signal convolved with the matched kernel, at the same sample rate. `sps` is the symbol length in
// samples of the input, so after an Upsampler it is the Upsampler's Factor.
export const matchedFilter = {
  title: 'Matched Filter',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  inputRate: 'any',
  rates: { out: (params, inRate) => inRate },   // a convolution keeps the sample rate
  matchedKernel,
  params: [
    { key: 'pulse', label: 'Pulse',            show: true, type: 'select', options: ['square', 'sinc'], default: 'square' },
    { key: 'sps',   label: 'Samples / symbol', show: true, type: 'range', min: 1, max: 64, step: 1, default: 8 },
  ],
  // the processor must be registered before build() can create the worklet node
  setup(ctx) {
    return ctx.audioWorklet.addModule(new URL('./shaper-processor.js', import.meta.url).href);
  },
  build(ctx, p, node, wires, rates = {}) {
    let inRate = rates.in || ctx.sampleRate;
    let params = p;
    const worklet = new AudioWorkletNode(ctx, 'dsplab-shaper', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { inRate, pulse: p.pulse, sps: p.sps, matched: true },
    });
    // the node only runs if it reaches the destination, so keep a muted copy of it going there
    const mute = ctx.createGain();
    mute.gain.value = 0;
    worklet.connect(mute).connect(ctx.destination);
    const send = () => worklet.port.postMessage({ inRate, pulse: params.pulse, sps: params.sps, matched: true });
    return {
      inputs: { in: worklet },
      outputs: { out: worklet },
      update(p) { params = p; send(); },
      setRates(r) { inRate = r.in || ctx.sampleRate; send(); },
      dispose() { worklet.port.onmessage = null; worklet.disconnect(); mute.disconnect(); },
    };
  },
};

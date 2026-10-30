import { pulseSamples } from './pulse-shaper.js';

// The impulse response of a matched filter is the pulse reversed in time. Both pulse shapes are symmetric,
// so it is the pulse itself, scaled by 1 / (its energy): a symbol sent with amplitude A then comes out of the
// filter with a peak of A, and the peak falls on the last sample of the symbol (a square pulse) or one
// SPAN after the pulse's centre (a sinc), which is the filter's delay.
export function matchedKernel(pulse, sps) {
  const { data } = pulseSamples(pulse, 0, sps, 1, 1);
  const energy = data.reduce((s, v) => s + v * v, 0);
  return data.map((v) => v / energy);
}

// Correlates the input with the pulse the Pulse Shaper uses: maximises the signal-to-noise ratio at the
// sampling instant. Done with a ConvolverNode (a real FIR filter), so it costs one convolution per block.
export const matchedFilter = {
  title: 'Matched Filter',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  matchedKernel,
  params: [
    { key: 'pulse', label: 'Pulse',     show: true, type: 'select', options: ['square', 'sinc'], default: 'square' },
    { key: 'baud',  label: 'Baud rate', show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
  ],
  build(ctx, p) {
    const conv = ctx.createConvolver();
    conv.normalize = false;   // keep the gain the kernel was scaled for
    let key = '';
    const update = (p) => {
      const k = `${p.pulse}/${p.baud}`;
      if (k === key) return;   // reassigning the buffer glitches the output: only when the pulse changed
      key = k;
      const h = matchedKernel(p.pulse, ctx.sampleRate / p.baud);
      const buffer = ctx.createBuffer(1, h.length, ctx.sampleRate);
      buffer.copyToChannel(h, 0);
      conv.buffer = buffer;
    };
    update(p);
    return {
      inputs: { in: conv },
      outputs: { out: conv },
      update,
      dispose() { conv.disconnect(); },
    };
  },
};

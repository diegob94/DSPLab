import { clamp } from '../util.js';

const SECONDS = 10;

// Unit-variance Gaussian noise (Box-Muller), shared by all instances and made on first use.
let noise = null;
function noiseBuffer(ctx) {
  if (!noise || noise.sampleRate !== ctx.sampleRate) {
    noise = new AudioBuffer({ length: SECONDS * ctx.sampleRate, sampleRate: ctx.sampleRate });
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i += 2) {
      const r = Math.sqrt(-2 * Math.log(1 - Math.random()));
      const a = 2 * Math.PI * Math.random();
      d[i] = r * Math.cos(a);
      if (i + 1 < d.length) d[i + 1] = r * Math.sin(a);
    }
  }
  return noise;
}

export const awgn = {
  title: 'AWGN',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  params: [
    { key: 'sigma', label: 'Noise σ', show: true, type: 'range', min: 0, max: 1, step: 0.01, default: 0.1 },
  ],
  // Additive white Gaussian noise: out = in + σ·N(0, 1). The noise comes from a looping 10 s buffer,
  // started at a random offset so two blocks are not correlated.
  build(ctx, p) {
    const sum = ctx.createGain();
    const level = ctx.createGain();
    const src = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx), loop: true });
    src.connect(level).connect(sum);
    src.start(0, Math.random() * SECONDS);
    const update = (p) => level.gain.setTargetAtTime(clamp(p.sigma, 0, 1), ctx.currentTime, 0.01);
    level.gain.value = clamp(p.sigma, 0, 1);
    return {
      inputs: { in: sum },
      outputs: { out: sum },
      update,
      dispose() { src.stop(); src.disconnect(); level.disconnect(); sum.disconnect(); },
    };
  },
};

import { clamp } from '../util.js';

export const filter = {
  title: 'Filter',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  params: [
    { key: 'type',      label: 'Type',      show: true, type: 'select', options: ['lowpass', 'highpass'], default: 'lowpass' },
    { key: 'frequency', label: 'Cutoff',    show: true, type: 'range', scale: 'log', min: 10, max: 20000, unit: 'Hz', default: 1000 },
    { key: 'q',         label: 'Q',         type: 'range', min: 0.1, max: 20, step: 0.1, default: 0.707 },
  ],
  // One BiquadFilterNode (2nd order, 12 dB/octave). Q = 0.707 is a flat (Butterworth) response;
  // higher values add a resonant peak at the cutoff.
  build(ctx, p) {
    const f = ctx.createBiquadFilter();
    const update = (p) => {
      const t = ctx.currentTime;
      f.type = p.type;
      f.frequency.setTargetAtTime(clamp(p.frequency, 10, 20000), t, 0.01);
      f.Q.setTargetAtTime(p.q, t, 0.01);
    };
    update(p);
    return {
      inputs: { in: f },
      outputs: { out: f },
      update,
      dispose() { f.disconnect(); },
    };
  },
};

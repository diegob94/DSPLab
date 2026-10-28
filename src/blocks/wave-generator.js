import { clamp } from '../util.js';

export const waveGenerator = {
  title: 'Wave Generator',
  category: 'Source blocks',
  inputs: [],
  outputs: ['out'],
  params: [
    { key: 'waveform',  label: 'Waveform',  show: true, type: 'select', options: ['sine', 'square', 'sawtooth', 'triangle'], default: 'sine' },
    { key: 'frequency', label: 'Frequency', show: true, type: 'range', scale: 'log', min: 1, max: 20000, unit: 'Hz', default: 440 },
    { key: 'amplitude', label: 'Amplitude', type: 'range',  min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  build(ctx, p) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    osc.start();
    const update = (p) => {
      const t = ctx.currentTime;
      osc.type = p.waveform;
      osc.frequency.setTargetAtTime(clamp(p.frequency, 1, 20000), t, 0.01);
      gain.gain.setTargetAtTime(p.amplitude, t, 0.01);
    };
    update(p);
    return {
      outputs: { out: gain },
      update,
      dispose() { osc.stop(); osc.disconnect(); gain.disconnect(); },
    };
  },
};

import { clamp } from '../util.js';

export const vco = {
  title: 'VCO',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  params: [
    { key: 'waveform',    label: 'Waveform',    show: true, type: 'select', options: ['sine', 'square', 'sawtooth', 'triangle'], default: 'sine' },
    { key: 'frequency',   label: 'Frequency',   show: true, type: 'range', scale: 'log', min: 1, max: 20000, unit: 'Hz', default: 440 },
    { key: 'sensitivity', label: 'Sensitivity', show: true, type: 'range', min: 0, max: 5000, step: 1, unit: 'Hz/unit', default: 100 },
    { key: 'amplitude',   label: 'Amplitude',   type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  // Voltage-controlled oscillator: instantaneous frequency = Frequency + Sensitivity · input.
  // The input is scaled and added to the oscillator's frequency AudioParam, so the phase stays continuous.
  // A negative total frequency runs the oscillator backwards. An unconnected input is 0.
  build(ctx, p) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const ctl = ctx.createGain();   // input · sensitivity, in Hz
    ctl.connect(osc.frequency);
    osc.connect(gain);
    osc.start();
    const update = (p) => {
      const t = ctx.currentTime;
      osc.type = p.waveform;
      osc.frequency.setTargetAtTime(clamp(p.frequency, 1, 20000), t, 0.01);
      ctl.gain.setTargetAtTime(p.sensitivity, t, 0.01);
      gain.gain.setTargetAtTime(p.amplitude, t, 0.01);
    };
    // start at the final values (no glide from the defaults)
    osc.type = p.waveform;
    osc.frequency.value = clamp(p.frequency, 1, 20000);
    ctl.gain.value = p.sensitivity;
    gain.gain.value = p.amplitude;
    return {
      inputs: { in: ctl },
      outputs: { out: gain },
      update,
      dispose() { osc.stop(); osc.disconnect(); ctl.disconnect(); gain.disconnect(); },
    };
  },
};

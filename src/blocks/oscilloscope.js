import { h } from '../dom.js';

// trace / port colours of the oscilloscope channels
const SCOPE_COLORS = ['#f2a65a', '#4dd0e1', '#8bd17c', '#e57fd0', '#f5d76e', '#7aa7ff', '#ff7b72', '#b5e853'];

const inputNames = (p) => Array.from({ length: p.channels }, (_, i) => `ch${i + 1}`);

export const oscilloscope = {
  title: 'Oscilloscope',
  category: 'Sink blocks',
  inputs: inputNames,
  outputs: [],
  portColor: (port) => SCOPE_COLORS[(parseInt(port.slice(2), 10) - 1) % SCOPE_COLORS.length],
  params: [
    { key: 'channels', label: 'Inputs',     type: 'select', options: [1, 2, 3, 4, 5, 6, 7, 8], ports: true, default: 2 },
    { key: 'trigger',  label: 'Trigger',    show: true, type: 'select', options: (p) => inputNames(p), default: 'ch1' },
    { key: 'level',    label: 'Trig level', type: 'range', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'timespan', label: 'Time span',  show: true, type: 'range', scale: 'log', min: 1, max: 100, unit: 'ms', default: 10 },
    { key: 'scale',    label: 'Scale',      type: 'range', scale: 'log', min: 0.1, max: 10, unit: '×', default: 1 },
  ],
  build(ctx, p) {
    const names = inputNames(p);
    const chans = names.map(() => {
      const an = ctx.createAnalyser();
      an.fftSize = 16384;
      return { an, buf: new Float32Array(an.fftSize), check: new Float32Array(an.fftSize), connected: false };
    });

    // Read the connected channels as one time-aligned snapshot: if the audio thread
    // advanced while we were reading, a channel differs between two consecutive reads, so retry.
    const readAll = (live) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        live.forEach((c) => c.an.getFloatTimeDomainData(c.buf));
        if (live.length < 2) return;
        live.forEach((c) => c.an.getFloatTimeDomainData(c.check));
        if (live.every((c) => c.buf.every((v, i) => v === c.check[i]))) return;
      }
    };

    return {
      inputs: Object.fromEntries(names.map((name, i) => [name, chans[i].an])),
      outputs: {},
      update() {},
      onConnect(port) { chans[names.indexOf(port)].connected = true; },
      // One window per connected channel (null for unconnected ones), all starting at the same
      // rising crossing of `level` on the `trigger` channel so the traces hold still.
      sample(spanMs, level = 0, trigger = names[0]) {
        const live = chans.filter((c) => c.connected);
        readAll(live);
        const n = Math.min(Math.round(spanMs * ctx.sampleRate / 1000), 16384 >> 1);
        const t = chans[names.indexOf(trigger)];
        let start = 0;
        if (t && t.connected) {
          // newest crossing that still leaves a full window after it; the oldest data
          // can hold start-up transients
          for (let i = t.buf.length - n - 1; i > 0; i--) {
            if (t.buf[i - 1] < level && t.buf[i] >= level) { start = i; break; }
          }
        }
        return chans.map((c) => (c.connected ? c.buf.subarray(start, start + n) : null));
      },
      dispose() { chans.forEach((c) => c.an.disconnect()); },
    };
  },
  ui(node) {
    const W = 220, H = 130, dpr = window.devicePixelRatio || 1;
    const el = h('canvas', { className: 'scope', width: W * dpr, height: H * dpr });
    const g = el.getContext('2d');
    return {
      el,
      draw(inst) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = '#0d0f12';
        g.fillRect(0, 0, W, H);
        g.lineWidth = 1;
        g.strokeStyle = '#242a33';
        g.beginPath();
        for (let i = 1; i < 10; i++) { g.moveTo(Math.round(i * W / 10) + .5, 0); g.lineTo(Math.round(i * W / 10) + .5, H); }
        for (let i = 1; i < 8; i++)  { g.moveTo(0, Math.round(i * H / 8) + .5);  g.lineTo(W, Math.round(i * H / 8) + .5); }
        g.stroke();
        g.strokeStyle = '#3a4350';
        g.beginPath(); g.moveTo(0, H / 2 + .5); g.lineTo(W, H / 2 + .5); g.stroke();

        g.fillStyle = '#6b7482';
        g.font = '10px system-ui, sans-serif';
        if (!inst) { g.fillText('Stopped', 6, 14); return; }
        g.fillText(`${node.params.timespan} ms · trigger ${node.params.trigger}`, 6, 14);

        const amp = (H / 2) * 0.9 * node.params.scale;
        g.lineWidth = 1.5;
        inst.sample(node.params.timespan, node.params.level, node.params.trigger).forEach((data, k) => {
          if (!data || data.length < 2) return;
          g.strokeStyle = SCOPE_COLORS[k % SCOPE_COLORS.length];
          g.beginPath();
          for (let i = 0; i < data.length; i++) {
            const x = i * (W - 1) / (data.length - 1);
            const y = Math.min(H, Math.max(0, H / 2 - data[i] * amp));
            if (i) g.lineTo(x, y); else g.moveTo(x, y);
          }
          g.stroke();
        });
      },
    };
  },
};

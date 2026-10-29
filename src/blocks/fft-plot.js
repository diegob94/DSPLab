import { h } from '../dom.js';

const W = 220, H = 130;
const DB_MIN = -100, DB_MAX = 0;   // vertical range of the plot
const F_MIN_LOG = 20;              // left edge of the logarithmic frequency axis
const COLOR = '#4dd0e1';

const fmtHz = (f) => f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : `${Math.round(f)}`;

export const fftPlot = {
  title: 'FFT Plot',
  category: 'Sink blocks',
  inputs: ['in'],
  outputs: [],
  params: [
    { key: 'size',  label: 'Window size', show: true, type: 'select', options: [256, 512, 1024, 2048, 4096, 8192, 16384, 32768], default: 2048 },
    { key: 'scale', label: 'Freq. axis',  show: true, type: 'select', options: ['linear', 'log'], default: 'linear' },
  ],
  build(ctx, p) {
    const an = ctx.createAnalyser();
    an.smoothingTimeConstant = 0.5;
    an.minDecibels = DB_MIN;
    an.maxDecibels = DB_MAX;
    an.fftSize = p.size;
    let bins = new Float32Array(an.frequencyBinCount);
    return {
      inputs: { in: an },
      outputs: {},
      update(p) {
        if (an.fftSize !== p.size) { an.fftSize = p.size; bins = new Float32Array(an.frequencyBinCount); }
      },
      // magnitude in dB of each bin, bin k being at k * binHz
      spectrum() {
        an.getFloatFrequencyData(bins);
        return { bins, binHz: ctx.sampleRate / an.fftSize };
      },
      dispose() { an.disconnect(); },
    };
  },
  ui(node) {
    const dpr = window.devicePixelRatio || 1;
    const el = h('canvas', { className: 'scope', width: W * dpr, height: H * dpr });
    const g = el.getContext('2d');
    return {
      el,
      draw(inst) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = '#0d0f12';
        g.fillRect(0, 0, W, H);
        const yOf = (db) => (1 - (Math.min(DB_MAX, Math.max(DB_MIN, db)) - DB_MIN) / (DB_MAX - DB_MIN)) * H;

        g.font = '10px system-ui, sans-serif';
        g.textBaseline = 'alphabetic';
        g.lineWidth = 1;
        g.strokeStyle = '#242a33';
        g.fillStyle = '#6b7482';
        g.textAlign = 'left';
        g.beginPath();
        for (let db = -20; db > DB_MIN; db -= 20) {
          const y = Math.round(yOf(db)) + .5;
          g.moveTo(0, y); g.lineTo(W, y);
          g.fillText(`${db}`, 2, y - 2);
        }
        g.stroke();
        if (!inst) { g.fillText('Stopped', 6, 14); return; }

        const { bins, binHz } = inst.spectrum();
        const nyquist = bins.length * binHz;
        const log = node.params.scale === 'log';
        const fMin = log ? F_MIN_LOG : 0;
        const xOf = (f) => log
          ? Math.log(Math.max(f, fMin) / fMin) / Math.log(nyquist / fMin) * (W - 1)
          : f / nyquist * (W - 1);
        const fOf = (x) => log ? fMin * Math.pow(nyquist / fMin, x / (W - 1)) : x / (W - 1) * nyquist;

        // frequency ticks
        g.strokeStyle = '#242a33';
        g.fillStyle = '#6b7482';
        g.textAlign = 'left';
        g.beginPath();
        const ticks = log ? [100, 1000, 10000].filter((f) => f < nyquist) : [0.25, 0.5, 0.75].map((t) => t * nyquist);
        for (const f of ticks) {
          const x = Math.round(xOf(f)) + .5;
          g.moveTo(x, 0); g.lineTo(x, H);
          g.fillText(fmtHz(f), x + 2, H - 3);
        }
        g.stroke();
        g.textAlign = 'right';
        g.fillText(fmtHz(nyquist), W - 2, H - 3);

        // one point per pixel column: the loudest bin that falls in it
        g.strokeStyle = COLOR;
        g.lineWidth = 1.5;
        g.beginPath();
        let peakDb = -Infinity, peakF = 0;
        for (let x = 0; x < W; x++) {
          const k0 = Math.max(0, Math.floor(fOf(x - .5) / binHz));
          const k1 = Math.min(bins.length - 1, Math.max(k0, Math.floor(fOf(x + .5) / binHz)));
          let m = -Infinity;
          for (let k = k0; k <= k1; k++) {
            if (bins[k] > m) m = bins[k];
            if (bins[k] > peakDb) { peakDb = bins[k]; peakF = k * binHz; }
          }
          if (x) g.lineTo(x, yOf(m)); else g.moveTo(x, yOf(m));
        }
        g.stroke();
        if (peakDb > DB_MIN) {
          g.fillStyle = COLOR;
          g.textAlign = 'right';
          g.fillText(`peak ${Math.round(peakF)} Hz`, W - 4, 12);
        }
      },
    };
  },
};

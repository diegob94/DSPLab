import { h } from '../dom.js';

// trace / port colours of the oscilloscope channels
const SCOPE_COLORS = ['#f2a65a', '#4dd0e1', '#8bd17c', '#e57fd0', '#f5d76e', '#7aa7ff', '#ff7b72', '#b5e853'];

const inputNames = (p) => Array.from({ length: p.channels }, (_, i) => `ch${i + 1}`);

const AUTO_HZ = 100;      // sweep rate of the free-running ("auto") trigger
const DIV_X = 10, DIV_Y = 8;   // graticule divisions
const LEVEL_SHOWN_MS = 1500;   // how long the trigger level line stays after it was last changed
const num = (v) => String(Number(v.toPrecision(3)));

export const oscilloscope = {
  title: 'Oscilloscope',
  category: 'Sink blocks',
  inputs: inputNames,
  outputs: [],
  portColor: (port) => SCOPE_COLORS[(parseInt(port.slice(2), 10) - 1) % SCOPE_COLORS.length],
  params: [
    { key: 'channels', label: 'Inputs',     type: 'select', options: [1, 2, 3, 4, 5, 6, 7, 8], ports: true, default: 2 },
    { key: 'trigger',  label: 'Trigger',    show: true, type: 'select', options: (p) => ['auto', ...inputNames(p)], default: 'auto' },
    { key: 'level',    label: 'Trig level', type: 'range', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'timespan', label: 'Time span',  show: true, type: 'range', scale: 'log', min: 1, max: 1000, unit: 'ms', default: 10 },
    { key: 'ydiv',     label: 'Y / div',    show: true, type: 'range', scale: 'log', min: 0.01, max: 2, default: 0.25 },
  ],
  // the capture processor must be registered before build() can create the worklet node
  setup(ctx) {
    return ctx.audioWorklet.addModule(new URL('./scope-processor.js', import.meta.url).href);
  },
  build(ctx, p) {
    const names = inputNames(p);
    const cap = Math.ceil(ctx.sampleRate * 2);        // history kept per channel: 2 s
    const maxWindow = Math.ceil(ctx.sampleRate);      // longest time span: 1 s
    const rings = names.map(() => new Float32Array(cap));
    const windows = names.map(() => new Float32Array(maxWindow));
    const search = new Float32Array(cap);
    const connected = names.map(() => false);
    let written = 0;                                  // samples received so far, per channel

    const capture = new AudioWorkletNode(ctx, 'dsplab-scope', {
      numberOfInputs: names.length, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
    });
    // the node only runs if it reaches the destination, so route its (silent) output there
    const mute = ctx.createGain();
    mute.gain.value = 0;
    capture.connect(mute).connect(ctx.destination);
    // one gain per channel: a cable connects to an AudioNode, and each feeds one input of the worklet
    const taps = names.map((_, i) => {
      const g = ctx.createGain();
      g.connect(capture, 0, i);
      return g;
    });

    capture.port.onmessage = ({ data }) => {
      const len = data[0].length;
      const head = written % cap;
      const first = Math.min(len, cap - head);
      data.forEach((chunk, c) => {
        rings[c].set(chunk.subarray(0, first), head);
        if (first < len) rings[c].set(chunk.subarray(first), 0);
      });
      written += len;
    };

    // copy `len` samples of a ring into dst, starting `from` samples into its oldest-first view
    const read = (ring, from, len, dst) => {
      const s = (written + from) % cap;
      const first = Math.min(len, cap - s);
      dst.set(ring.subarray(s, s + first), 0);
      if (first < len) dst.set(ring.subarray(0, len - first), first);
    };

    return {
      inputs: Object.fromEntries(names.map((name, i) => [name, taps[i]])),
      outputs: {},
      update() {},
      onConnect(port) { connected[names.indexOf(port)] = true; },
      // One window per connected channel (null for unconnected ones), all starting at the same
      // instant so the traces hold still: the rising crossing of `level` on the `trigger` channel,
      // or with trigger 'auto' the newest multiple of 1/100 s on the sample clock (free-running,
      // so `level` is ignored). Without a trigger crossing the newest samples are shown.
      sample(spanMs, level = 0, trigger = 'auto') {
        const n = Math.min(Math.round(spanMs * ctx.sampleRate / 1000), maxWindow);
        let start = cap - n;
        const t = names.indexOf(trigger);
        if (trigger === 'auto') {
          const period = Math.round(ctx.sampleRate / AUTO_HZ);
          start -= (((written - n) % period) + period) % period;   // (written - n) is the sample number at `start`
        } else if (t >= 0 && connected[t]) {
          read(rings[t], 0, cap, search);
          // newest crossing that still leaves a full window after it
          for (let i = cap - n - 1; i > 0; i--) {
            if (search[i - 1] < level && search[i] >= level) { start = i; break; }
          }
        }
        return names.map((_, c) => {
          if (!connected[c]) return null;
          read(rings[c], start, n, windows[c]);
          return windows[c].subarray(0, n);
        });
      },
      dispose() {
        capture.port.onmessage = null;
        taps.forEach((g) => g.disconnect());
        capture.disconnect();
        mute.disconnect();
      },
    };
  },
  ui(node) {
    const W = 220, H = 130, dpr = window.devicePixelRatio || 1;
    const el = h('canvas', { className: 'scope', width: W * dpr, height: H * dpr });
    const g = el.getContext('2d');
    let lastLevel = node.params.level, levelShownAt = -Infinity;
    return {
      el,
      draw(inst) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = '#0d0f12';
        g.fillRect(0, 0, W, H);
        g.lineWidth = 1;
        g.strokeStyle = '#242a33';
        g.beginPath();
        for (let i = 1; i < DIV_X; i++) { g.moveTo(Math.round(i * W / DIV_X) + .5, 0); g.lineTo(Math.round(i * W / DIV_X) + .5, H); }
        for (let i = 1; i < DIV_Y; i++) { g.moveTo(0, Math.round(i * H / DIV_Y) + .5); g.lineTo(W, Math.round(i * H / DIV_Y) + .5); }
        g.stroke();
        g.strokeStyle = '#3a4350';
        g.beginPath(); g.moveTo(0, H / 2 + .5); g.lineTo(W, H / 2 + .5); g.stroke();

        const { timespan, trigger, level, ydiv } = node.params;
        const pxPerUnit = (H / DIV_Y) / ydiv;
        const yOf = (v) => Math.min(H, Math.max(0, H / 2 - v * pxPerUnit));

        g.fillStyle = '#6b7482';
        g.font = '10px system-ui, sans-serif';
        g.textBaseline = 'alphabetic';
        g.textAlign = 'left';
        g.fillText(inst ? `trigger ${trigger}` : 'Stopped', 6, 14);
        g.textAlign = 'right';
        g.fillText(`${num(timespan / DIV_X)} ms/div · ${num(ydiv)}/div`, W - 6, H - 5);
        g.textAlign = 'left';

        // the trigger level, drawn for a moment after it was changed (also while stopped)
        if (level !== lastLevel) { lastLevel = level; levelShownAt = performance.now(); }
        if (performance.now() - levelShownAt < LEVEL_SHOWN_MS) {
          const ly = Math.round(yOf(level)) + .5;
          const k = trigger === 'auto' ? -1 : parseInt(trigger.slice(2), 10) - 1;
          g.strokeStyle = g.fillStyle = k < 0 ? '#9aa4b2' : SCOPE_COLORS[k % SCOPE_COLORS.length];
          g.setLineDash([4, 3]);
          g.beginPath(); g.moveTo(0, ly); g.lineTo(W, ly); g.stroke();
          g.setLineDash([]);
          g.fillText(`level ${level}`, 6, ly < 28 ? ly + 12 : ly - 4);
        }
        if (!inst) return;

        g.lineWidth = 1.5;
        inst.sample(timespan, level, trigger).forEach((data, k) => {
          if (!data || data.length < 2) return;
          g.strokeStyle = SCOPE_COLORS[k % SCOPE_COLORS.length];
          g.beginPath();
          if (data.length <= 4 * W) {
            for (let i = 0; i < data.length; i++) {
              const x = i * (W - 1) / (data.length - 1);
              if (i) g.lineTo(x, yOf(data[i])); else g.moveTo(x, yOf(data[i]));
            }
          } else {
            // many samples per pixel: draw each column's lowest and highest sample, in time order
            for (let x = 0; x < W; x++) {
              const end = Math.floor((x + 1) * data.length / W);
              let lo = Infinity, hi = -Infinity, iLo = 0, iHi = 0;
              for (let i = Math.floor(x * data.length / W); i < end; i++) {
                if (data[i] < lo) { lo = data[i]; iLo = i; }
                if (data[i] > hi) { hi = data[i]; iHi = i; }
              }
              const [first, last] = iLo < iHi ? [lo, hi] : [hi, lo];
              if (x) g.lineTo(x, yOf(first)); else g.moveTo(x, yOf(first));
              g.lineTo(x, yOf(last));
            }
          }
          g.stroke();
        });
      },
    };
  },
};

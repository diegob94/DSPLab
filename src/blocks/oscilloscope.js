import { h, svgEl } from '../dom.js';

// trace / port colours of the oscilloscope channels
const SCOPE_COLORS = ['#f2a65a', '#4dd0e1', '#8bd17c', '#e57fd0', '#f5d76e', '#7aa7ff', '#ff7b72', '#b5e853'];

const inputNames = (p) => Array.from({ length: p.channels }, (_, i) => `ch${i + 1}`);

const DIV_X = 10, DIV_Y = 8;   // graticule divisions
const LEVEL_SHOWN_MS = 1500;   // how long the trigger level line stays after it was last changed

export const oscilloscope = {
  title: 'Oscilloscope',
  category: 'Sink blocks',
  inputs: inputNames,
  outputs: [],
  portColor: (port) => SCOPE_COLORS[(parseInt(port.slice(2), 10) - 1) % SCOPE_COLORS.length],
  params: [
    { key: 'channels', label: 'Inputs',     type: 'select', options: [1, 2, 3, 4, 5, 6, 7, 8], ports: true, default: 2 },
    { key: 'trigger',  label: 'Trigger',    show: true, type: 'select', options: (p) => inputNames(p), default: 'ch1' },
    { key: 'mode',     label: 'Trig mode',  show: true, type: 'select', options: ['auto', 'normal', 'single'], default: 'auto' },
    { key: 'level',    label: 'Trig level', type: 'range', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'xdiv',     label: 'X / div',    show: true, type: 'range', scale: 'log', min: 0.1, max: 1000, unit: 'ms', default: 1 },
    { key: 'ydiv',     label: 'Y / div',    show: true, type: 'range', scale: 'log', min: 0.01, max: 2, default: 0.25 },
  ],
  // the capture processor must be registered before build() can create the worklet node
  setup(ctx) {
    return ctx.audioWorklet.addModule(new URL('./scope-processor.js', import.meta.url).href);
  },
  build(ctx, p) {
    const names = inputNames(p);
    const maxWindow = Math.ceil(ctx.sampleRate * 10); // longest time span: 10 s
    const cap = 2 * maxWindow;                        // history kept per channel: 20 s
    const history = Math.ceil(ctx.sampleRate);        // how far back before the window a trigger is searched
    const rings = names.map(() => new Float32Array(cap));
    const windows = names.map(() => new Float32Array(maxWindow));
    const search = new Float32Array(maxWindow + history);
    let held = null, heldKey = '', armedAt = 0;       // normal / single: the sweep on screen, and what it was taken with
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
      // rising crossing of `level` on the `trigger` channel so the traces hold still.
      //  auto:   without a trigger crossing the newest samples are shown.
      //  normal: only a trigger crossing updates the screen; until one comes, the last sweep stays
      //          (nothing at all if there is none yet).
      //  single: waits for the first crossing after it was armed, then keeps that sweep. It is armed
      //          by choosing the mode and again by changing the trigger, level or time base.
      sample(spanMs, level = 0, trigger = names[0], mode = 'auto') {
        const n = Math.min(Math.round(spanMs * ctx.sampleRate / 1000), maxWindow);
        const key = [mode, trigger, level, n].join();
        if (key !== heldKey) { heldKey = key; held = null; armedAt = written; }
        if (held && mode === 'single') return held;

        let start = -1;
        const t = names.indexOf(trigger);
        if (t >= 0 && connected[t]) {
          const len = Math.min(cap, n + history);
          const base = cap - len;                       // where the searched part starts in the oldest-first view
          read(rings[t], base, len, search);
          // single ignores crossings that were already in the buffer when it was armed
          const min = mode === 'single' ? Math.max(1, armedAt - (written - cap) - base) : 1;
          // newest crossing that still leaves a full window after it
          for (let i = len - n - 1; i >= min; i--) {
            if (search[i - 1] < level && search[i] >= level) { start = base + i; break; }
          }
        }
        if (start < 0) {
          if (mode === 'auto') start = cap - n;
          else return held || names.map(() => null);
        }
        const out = names.map((_, c) => {
          if (!connected[c]) return null;
          read(rings[c], start, n, windows[c]);
          return mode === 'auto' ? windows[c].subarray(0, n) : windows[c].slice(0, n);
        });
        if (mode !== 'auto') held = out;
        return out;
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
    const W0 = 220, H0 = 130, dpr = window.devicePixelRatio || 1;
    const canvas = h('canvas', { className: 'scope', width: W0 * dpr, height: H0 * dpr });
    const g0 = canvas.getContext('2d');
    // the corner button asks the UI for the big screen (a DOM event, as blocks never import ui/)
    const expand = h('button', { className: 'scope-expand', type: 'button', title: 'Big screen', ariaLabel: 'Big screen' });
    expand.append(svgEl('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }));
    expand.firstChild.append(svgEl('path', { d: 'M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4' }));
    expand.addEventListener('pointerdown', (e) => e.stopPropagation());
    expand.addEventListener('click', () => window.dispatchEvent(new CustomEvent('dsplab:screen', { detail: node })));
    const el = h('div', { className: 'scope-wrap' }, canvas, expand);
    let lastLevel = node.params.level, levelShownAt = -Infinity;

    // draws the screen into a W x H area of g (the block's small canvas or the big window's)
    function paint(g, W, H, inst, fontPx = 10) {
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

      const { xdiv, trigger, mode, level, ydiv } = node.params;
      const pxPerUnit = (H / DIV_Y) / ydiv;
      const yOf = (v) => Math.min(H, Math.max(0, H / 2 - v * pxPerUnit));

      g.fillStyle = '#6b7482';
      g.font = `${fontPx}px system-ui, sans-serif`;
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      if (!inst) g.fillText('Stopped', 6, 14);

      // the trigger level, drawn for a moment after it was changed (also while stopped)
      if (level !== lastLevel) { lastLevel = level; levelShownAt = performance.now(); }
      if (performance.now() - levelShownAt < LEVEL_SHOWN_MS) {
        const ly = Math.round(yOf(level)) + .5;
        g.strokeStyle = g.fillStyle = SCOPE_COLORS[(parseInt(trigger.slice(2), 10) - 1) % SCOPE_COLORS.length];
        g.setLineDash([4, 3]);
        g.beginPath(); g.moveTo(0, ly); g.lineTo(W, ly); g.stroke();
        g.setLineDash([]);
        g.fillText(`level ${level}`, 6, ly < 28 ? ly + 12 : ly - 4);
      }
      if (!inst) return;

      g.lineWidth = 1.5;
      const sweeps = inst.sample(xdiv * DIV_X, level, trigger, mode);
      // normal / single leave the screen empty until the trigger fires
      if (mode !== 'auto' && sweeps.every((d) => !d)) g.fillText('Waiting for trigger', 6, 14);
      sweeps.forEach((data, k) => {
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
    }
    return {
      el,
      draw(inst) {
        g0.setTransform(dpr, 0, 0, dpr, 0, 0);
        paint(g0, W0, H0, inst);
      },
      paint,
    };
  },
};

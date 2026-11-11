import { streamOutput, parseBytes } from './stream.js';

// On an asynchronous clock: the whole data (a text, or hex bytes) goes out as one array[int] of bytes every period.
export const strobeSource = {
  title: 'Strobe Source',
  category: 'Source blocks',
  inputs: [],
  outputs: ['out'],
  asyncPorts: ['out'],
  wireTypes: { out: 'array[int]' },
  params: [
    { key: 'type',   label: 'Type',   type: 'select', options: ['text', 'hex'], default: 'text' },
    { key: 'data',   label: 'Data',   show: true, type: 'text', default: 'hello' },
    { key: 'period', label: 'Period', show: true, type: 'range', scale: 'log', min: 10, max: 10000, step: 1, unit: 'ms', default: 1000 },
  ],
  build(ctx, p) {
    let params = p;
    const out = streamOutput();
    let timer = null;
    let period = null;
    const emit = () => { const bytes = parseBytes(params.type, params.data); if (bytes.length) out.send(Object.freeze(bytes)); };
    const start = (ms) => {
      clearInterval(timer);
      period = ms;
      timer = setInterval(emit, ms);
    };
    // the engine wires the cables after building every block, so the first send waits until that is done
    const first = setTimeout(emit, 0);
    start(p.period);
    return {
      outputs: { out },
      // retyping the data must not restart the clock
      update(next) { params = next; if (next.period !== period) start(next.period); },
      dispose() { clearTimeout(first); clearInterval(timer); out.disconnect(); },
    };
  },
};

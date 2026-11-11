import { streamOutput } from './stream.js';

const TICK = 10;      // ms between checks; timers can't fire once per sample at kilobaud, so the samples due are delivered together
const MAX_BACKLOG = 1;   // s: after a stall (a background tab) it skips ahead instead of delivering everything it missed

// array of numbers in, float signal out. The input arrays go into a buffer and the output is a synchronous signal whose
// sample rate is the baud rate: it delivers one sample every 1 / baud seconds, for as long as the block runs. Each
// sample is the next number of the buffer, or 0 when the buffer is empty. Integers (of any width) become floats
// implicitly: the values are the same, only what the wire says changes.
export const serializer = {
  title: 'Serializer',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  asyncPorts: ['in', 'out'],
  wireTypes: { in: 'array[numeric]', out: 'float' },
  rates: { out: (params) => params.baud },   // samples per second of the output's clock
  params: [
    { key: 'baud', label: 'Baud rate', show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
  ],
  build(ctx, p) {
    let baud = p.baud;
    const out = streamOutput();
    const buffer = [];      // the elements waiting to go out
    let t0 = ctx.currentTime;   // audio time of sample 0 of the current rate
    let sent = 0;               // samples delivered since t0
    // the audio clock sets the pace (not the timer), so the average rate is exactly the baud rate
    const pump = () => {
      let due = Math.floor((ctx.currentTime - t0) * baud + 1e-9) + 1;
      if (due - sent > MAX_BACKLOG * baud) sent = due - Math.ceil(MAX_BACKLOG * baud);
      for (; sent < due; sent++) out.send(buffer.length ? buffer.shift() : 0);
    };
    const timer = setInterval(pump, TICK);
    return {
      outputs: { out },
      inputs: { in: { receive(items) { if (Array.isArray(items) && items.every(Number.isFinite)) buffer.push(...items); } } },
      // a new rate starts from now, so the samples already delivered stay where they were
      update(p) { if (p.baud !== baud) { t0 = ctx.currentTime; sent = 0; baud = p.baud; } },
      dispose() { clearInterval(timer); buffer.length = 0; out.disconnect(); },
    };
  },
};

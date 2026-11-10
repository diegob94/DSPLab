import { streamOutput, parseBits } from './stream.js';

const TICK = 10;   // ms between checks; timers can't fire once per symbol at kilobaud, so the symbols due go out together

// A bit stream on an asynchronous clock: the bits of a text, hex bytes or a bit pattern go out one per symbol
// at the baud rate, most significant bit of each byte first, once or over and over.
export const bitSource = {
  title: 'Bit Source',
  category: 'Source blocks',
  inputs: [],
  outputs: ['bits'],
  asyncPorts: ['bits'],
  params: [
    { key: 'type',    label: 'Type',    type: 'select', options: ['text', 'hex', 'bits'], default: 'text' },
    { key: 'data', label: 'Data',    show: true, type: 'text', default: 'hello' },
    { key: 'baud',    label: 'Baud rate', show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
    { key: 'repeat',  label: 'Repeat',  show: true, type: 'select', options: ['every period', 'once'], default: 'every period' },
    { key: 'period',  label: 'Period',  type: 'range', scale: 'log', min: 10, max: 10000, step: 1, unit: 'ms', default: 1000 },
  ],
  build(ctx, p) {
    let params = p;
    let bits = parseBits(p.type, p.data);
    const out = streamOutput();
    const queue = [];       // bits waiting to go out
    let next = 0;           // audio time at which the next symbol is due
    let pumpTimer = null;
    let repeatTimer = null;
    let key = `${p.type}\u0000${p.data}`;
    let period = null;
    // Sends every symbol that is due. The audio clock sets the pace (not the timer), so the average
    // rate is exactly the baud rate; a burst only means the receiver must do its own timing.
    const pump = () => {
      const now = ctx.currentTime;
      let i = 0;
      while (i < queue.length && next <= now) { out.send(queue[i++]); next += 1 / params.baud; }
      queue.splice(0, i);
      if (!queue.length) { clearInterval(pumpTimer); pumpTimer = null; }
    };
    const emit = () => {
      if (!bits.length) return;
      if (!queue.length && next < ctx.currentTime) next = ctx.currentTime;   // idle: start now, don't "catch up"
      queue.push(...bits);
      if (!pumpTimer) pumpTimer = setInterval(pump, TICK);
      pump();
    };
    const arm = () => {
      clearInterval(repeatTimer);
      repeatTimer = null;
      period = params.period;
      if (params.repeat === 'every period') repeatTimer = setInterval(emit, period);
    };
    // the engine wires the cables after building every block, so the first send waits until that is done
    const first = setTimeout(emit, 0);
    arm();
    return {
      outputs: { bits: out },
      // retyping the data must not restart the clock; a block that sends once sends again when its data changes
      update(np) {
        const was = params.repeat;
        params = np;
        bits = parseBits(np.type, np.data);
        const nextKey = `${np.type}\u0000${np.data}`;
        if (np.repeat !== was || np.period !== period) arm();
        if (np.repeat === 'once' && nextKey !== key) emit();
        key = nextKey;
      },
      dispose() { clearTimeout(first); clearInterval(pumpTimer); clearInterval(repeatTimer); queue.length = 0; out.disconnect(); },
    };
  },
};

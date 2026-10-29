import { isBits, messageOutput, bitMessage } from './message.js';

// The bits of a message in transmission order: column after column, so an 8 x N message goes byte by
// byte, most significant bit first.
export function bitStream(m) {
  const out = [];
  for (let j = 0; j < m[0].length; j++) for (let i = 0; i < m.length; i++) out.push(m[i][j]);
  return out;
}

const TICK = 10;   // ms between checks; timers can't fire once per symbol at kilobaud, so the symbols due go out together

export const messageSerialize = {
  title: 'Message Serializer',
  category: 'Message blocks',
  inputs: ['msg'],
  outputs: ['msg'],
  messagePorts: ['msg'],
  bitStream,
  params: [
    { key: 'baud', label: 'Baud rate', show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
  ],
  build(ctx, p) {
    let baud = p.baud;
    const out = messageOutput();
    const queue = [];     // bits waiting to go out
    let next = 0;         // audio time at which the next symbol is due
    let timer = null;
    // Sends every symbol that is due. The audio clock sets the pace (not the timer), so the average
    // rate is exactly the baud rate; a burst only means the receiver must do its own timing.
    const pump = () => {
      const now = ctx.currentTime;
      let i = 0;
      while (i < queue.length && next <= now) { out.send(bitMessage(queue[i++])); next += 1 / baud; }
      queue.splice(0, i);
      if (!queue.length) { clearInterval(timer); timer = null; }
    };
    return {
      outputs: { msg: out },
      inputs: { msg: { receive(m) {
        if (!isBits(m)) return;
        if (!queue.length && next < ctx.currentTime) next = ctx.currentTime;   // idle: start now, don't "catch up"
        queue.push(...bitStream(m));
        if (!timer) timer = setInterval(pump, TICK);
        pump();
      } } },
      update(p) { baud = p.baud; },
      dispose() { clearInterval(timer); queue.length = 0; out.disconnect(); },
    };
  },
};

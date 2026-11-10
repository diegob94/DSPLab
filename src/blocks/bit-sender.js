import { streamOutput } from './stream.js';

const TICK = 10;   // ms between checks; timers can't fire once per symbol at kilobaud, so the symbols due go out together

// The output side shared by the source blocks: queues bits and sends them one per symbol at the baud rate.
// The audio clock sets the pace (not the timer), so the average rate is exactly the baud rate; a burst only
// means the receiver must do its own timing. baud() is read every time, so it can change live.
export function bitSender(ctx, baud) {
  const out = streamOutput();
  const queue = [];       // bits waiting to go out
  let next = 0;           // audio time at which the next symbol is due
  let timer = null;
  const pump = () => {
    const now = ctx.currentTime;
    let i = 0;
    while (i < queue.length && next <= now) { out.send(queue[i++]); next += 1 / baud(); }
    queue.splice(0, i);
    if (!queue.length) { clearInterval(timer); timer = null; }
  };
  return {
    out,
    send(bits) {
      if (!bits.length) return;
      if (!queue.length && next < ctx.currentTime) next = ctx.currentTime;   // idle: start now, don't "catch up"
      queue.push(...bits);
      if (!timer) timer = setInterval(pump, TICK);
      pump();
    },
    dispose() { clearInterval(timer); queue.length = 0; out.disconnect(); },
  };
}

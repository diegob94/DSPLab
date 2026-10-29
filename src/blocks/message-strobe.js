import { messageOutput, textToBits } from './message.js';

export const messageStrobe = {
  title: 'Message Strobe',
  category: 'Message blocks',
  inputs: [],
  outputs: ['msg'],
  messagePorts: ['msg'],
  params: [
    { key: 'period', label: 'Period', show: true, type: 'range', scale: 'log', min: 10, max: 10000, step: 1, unit: 'ms', default: 1000 },
    { key: 'message', label: 'Message', show: true, type: 'text', default: 'hello' },
  ],
  build(ctx, p) {
    const msg = messageOutput();
    let timer = null;
    let bits = null;   // the text as an 8 x N array of bits; null when the text is empty
    let period = null;
    const start = (ms) => {
      clearInterval(timer);
      period = ms;
      timer = setInterval(() => bits && msg.send(bits), ms);
    };
    const setText = (text) => { bits = text ? textToBits(text) : null; };
    setText(p.message);
    start(p.period);
    return {
      outputs: { msg },
      // retyping the message must not restart the clock
      update(p) { setText(p.message); if (p.period !== period) start(p.period); },
      dispose() { clearInterval(timer); msg.disconnect(); },
    };
  },
};

import { messageOutput } from './message.js';

export const messageStrobe = {
  title: 'Message Strobe',
  category: 'Message blocks',
  inputs: [],
  outputs: ['msg'],
  messagePorts: ['msg'],
  params: [
    { key: 'period', label: 'Period', show: true, type: 'range', scale: 'log', min: 10, max: 10000, step: 1, unit: 'ms', default: 1000 },
    { key: 'value',  label: 'Value',  show: true, type: 'range', min: -1000, max: 1000, step: 1, default: 1 },
  ],
  build(ctx, p) {
    const msg = messageOutput();
    let timer = null;
    let value = p.value;
    const start = (period) => {
      clearInterval(timer);
      timer = setInterval(() => msg.send(value), period);
    };
    start(p.period);
    return {
      outputs: { msg },
      update(p) { value = p.value; start(p.period); },
      dispose() { clearInterval(timer); msg.disconnect(); },
    };
  },
};

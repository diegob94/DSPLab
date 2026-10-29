import { h } from '../dom.js';

export const messageDebug = {
  title: 'Message Debug',
  category: 'Message blocks',
  inputs: ['msg'],
  outputs: [],
  messagePorts: ['msg'],
  params: [
    { key: 'lines', label: 'Lines', show: true, type: 'select', options: [4, 8, 16], default: 8 },
  ],
  build(ctx, p) {
    let lines = p.lines;
    const log = [];   // the newest `lines` messages: "12.345  text"
    return {
      inputs: { msg: { receive(m) {
        log.push(`${ctx.currentTime.toFixed(3)}  ${m}`);
        if (log.length > lines) log.splice(0, log.length - lines);
      } } },
      log,
      update(p) {
        lines = p.lines;
        if (log.length > lines) log.splice(0, log.length - lines);
      },
      dispose() { log.length = 0; },
    };
  },
  ui() {
    const el = h('pre', { className: 'msg-log' });
    let shown = null;
    return {
      el,
      draw(inst) {
        const text = inst ? inst.log.join('\n') || 'Waiting for messages' : 'Stopped';
        if (text !== shown) { shown = text; el.textContent = text; }
      },
    };
  },
};

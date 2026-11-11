import { h } from '../dom.js';
import { sampleType } from './stream.js';

// one log line for a sample: the audio time, its type and its value (cut short if it is long)
function describe(time, sample) {
  let value = JSON.stringify(sample);
  if (value.length > 40) value = `${value.slice(0, 39)}…`;
  return `${time.toFixed(3)}  ${sampleType(sample)}  ${value}`;
}

// Takes any async port, whatever it carries, and prints the type of every sample that arrives with its value.
export const debugSink = {
  title: 'Debug Sink',
  category: 'Sink blocks',
  inputs: ['in'],
  outputs: [],
  asyncPorts: ['in'],
  wireTypes: { in: '*' },
  params: [
    { key: 'lines', label: 'Lines', show: true, type: 'select', options: [4, 8, 16], default: 8 },
  ],
  build(ctx, p) {
    let lines = p.lines;
    const log = [];   // the newest `lines` samples
    return {
      inputs: { in: { receive(sample) {
        log.push(describe(ctx.currentTime, sample));
        if (log.length > lines) log.splice(0, log.length - lines);
      } } },
      outputs: {},
      log,
      update(p) { lines = p.lines; if (log.length > lines) log.splice(0, log.length - lines); },
      dispose() { log.length = 0; },
    };
  },
  ui() {
    const el = h('pre', { className: 'msg-log' });
    let shown = null;
    return {
      el,
      draw(inst) {
        const text = inst ? inst.log.join('\n') || 'Waiting for samples' : 'Stopped';
        if (text !== shown) { shown = text; el.textContent = text; }
      },
    };
  },
};

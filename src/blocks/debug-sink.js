import { logView, logSizeParams } from './log-view.js';
import { sampleType } from './stream.js';

// one log line for a sample: the audio time, its type and its value (cut short if it is long)
function describe(time, sample, type) {
  let value = JSON.stringify(sample);
  if (value.length > 40) value = `${value.slice(0, 39)}…`;
  return `${time.toFixed(3)}  ${type}  ${value}`;
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
    { key: 'lines', label: 'Lines', show: true, type: 'select', options: [4, 8, 16, 32, 64, 128], default: 8 },
    ...logSizeParams,
  ],
  build(ctx, p, node, wires = {}) {
    let lines = p.lines;
    // the type the cable declares, when it is known; otherwise the one worked out from each sample
    const declared = wires.in && wires.in !== '*' ? wires.in : null;
    const log = [];   // the newest `lines` samples
    return {
      inputs: { in: { receive(sample) {
        log.push(describe(ctx.currentTime, sample, declared || sampleType(sample)));
        if (log.length > lines) log.splice(0, log.length - lines);
      } } },
      outputs: {},
      log,
      update(p) { lines = p.lines; if (log.length > lines) log.splice(0, log.length - lines); },
      dispose() { log.length = 0; },
    };
  },
  ui(node) {
    return logView(node, (inst) => (inst ? inst.log.join('\n') || 'Waiting for samples' : 'Stopped'));
  },
};

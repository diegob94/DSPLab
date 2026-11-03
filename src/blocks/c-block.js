// A block programmed in C. The code is a single function, dsp_process(), compiled in the browser to
// WebAssembly (c-compiler.js) and run on the audio thread (c-block-processor.js).
//
// The compiled program is runtime data, not part of the diagram: only the source is saved. It is kept per
// model node, so it survives the engine rebuilding the audio graph. Press Compile (properties panel) to
// apply an edit to a running diagram; Run compiles whatever has not been compiled yet.
import { h } from '../dom.js';
import { emit } from '../core/events.js';
import { compileC, KNOBS } from './c-compiler.js';

const EXAMPLE = `#include <math.h>

/* One-pole low-pass filter. P1 sets the cutoff, 20 Hz to 20 kHz on a log scale. */
static float state;

void dsp_process(const float *in, float *out, int n, float fs, const float *p) {
  float fc = 20.0f * powf(1000.0f, p[0]);
  float a = 1.0f - expf(-6.2831853f * fc / fs);
  for (int i = 0; i < n; i++) {
    state += a * (in[i] - state);
    out[i] = state;
  }
}
`;

const knobKeys = Array.from({ length: KNOBS }, (_, i) => `p${i + 1}`);
const knobs = (p) => knobKeys.map((key) => p[key]);

const states = new WeakMap();   // node -> compile state (not serialized)
function stateOf(node) {
  let s = states.get(node);
  if (!s) {
    s = {
      status: 'idle',      // 'idle' | 'compiling' | 'ok' | 'error'
      attempted: null,     // the source of the latest compile (null: never compiled)
      bytes: null,         // the latest .wasm that compiled; kept when a later edit fails to compile
      size: 0,
      lines: [],           // compiler messages of a failed compile
      progress: 0,         // download of the compiler, 0..1
      runtimeError: null,  // reported by the worklet
      promise: null,
    };
    states.set(node, s);
  }
  return s;
}

// compiles the node's current code; never rejects, a failure is recorded in the state
function compile(node) {
  const s = stateOf(node);
  if (s.promise) return s.promise;
  const code = node.params.code;
  s.status = 'compiling';
  s.progress = 0;
  s.attempted = code;
  s.promise = (async () => {
    try {
      const r = await compileC(code, (value) => { s.progress = value; });
      if (r.ok) { s.bytes = r.bytes; s.size = r.size; s.lines = []; s.status = 'ok'; s.runtimeError = null; }
      else { s.lines = r.lines; s.status = 'error'; }
    } catch (err) {
      s.lines = [String(err && err.message || err)];
      s.status = 'error';
    } finally {
      s.promise = null;
    }
  })();
  return s.promise;
}

function summary(node) {
  const s = stateOf(node);
  const edited = s.attempted !== null && s.attempted !== node.params.code;
  let text;
  if (s.status === 'compiling') text = s.progress > 0 && s.progress < 1 ? `Loading the compiler… ${Math.round(s.progress * 100)}%` : 'Compiling…';
  else if (s.status === 'error') text = s.bytes ? 'Compile error · still running the previous version' : 'Compile error';
  else if (s.status === 'ok') text = `Compiled · ${(s.size / 1024).toFixed(1)} KB${edited ? ' · edited, press Compile' : ''}`;
  else text = 'Not compiled · Run compiles it';
  const detail = s.runtimeError || (s.status === 'error' ? s.lines.slice(0, 8).join('\n') : '');
  return { text, detail, state: s.runtimeError || s.status === 'error' ? 'error' : s.status };
}

export const cBlock = {
  title: 'C Block',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  params: [
    { key: 'code', label: 'C code', type: 'code', default: EXAMPLE, maxLength: 12000 },
    ...knobKeys.map((key, i) => ({ key, label: `P${i + 1}`, type: 'range', min: 0, max: 1, step: 0.001, default: 0.5 })),
  ],
  // press-and-hold buttons of the properties panel (here a plain click): compile the code now
  actions: [{
    label: (node) => stateOf(node).status === 'compiling' ? 'Compiling…' : 'Compile',
    press: (node) => compile(node),
    release() {},
  }],
  // the processor must be registered before build() can create the worklet node, and the code of the
  // diagram's C Blocks compiled (an edited or never compiled one) so the first build already has its program
  async setup(ctx, inUse, nodes = []) {
    await ctx.audioWorklet.addModule(new URL('./c-block-processor.js', import.meta.url).href);
    await Promise.all(nodes.filter((n) => stateOf(n).attempted !== n.params.code).map(compile));
  },
  build(ctx, p, node) {
    const s = stateOf(node);
    const worklet = new AudioWorkletNode(ctx, 'dsplab-c-block', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { bytes: s.bytes, params: knobs(p) },
    });
    let sent = s.bytes;
    worklet.port.onmessage = ({ data }) => {
      if (data.error) s.runtimeError = data.error;
      else if (data.loaded) s.runtimeError = null;
    };
    // a block added to a running diagram has never been compiled: do it now and swap the program in
    if (s.attempted === null && !s.promise) compile(node).then(() => emit('data', node));
    return {
      inputs: { in: worklet },
      outputs: { out: worklet },
      update(p) {
        worklet.port.postMessage({ params: knobs(p) });
        // a (re)compile finished: the new program replaces the running one (its state starts over)
        if (s.bytes && s.bytes !== sent) { sent = s.bytes; worklet.port.postMessage({ bytes: s.bytes }); }
      },
      dispose() { worklet.port.onmessage = null; worklet.disconnect(); },
    };
  },
  ui(node) {
    const status = h('div', { className: 'c-status' });
    const detail = h('pre', { className: 'c-errors' });
    const el = h('div', { className: 'cblock' }, status, detail);
    let shown = '';
    return {
      el,
      draw() {
        const { text, detail: more, state } = summary(node);
        const key = `${state}|${text}|${more}`;
        if (key === shown) return;
        shown = key;
        status.textContent = text;
        status.dataset.state = state;
        detail.textContent = more;
        detail.hidden = !more;
      },
    };
  },
};

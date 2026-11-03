// AudioWorklet processor behind the C Block: calls the user's C code, compiled to WebAssembly, once per
// render quantum. Until the code arrives (or after it fails) the output is silent.
//
// The code arrives as the bytes of the .wasm file, not as a WebAssembly.Module: a Module can be handed over
// in the node's constructor options but not through the port (the worklet gets a messageerror). It is
// compiled here, asynchronously, so a replaced program keeps running until the new one is ready.
//
// The module's glue (see PRELUDE in c-compiler.js) exposes three float buffers in its own memory (in, out,
// the knob values p[]) and run(n, sampleRate). Everything the C code can touch is that memory: its only
// import is WASI's proc_exit, which is never called, so the module cannot reach the page.
const CHUNK = 128;

class CBlockProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { bytes, params } = options.processorOptions;
    this.params = Float32Array.from(params);
    this.x = null;
    this.loads = 0;
    // the program the node is created with is compiled at once (it is small, and an offline context renders
    // without ever yielding to an asynchronous compile); a replacement arrives later and is compiled in the background
    if (bytes) this.fail(() => this.install(new WebAssembly.Module(bytes)));
    this.port.onmessage = ({ data }) => {
      if (data.params) { this.params = Float32Array.from(data.params); this.writeParams(); }
      if (data.bytes) this.load(data.bytes);
    };
  }

  // runs work(); a failure silences the block and is reported to the page
  fail(work) {
    try { work(); } catch (err) { this.error(err); }
  }

  error(err) {
    this.x = null;
    this.port.postMessage({ error: String(err && err.message || err) });
  }

  install(module) {
    // every import is a stub: the C code gets no system calls (a libc call that needs one just fails)
    const imports = {};
    for (const imp of WebAssembly.Module.imports(module)) {
      if (imp.kind !== 'function') continue;
      (imports[imp.module] = imports[imp.module] || {})[imp.name] = () => 52;   // ENOSYS
    }
    this.x = new WebAssembly.Instance(module, imports).exports;
    this.buffer = null;
    this.bind();
    this.writeParams();
    this.port.postMessage({ loaded: true });
  }

  load(bytes) {
    const mine = ++this.loads;   // only the latest program counts if several arrive in a row
    WebAssembly.compile(bytes).then((module) => {
      if (mine === this.loads) this.install(module);
    }).catch((err) => {
      if (mine === this.loads) this.error(err);
    });
  }

  // typed views of the module's buffers; memory.grow() (malloc) replaces the ArrayBuffer, so they are refreshed
  bind() {
    const { memory, in_ptr, out_ptr, params_ptr } = this.x;
    if (memory.buffer === this.buffer) return;
    this.buffer = memory.buffer;
    this.inBuf = new Float32Array(this.buffer, in_ptr(), CHUNK);
    this.outBuf = new Float32Array(this.buffer, out_ptr(), CHUNK);
    this.pBuf = new Float32Array(this.buffer, params_ptr(), this.params.length);
  }

  writeParams() {
    if (!this.x) return;
    this.bind();
    this.pBuf.set(this.params);
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!this.x) return true;   // silence
    const input = inputs[0] && inputs[0][0];
    try {
      for (let at = 0; at < out.length; at += CHUNK) {
        const n = Math.min(CHUNK, out.length - at);
        this.bind();
        if (input) this.inBuf.set(input.subarray(at, at + n));
        else this.inBuf.fill(0);
        this.x.run(n, sampleRate);
        for (let i = 0; i < n; i++) {
          const v = this.outBuf[i];
          out[at + i] = Number.isFinite(v) ? v : 0;   // a NaN or infinity must never reach the speakers
        }
      }
    } catch (err) {
      // a trap in the C code (e.g. an out-of-range index): stop calling it and say so
      this.x = null;
      out.fill(0);
      this.port.postMessage({ error: `The C code stopped: ${err && err.message || err}` });
    }
    return true;
  }
}

registerProcessor('dsplab-c-block', CBlockProcessor);

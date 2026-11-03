// Compiles C to a WebAssembly module in the browser, for the C Block. The compiler is clang built for
// WebAssembly (~28 MB compressed); it lives in vendor/clang/ (scripts/fetch-compiler.sh puts it there,
// it is not in the repository) and is only downloaded the first time a C Block is compiled.
//
// The user's code is a single function (dsp_process); this module wraps it with the glue that gives the
// audio worklet something to call (the exports of PRELUDE) and compiles the result to a WASI module that
// has no imports but proc_exit, so it needs no runtime support to run on the audio thread.

const BASE = new URL('../../vendor/clang/', import.meta.url);
// bump with VERSION in scripts/fetch-compiler.sh: a new compiler must not be served from the old cache
const CACHE_NAME = 'dsplab-clang-0.3.0';

export const BLOCK_SIZE = 128;   // frames per call: one Web Audio render quantum
export const KNOBS = 4;          // the p[] values the block hands to the C code

// Prepended to the user's code. `#line 1` after it makes compiler messages point at the user's own line numbers.
const PRELUDE = `#define DSP_EXPORT(name) __attribute__((used, export_name(name)))
static float dsp_in_buf[${BLOCK_SIZE}], dsp_out_buf[${BLOCK_SIZE}], dsp_p_buf[${KNOBS}];
void dsp_process(const float *in, float *out, int n, float fs, const float *p);
DSP_EXPORT("in_ptr")     float *dsp_in_ptr(void)     { return dsp_in_buf; }
DSP_EXPORT("out_ptr")    float *dsp_out_ptr(void)    { return dsp_out_buf; }
DSP_EXPORT("params_ptr") float *dsp_params_ptr(void) { return dsp_p_buf; }
DSP_EXPORT("run")        void   dsp_run(int n, float fs) { dsp_process(dsp_in_buf, dsp_out_buf, n, fs, dsp_p_buf); }
int main(void) { return 0; }   /* the linker wants an entry point; it is never called */
`;

const EXPORTS = ['memory', 'in_ptr', 'out_ptr', 'params_ptr', 'run'];

let toolchain = null;   // promise of the loaded compiler; shared by every C Block
let listeners = [];     // download progress callbacks of the load in flight

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('The C compiler could not be loaded. Run scripts/fetch-compiler.sh (npm test does it) and reload.'));
    document.head.append(el);
  });
}

// The compiler's assets are big, so they go through the Cache API: one download per browser, not per visit.
// Only the assets of this compiler version are stored; if the Cache API is unavailable (private windows,
// blocked storage) everything still works, it just downloads each time. The package verifies every asset's
// SHA-256 itself, so a damaged cache entry fails loudly instead of running.
function cachingFetch(original) {
  const mine = (url) => url.startsWith(BASE.href) && url.endsWith('.gz');
  return async function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input && input.url) || '';
    if (!mine(url)) return original.call(this, input, init);
    let cache = null;
    try {
      cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(url);
      if (hit) return hit;
    } catch (err) { cache = null; }
    const response = await original.call(this, input, init);
    if (cache && response.ok) cache.put(url, response.clone()).catch(() => {});
    return response;
  };
}

function load() {
  if (!toolchain) {
    toolchain = (async () => {
      await loadScript(new URL('toolchain.global.js', BASE).href);
      const T = self.clangWasmToolchain;
      // stays installed: the linker (lld) is only fetched at the first compile, not when the compiler loads.
      // It passes every other request through untouched.
      if (!globalThis.fetch.dsplabCaching) {
        globalThis.fetch = Object.assign(cachingFetch(globalThis.fetch), { dsplabCaching: true });
      }
      const tc = await T.createToolchain({
        baseUrl: new URL('assets/', BASE),
        onProgress: (value) => listeners.forEach((fn) => fn(value)),
      });
      return { tc, T };
    })();
    toolchain.catch((err) => {
      toolchain = null;   // a failed load can be retried
      // an asset that fails its hash check may be a damaged cache entry: drop the cache so the retry downloads afresh
      if (/SHA-256|expected \d+ bytes|, expected/.test(String(err && err.message))) caches.delete(CACHE_NAME).catch(() => {});
    });
  }
  return toolchain;
}

const stripAnsi = (text) => String(text == null ? '' : text).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

// -> { ok: true, bytes, size } (the .wasm file) or { ok: false, lines: [compiler messages] }
// onProgress(0..1) reports the one-time download of the compiler.
export async function compileC(code, onProgress) {
  if (onProgress) listeners.push(onProgress);
  let loaded;
  try {
    loaded = await load();
  } finally {
    listeners = listeners.filter((fn) => fn !== onProgress);
  }
  const { tc, T } = loaded;
  const source = `${PRELUDE}#line 1 "block.c"\n${code}\n`;
  const built = await tc.lock(() => tc.captureCompilerOutput(() => tc.runtime.compileArtifact(source, {
    language: 'C',
    fileName: 'block.c',
    compileArgs: [...T.CLANG_DRIVER_DEFAULT_ARGS, '-O2'],
  })));
  if (built.error) {
    const lines = (T.compilerDiagnostics ? T.compilerDiagnostics(built.raw) : stripAnsi(built.raw).split('\n').map((l) => l.trim()).filter(Boolean))
      .filter((l) => !/^process exited with code/.test(l));
    return { ok: false, lines: lines.length ? lines : [stripAnsi(built.error.message || built.error)] };
  }
  const bytes = new Uint8Array(built.result.bytes);
  const module = await WebAssembly.compile(bytes);   // also validates it
  const have = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
  const missing = EXPORTS.filter((name) => !have.has(name));
  if (missing.length) return { ok: false, lines: [`The compiled module lacks ${missing.join(', ')}: define dsp_process() and do not define main().`] };
  return { ok: true, bytes, size: bytes.byteLength };
}

'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, panelControl, startAudio, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const FS = 48000;
const run = async (params, input) => {
  const { Squelch } = await import('../src/blocks/squelch-core.js');
  const out = new Float32Array(input.length);
  new Squelch({ sampleRate: FS, ...params }).process(input, out);
  return out;
};
const square = (n, amp, period = 96) => Float32Array.from({ length: n }, (_, i) => (Math.floor(i / (period / 2)) % 2) * amp);

test('a signal with a swing above the threshold goes through unchanged', async () => {
  const x = square(4800, 0.5);
  assert.deepEqual(Array.from(await run({ threshold: 0.1, window: 20 }, x)), Array.from(x));
});

test('a weaker signal is replaced by exact zeros', async () => {
  const out = await run({ threshold: 0.1, window: 20 }, square(4800, 0.05));
  assert.ok(out.every((v) => v === 0));
});

test('it closes some time after the signal ends, within the window, and opens again with the next burst', async () => {
  const x = new Float32Array(FS);
  x.set(square(4800, 0.5), 0);                 // 0.1 s of signal, then silence
  x.set(square(4800, 0.5), 24000);             // a second burst at 0.5 s
  const out = await run({ threshold: 0.1, window: 20 }, x);
  assert.ok(out.slice(0, 4800).some((v) => v !== 0));
  assert.ok(out.slice(4800 + 48 * 20, 24000).every((v) => v === 0), 'closed 20 ms after the burst');
  assert.ok(out.slice(24000, 28800).some((v) => v !== 0), 'open again');
});

test('Squelch has an audio input and output, and keeps a Symbol Recovery quiet between bursts', () => withApp(app, async (page) => {
  for (const t of ['Message Strobe', 'Message Serializer', 'Pulse Shaper', 'Squelch', 'Symbol Recovery']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Squelch") .port.in').count(), 1);
  assert.equal(await page.locator('.node:has-text("Squelch") .port.out').count(), 1);
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, p, q, r] = ['message_strobe', 'message_serialize', 'pulse_shaper', 'squelch', 'symbol_timing'].map(by);
    Object.assign(s.params, { period: 400, message: 'UUUUUUUUUU' });
    for (const n of [z, p, r]) n.params.baud = 2000;
    p.params.pulse = 'square';
    const e = (a, ap, b, bp) => dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    e(s, 'msg', z, 'msg'); e(z, 'msg', p, 'msg'); e(p, 'out', q, 'in'); e(q, 'out', r, 'in');
    window.recovered = [];
    window.addCollector = () => dsplab.engine.live.get(r.id).outputs.msg.connect({ receive: (m) => window.recovered.push(m[0][0]) });
  });
  await startAudio(page);
  await page.evaluate(() => window.addCollector());
  await page.waitForFunction(() => window.recovered.length > 400, null, { timeout: 8000 });
  // new blocks all land at the canvas centre and overlap, so select it through the model rather than by clicking
  await page.evaluate(() => dsplab.select({ kind: 'node', id: [...dsplab.graph.nodes.values()].find((n) => n.type === 'squelch').id }));
  await panelControl(page, 'Threshold').fill('0.2');   // live change, no rebuild
  await sleep(200);
  assert.match(await page.textContent('#status'), /^Running/);
}));

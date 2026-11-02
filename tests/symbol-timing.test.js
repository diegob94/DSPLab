'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// The PLL on its own, in node: a pseudo-random bit stream pulse-shaped by the app's own shaper, delayed
// and with a sample clock off by `ppm`. Returns the best fraction of the symbols (the last stretch) that match the sent
// ones (the recovered stream is shifted by a few symbols, so every shift is tried).
async function recover({ pulse, baud, delay, ppm = 0, fs = 48000 }) {
  const { SymbolTimer } = await import('../src/blocks/timing-core.js');
  const { pulseSamples } = await import('../src/blocks/pulse-shaper.js');
  const sps = fs / baud, N = 1200;
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const bits = Array.from({ length: N }, () => (rand() < 0.5 ? 1 : 0));
  const y = new Float32Array(Math.ceil((N + 12) * sps) + 100);
  bits.forEach((b, k) => {
    const s = pulseSamples(pulse, k, sps, b, 0.5);
    if (s) s.data.forEach((v, i) => { y[Math.floor(s.start + i + Math.round(6 * sps) + delay)] += v; });
  });
  const ratio = 1 + ppm / 1e6;
  const z = y.map((_, n) => { const t = n * ratio, i = Math.floor(t); return i + 1 < y.length ? y[i] + (t - i) * (y[i + 1] - y[i]) : 0; });
  const got = [];
  const timer = new SymbolTimer({ sampleRate: fs, baud, onBit: (b) => got.push(b) });
  for (let i = 0; i < z.length; i += 128) timer.process(z.subarray(i, i + 128));
  let best = 0;
  for (let o = -20; o <= 40; o++) {
    let m = 0, c = 0;
    for (let i = 900; i < 1100; i++) if (got[i + o] !== undefined) { c++; if (got[i + o] === bits[i]) m++; }
    if (c) best = Math.max(best, m / c);
  }
  return best;
}

for (const pulse of ['square', 'sinc']) {
  test(`the PLL locks onto a ${pulse} pulse train at any start phase and gets every symbol`, async () => {
    for (const delay of pulse === 'square' ? [0, 17, 31.3, 47] : [12, 24, 36]) assert.equal(await recover({ pulse, baud: 1000, delay }), 1, `delay ${delay}`);
    assert.equal(await recover({ pulse, baud: 777, delay: 25 }), 1, '777 baud');
  });
}

test('it tracks a transmitter whose clock is 0.1 % fast or slow', async () => {
  for (const ppm of [1000, -1000]) assert.equal(await recover({ pulse: 'square', baud: 1000, delay: 5, ppm }), 1, `${ppm} ppm`);
});

test('it is quiet on silence, talks while a signal moves, and goes quiet again once it stays flat', async () => {
  const { SymbolTimer } = await import('../src/blocks/timing-core.js');
  const n = [];
  const t = new SymbolTimer({ sampleRate: 48000, baud: 1000, onBit: (b) => n.push(b) });
  t.process(new Float32Array(48000));
  assert.equal(n.length, 0, 'silence from the start');
  t.process(Float32Array.from({ length: 48 * 100 }, (_, i) => Math.floor(i / 48) % 2));   // 100 symbols of 0101...
  assert.ok(n.length >= 90 && n.length <= 100, `${n.length} bits for 100 symbols`);
  const sent = n.length;
  t.process(new Float32Array(48000));   // flat again
  assert.ok(n.length - sent <= 34, `at most 32 more symbols before it notices: ${n.length - sent}`);
  const again = n.length;
  t.process(new Float32Array(48000));
  assert.equal(n.length, again, 'and then nothing');
});

test('Symbol Recovery: audio in, message out; a full chain recovers what the serializer sent', () => withApp(app, async (page) => {
  for (const t of ['Message Strobe', 'Message Serializer', 'Pulse Shaper', 'Symbol Recovery']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Symbol Recovery") .port.in.msg').count(), 0, 'its input is audio');
  assert.equal(await page.locator('.node:has-text("Symbol Recovery") .port.out.msg').count(), 1);
  const text = 'UUUUUUUUUU';   // 0x55: a transition at every symbol, so the loop has something to lock to
  await page.evaluate((text) => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, p, r] = ['message_strobe', 'message_serialize', 'pulse_shaper', 'symbol_timing'].map(by);
    Object.assign(s.params, { period: 400, message: text });
    for (const n of [z, p, r]) n.params.baud = 2000;
    p.params.pulse = 'square';
    dsplab.addEdge({ node: s.id, port: 'msg' }, { node: z.id, port: 'msg' });
    dsplab.addEdge({ node: z.id, port: 'msg' }, { node: p.id, port: 'msg' });
    dsplab.addEdge({ node: p.id, port: 'out' }, { node: r.id, port: 'in' });
    window.recovered = [];
    window.addCollector = () => dsplab.engine.live.get(r.id).outputs.msg.connect({ receive: (m) => window.recovered.push(m[0][0]) });
  }, text);
  await startAudio(page);
  await page.evaluate(() => window.addCollector());
  await page.waitForFunction(() => window.recovered.length > 400, null, { timeout: 8000 });
  const got = (await page.evaluate(() => window.recovered)).join('');
  assert.ok(got.includes('01010101'.repeat(10)), `the whole message is in the recovered stream: ${got.slice(-100)}`);
}));

test('lock: the timing error goes to ~0 and the lock turns on with a clean signal, and off in silence', async () => {
  const { SymbolTimer } = await import('../src/blocks/timing-core.js');
  const fs = 48000;
  let seed = 99;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const bits = Array.from({ length: 600 }, () => (rand() < 0.5 ? 1 : 0));
  const x = Float32Array.from({ length: 600 * 48 }, (_, i) => (bits[Math.floor((i + 17) / 48) % 600] ? 1 : -1));
  const t = new SymbolTimer({ sampleRate: fs, baud: 1000, onBit: () => {} });
  const ph = new Float32Array(x.length);
  assert.ok(!t.locked);
  for (let i = 0; i < x.length; i += 128) t.process(x.subarray(i, i + 128), ph.subarray(i, i + 128));
  assert.ok(t.locked, 'locked');
  assert.ok(ph.every((v) => Math.abs(v) <= 1), 'timing error within +-1');
  assert.ok(ph.some((v) => v !== 0), 'and it is not just zeros');
  const quiet = new Float32Array(48000), phq = new Float32Array(48000);
  for (let i = 0; i < quiet.length; i += 128) t.process(quiet.subarray(i, i + 128), phq.subarray(i, i + 128));
  assert.ok(!t.locked, 'unlocked after silence');
  assert.ok(phq.subarray(-4800).every((v) => v === 0), 'no error in silence');
});

test('lock: a sinc stream at the wrong baud rate does not lock', async () => {
  const { SymbolTimer } = await import('../src/blocks/timing-core.js');
  const { pulseSamples } = await import('../src/blocks/pulse-shaper.js');
  const run = (sendBaud) => {
    const fs = 48000, sps = fs / sendBaud, N = 1500;
    let seed = 5;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const y = new Float32Array(Math.ceil((N + 12) * sps) + 100);
    for (let k = 0; k < N; k++) {
      const s = pulseSamples('sinc', k, sps, rand() < 0.5 ? 1 : 0, 0.5);
      if (s) s.data.forEach((v, i) => { y[Math.floor(s.start + i + Math.round(6 * sps) + 20)] += v; });
    }
    const t = new SymbolTimer({ sampleRate: fs, baud: 1000, onBit: () => {} });
    let on = 0, n = 0;
    for (let i = 0; i < y.length - 128; i += 128) {
      t.process(y.subarray(i, i + 128));
      if (i > y.length / 2) { n++; on += t.locked; }
    }
    return on / n;
  };
  assert.ok(run(1000) > 0.7, 'mostly locked at the right rate');
  assert.equal(run(1300), 0);
});

test('lock: the block reports it to its led', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Symbol Recovery');
  assert.equal(await page.locator('.node:has-text("Symbol Recovery") .port.out').count(), 2);
  assert.match(await page.locator('.node:has-text("Symbol Recovery") .lock-led').textContent(), /Unlocked/);
  await startAudio(page);
}));

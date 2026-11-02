'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, selectNode, panelControl, startAudio, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const FS = 48000;

// Runs the PLL (in node) on a sine of `hz` and phase `phi`, with optional noise; returns the output
// and the sine itself, so they can be compared, and the PLL.
async function lock({ hz, phi = 0.7, a = 0.5, f0 = 440, bw = 20, noise = 0, seconds = 2, amp = 1 }) {
  const { CarrierPLL } = await import('../src/blocks/carrier-core.js');
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5;
  const n = FS * seconds;
  const x = Float32Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * hz * i / FS + phi) + noise * rand());
  const clean = Float32Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * hz * i / FS + phi));
  const y = new Float32Array(n);
  const pll = new CarrierPLL({ sampleRate: FS, frequency: f0, bandwidth: bw, amplitude: amp });
  for (let i = 0; i < n; i += 128) pll.process(x.subarray(i, i + 128), y.subarray(i, i + 128));
  return { y, clean, pll };
}
// RMS difference over the last 0.25 s
const rmsTail = (a, b) => {
  const from = a.length - FS / 4;
  let s = 0;
  for (let i = from; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / (a.length - from));
};

test('it locks onto a tone away from its frequency, in frequency and in phase', async () => {
  for (const hz of [440, 455, 420, 470]) {
    const { y, clean, pll } = await lock({ hz });
    assert.ok(Math.abs(pll.hz - hz) < 0.5, `${hz} Hz: running at ${pll.hz}`);
    assert.ok(rmsTail(y, clean) < 0.05, `${hz} Hz: rms difference ${rmsTail(y, clean)}`);
  }
});

test('the output has the amplitude asked for, whatever the amplitude of the input', async () => {
  for (const a of [0.05, 0.9]) {
    const { y } = await lock({ hz: 450, a, amp: 0.3 });
    const peak = Math.max(...y.slice(-4800));
    assert.ok(Math.abs(peak - 0.3) < 0.005, `input ${a}: output peak ${peak}`);
  }
});

test('it recovers a clean carrier from a noisy one', async () => {
  const { y, clean, pll } = await lock({ hz: 450, noise: 1, a: 0.5, seconds: 3 });   // noise as strong as the tone
  assert.ok(Math.abs(pll.hz - 450) < 1, `running at ${pll.hz}`);
  assert.ok(rmsTail(y, clean) < 0.2, `rms difference ${rmsTail(y, clean)}`);
  assert.ok(Math.max(...y.slice(-4800)) <= 1 + 1e-6, 'and the output itself is a pure sine');
});

test('with no input it free-runs at the set frequency', async () => {
  const { y, pll } = await lock({ hz: 450, a: 0, f0: 1000, seconds: 1 });
  assert.ok(Math.abs(pll.hz - 1000) < 1e-6);
  let crossings = 0;
  for (let i = 1; i < y.length; i++) if (y[i - 1] < 0 && y[i] >= 0) crossings++;
  assert.ok(Math.abs(crossings - 1000) <= 1, `${crossings} cycles in one second`);
});

test('the block runs in the engine: a tone in, a tone of the same frequency out', () => withApp(app, async (page) => {
  const out = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 48000, 48000);
    await dsplab.BLOCKS.carrier_recovery.setup(ctx);
    const blk = dsplab.BLOCKS.carrier_recovery.build(ctx, { frequency: 440, bandwidth: 20, amplitude: 1 });
    const osc = new OscillatorNode(ctx, { frequency: 452 });
    osc.connect(blk.inputs.in);
    blk.outputs.out.connect(ctx.destination);
    osc.start();
    const data = (await ctx.startRendering()).getChannelData(0);
    let crossings = 0;
    for (let i = 24001; i < data.length; i++) if (data[i - 1] < 0 && data[i] >= 0) crossings++;
    return { crossings, peak: Math.max(...data.slice(-2000)) };
  });
  assert.ok(Math.abs(out.crossings - 226) <= 1, `${out.crossings} cycles in the last half second (452 Hz = 226)`);
  assert.ok(out.peak > 0.99 && out.peak <= 1.0001);
}));

test('Carrier Recovery has an audio input and output; the panel changes it live', () => withApp(app, async (page) => {
  for (const t of ['Wave Generator', 'Carrier Recovery', 'Audio Sink']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Carrier Recovery") .port.in').count(), 1);
  assert.equal(await page.locator('.node:has-text("Carrier Recovery") .port.out').count(), 2);
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [g, c, k] = ['wave_generator', 'carrier_recovery', 'audio_sink'].map(by);
    dsplab.addEdge({ node: g.id, port: 'out' }, { node: c.id, port: 'in' });
    dsplab.addEdge({ node: c.id, port: 'out' }, { node: k.id, port: 'in' });
    dsplab.select({ kind: 'node', id: c.id });
  });
  await startAudio(page);
  await panelControl(page, 'Frequency').evaluate((el) => { el.value = el.max; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await sleep(300);
  assert.match(await page.textContent('#status'), /^Running/);
}));

test('lock: the phase error goes to 0 and the lock turns on with a tone, and stays off without one', async () => {
  const { CarrierPLL } = await import('../src/blocks/carrier-core.js');
  const run = (hz, a) => {
    const pll = new CarrierPLL({ sampleRate: FS, frequency: 440, bandwidth: 20, amplitude: 1 });
    const x = Float32Array.from({ length: FS * 2 }, (_, i) => a * Math.sin(2 * Math.PI * hz * i / FS + 0.7));
    const y = new Float32Array(x.length), ph = new Float32Array(x.length);
    let early = false;
    for (let i = 0; i < x.length; i += 128) {
      pll.process(x.subarray(i, i + 128), y.subarray(i, i + 128), ph.subarray(i, i + 128));
      if (i === 128) early = pll.locked;
    }
    return { pll, ph, early };
  };
  const tone = run(455, 0.5);
  assert.ok(tone.pll.locked, 'locked');
  assert.ok(!tone.early, 'not locked at the very start');
  assert.ok(Math.max(...tone.ph.slice(-4800).map(Math.abs)) < 0.02, 'phase error ~ 0');
  assert.ok(Math.max(...tone.ph.map(Math.abs)) > 0.05, 'but it was not 0 while pulling in');
  const none = run(455, 0);
  assert.ok(!none.pll.locked);
  assert.ok(none.ph.every((v) => v === 0));
  // a tone far outside the loop's reach never locks
  assert.ok(!run(1500, 0.5).pll.locked);
});

test('lock: the block reports it to its led', () => withApp(app, async (page) => {
  for (const t of ['Wave Generator', 'Carrier Recovery']) await addFromPalette(page, t);
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [g, c] = ['wave_generator', 'carrier_recovery'].map(by);
    dsplab.addEdge({ node: g.id, port: 'out' }, { node: c.id, port: 'in' });
  });
  const led = page.locator('.node:has-text("Carrier Recovery") .lock-led');
  assert.match(await led.textContent(), /Unlocked/);
  await startAudio(page);
  await page.waitForFunction(() => document.querySelector('.lock-led .led.on'), null, { timeout: 5000 });
  assert.match(await led.textContent(), /^Locked/);
  assert.equal(await page.locator('.node:has-text("Carrier Recovery") .port.out').count(), 2);
}));

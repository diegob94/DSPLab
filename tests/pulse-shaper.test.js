'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, selectNode, panelControl, startAudio, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const SPS = 10;   // 44.1 kHz at 4410 baud: symbol centres fall on whole samples

// the pulse train of a list of bits, laid out the way the block does it, summed into one array
const wave = (page, bits, pulse, sps = SPS) => page.evaluate(([bits, pulse, sps]) => {
  const y = new Float32Array(Math.ceil((bits.length + 12) * sps));
  bits.forEach((b, k) => {
    const s = dsplab.BLOCKS.pulse_shaper.pulseSamples(pulse, k, sps, b, 1);
    if (s) s.data.forEach((v, i) => { y[Math.round(6 * sps) + s.start + i] += v; });
  });
  return Array.from(y);
}, [bits, pulse, sps]);

test('a square pulse holds each one for a whole symbol and tiles with the next', () => withApp(app, async (page) => {
  const y = await wave(page, [1, 0, 0, 1, 1], 'square');
  const at = (k, o) => y[6 * SPS + k * SPS + o];
  assert.deepEqual([at(0, 0), at(0, 9), at(1, 0), at(2, 9), at(3, 0), at(3, 9), at(4, 0), at(4, 9)], [1, 1, 0, 0, 1, 1, 1, 1]);
  // fractional samples per symbol: the pulses still tile with no gap and no overlap
  const r = await wave(page, [1, 1, 1, 1, 1, 1, 1], 'square', 7.3);
  const from = Math.round(6 * 7.3);
  assert.ok(r.slice(from, from + Math.round(7 * 7.3)).every((v) => v === 1), 'a run of ones is flat');
}));

test('a sinc pulse reproduces every bit at its symbol centre (no inter-symbol interference)', () => withApp(app, async (page) => {
  const bits = [1, 0, 1, 1, 0, 0, 1, 0];
  const y = await wave(page, bits, 'sinc');
  bits.forEach((b, k) => assert.ok(Math.abs(y[(6 + k) * SPS + 5] - b) < 1e-6, `bit ${k}`));
  assert.ok(y[(6 + 2) * SPS + 10] > 1.1, 'overshoot between two ones: a band-limited wave, not a staircase');
}));

test('a lone sinc pulse: peak 1, zeros at whole symbols, symmetric, sinc(0.5) = 2/pi', () => withApp(app, async (page) => {
  const y = await wave(page, [1], 'sinc');
  const c = 6 * SPS + 5;
  assert.ok(Math.abs(y[c] - 1) < 1e-6);
  for (const k of [1, 2, 3]) assert.ok(Math.abs(y[c + SPS * k]) < 1e-6 && Math.abs(y[c - SPS * k]) < 1e-6);
  assert.ok(Math.abs(y[c + 3] - y[c - 3]) < 1e-6);
  assert.ok(Math.abs(y[c + 5] - 2 / Math.PI) < 1e-6);
}));

test('the block places 1 x 1 messages on its baud grid, whatever the arrival times', () => withApp(app, async (page) => {
  const out = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const blk = dsplab.BLOCKS.pulse_shaper.build(ctx, { pulse: 'square', baud: 4410, amplitude: 1 });
    blk.outputs.out.connect(ctx.destination);
    for (const b of [1, 1, 0, 1]) blk.inputs.msg.receive([[b]]);   // all at once
    blk.inputs.msg.receive([[1, 1]]);                              // not a 1 x 1: ignored
    const data = (await ctx.startRendering()).getChannelData(0);
    const first = data.findIndex((v) => v !== 0);
    return { first, bits: Array.from({ length: 4 }, (_, k) => data[first + k * 10 + 5]), after: data.slice(first + 40).some((v) => v !== 0) };
  });
  assert.equal(out.first, Math.ceil(0.05 * 44100));
  assert.deepEqual(out.bits, [1, 1, 0, 1]);
  assert.equal(out.after, false);
}));

test('Pulse Shaper has a message input and an audio output; it runs behind a serializer', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Strobe');
  await addFromPalette(page, 'Message Serializer');
  await addFromPalette(page, 'Pulse Shaper');
  assert.equal(await page.locator('.node:has-text("Pulse Shaper") .port.in.msg').count(), 1);
  assert.equal(await page.locator('.node:has-text("Pulse Shaper") .port.out.msg').count(), 0, 'its output is audio');
  const wired = await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, p, k] = ['message_strobe', 'message_serialize', 'pulse_shaper', 'audio_sink'].map(by);
    s.params.period = 50;
    return [
      !!dsplab.addEdge({ node: s.id, port: 'msg' }, { node: z.id, port: 'msg' }),
      !!dsplab.addEdge({ node: z.id, port: 'msg' }, { node: p.id, port: 'msg' }),
      !!dsplab.addEdge({ node: p.id, port: 'out' }, { node: k.id, port: 'in' }),
    ];
  });
  assert.deepEqual(wired, [true, true, true]);
  await startAudio(page);
  await selectNode(page, 'Pulse Shaper');
  await panelControl(page, 'Pulse').selectOption('sinc');   // live change, no rebuild
  await sleep(300);
  assert.match(await page.textContent('#status'), /^Running/);
}));

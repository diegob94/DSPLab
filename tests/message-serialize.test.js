'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, selectNode, panelControl, startAudio, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const FS = 44100;
const BAUD = 4410;   // 10 samples per symbol, so symbol centres fall on whole samples
const base = { pulse: 'square', baud: BAUD, levels: 'bipolar', amplitude: 1, order: 'rows' };

// waveform(bits, params) -> plain array, computed by the app's own code
const wave = (page, bits, params) => page.evaluate(([bits, params, fs]) => Array.from(dsplab.BLOCKS.message_serialize.waveform(bits, params, fs)), [bits, { ...base, ...params }, FS]);

test('a square pulse holds each bit for one symbol: +1 for a one, -1 for a zero', () => withApp(app, async (page) => {
  const y = await wave(page, [[1, 0, 0, 1]], {});
  assert.equal(y.length, 40);
  assert.deepEqual([y[0], y[9], y[10], y[19], y[20], y[29], y[30], y[39]], [1, 1, -1, -1, -1, -1, 1, 1]);
}));

test('unipolar levels send zero for a zero, and the amplitude scales the wave', () => withApp(app, async (page) => {
  const y = await wave(page, [[1, 0]], { levels: 'unipolar', amplitude: 0.5 });
  assert.deepEqual([y[5], y[15]], [0.5, 0]);
}));

test('a sinc pulse reproduces every bit at its symbol centre (no inter-symbol interference)', () => withApp(app, async (page) => {
  const bits = [1, 0, 1, 1, 0, 0, 1, 0];
  const y = await wave(page, [bits], { pulse: 'sinc' });
  const SPAN = 4;
  assert.equal(y.length, (bits.length + 2 * SPAN) * 10, 'a lead-in and a tail of 4 symbols around the message');
  bits.forEach((b, k) => {
    const centre = (k + SPAN) * 10 + 5;
    assert.ok(Math.abs(y[centre] - (b ? 1 : -1)) < 1e-6, `bit ${k}: ${y[centre]}`);
  });
  // between centres it is a real band-limited wave, not a staircase
  // halfway between the two consecutive ones (bits 2 and 3) the neighbours add up to more than 1: overshoot, not a staircase
  assert.ok(y[(2 + SPAN) * 10 + 10] > 1.1, `overshoot between two ones: ${y[(2 + SPAN) * 10 + 10]}`);
}));

test('a lone sinc pulse is the sinc function: peak 1, zeros at whole symbols, symmetric', () => withApp(app, async (page) => {
  const y = await wave(page, [[1]], { pulse: 'sinc', levels: 'unipolar' });
  const c = 4 * 10 + 5;
  assert.ok(Math.abs(y[c] - 1) < 1e-6);
  for (const k of [1, 2, 3]) {
    assert.ok(Math.abs(y[c + 10 * k]) < 1e-6 && Math.abs(y[c - 10 * k]) < 1e-6, `zero at ${k} symbols`);
  }
  assert.ok(Math.abs(y[c + 3] - y[c - 3]) < 1e-6, 'symmetric');
  assert.ok(Math.abs(y[c + 5] - 2 / Math.PI) < 1e-6, 'sinc(0.5) = 2/pi');
}));

test('the bits are read byte by byte (columns) or row by row', () => withApp(app, async (page) => {
  const m = [[1, 0], [0, 1]];   // columns: 1,0 then 0,1. rows: 1,0 then 0,1 -> same, so use a non-symmetric one
  const n = [[1, 1], [0, 0]];   // columns: 1,0,1,0   rows: 1,1,0,0
  const sign = (y) => [5, 15, 25, 35].map((i) => y[i]);
  assert.deepEqual(sign(await wave(page, n, { order: 'columns' })), [1, -1, 1, -1]);
  assert.deepEqual(sign(await wave(page, n, { order: 'rows' })), [1, 1, -1, -1]);
  assert.equal((await wave(page, m, {})).length, 40);
}));

test('the block plays the waveform once when a message arrives, then stays silent', () => withApp(app, async (page) => {
  const out = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 4000, 44100);
    const blk = dsplab.BLOCKS.message_serialize.build(ctx, {
      pulse: 'square', baud: 4410, levels: 'bipolar', amplitude: 1, order: 'rows',
    });
    blk.outputs.out.connect(ctx.destination);
    blk.inputs.msg.receive([[1, 1, 0, 1]]);   // 40 samples
    const data = (await ctx.startRendering()).getChannelData(0);
    return { head: Array.from(data.slice(0, 40)), tail: Array.from(data.slice(40)).some((v) => v !== 0) };
  });
  assert.deepEqual(out.head.map((v) => Math.sign(v)), [...Array(20).fill(1), ...Array(10).fill(-1), ...Array(10).fill(1)]);
  assert.equal(out.tail, false, 'nothing after the waveform ends');
}));

test('Message Serialize is wired as a message input and an audio output; Run with a strobe makes sound without errors', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Strobe');
  await addFromPalette(page, 'Message Serialize');
  assert.equal(await page.locator('.node:has-text("Message Serialize") .port.in.msg').count(), 1);
  assert.equal(await page.locator('.node:has-text("Message Serialize") .port.out.msg').count(), 0, 'its output is audio');
  const wired = await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, k] = ['message_strobe', 'message_serialize', 'audio_sink'].map(by);
    s.params.period = 50;
    return [
      !!dsplab.addEdge({ node: s.id, port: 'msg' }, { node: z.id, port: 'msg' }),
      !!dsplab.addEdge({ node: z.id, port: 'out' }, { node: k.id, port: 'in' }),
    ];
  });
  assert.deepEqual(wired, [true, true]);
  await startAudio(page);
  await selectNode(page, 'Message Serialize');
  await panelControl(page, 'Pulse').selectOption('sinc');   // live change, no rebuild
  await sleep(300);
  assert.match(await page.textContent('#status'), /^Running/);
}));

'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// builds an Array Unpack fed by a cable of the given type, delivers each input and returns what it sent
const run = (page, wire, inputs) => page.evaluate(([wire, inputs]) => {
  const blk = dsplab.BLOCKS.array_unpack.build({}, {}, null, wire ? { in: wire } : {});
  const got = [];
  blk.outputs.out.connect({ receive: (a) => got.push(a) });
  inputs.forEach((x) => blk.inputs.in.receive(x));
  return { got, width: blk.width };
}, [wire, inputs]);

test('N elements of T give N arrays of W bits, most significant first', () => withApp(app, async (page) => {
  const r = await run(page, 'array[uint8]', [[0x41, 0xff]]);
  assert.deepEqual(r.got, [[[0, 1, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1, 1]]]);
  assert.equal(r.width, 8);
  const w = await run(page, 'array[uint16]', [[0x8001]]);
  assert.deepEqual(w.got, [[[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]]]);
  assert.equal((await run(page, 'array[uint32]', [[0xdeadbeef, 1]])).got[0].map((b) => b.length).join(), '32,32');
}));

test('negative numbers give their two\'s complement bits and the range follows the type', () => withApp(app, async (page) => {
  assert.deepEqual((await run(page, 'array[int8]', [[-1, -128, 127]])).got, [[[1, 1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 1, 1, 1, 1, 1, 1]]]);
  assert.deepEqual((await run(page, 'array[int32]', [[-2]])).got[0][0].join(''), '11111111111111111111111111111110');
  assert.deepEqual((await run(page, 'array[uint8]', [[-1], [256]])).got, [], 'out of the range of T: ignored');
  assert.deepEqual((await run(page, 'array[int8]', [[128]])).got, []);
}));

test('without a known type it takes 32 bits; anything that is not an array of ints is ignored', () => withApp(app, async (page) => {
  const r = await run(page, null, [[5]]);
  assert.equal(r.width, 32);
  assert.equal(r.got[0][0].join(''), '00000000000000000000000000000101');
  assert.deepEqual((await run(page, 'array[uint8]', [1, 'ab', ['a'], [1.5], [[1]], null])).got, []);
  assert.deepEqual((await run(page, 'array[uint8]', [[]])).got, [[]], 'an empty array is N = 0');
}));

test('it takes arrays of ints of 8, 16 and 32 bits only, gives array[array[uint8]], and the engine tells it the type', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Array Unpack', 'Debug Sink', 'Wave Generator', 'Pulse Shaper']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Array Unpack") .port.in.async').count(), 1);
  assert.equal(await page.locator('.node:has-text("Array Unpack") .port.out.async').count(), 1);
  const r = await page.evaluate(async () => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, u, d, w, m] = ['strobe_source', 'array_unpack', 'debug_sink', 'wave_generator', 'pulse_shaper'].map(by);
    const e = (a, ap, b, bp) => !!dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    s.params.period = 50;
    const out = { audio: e(w, 'out', u, 'in'), pulse: e(u, 'out', m, 'bits'), strobe: e(s, 'out', u, 'in'), debug: e(u, 'out', d, 'in') };
    await dsplab.engine.start();
    out.width = dsplab.engine.live.get(u.id).width;
    await dsplab.engine.stop();
    return out;
  });
  assert.deepEqual([r.audio, r.pulse, r.strobe, r.debug], [false, false, true, true]);
  assert.equal(r.width, 8, 'fed by a Strobe Source: array[uint8]');
}));

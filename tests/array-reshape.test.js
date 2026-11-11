'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// feeds arrays to an Array Reshape and returns what it sends and its status
const run = (page, params, inputs) => page.evaluate(([params, inputs]) => {
  const blk = dsplab.BLOCKS.array_reshape.build({}, { rows: 1, cols: -1, ...params });
  const got = [];
  blk.outputs.out.connect({ receive: (a) => got.push(a) });
  inputs.forEach((x) => blk.inputs.in.receive(x));
  return { got, status: blk.status };
}, [params, inputs]);

const A = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]];   // 3 x 4

test('the elements keep their order (row by row) in the new shape', () => withApp(app, async (page) => {
  assert.deepEqual((await run(page, { rows: 4, cols: 3 }, [A])).got, [[[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]]);
  assert.deepEqual((await run(page, { rows: 2, cols: 6 }, [A])).got, [[[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]]]);
}));

test('the defaults flatten into one row, and -1 is worked out from the other dimension', () => withApp(app, async (page) => {
  assert.deepEqual((await run(page, {}, [[[1, 2], [3, 4]]])).got, [[[1, 2, 3, 4]]]);
  assert.deepEqual((await run(page, { rows: -1, cols: 1 }, [[[1, 2], [3, 4]]])).got, [[[1], [2], [3], [4]]]);
  assert.deepEqual((await run(page, { rows: 2, cols: -1 }, [A])).got[0].map((r) => r.length), [6, 6]);
}));

test('what does not fit is dropped and the block says why; the elements can be anything', () => withApp(app, async (page) => {
  const bad = await run(page, { rows: 5, cols: 2 }, [A]);
  assert.deepEqual(bad.got, []);
  assert.equal(bad.status, "3x4 can't be 5 x 2");
  assert.deepEqual((await run(page, { rows: -1, cols: -1 }, [A])).got, [], 'only one dimension can be -1');
  assert.deepEqual((await run(page, { rows: 5, cols: -1 }, [A])).got, [], '12 is not a multiple of 5');
  assert.deepEqual((await run(page, { rows: 1, cols: -1 }, [[[[1], 'a'], [[2], 'b']]])).got, [[[[1], 'a', [2], 'b']]]);
  const ok = await run(page, { rows: 2, cols: 6 }, [A]);
  assert.equal(ok.status, '3x4 → 2x6');
}));

test('anything that is not a rectangular array of arrays is ignored', () => withApp(app, async (page) => {
  assert.deepEqual((await run(page, {}, [1, [1, 2], [], 'ab', null])).got, []);
  assert.deepEqual((await run(page, {}, [[[1, 2], [3]]])).got, [], 'ragged');
}));

test('it takes array[array[T]] and gives the same type; cables that stop fitting are dropped', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Array Unpack', 'Array Reshape', 'Pulse Shaper', 'Debug Sink']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Array Reshape") .port.in.async').count(), 1);
  assert.equal(await page.locator('.node:has-text("Array Reshape") .port.out.async').count(), 1);
  const r = await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, u, z, p, d] = ['strobe_source', 'array_unpack', 'array_reshape', 'pulse_shaper', 'debug_sink'].map(by);
    const e = (a, ap, b, bp) => !!dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    const out = {};
    out.flat = e(s, 'out', z, 'in');                         // array[uint8] is not an array of arrays
    out.nothingYet = e(z, 'out', p, 'bits');                 // the output is 'anything' until its input is cabled
    out.unpack = e(s, 'out', u, 'in');
    out.fed = e(u, 'out', z, 'in');                          // array[array[uint8]]: the output carries the same
    out.dropped = dsplab.graph.edges.filter((x) => x.from.node === z.id).length;   // the cable to the Pulse Shaper no longer fits
    out.debug = e(z, 'out', d, 'in');
    return out;
  });
  assert.deepEqual([r.flat, r.nothingYet, r.unpack, r.fed, r.debug], [false, true, true, true, true]);
  assert.equal(r.dropped, 0);
}));

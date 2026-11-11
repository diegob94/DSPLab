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

test('the defaults give one row, -1 is worked out from the other dimension, and a dimension of 0 disappears', () => withApp(app, async (page) => {
  assert.deepEqual((await run(page, {}, [[[1, 2], [3, 4]]])).got, [[[1, 2, 3, 4]]]);                      // the defaults: 1 x 4
  assert.deepEqual((await run(page, { rows: -1, cols: 1 }, [[[1, 2], [3, 4]]])).got, [[[1], [2], [3], [4]]]);   // 4 x 1 keeps both dimensions
  assert.deepEqual((await run(page, { rows: 2, cols: 2 }, [[1, 2, 3, 4]])).got, [[[1, 2], [3, 4]]], 'a plain array can be reshaped too');
  // 0: that dimension disappears and the other one holds all the elements (or -1: worked out)
  assert.deepEqual((await run(page, { rows: 0, cols: -1 }, [[[1, 2], [3, 4]]])).got, [[1, 2, 3, 4]]);
  assert.deepEqual((await run(page, { rows: 0, cols: 4 }, [[[1, 2], [3, 4]]])).got, [[1, 2, 3, 4]]);
  assert.deepEqual((await run(page, { rows: 4, cols: 0 }, [[[1, 2], [3, 4]]])).got, [[1, 2, 3, 4]]);
  assert.deepEqual((await run(page, { rows: 0, cols: 3 }, [[[1, 2], [3, 4]]])).got, [], '3 is not all 4 elements');
  assert.deepEqual((await run(page, { rows: 0, cols: 0 }, [[[1, 2], [3, 4]]])).got, [], 'a dimension has to stay');
  assert.equal((await run(page, { rows: 0, cols: -1 }, [[[1, 2], [3, 4]]])).status, '2x2 → 4');
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
  assert.deepEqual((await run(page, {}, [1, [], 'ab', null, [1, [2]]])).got, []);   // numbers and arrays mixed
  assert.deepEqual((await run(page, {}, [[1, 2]])).got, [[[1, 2]]]);   // a plain array is fine too: 1 x 2
  assert.deepEqual((await run(page, {}, [[[1, 2], [3]]])).got, [], 'ragged');
}));

test('it takes an array, gives array[T] when a dimension is 0 and array[array[T]] otherwise; cables that stop fitting are dropped', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Array Unpack', 'Array Reshape', 'Serializer', 'Debug Sink']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Array Reshape") .port.in.async').count(), 1);
  assert.equal(await page.locator('.node:has-text("Array Reshape") .port.out.async').count(), 1);
  const r = await page.evaluate(async () => {
    const g = await import('/src/core/graph.js');
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, u, z, p, d] = ['strobe_source', 'array_unpack', 'array_reshape', 'serializer', 'debug_sink'].map(by);
    const e = (a, ap, b, bp) => !!dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    const edgesFromZ = () => dsplab.graph.edges.filter((x) => x.from.node === z.id).length;
    const out = {};
    out.nothingYet = e(z, 'out', p, 'in');                 // the output is 'anything' until its input is cabled
    out.fed = e(s, 'out', z, 'in');                          // array[uint8] in; Rows 1 (the default): array[array[uint8]] out
    out.droppedPulse = edgesFromZ() === 0;                   // which doesn't fit the Serializer, that takes arrays of numbers
    out.nestedToUnpack = e(z, 'out', u, 'in');               // nor an Array Unpack, which takes array[int*]
    g.setParam(z, 'rows', 0);                                // Rows 0 disappears: the output is array[uint8]
    out.flatToUnpack = e(z, 'out', u, 'in');
    g.setParam(z, 'rows', 2);                                // 2 x N: an array of arrays again, which Array Unpack doesn't take
    out.droppedAfter = edgesFromZ() === 0;
    out.debug = e(z, 'out', d, 'in');
    return out;
  });
  assert.deepEqual(r, { nothingYet: true, fed: true, droppedPulse: true, nestedToUnpack: false, flatToUnpack: true, droppedAfter: true, debug: true });
}));

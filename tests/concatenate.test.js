'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// sends arrays to the named inputs of a Concatenate and returns what it sent and its status
const run = (page, inputs, sends) => page.evaluate(([inputs, sends]) => {
  const blk = dsplab.BLOCKS.concatenate.build({}, { inputs });
  const got = [];
  blk.outputs.out.connect({ receive: (a) => got.push(a) });
  sends.forEach(([port, bytes]) => blk.inputs[port].receive(bytes));
  return { got, status: blk.status };
}, [inputs, sends]);

test('what arrives at the last input goes out joined after the held ones, in input order', () => withApp(app, async (page) => {
  const { got, status } = await run(page, 3, [['b', [3, 4]], ['a', [1, 2]], ['c', [5]], ['c', [6, 7]]]);
  assert.deepEqual(got, [[1, 2, 3, 4, 5], [1, 2, 3, 4, 6, 7]]);   // a and b are remembered; c sets the pace
  assert.equal(status, '2 + 2 + 2 → 6 bytes');
}));

test('nothing is sent until every input has received something', () => withApp(app, async (page) => {
  const r = await run(page, 2, [['b', [9]]]);
  assert.deepEqual(r.got, []);
  assert.equal(r.status, 'Waiting for a');
}));

test('anything that is not an array of bytes is ignored', () => withApp(app, async (page) => {
  const r = await run(page, 2, [['a', [1]], ['b', 5], ['b', [256]], ['b', ['x']], ['b', [2]]]);
  assert.deepEqual(r.got, [[1, 2]]);
}));

test('it has Inputs array[uint8] async inputs and one output, and Inputs changes the ports', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Concatenate');
  assert.equal(await page.locator('.node:has-text("Concatenate") .port.in.async').count(), 2);
  assert.equal(await page.locator('.node:has-text("Concatenate") .port.out.async').count(), 1);
  await page.evaluate(() => {
    const n = [...dsplab.graph.nodes.values()].find((n) => n.type === 'concatenate');
    dsplab.setParam(n, 'inputs', 4);
    dsplab.rebuildPorts(n);
  });
  assert.equal(await page.locator('.node:has-text("Concatenate") .port.in.async').count(), 4);
}));

test('a Constant Source preamble in front of a Strobe Source payload', () => withApp(app, async (page) => {
  for (const t of ['Constant Source', 'Strobe Source', 'Concatenate', 'Debug Sink']) await addFromPalette(page, t);
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [c, s, j, d] = ['constant_source', 'strobe_source', 'concatenate', 'debug_sink'].map(by);
    Object.assign(c.params, { data: 'ab' });
    Object.assign(s.params, { data: 'cd', period: 50 });
    const e = (a, ap, b, bp) => dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    e(c, 'out', j, 'a'); e(s, 'out', j, 'b'); e(j, 'out', d, 'in');
  });
  await startAudio(page);
  await page.waitForFunction(() => /array\[uint8\]  \[97,98,99,100\]/.test(document.querySelector('.msg-log').textContent));
}));

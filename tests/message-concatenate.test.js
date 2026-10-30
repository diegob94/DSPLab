'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// steps: [port, message]; returns what was sent and the final status
const run = (page, join, steps, inputs = 2) => page.evaluate(([join, steps, inputs]) => {
  const blk = dsplab.BLOCKS.message_concatenate.build({}, { inputs, join });
  const got = [];
  blk.outputs.msg.connect({ receive: (m) => got.push(m) });
  steps.forEach(([port, m]) => blk.inputs[port].receive(m));
  return { got, status: blk.status, ports: Object.keys(blk.inputs) };
}, [join, steps, inputs]);

test('the number of inputs sets the ports: a, b, c...', () => withApp(app, async (page) => {
  assert.deepEqual((await run(page, 'columns', [], 2)).ports, ['a', 'b']);
  assert.deepEqual((await run(page, 'columns', [], 5)).ports, ['a', 'b', 'c', 'd', 'e']);
  assert.equal((await run(page, 'columns', [], 8)).ports.length, 8);
}));

test('with more inputs the messages are joined in order, and the last input sends', () => withApp(app, async (page) => {
  const steps = [['a', [[1]]], ['c', [[1]]], ['b', [[0]]], ['c', [[0]]]];   // a=1, c=1, b=0 (nothing yet), then c=0 sends
  const { got, status } = await run(page, 'columns', steps, 3);
  assert.deepEqual(got, [[[1, 0, 0]]]);
  assert.equal(status, '1x1 + 1x1 + 1x1 → 1x3');
  const rows = await run(page, 'rows', [['a', [[1]]], ['b', [[0]]], ['c', [[1]]], ['d', [[1]]]], 4);
  assert.deepEqual(rows.got, [[[1], [0], [1], [1]]]);
}));

test('it waits until every input has something, and names the first one missing', () => withApp(app, async (page) => {
  const { got, status } = await run(page, 'columns', [['a', [[1]]], ['c', [[1]]]], 3);
  assert.deepEqual(got, []);
  assert.equal(status, 'Waiting for b');
}));

test('a join that fails in the middle is dropped and says which two did not fit', () => withApp(app, async (page) => {
  const { got, status } = await run(page, 'columns', [['a', [[1]]], ['b', [[1], [0]]], ['c', [[1]]]], 3);
  assert.deepEqual(got, []);
  assert.equal(status, "1x1 and 2x1 can't join by columns");
}));

test('the Inputs setting in the panel adds and removes ports on the block', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Concatenate');
  assert.equal(await page.locator('.node:has-text("Message Concatenate") .port.in.msg').count(), 2);
  await page.evaluate(() => dsplab.select({ kind: 'node', id: [...dsplab.graph.nodes.values()].find((n) => n.type === 'message_concatenate').id }));
  await page.locator('#props .param:has(> label:text-is("Inputs")) > select').selectOption('4');
  assert.equal(await page.locator('.node:has-text("Message Concatenate") .port.in.msg').count(), 4);
  await page.locator('#props .param:has(> label:text-is("Inputs")) > select').selectOption('2');
  assert.equal(await page.locator('.node:has-text("Message Concatenate") .port.in.msg').count(), 2);
}));

test('columns: b goes after a, side by side', () => withApp(app, async (page) => {
  const { got, status } = await run(page, 'columns', [['a', [[1], [0]]], ['b', [[0, 1], [1, 1]]]]);
  assert.deepEqual(got, [[[1, 0, 1], [0, 1, 1]]]);
  assert.equal(status, '2x1 + 2x2 → 2x3');
}));

test('rows: b goes below a', () => withApp(app, async (page) => {
  const { got } = await run(page, 'rows', [['a', [[1, 0]]], ['b', [[0, 1], [1, 1]]]]);
  assert.deepEqual(got, [[[1, 0], [0, 1], [1, 1]]]);
}));

test('it sends when b arrives, with the last a received; nothing without an a', () => withApp(app, async (page) => {
  const none = await run(page, 'columns', [['b', [[1]]]]);
  assert.deepEqual(none.got, []);
  assert.equal(none.status, 'Waiting for a');
  const { got } = await run(page, 'columns', [['a', [[0]]], ['a', [[1]]], ['b', [[0]]], ['b', [[1]]]]);
  assert.deepEqual(got, [[[1, 0]], [[1, 1]]]);
}));

test('shapes that do not fit are dropped, and the block says so', () => withApp(app, async (page) => {
  const { got, status } = await run(page, 'columns', [['a', [[1], [0]]], ['b', [[1]]]]);
  assert.deepEqual(got, []);
  assert.equal(status, "2x1 and 1x1 can't join by columns");
}));

test('a preamble from one strobe in front of a payload from another is found by the Deserializer', () => withApp(app, async (page) => {
  for (const t of ['Message Strobe', 'Message Strobe', 'Message Concatenate', 'Message Serializer', 'Message Deserializer', 'Message Debug']) await addFromPalette(page, t);
  await page.evaluate(() => {
    const all = (t) => [...dsplab.graph.nodes.values()].filter((n) => n.type === t);
    const [pre, pay] = all('message_strobe');
    const [cat] = all('message_concatenate'), [ser] = all('message_serialize'), [des] = all('message_deserialize'), [dbg] = all('message_debug');
    // the preamble strobe fires first and often; only the payload's tick makes a message
    Object.assign(pre.params, { period: 50, message: '~~' });
    Object.assign(pay.params, { period: 300, message: 'hi' });
    ser.params.baud = 20000;
    Object.assign(des.params, { rows: 8, cols: 2, preamble: '~~' });
    const e = (a, ap, b, bp) => dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    e(pre, 'msg', cat, 'a'); e(pay, 'msg', cat, 'b'); e(cat, 'msg', ser, 'msg'); e(ser, 'msg', des, 'msg'); e(des, 'msg', dbg, 'msg');
  });
  await startAudio(page);
  await page.waitForFunction(() => /  hi\n?$/m.test(document.querySelector('.msg-log').textContent), null, { timeout: 8000 });
}));

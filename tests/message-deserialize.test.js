'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// feeds bits to a Message Deserializer and returns what it sends
const run = (page, params, bits) => page.evaluate(([params, bits]) => {
  const blk = dsplab.BLOCKS.message_deserialize.build({}, { preambleType: 'text', preamble: '', ...params });
  const got = [];
  blk.outputs.msg.connect({ receive: (m) => got.push(m) });
  bits.forEach((b) => blk.inputs.msg.receive([[b]]));
  blk.inputs.msg.receive([[1, 1]]);   // not 1 x 1: ignored
  return { got, status: blk.status };
}, [params, bits]);

test('every 8 bits make an 8 x 1 message, top bit in row 0', () => withApp(app, async (page) => {
  const { got, status } = await run(page, { rows: 8, cols: 1 }, [0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
  assert.deepEqual(got, [[[0], [1], [0], [0], [0], [0], [0], [1]]]);   // 'A'
  assert.equal(status, '3 / 8 bits');
}));

test('the bits fill column by column, so it undoes the Message Serializer', () => withApp(app, async (page) => {
  const { got } = await run(page, { rows: 2, cols: 2 }, [1, 0, 1, 0]);
  assert.deepEqual(got, [[[1, 1], [0, 0]]]);
  const text = await page.evaluate(() => {
    const m = dsplab.BLOCKS.message_deserialize;
    const bits = Array.from('Hi', (c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join('');
    const blk = m.build({}, { rows: 8, cols: 2 });
    let out;
    blk.outputs.msg.connect({ receive: (x) => { out = x; } });
    [...bits].forEach((b) => blk.inputs.msg.receive([[+b]]));
    return out.map((r) => r.join('')).join('/');
  });
  assert.equal(text, '00/11/01/00/11/00/00/01');   // 'H' = 01001000 and 'i' = 01101001, one per column
}));

test('changing the size drops the bits collected so far', () => withApp(app, async (page) => {
  const got = await page.evaluate(() => {
    const blk = dsplab.BLOCKS.message_deserialize.build({}, { rows: 4, cols: 1 });
    const out = [];
    blk.outputs.msg.connect({ receive: (m) => out.push(m) });
    [1, 1, 1].forEach((b) => blk.inputs.msg.receive([[b]]));
    blk.update({ rows: 2, cols: 1 });
    [0, 1].forEach((b) => blk.inputs.msg.receive([[b]]));
    return out;
  });
  assert.deepEqual(got, [[[0], [1]]]);
}));

// bits of a text, as the Message Serializer sends them
const bitsOf = (text) => Array.from(new TextEncoder().encode(text), (b) => b.toString(2).padStart(8, '0')).join('').split('').map(Number);
const byteRows = (got) => got.map((m) => m.map((r) => r[0]).join(''));

test('with a preamble it ignores everything until the preamble, then collects one message and looks again', () => withApp(app, async (page) => {
  const stream = [1, 0, 0, 1, 1, ...bitsOf('~~'), ...bitsOf('A'), 0, 0, 1, ...bitsOf('~~'), ...bitsOf('B')];
  const { got } = await run(page, { rows: 8, cols: 1, preamble: '~~' }, stream);
  assert.deepEqual(byteRows(got), ['01000001', '01000010']);
}));

test('the preamble can be found at any bit offset, and its bits are not in the message', () => withApp(app, async (page) => {
  for (const pad of [0, 3, 7]) {
    const { got } = await run(page, { rows: 8, cols: 1, preamble: 'U' }, [...Array(pad).fill(1), ...bitsOf('U'), ...bitsOf('Z')]);
    assert.deepEqual(byteRows(got), ['01011010'], `pad ${pad}`);
  }
}));

test('the preamble can be given as hex or as bits: 0xFF is eight ones', () => withApp(app, async (page) => {
  const stream = [0, 0, ...Array(8).fill(1), ...bitsOf('Z')];
  for (const [preambleType, preamble] of [['hex', 'FF'], ['hex', '0xff'], ['bits', '1111 1111']]) {
    const { got } = await run(page, { rows: 8, cols: 1, preambleType, preamble }, stream);
    assert.deepEqual(byteRows(got), ['01011010'], `${preambleType} ${preamble}`);
  }
}));

test('an empty preamble means no framing; changing the preamble restarts the search', () => withApp(app, async (page) => {
  const { got } = await run(page, { rows: 8, cols: 1, preamble: '' }, [1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(got.length, 1);
  const status = await page.evaluate(() => {
    const blk = dsplab.BLOCKS.message_deserialize.build({}, { rows: 2, cols: 1, preamble: '' });
    blk.update({ rows: 2, cols: 1, preamble: 'U' });
    return blk.status;
  });
  assert.equal(status, 'Looking for the preamble');
}));

test('a whole chain shows text in Message Debug', () => withApp(app, async (page) => {
  for (const t of ['Message Strobe', 'Message Serializer', 'Message Deserializer', 'Message Debug']) await addFromPalette(page, t);
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, d, g] = ['message_strobe', 'message_serialize', 'message_deserialize', 'message_debug'].map(by);
    s.params.period = 200;
    s.params.message = 'hello';
    z.params.baud = 20000;
    dsplab.addEdge({ node: s.id, port: 'msg' }, { node: z.id, port: 'msg' });
    dsplab.addEdge({ node: z.id, port: 'msg' }, { node: d.id, port: 'msg' });
    dsplab.addEdge({ node: d.id, port: 'msg' }, { node: g.id, port: 'msg' });
  });
  await startAudio(page);
  await page.waitForFunction(() => / {2}h\n[^\n]* {2}e\n/.test(document.querySelector('.msg-log').textContent + '\n'), null, { timeout: 8000 });
}));

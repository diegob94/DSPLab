'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const lines = (page, samples, params = {}) => page.evaluate(([samples, params]) => {
  const blk = dsplab.BLOCKS.debug_sink.build({ currentTime: 2 }, { lines: 8, ...params });
  samples.forEach((s) => blk.inputs.in.receive(s));
  return blk.log;
}, [samples, params]);

test('it prints the type of each sample with its value and the audio time', () => withApp(app, async (page) => {
  assert.deepEqual(await lines(page, [1, [104, 200], [-61, 3], [200, -3, 300], [0.5], 'x', [1.5, 2], [[1], [2]], []], { lines: 16 }), [
    '2.000  int  1',
    '2.000  array[uint8]  [104,200]',
    '2.000  array[int8]  [-61,3]',
    '2.000  array[int]  [200,-3,300]',
    '2.000  array[float]  [0.5]',
    '2.000  string  "x"',
    '2.000  array[mixed]  [1.5,2]',
    '2.000  array[array[uint8]]  [[1],[2]]',
    '2.000  array[]  []',
  ]);
}));

test('long values are cut and only the newest lines are kept', () => withApp(app, async (page) => {
  const out = await lines(page, [Array.from({ length: 50 }, (_, i) => i), 1, 2, 3, 4, 5], { lines: 4 });
  assert.deepEqual(out.map((l) => l.slice(7)), ['int  2', 'int  3', 'int  4', 'int  5']);
  const long = await lines(page, [Array.from({ length: 50 }, (_, i) => i)]);
  assert.ok(long[0].endsWith('…') && long[0].length < 80);
}));

test('it accepts any async port but not audio, and shows the type live on the block', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Debug Sink', 'Wave Generator']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Debug Sink") .port.in.async').count(), 1);
  const wired = await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const to = (from, port) => !!dsplab.addEdge({ node: by(from).id, port }, { node: by('debug_sink').id, port: 'in' });
    by('strobe_source').params.period = 50;
    return [to('wave_generator', 'out'), to('strobe_source', 'out')];
  });
  assert.deepEqual(wired, [false, true]);
  await startAudio(page);
  await page.waitForFunction(() => /array\[uint8\]/.test(document.querySelector('.msg-log').textContent));
  assert.match(await page.locator('.msg-log').textContent(), /array\[uint8\]  \[104,101,108,108,111\]/);
}));

test('dragging the corner resizes the log (it does not move the block), and the size is saved', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Debug Sink');
  const node = page.locator('.node:has-text("Debug Sink")');
  const wrap = node.locator('.log-wrap');
  await page.waitForFunction(() => document.querySelector('.log-wrap').offsetWidth === 220);   // the first frame sizes it
  const before = await wrap.boundingBox();
  const at = await node.boundingBox();
  const g = await node.locator('.log-grip').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 80, g.y + g.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  const after = await wrap.boundingBox();
  assert.ok(Math.abs(after.width - (before.width + 80)) <= 1 && Math.abs(after.height - (before.height + 60)) <= 1, `${before.width}x${before.height} -> ${after.width}x${after.height}`);
  const still = await node.boundingBox();
  assert.ok(Math.abs(still.x - at.x) <= 1 && Math.abs(still.y - at.y) <= 1, 'the block stayed where it was');
  const saved = await page.evaluate(() => {
    const p = [...dsplab.graph.nodes.values()].find((n) => n.type === 'debug_sink').params;
    return [p.width, p.height, JSON.parse(localStorage.getItem('dsplab.diagram') || 'null')];
  });
  assert.deepEqual(saved.slice(0, 2), [300, 180]);
  // the size limits hold: dragging far beyond them stops at the maximum
  await page.mouse.move(g.x + 80 + g.width / 2, g.y + 60 + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 2000, g.y + 2000, { steps: 3 });
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => { const p = [...dsplab.graph.nodes.values()].find((n) => n.type === 'debug_sink').params; return [p.width, p.height]; }), [1000, 800]);
}));

test('the newest lines stay in view', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Debug Sink');
  await page.evaluate(() => { [...dsplab.graph.nodes.values()].find((n) => n.type === 'debug_sink').params.lines = 128; });
  await startAudio(page);
  await page.evaluate(() => {
    const id = [...dsplab.graph.nodes.values()].find((n) => n.type === 'debug_sink').id;
    for (let i = 0; i < 100; i++) dsplab.engine.live.get(id).inputs.in.receive(i);
  });
  await page.waitForFunction(() => document.querySelector('.msg-log').textContent.endsWith('  99'));
  assert.ok(await page.evaluate(() => { const e = document.querySelector('.msg-log'); return e.scrollTop + e.clientHeight >= e.scrollHeight - 1; }));
}));

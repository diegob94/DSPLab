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
  assert.deepEqual(await lines(page, [1, [104, -61], [200, 3], [0.5], 'x', [1.5, 2], [[1], [2]], []]), [
    '2.000  int  1',
    '2.000  array[int8]  [104,-61]',
    '2.000  array[int]  [200,3]',
    '2.000  array[float]  [0.5]',
    '2.000  string  "x"',
    '2.000  array[mixed]  [1.5,2]',
    '2.000  array[array[int8]]  [[1],[2]]',
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
  await page.waitForFunction(() => /array\[int8\]/.test(document.querySelector('.msg-log').textContent));
  assert.match(await page.locator('.msg-log').textContent(), /array\[int8\]  \[104,101,108,108,111\]/);
}));

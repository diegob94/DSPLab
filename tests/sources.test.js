'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// a source block running; steps are [ms to wait, params to apply | null]; returns the arrays received after each step
const run = (page, type, params, steps) => page.evaluate(async ([type, params, steps]) => {
  const base = { type: 'text', data: 'A', period: 1000 };
  const blk = dsplab.BLOCKS[type].build({ currentTime: 0 }, { ...base, ...params });
  const got = [];
  blk.outputs.out.connect({ receive: (a) => got.push(a) });
  const log = [];
  for (const [ms, update] of steps) {
    if (update) blk.update({ ...base, ...params, ...update });
    await new Promise((r) => setTimeout(r, ms));
    log.push(got.length);
  }
  blk.dispose();
  return { log, got };
}, [type, params, steps]);

for (const type of ['strobe_source', 'constant_source']) {
  test(`${type}: the whole data goes out as one array[uint8] of bytes`, () => withApp(app, async (page) => {
    assert.deepEqual((await run(page, type, { data: 'Hé' }, [[50, null]])).got, [[72, 195, 169]]);   // UTF-8 bytes 0x48 0xC3 0xA9
    assert.deepEqual((await run(page, type, { type: 'hex', data: '0xA5 ff 1' }, [[50, null]])).got, [[0xa5, 0xff]]);
  }));

  test(`${type}: nothing is sent while the data is empty`, () => withApp(app, async (page) => {
    assert.deepEqual((await run(page, type, { data: '' }, [[50, null]])).got, []);
  }));

  test(`${type}: has an array[uint8] async output only; cables only join ports that carry the same thing`, () => withApp(app, async (page) => {
    const title = type === 'strobe_source' ? 'Strobe Source' : 'Constant Source';
    await addFromPalette(page, title);
    assert.equal(await page.locator(`.node:has-text("${title}") .port.out.async`).count(), 1);
    assert.equal(await page.locator(`.node:has-text("${title}") .port.in`).count(), 0);
    for (const sink of ['Audio Sink', 'Pulse Shaper']) await addFromPalette(page, sink);
    const wired = await page.evaluate((type) => {
      const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
      const to = (t, port) => !!dsplab.addEdge({ node: by(type).id, port: 'out' }, { node: by(t).id, port });
      return [to('audio_sink', 'in'), to('pulse_shaper', 'in')];
    }, type);
    assert.deepEqual(wired, [false, false]);
  }));
}

test('Strobe Source sends the array every period, and editing it does not restart the clock', () => withApp(app, async (page) => {
  const { got } = await run(page, 'strobe_source', { period: 20 }, [[100, null], [100, { period: 20, data: 'B' }]]);
  assert.ok(got.length >= 6, `sent again: ${got.length}`);
  assert.deepEqual(got[got.length - 1], [66]);
}));

test('Constant Source sends once, and again only when its data changes', () => withApp(app, async (page) => {
  const { got } = await run(page, 'constant_source', {}, [[50, null], [50, { data: 'A' }], [50, { data: 'B' }], [50, null]]);
  assert.deepEqual(got, [[65], [66]]);
}));

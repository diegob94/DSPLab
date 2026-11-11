'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

test('the samples of a channel: every output sample at the sound card rate, one per symbol at a lower rate', () => withApp(app, async (page) => {
  const r = await page.evaluate(() => {
    const { channelPoints, effectiveDisplay } = dsplab.BLOCKS.oscilloscope;
    return {
      native: channelPoints(5, 100, null, 48000),
      same: channelPoints(3, 0, 48000, 48000),
      // 12000 samples/s on a 48000 Hz card: a sample every 4 output samples, on the grid of context frames
      slow: channelPoints(10, 6, 12000, 48000),
      early: channelPoints(10, -3, 12000, 48000),      // frames before 0 have no samples
      fractional: channelPoints(60, 0, 700, 48000),    // 68.57 output samples per sample
      auto: [effectiveDisplay('auto', null, 48000), effectiveDisplay('auto', 1000, 48000), effectiveDisplay('auto', 48000, 48000), effectiveDisplay('impulse', 1000, 48000)],
    };
  });
  assert.deepEqual(r.native, [0, 1, 2, 3, 4]);
  assert.deepEqual(r.same, [0, 1, 2]);
  assert.deepEqual(r.slow, [2, 6]);                    // frames 8 and 12
  assert.deepEqual(r.early, [3, 7]);                   // frames 0 and 4
  assert.deepEqual(r.fractional, [0]);                 // the next one is at frame 69
  assert.deepEqual(r.auto, ['linear', 'sample & hold', 'linear', 'impulse']);
}));

test('each channel has its own display setting, listed only for the channels that exist', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await page.evaluate(() => dsplab.select({ kind: 'node', id: [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope').id }));
  const labels = () => page.locator('#props-body .param label').allTextContents();
  assert.deepEqual((await labels()).filter((l) => /display/.test(l)), ['Ch1 display', 'Ch2 display']);   // 2 inputs by default
  await page.selectOption('#props-body select >> nth=0', '4');                                           // Inputs
  assert.deepEqual((await labels()).filter((l) => /display/.test(l)), ['Ch1 display', 'Ch2 display', 'Ch3 display', 'Ch4 display']);
  const options = await page.locator('#props-body .param:has(label:text-is("Ch3 display")) option').allTextContents();
  assert.deepEqual(options, ['auto', 'linear', 'sample & hold', 'impulse']);
  // a setting the app doesn't know falls back to the default when a diagram is loaded
  const p = await page.evaluate(() => {
    const n = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    const saved = JSON.parse(JSON.stringify(dsplab.serialize()));
    saved.nodes[0].params.display1 = 'staircase';
    saved.nodes[0].params.display2 = 'impulse';
    return saved;
  });
  assert.equal(p.nodes[0].params.display2, 'impulse');
}));

test('the three display modes draw different pictures of a channel at its own rate, without errors', () => withApp(app, async (page) => {
  for (const t of ['Constant Source', 'Serializer', 'Oscilloscope']) await addFromPalette(page, t);
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [c, z, o] = ['constant_source', 'serializer', 'oscilloscope'].map(by);
    Object.assign(c.params, { type: 'hex', data: '01 00 02 00 03 00 04' });
    z.params.baud = 2000;
    Object.assign(o.params, { channels: 1, xdiv: 2, ydiv: 1, trigger: 'ch1', level: 0.5 });
    dsplab.rebuildPorts(o);
    dsplab.addEdge({ node: c.id, port: 'out' }, { node: z.id, port: 'in' });
    dsplab.addEdge({ node: z.id, port: 'out' }, { node: o.id, port: 'ch1' });
  });
  await startAudio(page);
  await sleep(500);
  const picture = async (mode) => {
    await page.evaluate((mode) => { [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope').params.display1 = mode; }, mode);
    await sleep(250);
    return page.evaluate(() => {
      const c = document.querySelector('.node canvas.scope');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0, h = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] > 180 && d[i + 2] < 140) { lit++; h = (h * 31 + i) >>> 0; } }   // the orange trace
      return { lit, h };
    });
  };
  const [linear, hold, impulse] = [await picture('linear'), await picture('sample & hold'), await picture('impulse')];
  for (const x of [linear, hold, impulse]) assert.ok(x.lit > 0, 'something is drawn');
  assert.notEqual(linear.h, hold.h);
  assert.notEqual(hold.h, impulse.h);
  assert.notEqual(linear.h, impulse.h);
}));

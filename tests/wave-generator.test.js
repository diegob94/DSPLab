'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, selectNode, setRange, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const freqSlider = (page) => page.locator('#props input[type=range]').first();

test('frequency is a logarithmic slider from 1 Hz to 20 kHz', () => withApp(app, async (page) => {
  await selectNode(page, 'Wave Generator');
  assert.equal(await page.locator('#props .val').first().textContent(), '440 Hz');
  const at = async (t) => {
    await setRange(freqSlider(page), t);
    return [await page.locator('#props .val').first().textContent(), await page.evaluate(() => [...dsplab.graph.nodes.values()][0].params.frequency)];
  };
  assert.deepEqual(await at(0), ['1 Hz', 1]);
  assert.deepEqual(await at(0.25), ['11.9 Hz', 11.9]);
  assert.deepEqual(await at(0.5), ['141 Hz', 141]);
  assert.deepEqual(await at(0.75), ['1680 Hz', 1680]);
  assert.deepEqual(await at(1), ['20000 Hz', 20000]);
}));

test('the slider keeps working while the audio runs', () => withApp(app, async (page) => {
  await selectNode(page, 'Wave Generator');
  await startAudio(page);
  await setRange(freqSlider(page), 0.4);
  await setRange(freqSlider(page), 0.5);
  assert.match(await page.textContent('#status'), /^Running/);
}));

// renders 0.1 s of the block (skipping the smoothing ramp) and returns the min and max of the output
const range = (page, params) => page.evaluate(async (params) => {
  const ctx = new OfflineAudioContext(1, 4410, 44100);
  const blk = dsplab.BLOCKS.wave_generator.build(ctx, params);
  blk.outputs.out.connect(ctx.destination);
  const data = (await ctx.startRendering()).getChannelData(0).slice(3500);
  return [+Math.min(...data).toFixed(2), +Math.max(...data).toFixed(2)];
}, params);

test('offset shifts the wave by a DC level, independently of the amplitude', () => withApp(app, async (page) => {
  const sine = { waveform: 'sine', frequency: 440, amplitude: 0.5 };
  assert.deepEqual(await range(page, { ...sine, offset: 0 }), [-0.5, 0.5]);
  assert.deepEqual(await range(page, { ...sine, offset: 0.3 }), [-0.2, 0.8]);
  assert.deepEqual(await range(page, { ...sine, offset: -1 }), [-1.5, -0.5]);
  assert.deepEqual(await range(page, { ...sine, amplitude: 0, offset: 0.7 }), [0.7, 0.7]);
}));

test('offset is a slider from -1 to 1, 0 by default', () => withApp(app, async (page) => {
  const p = await page.evaluate(() => dsplab.BLOCKS.wave_generator.params.find((q) => q.key === 'offset'));
  assert.deepEqual([p.min, p.max, p.default], [-1, 1, 0]);
  await selectNode(page, 'Wave Generator');
  await setRange(page.locator('#props input[type=range]').nth(2), 1);
  assert.equal(await page.evaluate(() => [...dsplab.graph.nodes.values()][0].params.offset), 1);
}));

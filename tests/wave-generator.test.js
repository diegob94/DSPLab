'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, selectNode, setRange, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// the exact-value field under the first slider, with its unit
const shown = async (page) => `${await page.locator('#props .val input').first().inputValue()} ${await page.locator('#props .val span').first().textContent()}`;
const freqSlider = (page) => page.locator('#props input[type=range]').first();

test('frequency is a logarithmic slider from 1 Hz to 20 kHz', () => withApp(app, async (page) => {
  await selectNode(page, 'Wave Generator');
  assert.equal(await shown(page), '440 Hz');
  const at = async (t) => {
    await setRange(freqSlider(page), t);
    return [await shown(page), await page.evaluate(() => [...dsplab.graph.nodes.values()][0].params.frequency)];
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

test('typing an exact value sets the parameter, moves the slider and clamps to the range', () => withApp(app, async (page) => {
  await selectNode(page, 'Wave Generator');
  const field = page.locator('#props .val input').first();
  const freq = () => page.evaluate(() => [...dsplab.graph.nodes.values()][0].params.frequency);

  await field.fill('433');
  await field.press('Enter');
  assert.equal(await freq(), 433);
  assert.equal(await page.locator('.node:has-text("Wave Generator") [data-key="frequency"]').textContent(), '433 Hz');
  const t = Number(await freqSlider(page).inputValue());
  assert.ok(Math.abs(t - Math.log(433) / Math.log(20000)) < 0.001, `slider at ${t}`);

  await field.fill('99999');
  await field.press('Enter');
  assert.equal(await freq(), 20000);
  assert.equal(await field.inputValue(), '20000');

  await field.fill('0.1');
  await field.press('Enter');
  assert.equal(await freq(), 1);

  await field.fill('');
  await field.press('Enter');
  assert.equal(await freq(), 1, 'an empty entry leaves the value alone');
  assert.equal(await field.inputValue(), '1');
}));

test('linear sliders take exact values too, and moving the slider updates the field', () => withApp(app, async (page) => {
  await selectNode(page, 'Wave Generator');
  const field = page.locator('#props .param:has(> label:text-is("Offset")) .val input');
  await field.fill('0.25');
  await field.press('Enter');
  assert.equal(await page.evaluate(() => [...dsplab.graph.nodes.values()][0].params.offset), 0.25);
  await setRange(page.locator('#props .param:has(> label:text-is("Offset")) input[type=range]'), -0.5);
  assert.equal(await field.inputValue(), '-0.5');
}));

'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, selectNode, setRange } = require('./helpers');

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const freqSlider = (page) => page.locator('#props input[type=range]').first();

test('frequency is a logarithmic slider from 1 Hz to 20 kHz', () => withApp(browser, async (page) => {
  await selectNode(page, 'Wave Generator');
  assert.equal(await page.locator('#props .val').first().textContent(), '440 Hz');
  const at = async (t) => {
    await setRange(freqSlider(page), t);
    return [await page.locator('#props .val').first().textContent(), await page.evaluate(() => [...graph.nodes.values()][0].params.frequency)];
  };
  assert.deepEqual(await at(0), ['1 Hz', 1]);
  assert.deepEqual(await at(0.25), ['11.9 Hz', 11.9]);
  assert.deepEqual(await at(0.5), ['141 Hz', 141]);
  assert.deepEqual(await at(0.75), ['1680 Hz', 1680]);
  assert.deepEqual(await at(1), ['20000 Hz', 20000]);
}));

test('the slider keeps working while the audio runs', () => withApp(browser, async (page) => {
  await selectNode(page, 'Wave Generator');
  await page.click('#run');
  await page.waitForFunction(() => engine.running);
  await setRange(freqSlider(page), 0.4);
  await setRange(freqSlider(page), 0.5);
  assert.match(await page.textContent('#status'), /^Running/);
}));

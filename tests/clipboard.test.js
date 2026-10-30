'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, snapshot } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const grant = (page) => page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

test('Copy puts the diagram on the clipboard as JSON and Paste loads it back', () => withApp(app, async (page) => {
  await grant(page);
  await addFromPalette(page, 'Oscilloscope');
  const before = await snapshot(page);
  await page.click('#copy');
  await page.waitForFunction(() => document.querySelector('#copy').textContent === 'Copied');
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  assert.deepEqual(copied, JSON.parse(before));

  // empty the canvas (no confirmation needed then), paste the copy back
  await page.evaluate(() => { for (const id of [...dsplab.graph.nodes.keys()]) dsplab.removeNode(id); });
  assert.equal(await page.locator('.node').count(), 0);
  page.once('dialog', () => assert.fail('an empty canvas needs no confirmation'));
  await page.click('#paste');
  await page.waitForFunction(() => document.querySelector('#paste').textContent === 'Pasted');
  assert.deepEqual(JSON.parse(await snapshot(page)).nodes.map((n) => n.type), copied.nodes.map((n) => n.type));
  assert.equal(await page.locator('.node').count(), copied.nodes.length);
}));

test('Paste asks before replacing a diagram, and declining keeps it', () => withApp(app, async (page) => {
  await grant(page);
  await page.evaluate((t) => navigator.clipboard.writeText(t), JSON.stringify({ version: 1, pan: { x: 0, y: 0 }, nodes: [], edges: [] }));
  const before = await snapshot(page);
  let asked = 0;
  page.once('dialog', (d) => { asked++; d.dismiss(); });
  await page.click('#paste');
  await page.waitForTimeout(200);
  assert.equal(asked, 1);
  assert.equal(await snapshot(page), before);

  page.once('dialog', (d) => d.accept());
  await page.click('#paste');
  await page.waitForFunction(() => dsplab.graph.nodes.size === 0);
}));

test('Paste rejects text that is not a diagram and leaves the diagram alone', () => withApp(app, async (page) => {
  await grant(page);
  const before = await snapshot(page);
  page.on('dialog', () => assert.fail('a bad paste must not ask for confirmation'));
  for (const bad of ['hello', '{"version":2,"nodes":[],"edges":[]}']) {
    await page.evaluate((t) => navigator.clipboard.writeText(t), bad);
    await page.click('#paste');
    await page.waitForFunction(() => document.querySelector('#paste').textContent === 'Not a diagram');
    await page.waitForFunction(() => document.querySelector('#paste').textContent === 'Paste');
  }
  assert.equal(await snapshot(page), before);
}));

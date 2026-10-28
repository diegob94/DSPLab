'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, sleep, addFromPalette, connect, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

test('starts with a connected Wave Generator and Audio Sink', () => withApp(app, async (page) => {
  assert.equal(await page.locator('.node').count(), 2);
  assert.equal(await page.locator('#wires path.edge').count(), 1);
  assert.match(await page.locator('#wires path.edge').getAttribute('d'), /^M[\d.]+,[\d.]+ C/);
}));

test('title is DSPLab', () => withApp(app, async (page) => {
  assert.equal(await page.title(), 'DSPLab');
  assert.equal(await page.locator('#toolbar h1').textContent(), 'DSPLab');
}));

test('layout: properties | canvas | block palette', () => withApp(app, async (page) => {
  const x = async (sel) => (await page.locator(sel).boundingBox()).x;
  assert.ok(await x('#props') < await x('#canvas'));
  assert.ok(await x('#canvas') < await x('#palette'));
}));

test('palette groups blocks by category', () => withApp(app, async (page) => {
  assert.deepEqual(await page.locator('#palette h2').allTextContents(), ['Source blocks', 'Processing blocks', 'Sink blocks']);
  assert.deepEqual(await page.locator('.palette-item').allTextContents(), ['Wave Generator', 'Audio Source', 'Math Operator', 'Audio Sink', 'Oscilloscope']);
}));

test('Run starts the audio engine and Stop ends it', () => withApp(app, async (page) => {
  await startAudio(page);
  await sleep(300);
  assert.match(await page.textContent('#status'), /^Running @ \d+ Hz$/);
  await page.click('#run');
  await page.waitForFunction(() => !dsplab.engine.running);
  await sleep(100);
  assert.equal(await page.textContent('#status'), 'Stopped');
}));

test('a selected cable can be deleted and drawn again', () => withApp(app, async (page) => {
  await page.locator('#wires path.edge').dispatchEvent('pointerdown');
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('#wires path.edge').count(), 0);
  await connect(page, '.port.out', '.port.in');
  assert.equal(await page.locator('#wires path.edge').count(), 1);
}));

test('an input accepts one cable: a new one replaces the old', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Wave Generator');
  await page.evaluate(() => {
    const n = [...dsplab.graph.nodes.values()].at(-1);
    n.x = 100; n.y = 400; n.el.style.left = '100px'; n.el.style.top = '400px'; dsplab.redrawEdges();
  });
  await connect(page, '.node:last-of-type .port.out', '.node:has-text("Audio Sink") .port.in');
  const { edges, newNode } = await page.evaluate(() => ({
    edges: dsplab.graph.edges.map((e) => e.from.node),
    newNode: [...dsplab.graph.nodes.keys()].at(-1),
  }));
  assert.deepEqual(edges, [newNode], 'only the new generator feeds the sink');
}));

test('Delete removes the selected block and its cables', () => withApp(app, async (page) => {
  await page.click('.node:has-text("Audio Sink") .node-title');
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.node').count(), 1);
  assert.equal(await page.locator('#wires path.edge').count(), 0);
}));

test('blocks can be dragged by their title', () => withApp(app, async (page) => {
  const before = await page.locator('.node:has-text("Audio Sink")').boundingBox();
  await page.mouse.move(before.x + 30, before.y + 10);
  await page.mouse.down();
  await page.mouse.move(before.x + 90, before.y + 70, { steps: 4 });
  await page.mouse.up();
  const after = await page.locator('.node:has-text("Audio Sink")').boundingBox();
  assert.equal(Math.round(after.x - before.x), 60);
  assert.equal(Math.round(after.y - before.y), 60);
}));

'use strict';
const { before, after, test } = require('node:test');
const { assert, launch } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// A phone: touch input and a narrow screen. withApp() uses a desktop viewport, so this builds its own page.
async function withPhone(fn) {
  const ctx = await app.browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await page.goto(app.url);
    await fn(page);
    assert.deepEqual(errors, [], 'page logged errors');
  } finally {
    await ctx.close();
  }
}

const visible = (page, sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).display !== 'none');

test('on a phone the canvas fills the width and the panels are hidden drawers', () => withPhone(async (page) => {
  const box = await page.locator('#canvas').boundingBox();
  assert.equal(box.width, 390);
  assert.equal(await visible(page, '#palette'), false);
  assert.equal(await visible(page, '#props'), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}));

test('the toolbar buttons open one drawer at a time and tapping the canvas closes it', () => withPhone(async (page) => {
  await page.tap('#show-palette');
  assert.equal(await visible(page, '#palette'), true);
  await page.tap('#show-props');
  assert.equal(await visible(page, '#palette'), false);
  assert.equal(await visible(page, '#props'), true);
  await page.tap('#canvas', { position: { x: 300, y: 500 } });
  assert.equal(await visible(page, '#props'), false);
}));

test('tapping a palette item adds the block and closes the drawer', () => withPhone(async (page) => {
  const before = await page.evaluate(() => dsplab.graph.nodes.size);
  await page.tap('#show-palette');
  await page.tap('.palette-item:has-text("Oscilloscope")');
  assert.equal(await page.evaluate(() => dsplab.graph.nodes.size), before + 1);
  assert.equal(await visible(page, '#palette'), false);
}));

test('on desktop the drawer buttons are hidden', async () => {
  const ctx = await app.browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  await page.goto(app.url);
  assert.equal(await visible(page, '#show-palette'), false);
  assert.equal(await visible(page, '#palette'), true);
  await ctx.close();
});

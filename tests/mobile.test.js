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

test('on a phone the canvas fills the width, properties sit below it and the palette is a hidden drawer', () => withPhone(async (page) => {
  const box = await page.locator('#canvas').boundingBox();
  assert.equal(box.width, 390);
  assert.equal(await visible(page, '#palette'), false);
  assert.equal(await visible(page, '#props'), true);
  assert.equal(await page.locator('#show-props').count(), 0);
  const props = await page.locator('#props').boundingBox();
  assert.ok(props.y >= box.y + box.height - 1, 'properties are below the canvas');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}));

test('the Blocks button toggles the palette drawer and tapping the canvas closes it; properties stay visible', () => withPhone(async (page) => {
  await page.tap('#show-palette');
  assert.equal(await visible(page, '#palette'), true);
  assert.equal(await visible(page, '#props'), true);
  await page.tap('#show-palette');
  assert.equal(await visible(page, '#palette'), false);
  await page.tap('#show-palette');
  await page.tap('#canvas', { position: { x: 340, y: 100 } });   // empty spot above the open drawer
  assert.equal(await visible(page, '#palette'), false);
  assert.equal(await visible(page, '#props'), true);
}));

test('selecting a block on a phone shows its settings in the always-visible panel', () => withPhone(async (page) => {
  await page.tap('.node .node-title');
  assert.ok(await page.locator('#props .param').count() > 0);
  assert.ok(await page.locator('#props').isVisible());
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

// the toolbar row is a fixed 44px: if its buttons wrap their text they grow taller and get clipped
for (const width of [360, 320]) {
  test(`on a ${width}px phone the toolbar buttons stay on one line and inside the bar`, async () => {
    const ctx = await app.browser.newContext({ viewport: { width, height: 740 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    try {
      await page.goto(app.url);
      const m = await page.evaluate(() => {
        const bar = document.querySelector('#toolbar').getBoundingClientRect();
        const items = [...document.querySelectorAll('#toolbar button, #toolbar select')].filter((el) => getComputedStyle(el).display !== 'none');
        return {
          bar: bar.height,
          items: items.map((el) => { const r = el.getBoundingClientRect(); return { id: el.id, top: r.top, bottom: r.bottom, right: r.right }; }),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      for (const it of m.items) {
        assert.ok(it.top >= 0 && it.bottom <= m.bar, `#${it.id} (${it.top}..${it.bottom}) fits in the ${m.bar}px bar`);
        assert.ok(it.right <= width, `#${it.id} ends inside the screen`);
      }
      assert.equal(new Set(m.items.map((it) => it.bottom - it.top)).size, 1, 'buttons and the Examples menu have the same height');
      assert.equal(m.overflow, false);
    } finally {
      await ctx.close();
    }
  });
}

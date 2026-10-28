'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const view = (page) => page.evaluate(() => ({ x: dsplab.graph.pan.x, y: dsplab.graph.pan.y, z: dsplab.graph.zoom }));

// A phone with real touch input (CDP), because Playwright's touchscreen can't do two fingers.
async function withPhone(fn) {
  const ctx = await app.browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  try {
    await page.goto(app.url);
    await fn(page, touch);
    assert.deepEqual(errors, [], 'page logged errors');
  } finally {
    await ctx.close();
  }
}

test('a block can be dragged by its grey body, not only by the header', () => withPhone(async (page, touch) => {
  const body = await page.locator('.node').first().locator('.node-body').boundingBox();
  const before = await page.evaluate(() => { const n = [...dsplab.graph.nodes.values()][0]; return { x: n.x, y: n.y }; });
  const [x, y] = [body.x + body.width / 2, body.y + body.height / 2];
  await touch('touchStart', [[x, y]]);
  await touch('touchMove', [[x + 40, y + 60]]);
  await touch('touchEnd', []);
  const after = await page.evaluate(() => { const n = [...dsplab.graph.nodes.values()][0]; return { x: n.x, y: n.y }; });
  assert.deepEqual({ x: after.x - before.x, y: after.y - before.y }, { x: 40, y: 60 });
}));

test('pinching the canvas zooms around the midpoint of the fingers', () => withPhone(async (page, touch) => {
  await touch('touchStart', [[150, 600], [250, 600]]);
  await touch('touchMove', [[100, 600], [300, 600]]);   // fingers twice as far apart
  await touch('touchEnd', []);
  const v = await view(page);
  assert.ok(Math.abs(v.z - 2) < 0.01, `zoom ${v.z}`);
  // the world point that was under the midpoint (200, 600 on the page) is still there
  const rect = await page.locator('#canvas').boundingBox();
  assert.ok(Math.abs(v.x - (200 - (200 - 0) * 2)) < 1 && Math.abs(v.y - ((600 - rect.y) - ((600 - rect.y) - 0) * 2)) < 1, JSON.stringify(v));
  assert.match(await page.locator('#world').evaluate((el) => el.style.transform), /scale\(2/);
}));

test('pinching starting on a block zooms instead of moving it', () => withPhone(async (page, touch) => {
  const node = await page.locator('.node').first().boundingBox();
  const before = await page.evaluate(() => { const n = [...dsplab.graph.nodes.values()][0]; return { x: n.x, y: n.y }; });
  const [x, y] = [node.x + 40, node.y + node.height - 10];
  await touch('touchStart', [[x, y]]);
  await touch('touchMove', [[x + 5, y]]);
  await touch('touchEnd', []);
  await touch('touchStart', [[x, y], [x + 100, y]]);
  await touch('touchMove', [[x - 20, y], [x + 120, y]]);
  await touch('touchEnd', []);
  const after = await page.evaluate(() => { const n = [...dsplab.graph.nodes.values()][0]; return { x: n.x, y: n.y }; });
  assert.ok(Math.abs(after.x - before.x) <= 5 && after.y === before.y, 'block stayed put');
  assert.ok((await view(page)).z > 1.3);
}));

test('zoom is clamped, cables follow the ports and blocks drag at the zoomed scale', () => withApp(app, async (page) => {
  await page.mouse.move(640, 500);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -200);
  await sleep(100);
  assert.equal((await view(page)).z, 2.5);
  for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 200);
  await sleep(100);
  assert.equal((await view(page)).z, 0.3);

  // a cable ends on its port at any zoom
  for (const wheel of [-300, 600]) {
    await page.mouse.wheel(0, wheel);
    await sleep(50);
    const gap = await page.evaluate(() => {
      const e = dsplab.graph.edges[0];
      const p = e.el.getPointAtLength(e.el.getTotalLength());
      const m = e.el.getScreenCTM();
      const dot = document.querySelector(`.node:has(.port.in) .port.in`).getBoundingClientRect();
      return Math.hypot(p.x * m.a + m.e - (dot.left + dot.width / 2), p.y * m.d + m.f - (dot.top + dot.height / 2));
    });
    assert.ok(gap < 1.5, `cable misses its port by ${gap}px`);
  }

  // dragging a block moves it by the pointer distance divided by the zoom
  const { z } = await view(page);
  const box = await page.locator('.node').first().locator('.node-title').boundingBox();
  const before = await page.evaluate(() => { const n = [...dsplab.graph.nodes.values()][0]; return { x: n.x, y: n.y }; });
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 5 + 30, box.y + 5, { steps: 3 });
  await page.mouse.up();
  const after = await page.evaluate(() => [...dsplab.graph.nodes.values()][0].x);
  assert.ok(Math.abs(after - before.x - 30 / z) <= 1);
}));

test('the zoom is saved and restored', () => withApp(app, async (page) => {
  await page.mouse.move(640, 500);
  await page.mouse.wheel(0, -300);
  await sleep(400);
  const z = (await view(page)).z;
  assert.ok(z > 1);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('dsplab.diagram'))).zoom, z);
}));

test('a bad saved zoom falls back to 1', () => withApp(app, async (page) => {
  assert.equal((await view(page)).z, 1);
}, { seed: { version: 1, pan: { x: 0, y: 0 }, zoom: 'big', nodes: [], edges: [] } }));

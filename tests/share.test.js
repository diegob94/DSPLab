'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, snapshot, setRange, panelControl } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const grant = (page) => page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

// click Share and return the link that landed on the clipboard
async function shareLink(page) {
  await page.click('#share');
  await page.waitForFunction(() => document.querySelector('#share').textContent === 'Link copied');
  return page.evaluate(() => navigator.clipboard.readText());
}

const nodeTypes = (page) => page.evaluate(() => [...dsplab.graph.nodes.values()].map((n) => n.type).sort());

test('Share copies a link whose fragment is much smaller than the plain JSON', () => withApp(app, async (page) => {
  await grant(page);
  await addFromPalette(page, 'Oscilloscope');
  const link = await shareLink(page);
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, new URL(page.url()).origin + '/');
  assert.match(url.hash, /^#d=[A-Za-z0-9_-]+$/);
  assert.ok(url.hash.length < (await snapshot(page)).length, 'the link is shorter than the minified JSON');
}));

test('opening a shared link in a fresh browser shows the same diagram', async () => {
  let link;
  let expected;
  await withApp(app, async (page) => {
    await grant(page);
    await addFromPalette(page, 'Oscilloscope');
    await addFromPalette(page, 'Math Operator');
    await page.locator('.node:has-text("Math Operator") .node-title').click();
    await panelControl(page, 'Operation').selectOption({ index: 1 });
    expected = JSON.parse(await snapshot(page));
    link = await shareLink(page);
  });
  // a browser profile with nothing saved, opening the link as its very first page (cold start)
  const ctx = await app.browser.newContext();
  const page = await ctx.newPage();
  try {
    page.on('dialog', () => assert.fail('no confirmation expected'));
    // an empty saved diagram has nothing to lose, unlike the starter one
    await page.addInitScript(() => localStorage.setItem('dsplab.diagram', JSON.stringify({ version: 1, pan: { x: 0, y: 0 }, nodes: [], edges: [] })));
    await page.goto(link);
    await page.waitForFunction((n) => dsplab.graph.nodes.size === n, expected.nodes.length);
    const pick = (d) => d.nodes.map(({ type, x, y, params }) => ({ type, x, y, params }));
    const got = JSON.parse(await snapshot(page));
    assert.deepEqual(pick(got), pick(expected));
    assert.equal(got.edges.length, expected.edges.length);
    assert.equal(new URL(page.url()).hash, '', 'the hash is removed so a reload does not replace later edits');
  } finally {
    await ctx.close();
  }
});

test('opening a link asks before replacing a diagram that has blocks', () => withApp(app, async (page) => {
  await grant(page);
  const link = await shareLink(page);
  await addFromPalette(page, 'Oscilloscope');
  const before = await snapshot(page);

  let asked = 0;
  page.once('dialog', (d) => { asked++; d.dismiss(); });
  await page.evaluate((l) => { location.hash = new URL(l).hash; }, link);
  await page.waitForFunction(() => location.hash === '');
  assert.equal(asked, 1);
  assert.equal(await snapshot(page), before);

  page.once('dialog', (d) => d.accept());
  await page.evaluate((l) => { location.hash = new URL(l).hash; }, link);
  await page.waitForFunction(() => !dsplab.graph.nodes.size || ![...dsplab.graph.nodes.values()].some((n) => n.type === 'oscilloscope'));
  assert.ok(!(await nodeTypes(page)).includes('oscilloscope'));
}));

test('a corrupt link alerts and leaves the diagram alone', () => withApp(app, async (page) => {
  const before = await snapshot(page);
  const messages = [];
  page.on('dialog', (d) => { messages.push(d.message()); d.accept(); });
  await page.evaluate(() => { location.hash = '#d=not-a-real-diagram'; });
  await page.waitForFunction(() => location.hash === '');
  await page.waitForTimeout(200);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /valid diagram/);
  assert.equal(await snapshot(page), before);
}));

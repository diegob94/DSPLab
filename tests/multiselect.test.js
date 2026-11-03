'use strict';
const { test, before, after } = require('node:test');
const { assert, launch, withApp, addFromPalette, connect } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// three blocks in known places (new blocks all land at the centre), the first two wired together
const setup = (page) => page.evaluate(() => {
  const { graph, addNode, addEdge, redrawEdges } = dsplab;
  [...graph.nodes.keys()].forEach(dsplab.removeNode);
  const a = addNode('wave_generator', 100, 100), b = addNode('oscilloscope', 400, 100), c = addNode('wave_generator', 100, 400);
  addEdge({ node: a.id, port: 'out' }, { node: b.id, port: 'ch1' });
  redrawEdges();
  dsplab.select(null);
  return [a.id, b.id, c.id];
});
const selected = (page) => page.evaluate(() => [...document.querySelectorAll('.node.selected')].length);
const nodeBox = (page, id) => page.evaluate((id) => {
  const r = dsplab.graph.nodes.get(id).el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}, id);

test('shift+click toggles blocks in the selection', () => withApp(app, async (page) => {
  const [a, b] = await setup(page);
  const ba = await nodeBox(page, a), bb = await nodeBox(page, b);
  await page.mouse.click(ba.x + 20, ba.y + 8);
  await page.keyboard.down('Shift');
  await page.mouse.click(bb.x + 20, bb.y + 8);
  await page.keyboard.up('Shift');
  assert.equal(await selected(page), 2);
  assert.match(await page.locator('#props').innerText(), /2 blocks selected/);
  await page.keyboard.down('Shift');
  await page.mouse.click(ba.x + 20, ba.y + 8);
  await page.keyboard.up('Shift');
  assert.equal(await selected(page), 1);
  await page.mouse.click(ba.x + 20, ba.y + 8);   // a plain click selects just that one
  await page.keyboard.down('Shift');
  await page.mouse.click(bb.x + 20, bb.y + 8);
  await page.keyboard.up('Shift');
  await page.mouse.click(ba.x + 20, ba.y + 8);   // ...also when it was part of a selection
  assert.equal(await selected(page), 1);
}));

test('dragging one selected block moves all of them', () => withApp(app, async (page) => {
  const [a, b, c] = await setup(page);
  const ba = await nodeBox(page, a), bb = await nodeBox(page, b);
  await page.mouse.click(ba.x + 20, ba.y + 8);
  await page.keyboard.down('Shift');
  await page.mouse.click(bb.x + 20, bb.y + 8);
  await page.keyboard.up('Shift');
  const before = await page.evaluate(([a, b, c]) => [a, b, c].map((id) => ({ ...dsplab.graph.nodes.get(id) })), [a, b, c]);
  await page.mouse.move(ba.x + 20, ba.y + 8);
  await page.mouse.down();
  await page.mouse.move(ba.x + 70, ba.y + 38, { steps: 5 });
  await page.mouse.up();
  const after = await page.evaluate(([a, b, c]) => [a, b, c].map((id) => ({ ...dsplab.graph.nodes.get(id) })), [a, b, c]);
  assert.deepEqual([after[0].x - before[0].x, after[0].y - before[0].y], [50, 30]);
  assert.deepEqual([after[1].x - before[1].x, after[1].y - before[1].y], [50, 30]);
  assert.deepEqual([after[2].x, after[2].y], [before[2].x, before[2].y]);
}));

test('shift+drag on the background selects the blocks inside the box', () => withApp(app, async (page) => {
  const [a, b, c] = await setup(page);
  const ba = await nodeBox(page, a), bb = await nodeBox(page, b);
  // from an empty spot above-left of a to inside b: touches a and b but not c
  await page.keyboard.down('Shift');
  await page.mouse.move(ba.x - 20, ba.y - 20);
  await page.mouse.down();
  await page.mouse.move(bb.x + 30, bb.y + 30, { steps: 6 });
  assert.equal(await page.locator('.marquee').count(), 1);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  assert.equal(await page.locator('.marquee').count(), 0);
  const ids = await page.evaluate(() => [...document.querySelectorAll('.node.selected')].length);
  assert.equal(ids, 2);
  assert.equal(await page.evaluate((c) => dsplab.graph.nodes.get(c).el.classList.contains('selected'), c), false);
}));

test('Delete removes every selected block; Ctrl+A selects all', () => withApp(app, async (page) => {
  await setup(page);
  await page.mouse.click(640, 700);
  await page.keyboard.press('Control+a');
  assert.equal(await selected(page), 3);
  await page.keyboard.press('Delete');
  assert.equal(await page.evaluate(() => dsplab.graph.nodes.size), 0);
  assert.equal(await page.evaluate(() => dsplab.graph.edges.length), 0);
}));

// the clipboard text of a copy, and a paste of given text, without depending on the system clipboard
const copyEvent = (page, key = 'copy') => page.evaluate((key) => {
  const dt = new DataTransfer();
  document.dispatchEvent(new ClipboardEvent(key, { clipboardData: dt, bubbles: true, cancelable: true }));
  return dt.getData('text/plain');
}, key);
const pasteEvent = (page, text) => page.evaluate((text) => {
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);

test('copy and paste between two instances of the app', async () => {
  let text;
  await withApp(app, async (page) => {
    const [a, b] = await setup(page);
    await page.evaluate(([a, b]) => { dsplab.graph.nodes.get(a).params.frequency = 880; dsplab.select({ kind: 'node', id: a, ids: [a, b] }); }, [a, b]);
    text = await copyEvent(page);
    assert.ok(text);
    const data = JSON.parse(text);
    assert.equal(data.nodes.length, 2);
    assert.equal(data.edges.length, 1);   // the cable between the two copied blocks comes along
  });
  await withApp(app, async (page) => {
    await setup(page);
    const before = await page.evaluate(() => ({ n: dsplab.graph.nodes.size, e: dsplab.graph.edges.length, maxId: dsplab.graph.nextId }));
    await pasteEvent(page, text);
    const after = await page.evaluate(() => ({
      n: dsplab.graph.nodes.size, e: dsplab.graph.edges.length,
      selected: [...document.querySelectorAll('.node.selected')].length,
      pasted: [...dsplab.graph.nodes.values()].filter((n) => n.id >= 1).slice(-2).map((n) => ({ ...n, el: 0, view: 0 })),
    }));
    assert.equal(after.n, before.n + 2);
    assert.equal(after.e, before.e + 1);
    assert.equal(after.selected, 2);
    assert.ok(after.pasted.some((n) => n.type === 'wave_generator' && n.params.frequency === 880));
    await pasteEvent(page, text);   // pasting again adds another copy, further along
    assert.equal(await page.evaluate(() => dsplab.graph.nodes.size), before.n + 4);
    // garbage on the clipboard is ignored
    await pasteEvent(page, 'hello');
    await pasteEvent(page, '{"version":1,"nodes":[{"type":"nope","x":1,"y":1}],"edges":[]}');
    assert.equal(await page.evaluate(() => dsplab.graph.nodes.size), before.n + 4);
  });
});

test('cut removes the blocks and puts them on the clipboard; copy with nothing selected does nothing', () => withApp(app, async (page) => {
  const [a] = await setup(page);
  assert.equal(await copyEvent(page), '');
  await page.evaluate((a) => dsplab.select({ kind: 'node', id: a }), a);
  const text = await copyEvent(page, 'cut');
  assert.equal(JSON.parse(text).nodes.length, 1);
  assert.equal(await page.evaluate(() => dsplab.graph.nodes.size), 2);
}));

test('the real keyboard shortcuts work (Ctrl+C then Ctrl+V)', () => withApp(app, async (page) => {
  await setup(page);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  assert.equal(await page.evaluate(() => dsplab.graph.nodes.size), 6);
  assert.equal(await page.evaluate(() => dsplab.graph.edges.length), 2);
}));

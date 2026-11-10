'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const base = { format: 'text', frame: 1, lines: 8, preambleType: 'text', preamble: '' };
// feeds bits to a Bit Monitor and returns its log without the times
const run = (page, params, bits, then) => page.evaluate(([params, bits, then]) => {
  const blk = dsplab.BLOCKS.bit_monitor.build({ currentTime: 1.5 }, params);
  bits.forEach((b) => blk.inputs.bits.receive(b));
  if (then) blk.update(then.params), then.bits.forEach((b) => blk.inputs.bits.receive(b));
  return blk.log;
}, [{ ...base, ...params }, bits, then]);

const bitsOf = (text) => Array.from(new TextEncoder().encode(text), (b) => b.toString(2).padStart(8, '0')).join('').split('').map(Number);
const texts = (log) => log.map((l) => l.replace(/^\d+\.\d{3} {2}/, ''));

test('every 8 bits make a character, top bit first, stamped with the audio time', () => withApp(app, async (page) => {
  const log = await run(page, {}, [...bitsOf('A'), 1, 1]);
  assert.deepEqual(log, ['1.500  A']);
  assert.deepEqual(texts(await run(page, { frame: 2 }, bitsOf('é'))), ['é']);   // two bytes in UTF-8
}));

test('a frame of several characters is one line; control characters show as a dot', () => withApp(app, async (page) => {
  assert.deepEqual(texts(await run(page, { frame: 3 }, [...bitsOf('a\nb'), ...bitsOf('xyz')])), ['a·b', 'xyz']);
}));

test('the bits format prints the frame as 0s and 1s', () => withApp(app, async (page) => {
  assert.deepEqual(texts(await run(page, { format: 'bits', frame: 4 }, [1, 0, 1, 1, 0, 0, 1])), ['1011']);
}));

test('with a preamble it ignores everything until it, then collects one frame and looks again', () => withApp(app, async (page) => {
  const stream = [1, 0, 0, 1, 1, ...bitsOf('~~'), ...bitsOf('A'), 0, 0, 1, ...bitsOf('~~'), ...bitsOf('B')];
  assert.deepEqual(texts(await run(page, { preamble: '~~' }, stream)), ['A', 'B']);
}));

test('only the newest lines are kept, and changing the frame size drops the bits collected so far', () => withApp(app, async (page) => {
  const many = await run(page, { lines: 4, frame: 1 }, bitsOf('abcdefg'));
  assert.deepEqual(texts(many), ['d', 'e', 'f', 'g']);
  const dropped = await run(page, { frame: 1 }, [1, 1, 1], { params: { ...base, format: 'bits', frame: 2 }, bits: [0, 1] });
  assert.deepEqual(texts(dropped), ['01']);
}));

test('Bit Monitor has an async input, no output, and prints on the block', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Bit Monitor');
  assert.equal(await page.locator('.node:has-text("Bit Monitor") .port.in.async').count(), 1);
  assert.equal(await page.locator('.node:has-text("Bit Monitor") .port.out').count(), 0);
  await page.waitForFunction(() => document.querySelector('.msg-log').textContent === 'Stopped');
}));

test('samples that are not bits are ignored', () => withApp(app, async (page) => {
  assert.deepEqual(texts(await run(page, { format: 'bits', frame: 2 }, [1, 7, 'x', 0])), ['10']);
}));

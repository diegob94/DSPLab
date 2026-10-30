'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, panelControl, startAudio, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const FS = 48000;
const DEFAULTS = { target: 0.5, attack: 5, release: 500, maxGain: 40 };
const run = async (params, input) => {
  const { Agc } = await import('../src/blocks/agc-core.js');
  const out = new Float32Array(input.length);
  new Agc({ sampleRate: FS, ...DEFAULTS, ...params }).process(input, out);
  return out;
};
const sine = (n, amp, hz = 1000) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / FS));
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('weak and strong signals both settle at the target peak level', async () => {
  for (const amp of [0.02, 0.9]) {
    const out = await run({}, sine(FS, amp));
    const p = peak(out.slice(FS / 2));
    assert.ok(Math.abs(p - 0.5) < 0.05, `amp ${amp} gave ${p}`);
  }
});

test('the gain follows a level change: quickly down, slowly up', async () => {
  const x = new Float32Array(FS * 2);
  x.set(sine(FS / 2, 0.1), 0);
  x.set(sine(FS / 2, 0.8), FS / 2);        // jump up at 0.5 s: gain must drop within the attack
  x.set(sine(FS, 0.1), FS);                // drop back at 1 s: gain recovers over the release
  const out = await run({ attack: 2, release: 300 }, x);
  assert.ok(peak(out.slice(FS / 2 + 480, FS / 2 + 4800)) < 1, 'no runaway after the jump up');
  assert.ok(peak(out.slice(FS, FS + 480)) < 0.2, 'still low right after the drop');
  assert.ok(peak(out.slice(2 * FS - 4800)) > 0.45, 'recovered to the target');
});

test('max gain stops silence and noise from being amplified without limit', async () => {
  const out = await run({ maxGain: 20 }, sine(FS, 0.001));
  assert.ok(peak(out.slice(FS / 2)) < 0.011 && peak(out.slice(FS / 2)) > 0.009, '0.001 x 10 (20 dB)');
  assert.ok((await run({}, new Float32Array(4800))).every((v) => v === 0), 'silence stays silent');
});

test('AGC has an audio input and output, and accepts live changes while running', () => withApp(app, async (page) => {
  await addFromPalette(page, 'AGC');
  assert.equal(await page.locator('.node:has-text("AGC") .port.in').count(), 1);
  assert.equal(await page.locator('.node:has-text("AGC") .port.out').count(), 1);
  assert.equal(await page.evaluate(() => dsplab.BLOCKS.agc.category), 'Processing blocks');
  await startAudio(page);
  await page.evaluate(() => dsplab.select({ kind: 'node', id: [...dsplab.graph.nodes.values()].find((n) => n.type === 'agc').id }));
  await panelControl(page, 'Target').fill('0.8');   // live change, no rebuild
  await sleep(200);
  assert.match(await page.textContent('#status'), /^Running/);
}));

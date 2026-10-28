'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const VIEWPORT = { width: 1280, height: 760 };

const launch = () => chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// Runs fn(page) on a fresh page (own context, so empty localStorage) and fails the test
// if the page logged any error. `seed` is stored as the saved diagram before the app starts.
async function withApp(browser, fn, { seed } = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  if (seed !== undefined) {
    await page.addInitScript((v) => {
      if (!sessionStorage.getItem('seeded')) { localStorage.setItem('dsplab.diagram', v); sessionStorage.setItem('seeded', '1'); }
    }, typeof seed === 'string' ? seed : JSON.stringify(seed));
  }
  try {
    await page.goto(URL);
    await fn(page);
    assert.deepEqual(errors, [], 'page logged errors');
  } finally {
    await ctx.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const selectNode = (page, title) => page.click(`.node:has-text("${title}") .node-title`);
const addFromPalette = (page, title) => page.dblclick(`.palette-item:has-text("${title}")`);

// drag from an output port to an input port with the real mouse
async function connect(page, fromSel, toSel) {
  const o = await page.locator(fromSel).boundingBox();
  const i = await page.locator(toSel).boundingBox();
  await page.mouse.move(o.x + 6, o.y + 6);
  await page.mouse.down();
  await page.mouse.move(i.x + 6, i.y + 6, { steps: 6 });
  await page.mouse.up();
}

// set a slider the way the browser would: `input` while dragging, `change` on release
const setRange = (locator, value) => locator.evaluate((el, v) => {
  el.value = v;
  el.dispatchEvent(new Event('input'));
  el.dispatchEvent(new Event('change'));
}, value);

const snapshot = (page) => page.evaluate(() => JSON.stringify(serialize()));

module.exports = { assert, URL, launch, withApp, sleep, selectNode, addFromPalette, connect, setRange, snapshot };

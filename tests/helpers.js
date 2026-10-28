'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const VIEWPORT = { width: 1280, height: 760 };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

// ES modules don't load from file://, so the app is served over HTTP. Set DSPLAB_URL to test
// an already running server instead (e.g. ./serve.sh).
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, rel.endsWith('/') ? rel + 'index.html' : rel);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// -> { browser, url, close }
async function launch() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const server = process.env.DSPLAB_URL ? null : await serve();
  const url = process.env.DSPLAB_URL || `http://127.0.0.1:${server.address().port}/`;
  return { browser, url, close: async () => { await browser.close(); if (server) server.close(); } };
}

// Runs fn(page) on a fresh page (own context, so empty localStorage) and fails the test
// if the page logged any error. `seed` is stored as the saved diagram before the app starts.
async function withApp(app, fn, { seed } = {}) {
  const ctx = await app.browser.newContext({ viewport: VIEWPORT });
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
    await page.goto(app.url);
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

// the <select>/<input> of the properties-panel row with this label
const panelControl = (page, label) => page.locator(`#props .param:has(> label:text-is("${label}")) > :is(select, input)`);

const snapshot = (page) => page.evaluate(() => JSON.stringify(dsplab.serialize()));

module.exports = { assert, launch, withApp, sleep, selectNode, addFromPalette, connect, setRange, panelControl, snapshot };

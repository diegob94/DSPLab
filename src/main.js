import { BLOCKS, CATEGORIES } from './blocks/index.js';
import { $, h, svgEl } from './dom.js';
import { on } from './core/events.js';
import { optionsOf, portNames } from './core/params.js';
import {
  graph, getSelection, select, addNode, removeNode, addEdge, removeEdge, moveNode, setPan,
  setParam, syncParams, rebuildPorts, deleteSelection,
} from './core/graph.js';
import { engine } from './core/engine.js';
import { serialize, restore } from './core/persistence.js';

/* ------------------------------------------------------------------ *
 * DOM refs
 * ------------------------------------------------------------------ */
const canvas = $('#canvas');
const world  = $('#world');
const wires  = $('#wires');
const runBtn = $('#run');
const delBtn = $('#delete');
const statusEl = $('#status');
const propsBody = $('#props-body');

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */
function buildPalette() {
  const pal = $('#palette');
  for (const [cat, color] of Object.entries(CATEGORIES)) {
    pal.append(h('h2', { textContent: cat }));
    for (const [type, def] of Object.entries(BLOCKS)) {
      if (def.category !== cat) continue;
      const item = h('div', { className: 'palette-item', textContent: def.title, draggable: true, title: 'Drag onto the canvas, or double-click to add' });
      item.style.setProperty('--cat', color);
      item.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/block', type));
      item.addEventListener('dblclick', () => {
        const r = canvas.getBoundingClientRect();
        addNode(type, r.width / 2 - graph.pan.x - 90, r.height / 2 - graph.pan.y - 40);
      });
      pal.append(item);
    }
  }
  pal.append(h('p', { className: 'hint', textContent:
    'Drag from an output port (right) to an input port (left) to connect blocks. Select a block to edit it in the properties panel. Drag the background to pan. Delete removes the selection.' }));
}

canvas.addEventListener('dragover', (e) => e.preventDefault());
canvas.addEventListener('drop', (e) => {
  const type = e.dataTransfer.getData('text/block');
  if (!BLOCKS[type]) return;
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  addNode(type, e.clientX - r.left - graph.pan.x - 90, e.clientY - r.top - graph.pan.y - 14);
});

/* ------------------------------------------------------------------ *
 * Nodes
 * ------------------------------------------------------------------ */
const fmt = (p, v) => p.unit ? `${v} ${p.unit}` : String(v);

function refreshSummary(node) {
  for (const p of BLOCKS[node.type].params) {
    const out = node.el.querySelector(`[data-key="${p.key}"]`);
    if (out) out.textContent = fmt(p, node.params[p.key]);
  }
}

function renderNode(node, def) {
  const el = h('div', { className: 'node' });
  el.style.setProperty('--cat', CATEGORIES[def.category]);
  el.style.left = node.x + 'px';
  el.style.top = node.y + 'px';

  const title = h('div', { className: 'node-title', textContent: def.title });
  el.append(title);

  for (const dir of ['in', 'out']) {
    for (const name of portNames(def, dir === 'in' ? 'inputs' : 'outputs', node.params)) {
      el.append(portRow(dir, name, node.id, def.portColor && def.portColor(name)));
    }
  }

  const body = h('div', { className: 'node-body' });
  if (def.ui) { node.view = def.ui(node); body.append(node.view.el); }
  for (const p of def.params.filter((p) => p.show)) {
    const val = h('b');
    val.dataset.key = p.key;
    body.append(h('div', { className: 'kv' }, h('span', { textContent: p.label }), val));
  }
  el.append(body);
  node.el = el;
  refreshSummary(node);

  // select + drag by title
  el.addEventListener('pointerdown', () => select({ kind: 'node', id: node.id }));
  title.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select({ kind: 'node', id: node.id });
    const sx = e.clientX, sy = e.clientY, ox = node.x, oy = node.y;
    const move = (ev) => moveNode(node, ox + ev.clientX - sx, oy + ev.clientY - sy);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  return el;
}

function portRow(dir, name, nodeId, color) {
  const row = h('div', { className: `port-row ${dir}` });
  const dot = h('div', { className: `port ${dir}` });
  if (color) row.style.setProperty('--cat', color);
  dot.dataset.node = nodeId;
  dot.dataset.port = name;
  dot.dataset.dir = dir;
  dot.addEventListener('pointerdown', (e) => startConnect(e, dot));
  const label = h('span', { className: 'port-label', textContent: name });
  if (color) label.style.color = color;
  row.append(dot, label);
  return row;
}

function paramWidget(node, p) {
  const wrap = h('div', { className: 'param' });
  const id = `p${node.id}-${p.key}`;
  wrap.append(h('label', { htmlFor: id, textContent: p.label }));

  // log sliders move over 0..1 and map to [min, max] exponentially
  const log = p.type === 'range' && p.scale === 'log';
  const toSlider = (v) => log ? Math.log(v / p.min) / Math.log(p.max / p.min) : v;
  const fromSlider = (t) => {
    if (!log) return t;
    return Number((p.min * Math.pow(p.max / p.min, t)).toPrecision(3));
  };
  const show = (v) => fmt(p, v);

  let input;
  if (p.type === 'select') {
    input = h('select', { id });
    optionsOf(p, node.params).forEach((o) => input.append(h('option', { value: o, textContent: o })));
  } else if (log) {
    input = h('input', { id, type: 'range', min: 0, max: 1, step: 0.001 });
  } else {
    input = h('input', { id, type: p.type, min: p.min, max: p.max, step: p.step });
  }
  input.value = toSlider(node.params[p.key]);
  wrap.append(input);

  let readout;
  if (p.type === 'range') {
    readout = h('div', { className: 'val', textContent: show(node.params[p.key]) });
    wrap.append(readout);
  }

  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('input', () => {
    setParam(node, p.key, p.type === 'select' ? input.value : fromSlider(parseFloat(input.value)));
    if (readout) readout.textContent = show(node.params[p.key]);
  });
  if (p.ports) {
    // applied on release, so dragging a slider across a smaller value doesn't drop cables on the way
    input.addEventListener('change', () => {
      syncParams(node);
      rebuildPorts(node);
      renderProps();
      const again = document.getElementById(id);
      if (again) again.focus();
    });
  }
  return wrap;
}

on('node-added', (node) => world.append(renderNode(node, BLOCKS[node.type])));
on('node-removed', (node) => node.el.remove());
on('param', (node) => refreshSummary(node));
on('moved', (node) => {
  node.el.style.left = node.x + 'px';
  node.el.style.top = node.y + 'px';
  redrawEdges();
});

// the number of input ports changed: re-render them
on('ports', (node) => {
  const def = BLOCKS[node.type];
  node.el.querySelectorAll('.port-row.in').forEach((row) => row.remove());
  const names = portNames(def, 'inputs', node.params);
  node.el.querySelector('.node-title').after(...names.map((name) => portRow('in', name, node.id, def.portColor && def.portColor(name))));
  redrawEdges();
});

/* ------------------------------------------------------------------ *
 * Edges
 * ------------------------------------------------------------------ */
function portEl(nodeId, port, dir) {
  const node = graph.nodes.get(nodeId);
  return node && node.el.querySelector(`.port.${dir}[data-port="${port}"]`);
}

function portPos(dot) {
  const w = world.getBoundingClientRect();
  const r = dot.getBoundingClientRect();
  return { x: r.left + r.width / 2 - w.left, y: r.top + r.height / 2 - w.top };
}

function curve(a, b) {
  const dx = Math.max(50, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}

function redrawEdges() {
  for (const e of graph.edges) {
    const a = portEl(e.from.node, e.from.port, 'out');
    const b = portEl(e.to.node, e.to.port, 'in');
    if (a && b) e.el.setAttribute('d', curve(portPos(a), portPos(b)));
  }
}

on('edge-added', (edge) => {
  edge.el = svgEl('path', { class: 'edge' });
  edge.el.addEventListener('pointerdown', (e) => { e.stopPropagation(); select({ kind: 'edge', id: edge.id }); });
  wires.append(edge.el);
  redrawEdges();
});
on('edge-removed', (edge) => edge.el.remove());

function startConnect(e, dot) {
  if (e.button !== 0 || dot.dataset.dir !== 'out') return;
  e.stopPropagation();
  const from = { node: +dot.dataset.node, port: dot.dataset.port };
  const temp = svgEl('path', { class: 'temp' });
  wires.append(temp);
  const start = portPos(dot);
  let hot = null;

  const move = (ev) => {
    const w = world.getBoundingClientRect();
    temp.setAttribute('d', curve(start, { x: ev.clientX - w.left, y: ev.clientY - w.top }));
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = t && t.closest && t.closest('.port.in');
    if (hot && hot !== target) hot.classList.remove('hot');
    hot = target;
    if (hot) hot.classList.add('hot');
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    temp.remove();
    if (hot) {
      hot.classList.remove('hot');
      const to = { node: +hot.dataset.node, port: hot.dataset.port };
      if (to.node !== from.node) addEdge(from, to);
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ------------------------------------------------------------------ *
 * Selection, properties panel, panning, keyboard
 * ------------------------------------------------------------------ */
on('selection', (sel) => {
  graph.nodes.forEach((n) => n.el.classList.toggle('selected', !!sel && sel.kind === 'node' && sel.id === n.id));
  graph.edges.forEach((e) => e.el.classList.toggle('selected', !!sel && sel.kind === 'edge' && sel.id === e.id));
  delBtn.disabled = !sel;
  renderProps();
});

function renderProps() {
  const selection = getSelection();
  propsBody.replaceChildren();
  const hint = (text) => propsBody.append(h('p', { className: 'hint', textContent: text }));
  if (!selection) return hint('Select a block to see and edit its properties.');

  if (selection.kind === 'edge') {
    const e = graph.edges.find((e) => e.id === selection.id);
    if (!e) return hint('');
    const name = (end) => `${BLOCKS[graph.nodes.get(end.node).type].title} · ${end.port}`;
    propsBody.append(h('div', { className: 'props-head', textContent: 'Connection' }));
    propsBody.append(h('div', { className: 'kv' }, h('span', { textContent: 'From' }), h('b', { textContent: name(e.from) })));
    propsBody.append(h('div', { className: 'kv' }, h('span', { textContent: 'To' }), h('b', { textContent: name(e.to) })));
    return;
  }

  const node = graph.nodes.get(selection.id);
  const def = BLOCKS[node.type];
  const head = h('div', { className: 'props-head', textContent: def.title });
  head.style.setProperty('--cat', CATEGORIES[def.category]);
  propsBody.append(head, h('div', { className: 'props-cat', textContent: def.category }));
  if (!def.params.length) return hint('This block has no properties.');
  for (const p of def.params) propsBody.append(paramWidget(node, p));
}

delBtn.addEventListener('click', deleteSelection);

window.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
    e.preventDefault();
    deleteSelection();
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.node')) return;
  select(null);
  canvas.classList.add('panning');
  const sx = e.clientX, sy = e.clientY, ox = graph.pan.x, oy = graph.pan.y;
  const move = (ev) => setPan(ox + ev.clientX - sx, oy + ev.clientY - sy);
  const up = () => {
    canvas.classList.remove('panning');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

on('pan', () => {
  world.style.transform = `translate(${graph.pan.x}px, ${graph.pan.y}px)`;
  canvas.style.backgroundPosition = `${graph.pan.x}px ${graph.pan.y}px`;
});

/* ------------------------------------------------------------------ *
 * Run / stop
 * ------------------------------------------------------------------ */
function setStatus() {
  const on = engine.running;
  runBtn.textContent = on ? '■ Stop' : '▶ Run';
  runBtn.classList.toggle('running', on);
  statusEl.textContent = on ? `Running @ ${engine.ctx.sampleRate} Hz` : 'Stopped';
  statusEl.classList.toggle('on', on);
}

runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  try {
    if (engine.running) await engine.stop(); else await engine.start();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Audio error: ' + err.message;
    engine.ctx = null;
    runBtn.disabled = false;
    return;
  }
  runBtn.disabled = false;
  setStatus();
});

/* ------------------------------------------------------------------ *
 * Boot: restore the saved diagram, or load a starter flowgraph
 * ------------------------------------------------------------------ */
buildPalette();
window.addEventListener('resize', redrawEdges);

(function frame() {
  for (const node of graph.nodes.values()) {
    if (node.view) node.view.draw(engine.live.get(node.id));
  }
  requestAnimationFrame(frame);
})();

if (!restore()) {
  const gen  = addNode('wave_generator', 80, 90);
  const sink = addNode('audio_sink', 420, 120);
  addEdge({ node: gen.id,  port: 'out' }, { node: sink.id, port: 'in' });
  select(null);
}

// handle for the tests and for poking at the app from the browser console
window.dsplab = {
  BLOCKS, graph, engine, select,
  addNode, removeNode, addEdge, removeEdge, rebuildPorts, syncParams,
  redrawEdges, refreshSummary, serialize,
};

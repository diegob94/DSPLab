// Nodes: rendering a block as a draggable card with ports, a read-only summary of its key
// parameters and an optional live view (e.g. the oscilloscope screen).
import { BLOCKS, CATEGORIES } from '../blocks/index.js';
import { $, h } from '../dom.js';
import { on } from '../core/events.js';
import { portNames } from '../core/params.js';
import { graph, select, moveNode } from '../core/graph.js';
import { engine } from '../core/engine.js';
import { redrawEdges, startConnect } from './wires.js';

const world = $('#world');

export const fmt = (p, v) => p.unit ? `${v} ${p.unit}` : String(v);

export function refreshSummary(node) {
  for (const p of BLOCKS[node.type].params) {
    const out = node.el.querySelector(`[data-key="${p.key}"]`);
    if (out) out.textContent = fmt(p, node.params[p.key]);
  }
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

  // select + drag from anywhere on the card (ports stop their own pointerdown)
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select({ kind: 'node', id: node.id });
    const sx = e.clientX, sy = e.clientY, ox = node.x, oy = node.y;
    const move = (ev) => moveNode(node, ox + (ev.clientX - sx) / graph.zoom, oy + (ev.clientY - sy) / graph.zoom);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('dsplab:pinch', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('dsplab:pinch', up);   // a second finger starts a pinch instead
  });
  return el;
}

export function initNodes() {
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
  on('selection', (sel) => {
    graph.nodes.forEach((n) => n.el.classList.toggle('selected', !!sel && sel.kind === 'node' && sel.id === n.id));
  });
}

// redraw every node's live view each animation frame
export function startRenderLoop() {
  (function frame() {
    for (const node of graph.nodes.values()) {
      if (node.view) node.view.draw(engine.live.get(node.id));
    }
    requestAnimationFrame(frame);
  })();
}

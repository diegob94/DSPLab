// The diagram is autosaved to localStorage and restored on load.
import { BLOCKS } from '../blocks/index.js';
import { graph, addNode, addEdge, setView, select, hasPort } from './graph.js';
import { on } from './events.js';

const STORAGE_KEY = 'dsplab.diagram';
let restoring = false;
let saveTimer = null;

export function serialize() {
  return {
    version: 1,
    pan: { x: graph.pan.x, y: graph.pan.y },
    zoom: graph.zoom,
    nodes: [...graph.nodes.values()].map(({ id, type, x, y, params }) => ({ id, type, x, y, params })),
    edges: graph.edges.map(({ from, to }) => ({ from, to })),
  };
}

function saveNow() {
  clearTimeout(saveTimer);
  if (restoring) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize())); } catch (err) { /* storage unavailable or full */ }
}

function save() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 200);
}

for (const event of ['changed', 'param', 'moved', 'pan']) on(event, save);
window.addEventListener('pagehide', saveNow);

// returns false when there is nothing usable saved, so the caller can load the starter graph
export function restore() {
  let data;
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (err) { return false; }
  if (!data || data.version !== 1 || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return false;

  restoring = true;
  try {
    for (const n of data.nodes) {
      if (n && BLOCKS[n.type] && Number.isFinite(n.x) && Number.isFinite(n.y)) addNode(n.type, n.x, n.y, n);
    }
    for (const e of data.edges) {
      if (e && e.from && e.to && hasPort(e.from.node, e.from.port, 'out') && hasPort(e.to.node, e.to.port, 'in')) {
        addEdge({ node: e.from.node, port: e.from.port }, { node: e.to.node, port: e.to.port });
      }
    }
    if (data.pan && Number.isFinite(data.pan.x) && Number.isFinite(data.pan.y)) setView(data.pan.x, data.pan.y, Number.isFinite(data.zoom) ? data.zoom : 1);
  } finally {
    restoring = false;
  }
  select(null);
  return true;
}

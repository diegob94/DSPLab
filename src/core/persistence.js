// The diagram is autosaved to localStorage and restored on load.
import { BLOCKS } from '../blocks/index.js';
import { graph, addNode, addEdge, setView, select, hasPort, clearGraph } from './graph.js';
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

// Replaces the diagram with a saved one. Returns false (leaving the diagram alone) when the data
// is not usable. Saved data is never trusted: unknown blocks, bad numbers and dangling cables are dropped.
export function loadDiagram(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return false;

  restoring = true;
  try {
    clearGraph();
    for (const n of data.nodes) {
      if (n && BLOCKS[n.type] && Number.isFinite(n.x) && Number.isFinite(n.y)) addNode(n.type, n.x, n.y, n);
    }
    for (const e of data.edges) {
      if (e && e.from && e.to && hasPort(e.from.node, e.from.port, 'out') && hasPort(e.to.node, e.to.port, 'in')) {
        addEdge({ node: e.from.node, port: e.from.port }, { node: e.to.node, port: e.to.port });
      }
    }
    const pan = data.pan;
    if (pan && Number.isFinite(pan.x) && Number.isFinite(pan.y)) setView(pan.x, pan.y, Number.isFinite(data.zoom) ? data.zoom : 1);
    else setView(0, 0, 1);
  } finally {
    restoring = false;
  }
  select(null);
  saveNow();
  return true;
}

// returns false when there is nothing usable saved, so the caller can load the starter graph
export function restore() {
  let data;
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (err) { return false; }
  return loadDiagram(data);
}

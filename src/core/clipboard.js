// Copy / paste of blocks. The clipboard text is a diagram fragment (the same shape as a saved
// diagram), so it travels between tabs, browsers and machines like any text. Pasting anything
// that is not a diagram fragment does nothing; the contents are sanitized by addNode as on load.
import { BLOCKS } from '../blocks/index.js';
import { graph, addNode, addEdge, hasPort, selectNodes, selectedNodeIds } from './graph.js';
import { isDiagram } from './persistence.js';

const STEP = 24;   // each paste of the same text lands one grid step further, so copies don't hide each other
let last = { text: null, count: 0 };

// the selected blocks and the cables between them, as text; null when no block is selected
export function copyText() {
  const ids = new Set(selectedNodeIds());
  if (!ids.size) return null;
  return JSON.stringify({
    version: 1,
    nodes: [...graph.nodes.values()].filter((n) => ids.has(n.id)).map(({ id, type, x, y, params }) => ({ id, type, x, y, params })),
    edges: graph.edges.filter((e) => ids.has(e.from.node) && ids.has(e.to.node)).map(({ from, to }) => ({ from, to })),
  });
}

// adds the blocks of a copied fragment and selects them; returns false when the text is not usable
export function pasteText(text) {
  let data;
  try { data = JSON.parse(text); } catch (err) { return false; }
  if (!isDiagram(data)) return false;
  const nodes = data.nodes.filter((n) => n && BLOCKS[n.type] && Number.isFinite(n.x) && Number.isFinite(n.y));
  if (!nodes.length) return false;

  last = { text, count: last.text === text ? last.count + 1 : 1 };
  const shift = STEP * last.count;
  const ids = new Map();   // id in the fragment -> id of the new block
  for (const n of nodes) ids.set(n.id, addNode(n.type, n.x + shift, n.y + shift, { params: n.params }).id);
  for (const e of data.edges) {
    if (!e || !e.from || !e.to || !ids.has(e.from.node) || !ids.has(e.to.node)) continue;
    const from = { node: ids.get(e.from.node), port: e.from.port }, to = { node: ids.get(e.to.node), port: e.to.port };
    if (hasPort(from.node, from.port, 'out') && hasPort(to.node, to.port, 'in')) addEdge(from, to);
  }
  selectNodes([...ids.values()]);
  return true;
}

// Block palette: lists the blocks by category; drag one onto the canvas or double-click to add it.
import { BLOCKS, CATEGORIES } from '../blocks/index.js';
import { $, h } from '../dom.js';
import { graph, addNode } from '../core/graph.js';

const canvas = $('#canvas');

export function initPalette() {
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

  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', (e) => {
    const type = e.dataTransfer.getData('text/block');
    if (!BLOCKS[type]) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    addNode(type, e.clientX - r.left - graph.pan.x - 90, e.clientY - r.top - graph.pan.y - 14);
  });
}

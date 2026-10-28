// Properties panel: shows and edits the parameters of the selected block.
import { BLOCKS, CATEGORIES } from '../blocks/index.js';
import { $, h } from '../dom.js';
import { on } from '../core/events.js';
import { optionsOf } from '../core/params.js';
import { graph, getSelection, setParam, syncParams, rebuildPorts } from '../core/graph.js';
import { fmt } from './nodes.js';

const propsBody = $('#props-body');

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
    setParam(node, p.key, p.type === 'select' ? optionsOf(p, node.params)[input.selectedIndex] : fromSlider(parseFloat(input.value)));
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

export function initProperties() {
  on('selection', renderProps);
}

// Properties panel: shows and edits the parameters of the selected block.
import { BLOCKS, CATEGORIES } from '../blocks/index.js';
import { $, h } from '../dom.js';
import { on } from '../core/events.js';
import { optionsOf } from '../core/params.js';
import { graph, getSelection, setParam, syncParams, rebuildPorts, dataChanged } from '../core/graph.js';
import { clamp } from '../util.js';

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
  let input;
  if (p.type === 'select') {
    input = h('select', { id });
    optionsOf(p, node.params).forEach((o) => input.append(h('option', { value: o, textContent: o })));
  } else if (p.type === 'text') {
    input = h('input', { id, type: 'text', maxLength: p.maxLength || 100 });
  } else if (log) {
    input = h('input', { id, type: 'range', min: 0, max: 1, step: 0.001 });
  } else {
    input = h('input', { id, type: p.type, min: p.min, max: p.max, step: p.step });
  }
  input.value = toSlider(node.params[p.key]);
  wrap.append(input);

  // the exact value: shown under the slider, and typing one (Enter / leaving the field) sets it
  let number;
  if (p.type === 'range') {
    number = h('input', { type: 'number', min: p.min, max: p.max, step: p.step || 'any', value: node.params[p.key] });
    number.setAttribute('aria-label', `${p.label} value`);
    wrap.append(h('div', { className: 'val' }, number, h('span', { textContent: p.unit || '' })));
  }

  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('input', () => {
    const value = p.type === 'select' ? optionsOf(p, node.params)[input.selectedIndex]
      : p.type === 'text' ? input.value
      : fromSlider(parseFloat(input.value));
    setParam(node, p.key, value);
    if (number) number.value = node.params[p.key];
  });
  if (number) {
    number.addEventListener('pointerdown', (e) => e.stopPropagation());
    number.addEventListener('change', () => {
      const typed = parseFloat(number.value);
      // an empty or invalid entry goes back to the current value
      if (Number.isFinite(typed)) {
        const v = clamp(typed, p.min, p.max);
        setParam(node, p.key, p.step === 1 ? Math.round(v) : v);
        input.value = toSlider(node.params[p.key]);
      }
      number.value = node.params[p.key];
    });
  }
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

// a block's press-and-hold button (e.g. Record): the action runs while it is held. When it
// settles the model is told, so the live block can pick up the result
function actionButton(node, a) {
  const button = h('button', { className: 'action', type: 'button' });
  const refresh = () => { button.textContent = a.label(node); };
  refresh();
  const press = () => {
    const done = a.press(node);
    refresh();
    done.catch((err) => alert(`${a.label(node)}: ${err.message || err}`)).then(() => {
      dataChanged(node);
      const sel = getSelection();
      if (sel && sel.kind === 'node' && sel.id === node.id) renderProps();
    });
  };
  const release = () => a.release(node);
  button.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    button.setPointerCapture(e.pointerId);   // so the release is seen wherever the pointer ends up
    press();
  });
  for (const ev of ['pointerup', 'pointercancel']) button.addEventListener(ev, release);
  button.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); } });
  button.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') release(); });
  button.addEventListener('blur', release);
  return button;
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
  if (!def.params.length && !def.actions) return hint('This block has no properties.');
  for (const p of def.params) propsBody.append(paramWidget(node, p));
  for (const a of def.actions || []) propsBody.append(actionButton(node, a));
}

export function initProperties() {
  on('selection', renderProps);
}

// Help: a dialog listing the mouse and keyboard shortcuts, opened by the toolbar's Help button or "?".
import { $, h } from '../dom.js';

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = mac ? 'Cmd' : 'Ctrl';

const SHORTCUTS = [
  ['Add a block', 'Double-click it in the palette, or drag it onto the canvas'],
  ['Move a block', 'Drag it'],
  ['Connect blocks', 'Drag from an output port to an input port'],
  ['Select a block or cable', 'Click it'],
  ['Add / remove a block in the selection', 'Shift + click'],
  ['Select the blocks in a box', 'Shift + drag on the empty background'],
  [`Select all blocks`, `${MOD} + A`],
  ['Move the selected blocks', 'Drag any one of them'],
  ['Copy / cut / paste blocks', `${MOD} + C / ${MOD} + X / ${MOD} + V (also into another tab)`],
  ['Delete the selection', 'Delete or Backspace'],
  ['Pan the canvas', 'Drag the empty background'],
  ['Zoom the canvas', 'Mouse wheel, or pinch'],
  ['Deselect', 'Click the empty background'],
  ['Close this window', 'Esc'],
];

export function initHelp() {
  const rows = SHORTCUTS.map(([what, how]) => h('tr', {}, h('td', { textContent: what }), h('td', {}, h('kbd', { textContent: how }))));
  const dialog = h('dialog', { id: 'help', ariaLabel: 'Shortcuts' },
    h('h2', { textContent: 'Shortcuts' }),
    h('table', {}, h('tbody', {}, ...rows)),
    h('button', { id: 'help-close', type: 'button', textContent: 'Close' }));
  document.body.append(dialog);

  const open = () => { if (!dialog.open) dialog.showModal(); };
  $('#help-open').addEventListener('click', open);
  $('#help-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });   // the backdrop
  window.addEventListener('keydown', (e) => {
    if (e.key === '?' && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); open(); }
  });
}

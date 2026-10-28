// The canvas: panning by dragging the background, and the Delete key.
import { $ } from '../dom.js';
import { on } from '../core/events.js';
import { graph, select, setPan, deleteSelection } from '../core/graph.js';

const canvas = $('#canvas');
const world = $('#world');

export function initCanvas() {
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
}

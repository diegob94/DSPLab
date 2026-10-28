// The canvas: panning by dragging the background, zoom (pinch on touch screens, wheel with a
// mouse), and the Delete key. screen = pan + world * zoom.
import { $ } from '../dom.js';
import { on } from '../core/events.js';
import { graph, select, setView, deleteSelection, MIN_ZOOM, MAX_ZOOM } from '../core/graph.js';

const canvas = $('#canvas');
const world = $('#world');
const GRID = 24;
const clampZoom = (z) => Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);

export function initCanvas() {
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
      e.preventDefault();
      deleteSelection();
    }
  });

  // keep `p` (a point in canvas coordinates) fixed on screen while the zoom changes
  const zoomAbout = (p, zoom) => {
    zoom = clampZoom(zoom);
    const k = zoom / graph.zoom;
    setView(p.x - (p.x - graph.pan.x) * k, p.y - (p.y - graph.pan.y) * k, zoom);
  };
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // pan: one pointer on the background
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.node')) return;
    select(null);
    canvas.classList.add('panning');
    const sx = e.clientX, sy = e.clientY, ox = graph.pan.x, oy = graph.pan.y;
    const move = (ev) => setView(ox + ev.clientX - sx, oy + ev.clientY - sy, graph.zoom);
    const up = () => {
      canvas.classList.remove('panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('dsplab:pinch', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('dsplab:pinch', up);
  });

  // pinch: two pointers anywhere on the canvas (also on blocks). Seen in the capture phase so
  // that blocks stopping their pointerdown don't hide the second finger.
  const pointers = new Map();
  let pinch = null;
  const measure = () => {
    const [a, b] = [...pointers.values()];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;   // a mouse has one pointer; it zooms with the wheel
    pointers.set(e.pointerId, local(e));
    if (pointers.size < 2) return;
    e.stopPropagation();                      // the extra finger must not start a drag of its own
    if (pointers.size > 2) return;
    window.dispatchEvent(new Event('dsplab:pinch'));   // cancels any drag in progress
    const m = measure();
    pinch = {
      dist: m.dist, zoom: graph.zoom,
      anchor: { x: (m.mid.x - graph.pan.x) / graph.zoom, y: (m.mid.y - graph.pan.y) / graph.zoom },
    };
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (!pinch || pointers.size !== 2) return;
    const m = measure();
    // zoom by the change of finger distance, keep the world point under the fingers' midpoint
    const zoom = clampZoom(pinch.zoom * m.dist / pinch.dist);
    setView(m.mid.x - pinch.anchor.x * zoom, m.mid.y - pinch.anchor.y * zoom, zoom);
  });
  const lift = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);

  // mouse wheel: zoom about the cursor
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAbout(local(e), graph.zoom * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  on('pan', () => {
    const { pan, zoom } = graph;
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    canvas.style.backgroundPosition = `${pan.x}px ${pan.y}px`;
    canvas.style.backgroundSize = `${GRID * zoom}px ${GRID * zoom}px`;
  });
}

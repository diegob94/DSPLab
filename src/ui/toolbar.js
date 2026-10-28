// Toolbar: Run / Stop, Delete selected, and the audio status.
import { $ } from '../dom.js';
import { on } from '../core/events.js';
import { deleteSelection } from '../core/graph.js';
import { engine } from '../core/engine.js';

const runBtn = $('#run');
const delBtn = $('#delete');
const statusEl = $('#status');

function setStatus() {
  const running = engine.running;
  runBtn.textContent = running ? '■ Stop' : '▶ Run';
  runBtn.classList.toggle('running', running);
  statusEl.textContent = running ? `Running @ ${engine.ctx.sampleRate} Hz` : 'Stopped';
  statusEl.classList.toggle('on', running);
}

// On narrow screens the palette and the properties panel are drawers; at most one is open.
function initDrawers() {
  const toggles = { palette: $('#show-palette'), props: $('#show-props') };
  const show = (which) => {
    for (const [name, btn] of Object.entries(toggles)) {
      const open = name === which;
      document.body.classList.toggle('show-' + name, open);
      btn.classList.toggle('active', open);
    }
  };
  for (const [name, btn] of Object.entries(toggles)) {
    btn.addEventListener('click', () => show(document.body.classList.contains('show-' + name) ? null : name));
  }
  // tapping the canvas background or adding a block gets the drawer out of the way
  $('#canvas').addEventListener('pointerdown', (e) => { if (!e.target.closest('.node')) show(null); });
  on('node-added', () => show(null));
}

export function initToolbar() {
  initDrawers();
  delBtn.addEventListener('click', deleteSelection);
  on('selection', (sel) => { delBtn.disabled = !sel; });

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    try {
      if (engine.running) await engine.stop(); else await engine.start();
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Audio error: ' + err.message;
      engine.ctx = null;
      runBtn.disabled = false;
      return;
    }
    runBtn.disabled = false;
    setStatus();
  });
}

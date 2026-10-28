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

export function initToolbar() {
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

// The "locked" indicator shared by the PLL blocks: a ui() view with a led that is lit while inst.locked is true.
import { h } from '../dom.js';

export function lockLed() {
  const dot = h('span', { className: 'led' });
  const text = h('span', { textContent: 'Unlocked' });
  const el = h('div', { className: 'lock-led' }, dot, text);
  let shown = null;
  return {
    el,
    draw(inst) {
      const locked = !!(inst && inst.locked);
      if (locked === shown) return;
      shown = locked;
      dot.classList.toggle('on', locked);
      text.textContent = locked ? 'Locked' : 'Unlocked';
    },
  };
}

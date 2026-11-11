import { streamOutput, parseBytes } from './stream.js';

// Like the Strobe Source but the array[uint8] of bytes goes out only once, when the audio starts, and again
// whenever the data is edited.
export const constantSource = {
  title: 'Constant Source',
  category: 'Source blocks',
  inputs: [],
  outputs: ['out'],
  asyncPorts: ['out'],
  wireTypes: { out: 'array[uint8]' },
  params: [
    { key: 'type', label: 'Type', type: 'select', options: ['text', 'hex'], default: 'text' },
    { key: 'data', label: 'Data', show: true, type: 'text', default: 'hello' },
  ],
  build(ctx, p) {
    const out = streamOutput();
    let key = `${p.type}\u0000${p.data}`;
    const send = (type, data) => { const bytes = parseBytes(type, data); if (bytes.length) out.send(Object.freeze(bytes)); };
    // the engine wires the cables after building every block, so the first send waits until that is done
    const first = setTimeout(() => send(p.type, p.data), 0);
    return {
      outputs: { out },
      update(next) {
        const nextKey = `${next.type}\u0000${next.data}`;
        if (nextKey === key) return;
        key = nextKey;
        send(next.type, next.data);
      },
      dispose() { clearTimeout(first); out.disconnect(); },
    };
  },
};

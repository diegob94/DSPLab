import { messageOutput, textToBits, bytesToBits, hexToBytes, freezeBits } from './message.js';

// The message a Message Constant holds: text as 8 x N; hex bytes as 8 x N too (so 'FF' joins with text);
// or bits as 1 x N (anything but 0 and 1 is ignored, so '1011 0111' works). null when it would be empty.
export function constantMessage(type, value) {
  if (type === 'hex') {
    const bytes = hexToBytes(value);
    return bytes.length ? bytesToBits(bytes) : null;
  }
  if (type === 'bits') {
    const bits = [...value].filter((c) => c === '0' || c === '1').map(Number);
    return bits.length ? freezeBits([bits]) : null;
  }
  return value ? textToBits(value) : null;
}

// A fixed message, sent once when the audio starts and again whenever it is edited. It is meant for blocks
// that remember their input, like the `a` input of Message Concatenate (a preamble).
export const messageConstant = {
  title: 'Message Constant',
  category: 'Message blocks',
  inputs: [],
  outputs: ['msg'],
  messagePorts: ['msg'],
  constantMessage,
  params: [
    { key: 'type',    label: 'Type',    show: true, type: 'select', options: ['text', 'hex', 'bits'], default: 'text' },
    { key: 'message', label: 'Message', show: true, type: 'text', default: 'hello' },
  ],
  build(ctx, p) {
    const msg = messageOutput();
    let current = constantMessage(p.type, p.message);
    let shown = `${p.type}\u0000${p.message}`;
    // the engine wires the cables after building every block, so send once that is done
    const first = setTimeout(() => current && msg.send(current), 0);
    return {
      outputs: { msg },
      update(p) {
        const key = `${p.type}\u0000${p.message}`;
        if (key === shown) return;
        shown = key;
        current = constantMessage(p.type, p.message);
        if (current) msg.send(current);
      },
      dispose() { clearTimeout(first); msg.disconnect(); },
    };
  },
};

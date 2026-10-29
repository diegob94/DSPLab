// Message ports: discrete events travelling on their own cables, apart from the audio.
// A message output has the same connect() as an AudioNode, so the engine wires both kinds alike;
// a message input is any object with receive(msg).
export function messageOutput() {
  const targets = new Set();
  return {
    connect(target) { targets.add(target); },
    disconnect() { targets.clear(); },
    send(msg) { targets.forEach((t) => t.receive(msg)); },
  };
}

// The message format: a 2-D array of bits, rows x columns (m[row][col], every entry 0 or 1).
// Messages are shared by every block they reach, so they are frozen: build a new one instead of editing.
// Text travels as 8 x N: one column per byte of its UTF-8, most significant bit in row 0.
export const freezeBits = (rows) => Object.freeze(rows.map((r) => Object.freeze(r)));

// A 1 x 1 message: one symbol.
export const bitMessage = (b) => freezeBits([[b]]);

export const isBits = (m) => Array.isArray(m) && m.length > 0 && Array.isArray(m[0]) && m[0].length > 0
  && m.every((row) => Array.isArray(row) && row.length === m[0].length && row.every((b) => b === 0 || b === 1));

export const shapeOf = (m) => `${m.length}x${m[0].length}`;

export function textToBits(text) {
  const bytes = new TextEncoder().encode(text);
  return freezeBits(Array.from({ length: 8 }, (_, i) => Array.from(bytes, (b) => (b >> (7 - i)) & 1)));
}

export const isByteMessage = (m) => isBits(m) && m.length === 8;

// m must satisfy isByteMessage
export function bitsToText(m) {
  const bytes = Uint8Array.from({ length: m[0].length }, (_, j) => m.reduce((v, row) => (v << 1) | row[j], 0));
  return new TextDecoder().decode(bytes);
}

// numpy.reshape in row-major order; one of rows / cols may be -1 (worked out from the other).
// Returns null when the bits don't fit the new shape.
export function reshape(m, rows, cols) {
  const flat = m.flat();
  const total = flat.length;
  if (rows === -1 && cols > 0 && total % cols === 0) rows = total / cols;
  else if (cols === -1 && rows > 0 && total % rows === 0) cols = total / rows;
  if (!(rows > 0 && cols > 0 && rows * cols === total)) return null;
  return freezeBits(Array.from({ length: rows }, (_, i) => flat.slice(i * cols, (i + 1) * cols)));
}

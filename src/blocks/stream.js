// Asynchronous-clock ports: a signal whose samples are not tied to the audio sample rate but come at
// their own instants (one per symbol, say). The samples are plain numbers (bits, 0 or 1).
// An async output has the same connect() as an AudioNode, so the engine wires both clocks alike;
// an async input is any object with receive(sample).
export function streamOutput() {
  const targets = new Set();
  return {
    connect(target) { targets.add(target); },
    disconnect() { targets.clear(); },
    send(sample) { targets.forEach((t) => t.receive(sample)); },
  };
}

export const isBit = (b) => b === 0 || b === 1;

// bytes -> bits in transmission order, most significant bit first
export const bytesToBits = (bytes) => Array.from(bytes, (b) => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1)).flat();

export const textToBits = (text) => bytesToBits(new TextEncoder().encode(text));

// 'AA 55' or '0xAA 0x55' -> [0xAA, 0x55]: 0x prefixes and anything that isn't a hex digit are ignored,
// and a last lone digit is dropped
export function hexToBytes(hex) {
  const digits = [...hex.replace(/0x/gi, ' ')].filter((c) => /[0-9a-fA-F]/.test(c)).join('');
  return Array.from({ length: digits.length >> 1 }, (_, i) => parseInt(digits.slice(2 * i, 2 * i + 2), 16));
}

// The bytes a text field stands for, as an array of ints: text (UTF-8) or hex.
export const parseBytes = (type, value) => (type === 'hex' ? hexToBytes(value) : Array.from(new TextEncoder().encode(value)));

// The bits a text field stands for: text (UTF-8), hex bytes, or bits as typed (anything but 0 and 1 is ignored,
// so '1011 0111' works).
export function parseBits(type, value) {
  if (type === 'bits') return [...value].filter((c) => c === '0' || c === '1').map(Number);
  if (type === 'hex') return bytesToBits(hexToBytes(value));
  return value ? textToBits(value) : [];
}

// bits (a multiple of 8) -> text; most significant bit first
export function bitsToText(bits) {
  const bytes = Uint8Array.from({ length: bits.length >> 3 }, (_, k) => bits.slice(8 * k, 8 * k + 8).reduce((v, b) => (v << 1) | b, 0));
  return new TextDecoder().decode(bytes);
}

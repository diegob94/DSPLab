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

// 'AA 55' or '0xAA 0x55' -> [0xAA, 0x55]: 0x prefixes and anything that isn't a hex digit are ignored,
// and a last lone digit is dropped
export function hexToBytes(hex) {
  const digits = [...hex.replace(/0x/gi, ' ')].filter((c) => /[0-9a-fA-F]/.test(c)).join('');
  return Array.from({ length: digits.length >> 1 }, (_, i) => parseInt(digits.slice(2 * i, 2 * i + 2), 16));
}

// The bytes a text field stands for, as an array of uint8 (0..255): text (UTF-8) or hex.
export const parseBytes = (type, value) => (type === 'hex' ? hexToBytes(value) : Array.from(new TextEncoder().encode(value)));

// The type of a sample on an async wire, worked out from the value: 'int', 'array[uint8]', 'array[int8]', 'array[int]', 'array[float]'...
export function sampleType(s) {
  if (Number.isInteger(s)) return 'int';
  if (typeof s === 'number') return 'float';
  if (Array.isArray(s)) {
    const kinds = new Set(s.map(sampleType));
    if (!kinds.size) return 'array[]';
    if (kinds.size === 1) {
      const k = [...kinds][0];
      if (k !== 'int') return `array[${k}]`;
      if (s.every((v) => v >= 0 && v <= 255)) return 'array[uint8]';
      return s.every((v) => v >= -128 && v <= 127) ? 'array[int8]' : 'array[int]';
    }
    return 'array[mixed]';
  }
  return s === null ? 'null' : typeof s;
}

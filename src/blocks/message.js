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

// Sharing a diagram as a link: the diagram JSON, without the parameters that still have their
// default (loadDiagram restores them), deflate-compressed and base64url-encoded into the URL fragment.
// The fragment is never sent to a server, so this works on any static host.
import { BLOCKS } from '../blocks/index.js';
import { serialize } from './persistence.js';

const KEY = 'd=';

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// the diagram without parameters equal to their default
function slim(diagram) {
  const nodes = diagram.nodes.map((n) => {
    const defs = BLOCKS[n.type].params;
    const params = {};
    for (const p of defs) if (n.params[p.key] !== p.default) params[p.key] = n.params[p.key];
    return { ...n, params };
  });
  return { ...diagram, nodes };
}

export async function encodeDiagram(diagram = serialize()) {
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(slim(diagram))), new CompressionStream('deflate-raw'));
  return toBase64Url(bytes);
}

// -> the parsed diagram, or null when the text is not something we produced (the caller still validates it)
export async function decodeDiagram(text) {
  try {
    const bytes = await pipe(fromBase64Url(text), new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (err) {
    return null;
  }
}

export async function shareUrl() {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#${KEY}${await encodeDiagram()}`;
}

// the encoded diagram in a URL hash ("#d=..."), or null when there is none
export function diagramFromHash(hash = window.location.hash) {
  const h = hash.replace(/^#/, '');
  return h.startsWith(KEY) ? h.slice(KEY.length) : null;
}

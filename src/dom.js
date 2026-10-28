export const $ = (sel) => document.querySelector(sel);

const SVG_NS = 'http://www.w3.org/2000/svg';
export const svgEl = (name, attrs = {}) => {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
export const h = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// Narrow screens (phones): the palette and properties become drawers and a tap replaces drag & drop.
// Keep in sync with the media query in styles.css.
export const NARROW = window.matchMedia('(max-width: 760px), (max-height: 500px)');

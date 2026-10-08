type Child = Node | string | null | undefined | false;

/** Tiny element builder: h('div', { class: 'x', onclick }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

export function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** An inline eighth-note glyph. */
export function noteGlyph(cls = ''): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 32');
  svg.setAttribute('class', `glyph ${cls}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<ellipse cx="9" cy="25" rx="6.6" ry="4.8" transform="rotate(-22 9 25)"/>' +
    '<rect x="14" y="4" width="2.2" height="21" rx="1"/>' +
    '<path d="M16 4c1 4.5 7 6 6.4 12.5-.3-3.6-3.2-6-6.4-6.4z"/>';
  return svg;
}

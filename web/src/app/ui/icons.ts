// Every icon in the app, as SVG tags: Lucide icons (ISC) plus the status
// glyphs. Each call returns a fresh <svg>, so one can sit in many places.
// Functions only: nothing here touches the DOM until an icon is built.
import van from 'vanjs-core';
import type { Status } from '../board/model.ts';

const NS = 'http://www.w3.org/2000/svg';
const tags = () => van.tags(NS);

const LUCIDE = {
  width: '24',
  height: '24',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};

export type Icon = () => SVGSVGElement;

// Builds an icon from the SVG tag functions: `draw(({ svg, path }) => svg(...))`.
const draw =
  (build: (t: ReturnType<typeof tags>) => Element): Icon =>
  () =>
    build(tags()) as SVGSVGElement;

export const icons: Record<
  | 'board'
  | 'explorer'
  | 'plus'
  | 'group'
  | 'settings'
  | 'search'
  | 'close'
  | 'check'
  | 'theme'
  | 'font'
  | 'size'
  | 'sound'
  | 'keybinding'
  | 'boardPage'
  | 'info'
  | 'back'
  | 'forward'
  | 'edit'
  | 'preview'
  | 'collapse'
  | 'folder'
  | 'boardOnboarding'
  | 'arrowUpRight'
  | 'expand'
  | 'chevronDown'
  | 'trash'
  | 'more'
  | 'tag'
  | 'chevronRight',
  Icon
> = {
  board: draw(({ path, rect, svg }) =>
    svg(
      { ...LUCIDE },
      rect({ width: '18', height: '18', x: '3', y: '3', rx: '2' }),
      path({ d: 'M9 3v12' }),
      path({ d: 'M15 3v7' }),
    ),
  ),
  explorer: draw(({ path, rect, svg }) =>
    svg({ ...LUCIDE }, rect({ width: '18', height: '18', x: '3', y: '3', rx: '2' }), path({ d: 'M9 3v18' })),
  ),
  plus: draw(({ path, svg }) => svg({ ...LUCIDE }, path({ d: 'M5 12h14' }), path({ d: 'M12 5v14' }))),
  group: draw(({ path, rect, svg }) =>
    svg(
      { ...LUCIDE },
      path({ d: 'M3 7V5c0-1.1.9-2 2-2h2' }),
      path({ d: 'M17 3h2c1.1 0 2 .9 2 2v2' }),
      path({ d: 'M21 17v2c0 1.1-.9 2-2 2h-2' }),
      path({ d: 'M7 21H5c-1.1 0-2-.9-2-2v-2' }),
      rect({ width: '7', height: '5', x: '7', y: '7', rx: '1' }),
      rect({ width: '7', height: '5', x: '10', y: '12', rx: '1' }),
    ),
  ),
  settings: draw(({ circle, path, svg }) =>
    svg(
      { ...LUCIDE },
      path({
        d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
      }),
      circle({ cx: '12', cy: '12', r: '3' }),
    ),
  ),
  search: draw(({ circle, path, svg }) =>
    svg({ ...LUCIDE }, circle({ cx: '11', cy: '11', r: '8' }), path({ d: 'm21 21-4.3-4.3' })),
  ),
  tag: draw(({ circle, path, svg }) =>
    svg(
      { ...LUCIDE },
      path({
        d: 'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z',
      }),
      circle({ cx: '7.5', cy: '7.5', r: '.5', fill: 'currentColor' }),
    ),
  ),
  chevronRight: draw(({ path, svg }) => svg({ ...LUCIDE }, path({ d: 'm9 18 6-6-6-6' }))),
  more: draw(({ circle, svg }) =>
    svg(
      { ...LUCIDE },
      circle({ cx: '5', cy: '12', r: '1' }),
      circle({ cx: '12', cy: '12', r: '1' }),
      circle({ cx: '19', cy: '12', r: '1' }),
    ),
  ),
  trash: draw(({ path, svg }) =>
    svg(
      { ...LUCIDE },
      path({ d: 'M3 6h18' }),
      path({ d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' }),
      path({ d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' }),
    ),
  ),
  chevronDown: draw(({ path, svg }) => svg({ ...LUCIDE }, path({ d: 'm6 9 6 6 6-6' }))),
  expand: draw(({ path, svg }) =>
    svg(
      { ...LUCIDE },
      path({ d: 'M15 3h6v6' }),
      path({ d: 'M9 21H3v-6' }),
      path({ d: 'm21 3-7 7' }),
      path({ d: 'm3 21 7-7' }),
    ),
  ),
  close: draw(({ path, svg }) => svg({ ...LUCIDE }, path({ d: 'M18 6 6 18' }), path({ d: 'm6 6 12 12' }))),
  check: draw(({ path, svg }) => svg({ ...LUCIDE }, path({ d: 'M20 6 9 17l-5-5' }))),
  theme: draw(({ circle, path, svg }) =>
    svg(
      { ...LUCIDE },
      path({
        d: 'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z',
      }),
      circle({ cx: '13.5', cy: '6.5', r: '.5', fill: 'currentColor' }),
      circle({ cx: '17.5', cy: '10.5', r: '.5', fill: 'currentColor' }),
      circle({ cx: '6.5', cy: '12.5', r: '.5', fill: 'currentColor' }),
      circle({ cx: '8.5', cy: '7.5', r: '.5', fill: 'currentColor' }),
    ),
  ),
  font: draw(({ path, svg }) =>
    svg(
      { ...LUCIDE },
      path({ d: 'M12 4v16' }),
      path({ d: 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2' }),
      path({ d: 'M9 20h6' }),
    ),
  ),
  size: draw(({ path, svg }) =>
    svg(
      { ...LUCIDE },
      path({ d: 'm15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16' }),
      path({ d: 'M15.697 14h5.606' }),
      path({ d: 'm2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16' }),
      path({ d: 'M3.304 13h6.392' }),
    ),
  ),
  sound: draw(({ path, rect, svg }) =>
    svg(
      { ...LUCIDE },
      path({ d: 'M10 8h.01' }),
      path({ d: 'M12 12h.01' }),
      path({ d: 'M14 8h.01' }),
      path({ d: 'M16 12h.01' }),
      path({ d: 'M18 8h.01' }),
      path({ d: 'M6 8h.01' }),
      path({ d: 'M7 16h10' }),
      path({ d: 'M8 12h.01' }),
      rect({ width: '20', height: '16', x: '2', y: '4', rx: '2' }),
    ),
  ),
  keybinding: draw(({ path, svg }) =>
    svg({ ...LUCIDE }, path({ d: 'M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3' })),
  ),
  boardPage: draw(({ path, rect, svg }) =>
    svg(
      { ...LUCIDE },
      rect({ width: '18', height: '18', x: '3', y: '3', rx: '2' }),
      path({ d: 'M8 7v7' }),
      path({ d: 'M12 7v4' }),
      path({ d: 'M16 7v9' }),
    ),
  ),
  back: draw(({ path, svg }) => svg({ ...LUCIDE }, path({ d: 'm12 19-7-7 7-7' }), path({ d: 'M19 12H5' }))),
  forward: draw(({ path, svg }) => svg({ ...LUCIDE }, path({ d: 'M5 12h14' }), path({ d: 'm12 5 7 7-7 7' }))),
  info: draw(({ circle, path, svg }) =>
    svg({ ...LUCIDE }, circle({ cx: '12', cy: '12', r: '10' }), path({ d: 'M12 16v-4' }), path({ d: 'M12 8h.01' })),
  ),
  edit: draw(({ path, svg }) =>
    svg(
      { ...LUCIDE, 'aria-hidden': 'true' },
      path({
        d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
      }),
      path({ d: 'm15 5 4 4' }),
    ),
  ),
  preview: draw(({ circle, path, svg }) =>
    svg(
      { ...LUCIDE, 'aria-hidden': 'true' },
      path({
        d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
      }),
      circle({ cx: '12', cy: '12', r: '3' }),
    ),
  ),
  collapse: draw(({ path, rect, svg }) =>
    svg(
      { ...LUCIDE, 'aria-hidden': 'true' },
      rect({ width: '18', height: '18', x: '3', y: '3', rx: '2' }),
      path({ d: 'M15 3v18' }),
      path({ d: 'm8 9 3 3-3 3' }),
    ),
  ),
  folder: draw(({ path, svg }) =>
    svg(
      {
        viewBox: '0 0 24 24',
        width: '12',
        height: '12',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      },
      path({
        d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
      }),
    ),
  ),
  boardOnboarding: draw(({ path, rect, svg }) =>
    svg(
      {
        viewBox: '0 0 24 24',
        width: '16',
        height: '16',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      },
      rect({ width: '18', height: '18', x: '3', y: '3', rx: '2' }),
      path({ d: 'M9 3v12' }),
      path({ d: 'M15 3v7' }),
    ),
  ),
  arrowUpRight: draw(({ path, svg }) =>
    svg(
      {
        viewBox: '0 0 24 24',
        width: '14',
        height: '14',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      },
      path({ d: 'M7 7h10v10' }),
      path({ d: 'M7 17 17 7' }),
    ),
  ),
};

const GLYPH = { viewBox: '0 0 14 14', width: '14', height: '14', 'aria-hidden': 'true' };

// Linear-style status glyphs, drawn in currentColor (needs input is coloured
// by CSS).
export const glyph = (status: Status): SVGSVGElement => drawGlyph(status) as SVGSVGElement;

function drawGlyph(status: Status): Element {
  const { svg, circle, path } = tags();
  const ring = (extra: Record<string, string> = {}) =>
    circle({ cx: '7', cy: '7', r: '5.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', ...extra });
  const disc = () => circle({ cx: '7', cy: '7', r: '6', fill: 'currentColor' });
  switch (status) {
    case 'backlog':
      return svg(GLYPH, ring({ 'stroke-dasharray': '2.2 2' }));
    case 'in_progress':
      return svg(GLYPH, ring(), path({ d: 'M7 3.5a3.5 3.5 0 0 1 0 7z', fill: 'currentColor' }));
    case 'needs_input':
      return svg(GLYPH, disc());
    case 'completed':
      return svg(
        GLYPH,
        disc(),
        path({
          d: 'M4.4 7.2l1.8 1.8 3.4-3.7',
          fill: 'none',
          stroke: 'var(--background)',
          'stroke-width': '1.5',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      );
    case 'archived':
      return svg(
        GLYPH,
        ring(),
        path({ d: 'M4.5 7h5', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' }),
      );
  }
}

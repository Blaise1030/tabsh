// Every icon in the app, as SVG tags: Lucide icons (ISC), the agents' marks
// (Simple Icons, CC0) and the status glyphs. Each call returns a fresh <svg>, so one can sit in many places.
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

// A filled mark, for the agents' logos.
const BRAND = { width: '24', height: '24', viewBox: '0 0 24 24', fill: 'currentColor' };

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
  | 'listFilter'
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
  | 'agent'
  | 'info'
  | 'back'
  | 'forward'
  | 'edit'
  | 'preview'
  | 'collapse'
  | 'folder'
  | 'rows'
  | 'boardOnboarding'
  | 'arrowUpRight'
  | 'expand'
  | 'arrowRightToLine'
  | 'chevronDown'
  | 'trash'
  | 'more'
  | 'tag'
  | 'chevronRight'
  | 'paperclip'
  | 'shrink'
  | 'claude'
  | 'openai'
  | 'gemini',
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
  // The board's list layout (Lucide's rows-3).
  rows: draw(({ path, rect, svg }) =>
    svg(
      { ...LUCIDE },
      rect({ width: '18', height: '18', x: '3', y: '3', rx: '2' }),
      path({ d: 'M21 9H3' }),
      path({ d: 'M21 15H3' }),
    ),
  ),
  explorer: draw(({ path, rect, svg }) =>
    svg({ ...LUCIDE }, rect({ width: '18', height: '18', x: '3', y: '3', rx: '2' }), path({ d: 'M9 3v18' })),
  ),
  arrowRightToLine: draw(({ path, svg }) =>
    svg({ ...LUCIDE }, path({ d: 'M17 12H3' }), path({ d: 'm11 18 6-6-6-6' }), path({ d: 'M21 5v14' })),
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
  listFilter: draw(({ path, svg }) =>
    svg({ ...LUCIDE }, path({ d: 'M2 5h20' }), path({ d: 'M6 12h12' }), path({ d: 'M9 19h6' })),
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
  shrink: draw(({ path, svg }) =>
    svg(
      { ...LUCIDE },
      path({ d: 'm14 10 7-7' }),
      path({ d: 'M20 10h-6V4' }),
      path({ d: 'm3 21 7-7' }),
      path({ d: 'M4 14h6v6' }),
    ),
  ),
  paperclip: draw(({ path, svg }) =>
    svg(
      { ...LUCIDE },
      path({
        d: 'm16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551',
      }),
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
  claude: draw(({ path, svg }) =>
    svg(
      { ...BRAND, fill: '#D97757' },
      path({
        d: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
      }),
    ),
  ),
  openai: draw(({ path, svg }) =>
    svg(
      { ...BRAND },
      path({
        d: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
      }),
    ),
  ),
  gemini: draw(({ path, svg }) =>
    svg(
      { ...BRAND, fill: '#4796E3' },
      path({
        d: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
      }),
    ),
  ),
  agent: draw(({ path, svg }) => svg({ ...LUCIDE }, path({ d: 'm4 17 6-6-6-6' }), path({ d: 'M12 19h8' }))),
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
// by CSS). Needs input is Lucide's circle-question-mark.
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
      return svg(
        {
          ...GLYPH,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
        circle({ cx: '12', cy: '12', r: '10' }),
        path({ d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }),
        path({ d: 'M12 17h.01' }),
      );
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

// A provider's icon, by the program its command runs: the agent's mark when
// we know it, else a prompt.
export function providerIcon(command: string): Icon {
  const program = command.trim().split(/\s+/)[0]?.split('/').pop() ?? '';
  return { claude: icons.claude, codex: icons.openai, gemini: icons.gemini }[program] ?? icons.agent;
}

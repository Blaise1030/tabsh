// Every icon in the app, as SVG elements: Lucide icons (ISC), the agents' marks
// (Simple Icons, CC0) and the status glyphs. Each call returns a fresh <svg>, so one can sit in many places.
// Functions only: nothing here touches the DOM until an icon is built.
import type { JSX } from 'solid-js';
import type { Status } from '../board/model.ts';

// A DOM node, not just JSX: VanJS views still put icons in their tags.
export type Icon = () => SVGSVGElement;

// A Lucide icon: the 24-unit grid, stroked in currentColor.
const lucide =
  (draw: () => JSX.Element, { size = '24', hidden = false } = {}): Icon =>
  () => {
    const parts = draw();
    const svg = (
      // biome-ignore lint/a11y/noSvgWithoutTitle: an icon; its button or row names it
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden={hidden ? 'true' : undefined}
      >
        {parts}
      </svg>
    );
    return svg as SVGSVGElement;
  };

// A filled mark, for the agents' logos.
const brand =
  (d: string, fill = 'currentColor'): Icon =>
  () => {
    const svg = (
      // biome-ignore lint/a11y/noSvgWithoutTitle: an icon; its button or row names it
      <svg width="24" height="24" viewBox="0 0 24 24" fill={fill}>
        <path d={d} />
      </svg>
    );
    return svg as SVGSVGElement;
  };

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
  | 'circleCheck'
  | 'circleX'
  | 'theme'
  | 'font'
  | 'size'
  | 'sound'
  | 'keybinding'
  | 'boardPage'
  | 'agent'
  | 'shield'
  | 'shieldOff'
  | 'map'
  | 'bot'
  | 'info'
  | 'activity'
  | 'back'
  | 'forward'
  | 'edit'
  | 'preview'
  | 'send'
  | 'messageSquarePlus'
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
  | 'stop'
  | 'clipboardPaste'
  | 'shrink'
  | 'claude'
  | 'openai'
  | 'gemini'
  | 'cursor',
  Icon
> = {
  board: lucide(() => (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v12" />
      <path d="M15 3v7" />
    </>
  )),
  // The board's list layout (Lucide's rows-3).
  rows: lucide(() => (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M21 9H3" />
      <path d="M21 15H3" />
    </>
  )),
  explorer: lucide(() => (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </>
  )),
  arrowRightToLine: lucide(() => (
    <>
      <path d="M17 12H3" />
      <path d="m11 18 6-6-6-6" />
      <path d="M21 5v14" />
    </>
  )),
  plus: lucide(() => (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  )),
  group: lucide(() => (
    <>
      <path d="M3 7V5c0-1.1.9-2 2-2h2" />
      <path d="M17 3h2c1.1 0 2 .9 2 2v2" />
      <path d="M21 17v2c0 1.1-.9 2-2 2h-2" />
      <path d="M7 21H5c-1.1 0-2-.9-2-2v-2" />
      <rect width="7" height="5" x="7" y="7" rx="1" />
      <rect width="7" height="5" x="10" y="12" rx="1" />
    </>
  )),
  listFilter: lucide(() => (
    <>
      <path d="M2 5h20" />
      <path d="M6 12h12" />
      <path d="M9 19h6" />
    </>
  )),
  settings: lucide(() => (
    <>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </>
  )),
  search: lucide(() => (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  )),
  tag: lucide(() => (
    <>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  )),
  chevronRight: lucide(() => <path d="m9 18 6-6-6-6" />),
  more: lucide(() => (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  )),
  trash: lucide(() => (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </>
  )),
  chevronDown: lucide(() => <path d="m6 9 6 6 6-6" />),
  expand: lucide(() => (
    <>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="m21 3-7 7" />
      <path d="m3 21 7-7" />
    </>
  )),
  shrink: lucide(() => (
    <>
      <path d="m14 10 7-7" />
      <path d="M20 10h-6V4" />
      <path d="m3 21 7-7" />
      <path d="M4 14h6v6" />
    </>
  )),
  paperclip: lucide(() => (
    <path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />
  )),
  // Lucide Square — media-style stop.
  stop: lucide(() => <rect width="14" height="14" x="5" y="5" rx="2" />),
  clipboardPaste: lucide(() => (
    <>
      <path d="M11 14h10" />
      <path d="M16 4h2a2 2 0 0 1 2 2v1.344" />
      <path d="m17 18 4-4-4-4" />
      <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </>
  )),
  close: lucide(() => (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  )),
  check: lucide(() => <path d="M20 6 9 17l-5-5" />),
  circleCheck: lucide(() => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  )),
  circleX: lucide(() => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </>
  )),
  theme: lucide(() => (
    <>
      <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  )),
  font: lucide(() => (
    <>
      <path d="M12 4v16" />
      <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
      <path d="M9 20h6" />
    </>
  )),
  size: lucide(() => (
    <>
      <path d="m15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16" />
      <path d="M15.697 14h5.606" />
      <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" />
      <path d="M3.304 13h6.392" />
    </>
  )),
  sound: lucide(() => (
    <>
      <path d="M10 8h.01" />
      <path d="M12 12h.01" />
      <path d="M14 8h.01" />
      <path d="M16 12h.01" />
      <path d="M18 8h.01" />
      <path d="M6 8h.01" />
      <path d="M7 16h10" />
      <path d="M8 12h.01" />
      <rect width="20" height="16" x="2" y="4" rx="2" />
    </>
  )),
  keybinding: lucide(() => <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />),
  boardPage: lucide(() => (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M8 7v7" />
      <path d="M12 7v4" />
      <path d="M16 7v9" />
    </>
  )),
  back: lucide(() => (
    <>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </>
  )),
  forward: lucide(() => (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  )),
  claude: brand(
    'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
    '#D97757',
  ),
  openai: brand(
    'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
  ),
  gemini: brand(
    'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
    '#4796E3',
  ),
  // Cursor's mark (Simple Icons, CC0). The CLI's program is `agent`.
  cursor: brand(
    'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23',
  ),
  agent: lucide(() => (
    <>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </>
  )),
  shield: lucide(() => (
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  )),
  shieldOff: lucide(() => (
    <>
      <path d="m2 2 20 20" />
      <path d="M5 5v6c0 5 3.5 7.5 7.66 8.95a1 1 0 0 0 .67-.01c.98-.25 1.9-.62 2.73-1.1" />
      <path d="M9.24 2.72A1.17 1.17 0 0 1 10.76 2.72C12.49 4.19 15 5 19 5a1 1 0 0 1 1 1v5" />
    </>
  )),
  map: lucide(() => (
    <>
      <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
      <path d="M15 5.764v15" />
      <path d="M9 3.236v15" />
    </>
  )),
  bot: lucide(() => (
    <>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </>
  )),
  info: lucide(() => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  )),
  activity: lucide(() => <path d="M22 12h-4l-3 9L9 3l-3 9H2" />),
  send: lucide(
    () => (
      <>
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </>
    ),
    { hidden: true },
  ),
  messageSquarePlus: lucide(
    () => (
      <>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M12 7v6" />
        <path d="M9 10h6" />
      </>
    ),
    { hidden: true },
  ),
  edit: lucide(
    () => (
      <>
        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
        <path d="m15 5 4 4" />
      </>
    ),
    { hidden: true },
  ),
  preview: lucide(
    () => (
      <>
        <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    { hidden: true },
  ),
  collapse: lucide(
    () => (
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M15 3v18" />
        <path d="m8 9 3 3-3 3" />
      </>
    ),
    { hidden: true },
  ),
  folder: lucide(
    () => (
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    ),
    { size: '12', hidden: true },
  ),
  boardOnboarding: lucide(
    () => (
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M9 3v12" />
        <path d="M15 3v7" />
      </>
    ),
    { size: '16', hidden: true },
  ),
  arrowUpRight: lucide(
    () => (
      <>
        <path d="M7 7h10v10" />
        <path d="M7 17 17 7" />
      </>
    ),
    { size: '14', hidden: true },
  ),
};

// A status glyph's ring, dashed for Backlog.
const ring = (dash?: string) => (
  <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray={dash} />
);

// Linear-style status glyphs, drawn in currentColor (needs input is coloured
// by CSS). Needs input is Lucide's circle-question-mark.
export const glyph = (status: Status): SVGSVGElement => drawGlyph(status) as SVGSVGElement;

function drawGlyph(status: Status): JSX.Element {
  switch (status) {
    case 'backlog': {
      const dashed = ring('2.2 2');
      return (
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          {dashed}
        </svg>
      );
    }
    case 'in_progress': {
      const solid = ring();
      return (
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          {solid}
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </svg>
      );
    }
    case 'needs_input':
      return (
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
      );
    case 'completed':
      return (
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path
            d="M4.4 7.2l1.8 1.8 3.4-3.7"
            fill="none"
            stroke="var(--background)"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      );
    case 'archived': {
      const solid = ring();
      return (
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          {solid}
          <path d="M4.5 7h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      );
    }
  }
}

// A provider's icon, by the program its command runs: the agent's mark when
// we know it, else a prompt.
export function providerIcon(command: string): Icon {
  const program = command.trim().split(/\s+/)[0]?.split('/').pop() ?? '';
  return (
    { claude: icons.claude, codex: icons.openai, gemini: icons.gemini, agent: icons.cursor, cursor: icons.cursor }[
      program
    ] ?? icons.agent
  );
}

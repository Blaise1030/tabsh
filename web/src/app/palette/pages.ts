// The command palette's pages: settings to pick, pages to open, and actions.
import { FONT_SIZES, FONTS, THEMES, type ThemeColors, TYPING_SOUNDS } from '../settings/catalog.ts';
import { type KeyId, keyLabel } from '../settings/keys.ts';
import type { Settings, TabGrouping } from '../settings/schema.ts';
import { current, KEYBINDINGS } from '../settings/settings.ts';
import { isMac } from '../ui/dom.ts';

export const CHECK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
export const ICONS = {
  theme:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
  font: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/></svg>',
  size: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16"/><path d="M15.697 14h5.606"/><path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/><path d="M3.304 13h6.392"/></svg>',
  sound:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/></svg>',
  keybinding:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>',
  group:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5c0-1.1.9-2 2-2h2"/><path d="M17 3h2c1.1 0 2 .9 2 2v2"/><path d="M21 17v2c0 1.1-.9 2-2 2h-2"/><path d="M7 21H5c-1.1 0-2-.9-2-2v-2"/><rect width="7" height="5" x="7" y="7" rx="1"/><rect width="7" height="5" x="10" y="12" rx="1"/></svg>',
  board:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/></svg>',
  explorer:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>',
  back: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>',
  forward:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  info: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
};

// An item either opens another page (`go`), picks a setting (`key` +
// `value`, previewed while highlighted), records a keybinding (`record`)
// or runs code. `preview` rides along with `run` for a choice the palette
// previews while highlighted, and `checked` marks the current such choice.
export interface PaletteItem {
  label: string;
  icon?: string;
  hint?: string;
  keywords?: string;
  go?: string;
  key?: keyof Settings;
  value?: string | number;
  swatch?: ThemeColors;
  record?: KeyId;
  run?: () => void;
  preview?: () => void;
  checked?: boolean;
  disabled?: boolean; // greyed out and not selectable
}
export interface PalettePage {
  placeholder: string;
  groups: { heading: string; items: PaletteItem[] }[];
}

const keyIds = Object.keys(KEYBINDINGS) as KeyId[];

const GROUPINGS: Record<TabGrouping, string> = { none: 'No grouping', repo: 'By repo', tag: 'By tag' };

// Each page is a list of groups. `ctx` is what the root page needs from the
// rest of the app.
export function pages(ctx: {
  hasFile: boolean;
  closeFile(): void;
  openAbout(): void;
  toggleExplorer(): void;
  toggleBoard(): void;
  searchFiles(): void;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack(): void;
  goForward(): void;
}): Record<string, () => PalettePage> {
  const { saved } = current;
  return {
    root: () => ({
      placeholder: `Search settings…`,
      groups: [
        {
          heading: 'Appearance',
          items: [
            {
              label: 'Theme…',
              icon: ICONS.theme,
              hint: THEMES[saved.theme].name,
              keywords: 'color colour scheme dark light',
              go: 'theme',
            },
            {
              label: 'Font…',
              icon: ICONS.font,
              hint: FONTS[saved.font].name,
              keywords: 'typeface family',
              go: 'font',
            },
            {
              label: 'Font size…',
              icon: ICONS.size,
              hint: `${saved.fontSize}px`,
              keywords: 'zoom text bigger smaller',
              go: 'fontSize',
            },
          ],
        },
        {
          heading: 'Sound',
          items: [
            {
              label: 'Typing sound…',
              icon: ICONS.sound,
              hint: TYPING_SOUNDS[saved.typingSound],
              keywords: 'keyboard click clack audio mute',
              go: 'typingSound',
            },
          ],
        },
        {
          heading: 'Tabs',
          items: [
            {
              label: 'Toggle board',
              icon: ICONS.board,
              hint: keyLabel(saved.keyToggleBoard, isMac),
              keywords: 'kanban cards tasks status overview',
              run: ctx.toggleBoard,
            },
            {
              label: 'Group tabs…',
              icon: ICONS.group,
              hint: GROUPINGS[saved.tabGrouping],
              keywords: 'tags repos projects collapse filter',
              go: 'tabGrouping',
            },
          ],
        },
        {
          heading: 'Navigate',
          items: [
            {
              label: 'Go back',
              icon: ICONS.back,
              hint: keyLabel(saved.keyBack, isMac),
              keywords: KEYBINDINGS.keyBack.keywords,
              disabled: !ctx.canGoBack,
              run: ctx.canGoBack ? ctx.goBack : undefined,
            },
            {
              label: 'Go forward',
              icon: ICONS.forward,
              hint: keyLabel(saved.keyForward, isMac),
              keywords: KEYBINDINGS.keyForward.keywords,
              disabled: !ctx.canGoForward,
              run: ctx.canGoForward ? ctx.goForward : undefined,
            },
          ],
        },
        {
          heading: 'Files',
          items: [
            {
              label: 'Toggle file explorer',
              icon: ICONS.explorer,
              hint: keyLabel(saved.keyToggleExplorer, isMac),
              keywords: 'files sidebar tree folders project',
              run: ctx.toggleExplorer,
            },
            {
              label: 'Search files',
              icon: ICONS.explorer,
              hint: keyLabel(saved.keySearchFiles, isMac),
              keywords: 'find filter name tree explorer',
              run: ctx.searchFiles,
            },
            ...(ctx.hasFile
              ? [{ label: 'Close file', icon: ICONS.info, keywords: 'pane editor hide', run: ctx.closeFile }]
              : []),
          ],
        },
        {
          heading: 'Keybindings',
          items: keyIds.map((id) => ({
            label: `${KEYBINDINGS[id].name}…`,
            icon: ICONS.keybinding,
            hint: keyLabel(saved[id], isMac),
            keywords: `shortcut hotkey keybinding keyboard ${KEYBINDINGS[id].keywords} ${keyLabel(saved[id], isMac, true)}`,
            go: id,
          })),
        },
        {
          heading: 'Help',
          items: [{ label: 'About tabsh', icon: ICONS.info, keywords: 'version info', run: ctx.openAbout }],
        },
      ],
    }),
    theme: () => {
      const entries = Object.entries(THEMES);
      const item = ([id, t]: (typeof entries)[number]): PaletteItem => ({
        label: t.name,
        key: 'theme',
        value: id,
        swatch: t.colors,
      });
      return {
        placeholder: 'Search themes…',
        groups: [
          { heading: 'System', items: entries.filter(([, t]) => t.system).map(item) },
          { heading: 'Dark', items: entries.filter(([, t]) => !t.system && !t.light).map(item) },
          { heading: 'Light', items: entries.filter(([, t]) => !t.system && t.light).map(item) },
        ],
      };
    },
    font: () => ({
      placeholder: 'Search fonts…',
      groups: [
        {
          heading: 'Font',
          items: Object.entries(FONTS).map(([id, f]) => ({
            label: f.name,
            key: 'font',
            value: id,
            hint: f.google ? 'Google Fonts' : 'System',
          })),
        },
      ],
    }),
    typingSound: () => ({
      placeholder: 'Search…',
      groups: [
        {
          heading: 'Typing sound',
          items: Object.entries(TYPING_SOUNDS).map(([id, name]) => ({ label: name, key: 'typingSound', value: id })),
        },
      ],
    }),
    fontSize: () => ({
      placeholder: 'Search sizes…',
      groups: [
        { heading: 'Font size', items: FONT_SIZES.map((n) => ({ label: `${n}px`, key: 'fontSize', value: n })) },
      ],
    }),
    tabGrouping: () => ({
      placeholder: 'Group tabs…',
      groups: [
        {
          heading: 'Group tabs',
          items: (Object.entries(GROUPINGS) as [TabGrouping, string][]).map(([value, label]) => ({
            label,
            key: 'tabGrouping',
            value,
          })),
        },
      ],
    }),
    ...Object.fromEntries(
      keyIds.map((id) => [
        id,
        (): PalettePage => {
          const { presets } = KEYBINDINGS[id];
          // A recorded combo is listed too, so it shows as the current one.
          const combos = presets.includes(saved[id]) ? presets : [...presets, saved[id]];
          return {
            placeholder: 'Search shortcuts…',
            groups: [
              {
                heading: KEYBINDINGS[id].name,
                items: combos.map((combo) => ({
                  label: keyLabel(combo, isMac),
                  key: id,
                  value: combo,
                  keywords: keyLabel(combo, isMac, true),
                })),
              },
              {
                heading: 'Custom',
                items: [
                  {
                    label: 'Record shortcut…',
                    icon: ICONS.keybinding,
                    keywords: 'custom record press new other',
                    record: id,
                  },
                ],
              },
            ],
          };
        },
      ]),
    ),
  };
}

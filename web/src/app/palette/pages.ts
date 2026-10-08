// The command palette's pages: settings to pick, pages to open, and actions.
import { CARD_SOUNDS, FONT_SIZES, FONTS, THEMES, type ThemeColors, TYPING_SOUNDS } from '../settings/catalog.ts';
import { type KeyId, keyLabel } from '../settings/keys.ts';
import type { Settings, TabGrouping } from '../settings/schema.ts';
import { current, KEYBINDINGS } from '../settings/settings.ts';
import { isMac } from '../ui/dom.ts';
import { type Icon, icons } from '../ui/icons.ts';

// An item either opens another page (`go`), picks a setting (`key` +
// `value`, previewed while highlighted), records a keybinding (`record`)
// or runs code. `preview` rides along with `run` for a choice the palette
// previews while highlighted, and `checked` marks the current such choice.
export interface PaletteItem {
  label: string;
  icon?: Icon;
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
  goBack(): void;
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
              icon: icons.theme,
              hint: THEMES[saved.theme].name,
              keywords: 'color colour scheme dark light',
              go: 'theme',
            },
            {
              label: 'Font…',
              icon: icons.font,
              hint: FONTS[saved.font].name,
              keywords: 'typeface family',
              go: 'font',
            },
            {
              label: 'Font size…',
              icon: icons.size,
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
              icon: icons.sound,
              hint: TYPING_SOUNDS[saved.typingSound],
              keywords: 'keyboard click clack audio mute',
              go: 'typingSound',
            },
            {
              label: 'Needs input sound…',
              icon: icons.sound,
              hint: CARD_SOUNDS[saved.needsInputSound],
              keywords: 'notification alert chime board card waiting audio mute',
              go: 'needsInputSound',
            },
            {
              label: 'Completed sound…',
              icon: icons.sound,
              hint: CARD_SOUNDS[saved.completedSound],
              keywords: 'notification alert chime board card done finished audio mute',
              go: 'completedSound',
            },
          ],
        },
        {
          heading: 'Tabs',
          items: [
            {
              label: 'Toggle board',
              icon: icons.boardPage,
              hint: keyLabel(saved.keyToggleBoard, isMac),
              keywords: 'kanban cards tasks status overview',
              run: ctx.toggleBoard,
            },
            {
              label: 'Group tabs…',
              icon: icons.group,
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
              icon: icons.back,
              hint: keyLabel(saved.keyBack, isMac),
              keywords: KEYBINDINGS.keyBack.keywords,
              disabled: !ctx.canGoBack,
              run: ctx.canGoBack ? ctx.goBack : undefined,
            },
          ],
        },
        {
          heading: 'Files',
          items: [
            {
              label: 'Toggle file explorer',
              icon: icons.explorer,
              hint: keyLabel(saved.keyToggleExplorer, isMac),
              keywords: 'files sidebar tree folders project',
              run: ctx.toggleExplorer,
            },
            {
              label: 'Search files',
              icon: icons.explorer,
              hint: keyLabel(saved.keySearchFiles, isMac),
              keywords: 'find filter name tree explorer',
              run: ctx.searchFiles,
            },
            ...(ctx.hasFile
              ? [{ label: 'Close file', icon: icons.info, keywords: 'pane editor hide', run: ctx.closeFile }]
              : []),
          ],
        },
        {
          heading: 'Keybindings',
          items: keyIds.map((id) => ({
            label: `${KEYBINDINGS[id].name}…`,
            icon: icons.keybinding,
            hint: keyLabel(saved[id], isMac),
            keywords: `shortcut hotkey keybinding keyboard ${KEYBINDINGS[id].keywords} ${keyLabel(saved[id], isMac, true)}`,
            go: id,
          })),
        },
        {
          heading: 'Help',
          items: [{ label: 'About tabsh', icon: icons.info, keywords: 'version info', run: ctx.openAbout }],
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
    ...Object.fromEntries(
      (['needsInputSound', 'completedSound'] as const).map((key) => [
        key,
        (): PalettePage => ({
          placeholder: 'Search…',
          groups: [
            {
              heading: key === 'needsInputSound' ? 'Needs input sound' : 'Completed sound',
              items: Object.entries(CARD_SOUNDS).map(([id, name]) => ({ label: name, key, value: id })),
            },
          ],
        }),
      ]),
    ),
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
                    icon: icons.keybinding,
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

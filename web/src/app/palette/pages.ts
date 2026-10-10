// The command palette's pages: settings to pick, pages to open, and actions.
import { CARD_SOUNDS, FONT_SIZES, FONTS, THEMES, type ThemeColors, TYPING_SOUNDS } from '../settings/catalog.ts';
import { type KeyId, keyLabel } from '../settings/keys.ts';
import {
  MAX_PROVIDERS,
  type Provider,
  providerNameProblem,
  type Settings,
  type TabGrouping,
} from '../settings/schema.ts';
import { current, KEYBINDINGS, saveSetting } from '../settings/settings.ts';
import type { AboutRow } from '../ui/about.ts';
import { isMac } from '../ui/dom.ts';
import { type Icon, icons, providerIcon } from '../ui/icons.ts';

// An item either opens another page (`go`, after running `run` if it has
// one), picks a setting (`key` + `value`, previewed while highlighted),
// records a keybinding (`record`), edits a text (`edit`) or runs code.
// `copy` puts its text on the clipboard. `preview` rides along with `run` for a choice the palette previews while
// highlighted, and `checked` marks the current such choice.
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
  edit?: TextEdit;
  copy?: string;
}
// The palette's input becomes a text box holding `value`. Enter saves:
// `save` says why it can't (the input stays open), or the page to show.
export interface TextEdit {
  value: string;
  placeholder: string;
  save(value: string): { problem: string } | { next: string };
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
  about: AboutRow[] | null;
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
          heading: 'Agents',
          items: [
            {
              label: 'Agent providers…',
              icon: icons.agent,
              hint: saved.providers.map((p) => p.name).join(', '),
              keywords: 'agent provider command resume startup launch claude codex gemini opencode new card',
              go: 'providers',
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
          items: [{ label: 'About tabsh…', icon: icons.info, keywords: 'version info uptime shell', go: 'about' }],
        },
      ],
    }),
    providers: () => ({
      placeholder: 'Search providers…',
      groups: [
        {
          heading: 'Agent providers',
          items: saved.providers.map((p, i) => ({
            label: p.name,
            icon: providerIcon(p.command),
            hint: p.command,
            keywords: `${p.command} ${p.resume}`,
            go: `provider:${i}`,
          })),
        },
        ...(saved.providers.length < MAX_PROVIDERS
          ? [
              {
                heading: 'New',
                items: [
                  {
                    label: 'Add provider…',
                    icon: icons.plus,
                    keywords: 'new create custom agent',
                    edit: {
                      value: '',
                      placeholder: 'Name the provider, then Enter  (Esc to cancel)',
                      save: (name: string) => {
                        const problem = providerNameProblem(saved.providers, -1, name);
                        if (problem) return { problem };
                        const n = name.trim();
                        const p: Provider = { name: n, command: `${n.toLowerCase()} {prompt}`, resume: '' };
                        saveSetting('providers', [...saved.providers, p]);
                        return { next: `provider:${saved.providers.length}` };
                      },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    }),
    // Each row copies its value; until the daemon answers, one says so.
    about: () => ({
      placeholder: 'Search about tabsh…',
      groups: [
        {
          heading: 'About tabsh',
          items:
            ctx.about === null
              ? [{ label: 'Loading…', disabled: true }]
              : ctx.about.length
                ? ctx.about.map(([label, value]) => ({ label, hint: value, keywords: value, copy: value }))
                : [{ label: 'Could not reach the tabsh daemon.', disabled: true }],
        },
      ],
    }),
    ...Object.fromEntries(saved.providers.map((_, i) => [`provider:${i}`, () => providerPage(saved.providers, i)])),
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

// One provider: its name, startup and resume commands, and deleting it (the
// last one stays).
function providerPage(list: Provider[], i: number): PalettePage {
  const p = list[i];
  const self = `provider:${i}`;
  const put = (changes: Partial<Provider>) =>
    saveSetting(
      'providers',
      list.map((q, j) => (j === i ? { ...q, ...changes } : q)),
    );
  const command = (field: 'command' | 'resume', placeholder: string): TextEdit => ({
    value: p[field],
    placeholder,
    save: (value) => {
      const v = value.trim();
      if (field === 'command' && !v) return { problem: 'The startup command can’t be empty' };
      put({ [field]: v });
      return { next: self };
    },
  });
  return {
    placeholder: `${p.name}…`,
    groups: [
      {
        heading: p.name,
        items: [
          {
            label: 'Name…',
            icon: icons.edit,
            hint: p.name,
            keywords: 'rename title',
            edit: {
              value: p.name,
              placeholder: 'Name, then Enter  (Esc to cancel)',
              save: (name) => {
                const problem = providerNameProblem(list, i, name);
                if (problem) return { problem };
                put({ name: name.trim() });
                // New card keeps offering it under its new name.
                if (current.saved.agentProvider === p.name) saveSetting('agentProvider', name.trim());
                return { next: self };
              },
            },
          },
          {
            label: 'Startup command…',
            icon: icons.edit,
            hint: p.command,
            keywords: 'launch start run command prompt',
            edit: command(
              'command',
              '{prompt} is the card’s first prompt, {session} a conversation id tabsh picks; Enter saves  (Esc to cancel)',
            ),
          },
          {
            label: 'Resume command…',
            icon: icons.edit,
            hint: p.resume || 'None',
            keywords: 'resume restart continue session restore',
            edit: command(
              'resume',
              '{session} is the conversation (tabsh’s, or what its hooks report); empty for none  (Esc to cancel)',
            ),
          },
        ],
      },
      ...(list.length > 1
        ? [
            {
              heading: 'Remove',
              items: [
                {
                  label: 'Delete provider',
                  icon: icons.trash,
                  keywords: 'remove delete',
                  run: () =>
                    saveSetting(
                      'providers',
                      list.filter((_, j) => j !== i),
                    ),
                  go: 'providers',
                },
              ],
            },
          ]
        : []),
    ],
  };
}

// A tab on the strip: its card's glyph, its name and its close button, all
// following its session's states. A click picks it, a middle-click or its
// button closes it, a right-click opens its tag menu. A copy (`.mirror`) is
// another group's place for a tab with several tags, and acts for it.
import { createMemo, createRenderEffect, type JSX } from 'solid-js';
import { STATUS_NAMES } from '../board/glyph.ts';
import type { Card } from '../board/model.ts';
import { glyph, icons } from '../ui/icons.tsx';
import { tagBar } from './labels.ts';
import { active, closeSession, pick, type Session } from './store.ts';
import { openTagMenu } from './tags.tsx';

const statusTitle = (card: Card): string =>
  card.note ? `${STATUS_NAMES[card.status]}: ${card.note}` : STATUS_NAMES[card.status];

const tabSessions = new WeakMap<Element, Session>(); // a tab or copy → its session

// `grow: false` draws it at full width at once: a tab moving to a new place
// (another group, a regroup) rather than first appearing. Its node is made
// once: a rename only changes its text, so a drag holding it goes on.
export function Tab(props: { session: Session; group?: string; copy?: boolean; grow?: boolean }): JSX.Element {
  const s = props.session;
  const group = props.group;
  const grow = !props.copy && props.grow !== false;
  const base = props.copy ? 'tab mirror' : grow ? 'tab entering' : 'tab';
  const card = s.card;
  const name = s.name;
  const tags = s.tags;
  // Only a change of status redraws the glyph (a new note doesn't).
  const status = createMemo(() => card().status);
  const selected = () => active() === s;
  const node = (
    // biome-ignore lint/a11y/useFocusableInteractive: a div, as it holds its Close button, which a button can't
    // biome-ignore lint/a11y/useKeyWithClickEvents: a div, as it holds its Close button, which a button can't
    <div
      class={base}
      // Toggled one by one, so the strip's own classes (dragging, …) stay.
      classList={{
        active: selected(),
        bell: s.bell(),
        unread: s.unread(),
        archived: status() === 'archived',
        tagged: tags().length > 0,
        leaving: s.leaving(),
      }}
      data-group={group}
      role="tab"
      aria-selected={selected()}
      title={name()}
      onClick={() => pick(s)}
      on:auxclick={(e) => e.button === 1 && closeSession(s)} // middle-click closes
      onContextMenu={(e) => {
        e.preventDefault();
        openTagMenu(s, e.clientX, e.clientY);
      }}
    >
      <i class="tab-status" aria-hidden="true" data-status={status()} title={statusTitle(card())}>
        {glyph(status())}
      </i>
      <span class="tab-name">{name()}</span>
      <button
        type="button"
        class="btn"
        data-variant="ghost"
        data-size="icon-xs"
        aria-label="Close terminal"
        // Native: stopped here, the click never reaches the tab's own handler.
        on:click={(e) => {
          e.stopPropagation();
          void closeSession(s);
        }}
      >
        {icons.close()}
      </button>
    </div>
  );
  const t = node as HTMLDivElement;
  // A tagged tab shows a bar in its tags' colors.
  createRenderEffect(() => {
    const list = tags();
    if (list.length) t.style.setProperty('--tag', tagBar(list));
  });
  tabSessions.set(t, s);
  if (!grow) return t;
  // It grows in from nothing: the collapsed state is drawn first, then let go.
  requestAnimationFrame(() => {
    void t.offsetWidth;
    t.classList.remove('entering');
  });
  // It was zero-width when activated; bring it fully into view once grown.
  t.addEventListener('transitionend', function grown(e) {
    if (e.propertyName !== 'max-width') return;
    t.removeEventListener('transitionend', grown);
    if (active() === s) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  return t;
}

// The session a tab (or a copy of one) stands for.
export const sessionOfTab = (t: Element): Session | undefined => tabSessions.get(t);

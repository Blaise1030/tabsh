// The screens shown while the daemon can't be reached: start it, open its
// own copy of the page (Safari), or pair this browser with it.
import { createSignal, type JSX } from 'solid-js';
import { gateMode, pairWith } from '../daemon/client.ts';
import { LOCAL_APP } from '../daemon/config.ts';
import { fromVan } from './interop.ts';

function Heading(props: { text: string }): JSX.Element {
  return (
    <h2>
      <span class="mark">#</span>
      {` ${props.text}`}
    </h2>
  );
}

function Command(): JSX.Element {
  return (
    <pre class="cmd">
      <span class="mark">$</span>
      {' tabsh'}
    </pre>
  );
}

export function Gate(): JSX.Element {
  const mode = fromVan(gateMode);
  const [invalid, setInvalid] = createSignal(false);
  let input!: HTMLInputElement;
  return (
    <div class="empty" id="gate" hidden={mode() === null}>
      <div data-gate="offline" hidden={mode() !== 'offline'}>
        <Heading text="CAN'T REACH TABSH ON THIS COMPUTER" />
        <p>Start it in a terminal. This page connects as soon as it's up.</p>
        <Command />
        <p class="mark">{'> If your browser asks to let this site reach apps on your device, allow it.'}</p>
      </div>
      <div data-gate="safari" hidden={mode() !== 'safari'}>
        <Heading text="OPEN TABSH FROM YOUR COMPUTER" />
        <p>
          Safari doesn't let websites reach apps on your computer, so tabsh serves this page itself. Start it if it
          isn't running:
        </p>
        <Command />
        <p>
          <a class="btn" id="open-local" href={LOCAL_APP}>
            Open tabsh
          </a>
        </p>
        <p class="mark">{'> Add it to your Dock (File → Add to Dock) to open it like an app.'}</p>
      </div>
      <div data-gate="pair" hidden={mode() !== 'pair'}>
        <Heading text="PAIR THIS BROWSER WITH TABSH" />
        <p>Open the link tabsh printed when it started, or paste it here.</p>
      </div>
      <form
        data-gate="pair"
        id="pair-form"
        hidden={mode() !== 'pair'}
        on:submit={(e) => {
          e.preventDefault();
          if (pairWith(input.value)) input.value = '';
          else setInvalid(true);
        }}
      >
        <input
          ref={input}
          class="input"
          id="pair-input"
          placeholder="https://…/app/#token=…"
          autocomplete="off"
          spellcheck="false"
          aria-label="Pairing link or token"
          aria-invalid={invalid() ? 'true' : undefined}
        />
        <button type="submit" class="btn">
          Pair
        </button>
      </form>
    </div>
  );
}

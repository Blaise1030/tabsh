// Click-to-zoom for chat images: a native <dialog> lightbox (no Spotlight.js).
import { type JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { icons } from '../ui/icons.tsx';

export function ZoomableImage(props: { src: string; alt?: string; title?: string; class?: string }): JSX.Element {
  let sheet!: HTMLDialogElement;

  const open = () => {
    if (!sheet.open) sheet.showModal();
  };
  const close = () => {
    if (sheet.open) sheet.close();
  };

  return (
    <>
      <button
        type="button"
        class="chat-image-zoom"
        aria-label="View image larger"
        title={props.title ?? 'View image'}
        onClick={open}
      >
        <img class={props.class ?? 'chat-user-image'} src={props.src} alt={props.alt ?? ''} title={props.title} />
      </button>
      <Portal>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click; Esc closes from the keyboard */}
        <dialog
          ref={sheet}
          class="chat-image-lightbox"
          aria-label={props.alt || props.title || 'Image'}
          onClick={(e) => {
            if (e.target === sheet) close();
          }}
        >
          <button
            type="button"
            class="btn chat-image-lightbox-close"
            data-variant="ghost"
            data-size="icon-sm"
            aria-label="Close"
            title="Close"
            onClick={close}
          >
            {icons.circleX()}
          </button>
          <img src={props.src} alt={props.alt ?? ''} title={props.title} />
        </dialog>
      </Portal>
    </>
  );
}

/** Markdown `<img>` → zoomable when it has a src. */
export function MarkdownImage(props: { src?: string; alt?: string; title?: string }): JSX.Element {
  return (
    <Show when={props.src} fallback={<img src={props.src} alt={props.alt ?? ''} title={props.title} />}>
      {(src) => <ZoomableImage src={src()} alt={props.alt} title={props.title} class="chat-md-image" />}
    </Show>
  );
}

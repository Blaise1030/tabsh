// Image attach for the chat composer toolbar (New card style: upload paths
// on send). Thumbs sit above the paperclip row.
import { For, type JSX, Show } from 'solid-js';
import { icons } from '../ui/icons.tsx';

export type PendingImage = { file: File; url: string };

export function isImageFile(f: File): boolean {
  return f.type.startsWith('image/');
}

export function revokeImages(list: PendingImage[]): void {
  for (const x of list) URL.revokeObjectURL(x.url);
}

export function AttachBar(props: {
  images: PendingImage[];
  onAdd: (files: FileList | File[]) => void;
  onRemove: (image: PendingImage) => void;
}): JSX.Element {
  let input: HTMLInputElement | undefined;

  return (
    <div class="chat-attach">
      <Show when={props.images.length}>
        <div class="chat-attach-thumbs">
          <For each={props.images}>
            {(x) => (
              <span class="nc-thumb">
                <img src={x.url} alt={x.file.name} title={x.file.name} />
                <button
                  type="button"
                  class="nc-thumb-off"
                  aria-label={`Remove ${x.file.name}`}
                  onClick={() => props.onRemove(x)}
                >
                  {icons.close()}
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>
      <button
        type="button"
        class="btn chat-attach-btn"
        data-variant="outline"
        data-size="icon"
        aria-label="Attach images"
        title="Attach images"
        onClick={() => input?.click()}
      >
        {icons.paperclip()}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={() => {
          if (input?.files?.length) props.onAdd(input.files);
          if (input) input.value = '';
        }}
      />
    </div>
  );
}

// Image attach for the chat composer toolbar. Pending files show as removable
// badges; paths are uploaded on send (same as the New card flow).
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
        <div class="chat-attach-badges">
          <For each={props.images}>
            {(x) => (
              <span class="badge chat-attach-badge" title={x.file.name}>
                {icons.paperclip()}
                <span class="chat-attach-name">{x.file.name}</span>
                <button
                  type="button"
                  class="chat-attach-off"
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
        data-size="icon-sm"
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

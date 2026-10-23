// Agent input on a UI card belongs in the composer. A paste or a path that
// reaches the hidden xterm is the bug these tests catch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deliverAgentImages,
  deliverAgentText,
  focusAgentSurface,
  insertIntoComposer,
  registerComposer,
} from './deliver.ts';

test('insertIntoComposer joins a path onto what is already typed', () => {
  assert.equal(insertIntoComposer('', 'src/main.rs '), 'src/main.rs ');
  assert.equal(insertIntoComposer('ls ', 'README'), 'ls README');
  assert.equal(insertIntoComposer('hello', 'src/a.rs'), 'hello src/a.rs');
});

test('deliverAgentText does not paste into a chat card terminal', () => {
  const term = {
    pasted: '',
    focused: 0,
    paste(s: string) {
      this.pasted += s;
    },
    focus() {
      this.focused += 1;
    },
  };
  deliverAgentText(true, 'card', 'src/main.rs ', term);
  assert.equal(term.pasted, '');
  assert.equal(term.focused, 0);
  let got = '';
  let focuses = 0;
  registerComposer('card', {
    insert: (text) => {
      got = insertIntoComposer(got, text);
    },
    focus: () => {
      focuses += 1;
    },
  });
  assert.equal(got, 'src/main.rs ');
  assert.equal(focuses, 1);
});

test('deliverAgentText pastes into a side terminal', () => {
  const term = {
    pasted: '',
    focused: 0,
    paste(s: string) {
      this.pasted += s;
    },
    focus() {
      this.focused += 1;
    },
  };
  deliverAgentText(false, 'side', 'ls ', term);
  assert.equal(term.pasted, 'ls ');
  assert.equal(term.focused, 1);
});

test('focusAgentSurface focuses the composer of a chat card', () => {
  const term = {
    focused: 0,
    focus() {
      this.focused += 1;
    },
  };
  let focuses = 0;
  registerComposer('focus-card', {
    insert: () => {},
    focus: () => {
      focuses += 1;
    },
  });
  focusAgentSurface(true, 'focus-card', term);
  assert.equal(term.focused, 0);
  assert.equal(focuses, 1);
  focusAgentSurface(false, 'focus-card', term);
  assert.equal(term.focused, 1);
});

test('deliverAgentImages attaches files on a registered composer', () => {
  const got: File[] = [];
  let focuses = 0;
  registerComposer('img-card', {
    insert: () => {},
    focus: () => {
      focuses += 1;
    },
    attachImages: (files) => {
      got.push(...files);
    },
  });
  const file = new File(['x'], 'shot.png', { type: 'image/png' });
  deliverAgentImages('img-card', [file]);
  assert.equal(got.length, 1);
  assert.equal(got[0], file);
  assert.equal(focuses, 1);
});

test('deliverAgentImages queues until the composer registers', () => {
  const file = new File(['x'], 'a.png', { type: 'image/png' });
  deliverAgentImages('late-card', [file]);
  const got: File[] = [];
  registerComposer('late-card', {
    insert: () => {},
    focus: () => {},
    attachImages: (files) => {
      got.push(...files);
    },
  });
  assert.deepEqual(
    got.map((f) => f.name),
    ['a.png'],
  );
});

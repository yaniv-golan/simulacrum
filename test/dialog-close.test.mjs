import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDialogClose, createDialogHeader } from '../src/presentation/dialog-close.mjs';

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.textContent = '';
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
}
function withDocument(run) {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    return run();
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

const source = (path) => readFileSync(path, 'utf8');
const files = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : entry.name.endsWith('.mjs')
        ? [join(directory, entry.name)]
        : [],
  );
const createsDialog = (text) => /\b(?:createElement|element|el)\(\s*'dialog'/.test(text);
const importsHelper = (text) =>
  /from '[./]*\/presentation\/dialog-close\.mjs'|from '\.\/dialog-close\.mjs'/.test(text);

test('dialog close control is one named × button whose semantics stay with the owner', () => {
  withDocument(() => {
    let closed = 0;
    const close = createDialogClose('Close photos', () => closed++);
    assert.equal(close.tagName, 'BUTTON');
    assert.equal(close.type, 'button', 'never submits a surrounding form');
    assert.equal(close.textContent, '×');
    assert.equal(close.className, 'dialog-close');
    assert.equal(close.attributes['aria-label'], 'Close photos');
    assert.equal(close.title, 'Close photos');
    assert.equal(closed, 0);
    close.onclick();
    assert.equal(closed, 1, 'the owner-supplied handler is the only close path');
  });
});

test('bare close labels and dialog owners without the shared control are rejected', () => {
  withDocument(() => {
    assert.throws(() => createDialogClose('Close', () => {}), /name the dialog/i);
    assert.throws(() => createDialogClose('', () => {}), /name the dialog/i);
    assert.throws(() => createDialogClose('Dismiss photos', () => {}), /name the dialog/i);
  });
  const owner = "const d = element('dialog', 'x'); d.append(button('×', () => d.close()));";
  assert.ok(createsDialog(owner) && !importsHelper(owner), 'a hand-rolled owner is detected');
  assert.match(owner, /'×'/, 'a private glyph is detected');
  assert.ok(
    importsHelper("import { createDialogClose } from './dialog-close.mjs';") &&
      importsHelper("import { createDialogClose } from '../presentation/dialog-close.mjs';"),
    'both presentation and application import spellings count as adoption',
  );
});

test('dialog header keeps the heading first and the × last', () => {
  withDocument(() => {
    const heading = new Element('h2');
    heading.textContent = 'Photos';
    const close = createDialogClose('Close photos', () => {});
    const header = createDialogHeader(heading, close);
    assert.equal(header.tagName, 'HEADER');
    assert.equal(header.className, 'dialog-header');
    assert.deepEqual(header.children, [heading, close]);
  });
});

test('every custom dialog owner uses the shared top-right close control', () => {
  const owners = files('src').filter((path) => createsDialog(source(path)));
  assert.ok(owners.length >= 6, `dialog owners found: ${owners.join(', ')}`);
  for (const path of owners) {
    const text = source(path);
    assert.ok(importsHelper(text), `${path} creates a dialog without the shared close control`);
    assert.doesNotMatch(text, /'×'/, `${path} draws its own × glyph instead of createDialogClose`);
  }
});

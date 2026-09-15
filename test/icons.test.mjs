import test from 'node:test';
import assert from 'node:assert/strict';
import { icon, ICONS } from '../src/presentation/icons.mjs';

class Element {
  constructor(namespace, tag) {
    this.namespaceURI = namespace;
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  setAttribute(key, value) {
    this.attributes[key] = String(value);
  }
}
function withDocument(run) {
  const previous = globalThis.document;
  globalThis.document = { createElementNS: (namespace, tag) => new Element(namespace, tag) };
  try {
    return run();
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test('every named icon is a fresh decorative 16-grid svg with drawn shapes', () => {
  withDocument(() => {
    assert.ok(ICONS.length >= 9, 'the header needs at least nine glyphs');
    for (const name of ICONS) {
      const svg = icon(name);
      assert.equal(svg.tagName, 'svg', name);
      assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg', name);
      assert.equal(svg.attributes.viewBox, '0 0 16 16', name);
      assert.equal(svg.attributes['aria-hidden'], 'true', name);
      assert.equal(svg.attributes.focusable, 'false', name);
      assert.equal(svg.attributes.fill, 'currentColor', name);
      assert.ok(svg.children.length > 0, `${name} draws something`);
      for (const shape of svg.children) {
        assert.equal(shape.namespaceURI, svg.namespaceURI, name);
        assert.ok(
          (shape.tagName === 'path' && shape.attributes.d?.length > 8) ||
            (shape.tagName === 'rect' && Number(shape.attributes.width) > 0),
          `${name} shape ${shape.tagName} has geometry`,
        );
      }
      assert.notEqual(icon(name), svg, `${name} is a new node per call`);
    }
  });
});

test('unknown icon names throw instead of rendering an empty box', () => {
  withDocument(() => {
    assert.throws(() => icon('floppy'), /Unknown icon "floppy"/);
    assert.throws(() => icon(''), /Unknown icon/);
  });
});

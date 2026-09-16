import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartsBrowser } from '../src/presentation/parts-browser.mjs';
import { CATALOG } from '../src/model/catalog.mjs';

/** Enough DOM for the catalogue: elements, classes, focus tracking and key events. */
class Element extends EventTarget {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.scrollTop = 0;
    this.textContent = '';
    this.value = '';
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    };
  }
  set className(value) {
    for (const name of String(value).split(/\s+/).filter(Boolean)) this.classList.add(name);
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  prepend(...nodes) {
    for (const node of nodes.reverse()) {
      node.parent = this;
      this.children.unshift(node);
    }
  }
  insertBefore(node, before) {
    node.parent = this;
    const at = this.children.indexOf(before);
    this.children.splice(at < 0 ? this.children.length : at, 0, node);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  querySelector(selector) {
    const name = selector.replace(/^\./, '');
    const walk = (node) => {
      for (const child of node.children) {
        if (child.classList.contains(name) || child.tagName === selector) return child;
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }
  focus() {
    focused.push(this);
  }
  scrollIntoView() {}
  remove() {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
  }
}
let focused = [];
function mount(t, { placementActive = () => false, matches = false, storage = null } = {}) {
  focused = [];
  const previous = {};
  const globals = {
    document: Object.assign(new EventTarget(), {
      createElement: (tag) => new Element(tag),
      // The favourite toggle's star comes from icons.mjs, which builds SVG in its namespace.
      createElementNS: (_namespace, tag) => new Element(tag),
      createTextNode: (text) => Object.assign(new Element('#text'), { textContent: text }),
      activeElement: null,
    }),
    window: new EventTarget(),
    matchMedia: () => ({ matches }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
  };
  for (const key of Object.keys(globals)) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      value: globals[key],
      configurable: true,
      writable: true,
    });
  }
  t.after(() => {
    for (const [key, descriptor] of Object.entries(previous))
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  });
  const picked = [];
  const browser = createPartsBrowser({
    icon: () => new Element('span'),
    help: {
      entry: (tile) => {
        const wrapper = new Element('div');
        const about = new Element('button');
        about.className = 'part-about';
        wrapper.append(tile, about);
        return wrapper;
      },
      dismissTooltip: () => false,
    },
    pick: (type) => picked.push(type),
    drag: () => {},
    openAssemblies: () => {},
    attachRope: () => {},
    storage,
    placementActive,
  });
  return { browser, picked, panel: browser.panel };
}
const search = (panel) => panel.querySelector('input');
const escape = (panel) =>
  panel.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
const expanded = (panel) => panel.classList.contains('catalog-expanded');

test('summoning opens the overlay with the search focused and names it as a dialog', (t) => {
  const { browser, panel } = mount(t);
  const opener = new Element('button');
  assert.equal(expanded(panel), false);
  assert.equal(
    panel.getAttribute('role'),
    null,
    'compact: the catalogue is a landmark, not a dialog',
  );
  browser.open({ opener });
  assert.equal(expanded(panel), true);
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(panel.getAttribute('aria-modal'), 'false');
  assert.equal(panel.getAttribute('aria-label'), 'Parts');
  assert.equal(focused.at(-1), search(panel), 'focus goes to the search box');
  escape(panel);
  assert.equal(expanded(panel), false);
  assert.equal(panel.getAttribute('role'), null, 'concealed: the dialog role leaves with it');
  assert.equal(panel.getAttribute('aria-label'), 'Part catalog');
  assert.equal(focused.at(-1), opener, 'Escape hands focus back to whatever summoned it');
});

test('entering Run puts the overlay away; Build alone does not bring it back', (t) => {
  const { browser, panel } = mount(t);
  browser.open({ opener: new Element('button') });
  browser.update('run');
  assert.equal(expanded(panel), false);
  browser.update('build');
  assert.equal(expanded(panel), false);
});

test('a cancelled placement restores the browse snapshot but never re-summons the overlay', (t) => {
  const { browser, panel } = mount(t);
  const opener = new Element('button');
  browser.open({ opener });
  search(panel).value = 'wheel';
  search(panel).dispatchEvent(new Event('input'));
  browser.dragStarted('gripWheel');
  assert.equal(expanded(panel), true, 'the drag frame has not run yet');
  browser.placed('gripWheel');
  assert.equal(expanded(panel), false, 'placing conceals');
  search(panel).value = '';
  browser.cancelled('gripWheel');
  assert.equal(search(panel).value, 'wheel', 'the search comes back for the next open');
  assert.equal(
    expanded(panel),
    false,
    'the old behaviour re-expanded here; the overlay stays away',
  );
  // Disabled tiles cannot take focus: the opener gets it instead.
  browser.update('run');
  browser.cancelled('gripWheel');
  assert.equal(focused.at(-1), opener);
});

test('Escape belongs to an active placement, not to the overlay', (t) => {
  const { browser, panel } = mount(t, { placementActive: () => true });
  browser.open({ opener: new Element('button') });
  escape(panel);
  assert.equal(expanded(panel), true, 'placement owns Escape while it is active');
});

test('the compact catalogue no longer carries its own expand toggle', (t) => {
  const { panel } = mount(t);
  const labels = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (child.tagName === 'button') labels.push(child.textContent);
      walk(child);
    }
  };
  walk(panel);
  assert.equal(labels.includes('Expand parts'), false, 'one opener: + Add part in the header');
  assert.equal(labels.includes('Return to workbench'), false);
  assert.equal(labels.includes('×'), true, 'the shared close control is present');
  const close = panel.querySelector('.dialog-close');
  assert.equal(close.getAttribute('aria-label'), 'Close parts');
  assert.equal(close.hidden, true, 'hidden while compact');
});

/** This mock's dispatchEvent never reaches an `on*` property, so hover, focus and typing are
 * driven by calling the handlers the component assigns; dispatching would pass vacuously.
 * Part types are derived from the catalogue rather than spelled out, so a renamed part fails
 * these tests honestly instead of throwing on an undefined tile. */
const wrapperOf = (panel, type) => {
  const walk = (node) => {
    for (const child of node.children) {
      if (child.dataset?.partType === type) return child.parent;
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(panel);
};
const starOf = (panel, type) =>
  wrapperOf(panel, type)?.children.find((c) => c.classList.contains('catalog-favorite')) ?? null;
const tileOf = (panel, type) => wrapperOf(panel, type)?.children.find((c) => c.dataset?.partType);
const byClass = (panel, cls) => {
  const walk = (node) => {
    for (const child of node.children) {
      if (child.classList.contains(cls)) return child;
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(panel);
};
const buttons = (node, out = []) => {
  for (const child of node.children) {
    if (child.tagName === 'button') out.push(child);
    buttons(child, out);
  }
  return out;
};
const othersThan = (...exclude) => Object.keys(CATALOG).filter((t) => !exclude.includes(t));
const alive = (node) => {
  for (let n = node; n; n = n.parent) if (n.hidden) return false;
  return true;
};
function fakeStorage(initial = null) {
  let value = initial === null ? null : JSON.stringify(initial);
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    read: () => (value === null ? null : JSON.parse(value)),
  };
}

test('a tile star saves its own part, whatever the pointer, Rope or search touched last', (t) => {
  const storage = fakeStorage();
  const { panel } = mount(t, { storage });
  const cellStar = starOf(panel, 'powerCell');
  assert.ok(cellStar, 'every catalogue tile carries its own favourite toggle');
  // Every path that used to re-target the one shared button.
  const [grazed, tabbed] = othersThan('powerCell');
  tileOf(panel, grazed).onpointerenter();
  tileOf(panel, tabbed).onfocus();
  byClass(panel, 'catalog-connection').onfocus();
  const box = search(panel);
  box.value = 'wheel';
  box.oninput();
  box.value = '';
  box.oninput();
  // The graze has to be the LAST act before the press. Clearing the search re-runs refresh(),
  // which reseats the summary's `selected` to rows[0] — Power Cell — so a graze placed only
  // earlier lets a wrong implementation save the right part by luck. Proven by mutation: with
  // the star reading `selected` instead of its own `type`, this test passed until this line
  // was added, and the mutant was caught by the aria-pressed test instead of by this one.
  tileOf(panel, grazed).onpointerenter();
  cellStar.onclick();
  assert.deepEqual(
    storage.read().favorites,
    ['powerCell'],
    'the star saves the part whose tile it sits on, not the last part grazed',
  );
});

test('a star restates aria-pressed after refresh and after a reload', (t) => {
  const storage = fakeStorage({ favorites: ['powerCell'], category: 'Essentials' });
  const { panel } = mount(t, { storage });
  const other = othersThan('powerCell', 'gripWheel')[0];
  assert.ok(
    starOf(panel, 'powerCell') && starOf(panel, 'gripWheel') && starOf(panel, other),
    'every catalogue tile carries its own favourite toggle',
  );
  assert.equal(starOf(panel, 'powerCell').getAttribute('aria-pressed'), 'true');
  assert.equal(starOf(panel, 'gripWheel').getAttribute('aria-pressed'), 'false');
  assert.equal(
    starOf(panel, 'powerCell').getAttribute('aria-label'),
    `Remove ${CATALOG.powerCell.name} from favorites`,
    'a pressed star names the action its press performs, not the one already taken',
  );
  assert.equal(
    starOf(panel, 'powerCell').getAttribute('title'),
    `Remove ${CATALOG.powerCell.name} from favorites`,
  );
  assert.equal(
    starOf(panel, 'gripWheel').getAttribute('aria-label'),
    `Save ${CATALOG.gripWheel.name} to favorites`,
    'an unsaved star offers the save',
  );
  starOf(panel, 'gripWheel').onclick();
  assert.equal(starOf(panel, 'gripWheel').getAttribute('aria-pressed'), 'true');
  assert.equal(
    starOf(panel, 'gripWheel').getAttribute('aria-label'),
    `Remove ${CATALOG.gripWheel.name} from favorites`,
    'the label follows the toggle, not only the first render',
  );
  assert.deepEqual(storage.read().favorites, ['powerCell', 'gripWheel']);
  // A category change re-runs refresh(): every card must restate its own state.
  buttons(panel)
    .find((b) => b.textContent === 'All parts')
    .onclick();
  assert.equal(starOf(panel, 'powerCell').getAttribute('aria-pressed'), 'true');
  assert.equal(starOf(panel, other).getAttribute('aria-pressed'), 'false');
  const reloaded = mount(t, { storage });
  assert.equal(
    starOf(reloaded.panel, 'powerCell').getAttribute('aria-pressed'),
    'true',
    'saved favourites come back pressed without a machine save',
  );
});

test('un-starring inside Favorites leaves focus on a live control', (t) => {
  const storage = fakeStorage({ favorites: ['powerCell', 'gripWheel'], category: 'Favorites' });
  const { panel } = mount(t, { storage });
  const cellStar = starOf(panel, 'powerCell');
  // alive(null) is vacuously true, so the toggle's existence is asserted before it is used.
  assert.ok(cellStar, 'every catalogue tile carries its own favourite toggle');
  assert.equal(alive(cellStar), true, 'the starred card is on screen in Favorites');
  cellStar.onclick();
  assert.equal(alive(cellStar), false, 'un-starring drops its own card out of Favorites');
  const landed = focused.at(-1);
  assert.ok(landed, 'focus is placed explicitly, never left on the removed control');
  assert.notEqual(landed, cellStar, 'focus does not stay on the control that just left');
  assert.equal(alive(landed), true, 'focus lands on something still rendered');
});

test('un-starring the last favourite lands focus on the Favorites tab', (t) => {
  const storage = fakeStorage({ favorites: ['powerCell'], category: 'Favorites' });
  const { panel } = mount(t, { storage });
  const cellStar = starOf(panel, 'powerCell');
  assert.ok(cellStar, 'every catalogue tile carries its own favourite toggle');
  cellStar.onclick();
  const landed = focused.at(-1);
  assert.ok(landed, 'focus is placed explicitly even when no card is left to take it');
  assert.equal(
    landed.textContent,
    'Favorites',
    'with the grid empty, focus falls back to the open category rather than the removed star',
  );
  assert.equal(alive(landed), true, 'the category tab is still rendered');
});

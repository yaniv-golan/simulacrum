import { CATALOG } from '../model/catalog.mjs';
import { PART_HELP } from './part-help-content.mjs';
import { PART_SEARCH, ESSENTIAL_PARTS, searchParts } from './part-search.mjs';
import { createDialogClose } from './dialog-close.mjs';
import { icon as glyph } from './icons.mjs';

const el = (tag, text = '', cls = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = cls;
  return node;
};
export function createPartsBrowser({
  icon,
  help,
  pick,
  drag,
  openAssemblies,
  attachRope,
  storage,
  placementActive = () => false,
}) {
  const panel = el('section', '', 'parts-browser');
  panel.dataset.partHelpInput = '';
  panel.setAttribute('aria-label', 'Part catalog');
  const head = el('div', '', 'catalog-head');
  // Summoned by + Add part or P; put away by the shared ×, Escape, a pick, a drag or Run.
  let opener = null;
  const close = createDialogClose('Close parts', () => {
    conceal();
    opener?.focus();
  });
  close.hidden = true;
  head.append(close);
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Find a part or what it does…';
  search.setAttribute('aria-label', 'Search all parts');
  const clear = el('button', 'Clear search');
  const searchRow = el('div', '', 'catalog-search');
  searchRow.append(search, clear);
  const nav = el('nav', '', 'catalog-categories');
  nav.setAttribute('aria-label', 'Part categories');
  const count = el('p', '', 'catalog-count');
  count.setAttribute('role', 'status');
  const grid = el('div', '', 'catalog-grid');
  const summary = el('div', '', 'catalog-summary');
  const name = el('strong'),
    purpose = el('p');
  summary.append(name, purpose);
  const assemblies = el('button', 'Spring strut · Assemblies');
  assemblies.onclick = () => {
    conceal();
    openAssemblies();
  };
  const rope = el('button', 'Rope', 'catalog-connection');
  rope.onfocus = describeRope;
  rope.onpointerenter = describeRope;
  rope.onclick = () => {
    if (!editable || placementActive()) return;
    conceal();
    attachRope?.();
  };
  const notice = el('p', '', 'catalog-notice');
  notice.setAttribute('role', 'status');
  panel.append(head, searchRow, nav, count, grid, assemblies, summary, notice);
  let category = 'Essentials',
    favorites = [],
    recent = [],
    selected = ESSENTIAL_PARTS[0],
    editable = true,
    searching = false,
    expanded = false,
    origin = null,
    savedScroll = new Map();
  try {
    const saved = JSON.parse(storage?.getItem('simulacrum.parts.v1') ?? 'null');
    if (saved) {
      favorites = Array.isArray(saved.favorites) ? saved.favorites.filter((t) => CATALOG[t]) : [];
      if (
        [
          'Essentials',
          'All parts',
          'Recent',
          'Favorites',
          ...new Set(Object.values(PART_SEARCH).map((m) => m.category)),
        ].includes(saved.category)
      )
        category = saved.category;
    }
  } catch {
    notice.textContent = 'Saved favorites could not be read. You can still use this catalog.';
  }
  function persist() {
    try {
      storage?.setItem('simulacrum.parts.v1', JSON.stringify({ category, favorites }));
    } catch {
      notice.textContent = 'Favorites are available this session, but could not be saved.';
    }
  }
  let availabilityNotice = '';
  let dragSession = null,
    dragFrame = null;
  const cards = new Map();
  // The summary describes whatever the pointer or focus last reached. It owns no action, so
  // grazing a neighbour on the way to a control can no longer change what that control does.
  function describeRope() {
    summary.hidden = false;
    name.textContent = 'Rope';
    purpose.textContent =
      'Attach two parts with a flexible rope. Choose its length in the selected inspector.';
  }
  function describe(type, reason = '') {
    selected = type;
    name.textContent = CATALOG[type].name;
    purpose.textContent = reason || PART_HELP[type].purpose;
  }
  // The toggle names the action its press will perform, so a saved part stops offering to save
  // what is already saved. `aria-pressed` carries the state; this carries the next action.
  const favoriteLabel = (type, saved) =>
    saved
      ? `Remove ${CATALOG[type].name} from favorites`
      : `Save ${CATALOG[type].name} to favorites`;
  const order = [
    ...ESSENTIAL_PARTS,
    ...Object.keys(CATALOG).filter((t) => !ESSENTIAL_PARTS.includes(t)),
  ];
  for (const type of order) {
    const tile = el('button', '', 'part-card');
    tile.type = 'button';
    tile.dataset.partType = type;
    tile.dataset.placement = '';
    tile.append(icon(type), el('span', CATALOG[type].name));
    tile.setAttribute('aria-label', CATALOG[type].name);
    const wrapper = help.entry(tile, type);
    wrapper.classList.add('catalog-entry');
    const info = wrapper.querySelector('.part-about');
    info.addEventListener(
      'click',
      () => {
        const saved = snapshot();
        info.catalogRestore = () => restoreSnapshot(saved);
      },
      true,
    );
    const reason = el('span', '', 'catalog-reason');
    reason.id = `catalog-reason-${type}`;
    tile.setAttribute('aria-describedby', `part-description-${type} ${reason.id}`);
    tile.onfocus = () => describe(type, reason.textContent);
    tile.onpointerenter = () => describe(type, reason.textContent);
    tile.onclick = () => {
      if (!editable) return;
      const saved = snapshot();
      help.close();
      pick(type);
      // Replacing an earlier pickup may restore its origin. Keep this pickup's
      // independently captured browse state and dismiss it after that cancellation.
      restoreSnapshot(saved);
      origin = saved;
      conceal();
    };
    // A sibling of the tile, never inside it: the tile is itself a button, so the card's
    // top-left corner leaves the drag/pick target. Tab order within a card is tile, star, (i).
    const star = el('button', '', 'catalog-favorite');
    star.type = 'button';
    // Both glyphs are built once and one is shown by aria-pressed, so a saved part reads as a
    // filled star rather than as a colour a player may not be able to tell apart.
    const outlineStar = glyph('star'),
      filledStar = glyph('star-fill');
    outlineStar.setAttribute('class', 'icon star-outline');
    filledStar.setAttribute('class', 'icon star-filled');
    star.append(outlineStar, filledStar);
    const initialLabel = favoriteLabel(type, favorites.includes(type));
    star.setAttribute('aria-label', initialLabel);
    star.setAttribute('title', initialLabel);
    star.onclick = () => {
      favorites = favorites.includes(type)
        ? favorites.filter((t) => t !== type)
        : [...favorites, type];
      persist();
      refresh();
      // Un-starring inside Favorites takes this card off the grid, so focus must not leave
      // with it: the first card still shown, else the open category, else the search box.
      if (cards.get(type).wrapper.hidden) {
        const next = [...cards.values()].find((card) => !card.wrapper.hidden)?.star;
        (next ?? tabs.get(category) ?? search).focus({ preventScroll: true });
      }
    };
    wrapper.insertBefore(star, info);
    drag(tile, type);
    wrapper.append(reason);
    grid.append(wrapper);
    cards.set(type, { wrapper, tile, reason, info, star });
  }
  const tabs = new Map();
  for (const label of [
    'Essentials',
    'All parts',
    'Structure',
    'Motion',
    'Power',
    'Controls',
    'Sensors',
    'Recent',
    'Favorites',
  ]) {
    const b = el('button', label);
    b.onclick = () => {
      savedScroll.set(category, grid.scrollTop);
      category = label;
      search.value = '';
      refresh();
      grid.scrollTop = savedScroll.get(category) ?? 0;
      persist();
    };
    nav.append(b);
    tabs.set(label, b);
  }
  function refresh() {
    const query = search.value.trim();
    let rows = query
      ? searchParts(query)
      : order
          .filter(
            (t) =>
              category === 'All parts' ||
              (category === 'Essentials' && ESSENTIAL_PARTS.includes(t)) ||
              (category === 'Favorites' && favorites.includes(t)) ||
              (category === 'Recent' && recent.includes(t)) ||
              PART_SEARCH[t].category === category,
          )
          .map((type) => ({ type, reason: '' }));
    if (!query && category === 'Recent')
      rows.sort((a, b) => recent.indexOf(a.type) - recent.indexOf(b.type));
    grid.classList.toggle('catalog-essentials', !query && category === 'Essentials');
    const visible = new Map(rows.map((r, i) => [r.type, { ...r, i }]));
    for (const [type, card] of cards) {
      const result = visible.get(type);
      card.wrapper.hidden = !result;
      card.tile.disabled = !editable;
      card.tile.draggable = editable;
      card.reason.textContent = result?.reason ?? '';
      // Every card restates its own saved state: a reload, a search or a category change
      // must never leave a star claiming the opposite of what is stored, nor offering to save
      // a part it would in fact remove.
      const saved = favorites.includes(type);
      card.star.setAttribute('aria-pressed', String(saved));
      const label = favoriteLabel(type, saved);
      card.star.setAttribute('aria-label', label);
      card.star.setAttribute('title', label);
    }
    // Reorder only on explicit browse/search actions, never on simulation frames.
    for (const { type } of rows) grid.append(cards.get(type).wrapper);
    grid.append(rope);
    for (const [label, b] of tabs)
      b.setAttribute('aria-pressed', String(!query && label === category));
    count.textContent = rows.length
      ? `${query ? 'All parts' : category} · ${rows.length}`
      : query
        ? 'No matching parts. Try battery, wheel, or sensor.'
        : category === 'Recent'
          ? 'Parts appear here after placement.'
          : 'Star a part on its tile to save it here.';
    assemblies.hidden = !/spring|suspension/i.test(query) || !openAssemblies;
    rope.hidden =
      !attachRope ||
      !(query
        ? /\b(rope|cable|tow|towing)\b/i.test(query)
        : ['All parts', 'Structure'].includes(category));
    rope.disabled = !editable || placementActive();
    if (!rope.hidden && !rows.length) count.textContent = 'Rope · Connection tool';
    summary.hidden = !rows.length;
    if (rows.length)
      describe(visible.has(selected) ? selected : rows[0].type, visible.get(selected)?.reason);
    if (!rows.length && !rope.hidden) describeRope();
    searching = Boolean(query);
  }
  function snapshot() {
    return {
      category,
      query: search.value,
      scroll: grid.scrollTop,
      expanded,
      selected,
      savedScroll: new Map(savedScroll),
    };
  }
  // The browse snapshot (search, category, scroll) comes back; whether the overlay shows is
  // the caller's decision, never the snapshot's.
  function restoreSnapshot(saved) {
    category = saved.category;
    search.value = saved.query;
    selected = saved.selected;
    savedScroll = new Map(saved.savedScroll);
    refresh();
    grid.scrollTop = saved.scroll;
  }
  function reveal(type) {
    search.value = CATALOG[type].name;
    refresh();
    if (matchMedia('(max-width: 900px)').matches) show();
    cards.get(type).tile.focus({ preventScroll: true });
    cards.get(type).wrapper.scrollIntoView({ block: 'nearest' });
  }
  function show() {
    expanded = true;
    panel.classList.add('catalog-expanded');
    // Summoned, the same node is a non-modal dialog; compact, it is the catalogue landmark.
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', 'Parts');
    close.hidden = false;
  }
  function conceal() {
    expanded = false;
    panel.classList.remove('catalog-expanded');
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    panel.setAttribute('aria-label', 'Part catalog');
    close.hidden = true;
  }
  function open({ opener: from = null } = {}) {
    opener = from;
    show();
    search.focus();
  }
  search.oninput = () => {
    if (!searching) savedScroll.set(category, grid.scrollTop);
    grid.scrollTop = 0;
    refresh();
    if (!searching) grid.scrollTop = savedScroll.get(category) ?? 0;
  };
  clear.onclick = () => {
    search.value = '';
    refresh();
    grid.scrollTop = savedScroll.get(category) ?? 0;
    search.focus();
  };
  panel.addEventListener('keydown', (event) => {
    // Active placement owns Escape, including while browsing with search focus.
    if (event.key !== 'Escape' || placementActive()) return;
    if (help.dismissTooltip()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (expanded) {
      conceal();
      opener?.focus();
    } else if (search.value) {
      search.value = '';
      refresh();
      grid.scrollTop = savedScroll.get(category) ?? 0;
    }
  });
  refresh();
  return {
    panel,
    reveal,
    show,
    open,
    dragStarted(type) {
      origin = snapshot();
      const session = { type };
      dragSession = session;
      dragFrame = requestAnimationFrame(() => {
        if (dragSession === session) conceal();
      });
    },
    placed(type) {
      if (dragSession?.type === type) {
        dragSession = null;
        conceal();
      }
      recent = [type, ...recent.filter((t) => t !== type)];
    },
    cancelled(type) {
      dragSession = null;
      // The snapshot returns for the next open; the overlay itself stays away.
      if (origin) restoreSnapshot(origin);
      // The tile when it is rendered (summoned or in the compact sidebar), else the opener.
      const tile = cards.get(type)?.tile;
      if (tile && !tile.disabled && (expanded || tile.getClientRects?.().length))
        tile.focus({ preventScroll: true });
      else opener?.focus({ preventScroll: true });
    },
    update(mode, busy = false) {
      const next = mode === 'build' && !busy;
      if (mode !== 'build' && expanded) conceal();
      const message = busy
        ? 'Finish or cancel the assembly operation to add parts.'
        : next
          ? ''
          : 'Return to Build to add parts.';
      rope.disabled = !next || placementActive();
      if (next === editable && message === availabilityNotice) return;
      availabilityNotice = message;
      editable = next;
      for (const { tile } of cards.values()) {
        tile.disabled = !editable;
        tile.draggable = editable;
      }
      notice.textContent = message;
    },
    dispose() {
      dragSession = null;
      cancelAnimationFrame(dragFrame);
      panel.remove();
    },
  };
}

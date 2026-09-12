import { CATALOG } from '../model/catalog.mjs';
import { PART_HELP } from './part-help-content.mjs';
import { PART_SEARCH, ESSENTIAL_PARTS, searchParts } from './part-search.mjs';

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
  storage,
  placementActive = () => false,
}) {
  const panel = el('section', '', 'parts-browser');
  panel.dataset.partHelpInput = '';
  panel.setAttribute('aria-label', 'Part catalog');
  const head = el('div', '', 'catalog-head');
  const expand = el('button', 'Expand parts');
  const close = el('button', 'Close parts');
  close.hidden = true;
  head.append(expand, close);
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
    purpose = el('p'),
    favorite = el('button', 'Save to favorites');
  summary.append(name, purpose, favorite);
  const assemblies = el('button', 'Spring strut · Assemblies');
  assemblies.onclick = () => {
    conceal();
    openAssemblies();
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
  function describe(type, reason = '') {
    selected = type;
    name.textContent = CATALOG[type].name;
    purpose.textContent = reason || PART_HELP[type].purpose;
    favorite.textContent = favorites.includes(type) ? 'Remove favorite' : 'Save to favorites';
  }
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
        info.catalogRestore = () => restore(saved);
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
      restore(saved);
      origin = saved;
      conceal();
    };
    drag(tile, type);
    wrapper.append(reason);
    grid.append(wrapper);
    cards.set(type, { wrapper, tile, reason, info });
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
    const visible = new Map(rows.map((r, i) => [r.type, { ...r, i }]));
    for (const [type, card] of cards) {
      const result = visible.get(type);
      card.wrapper.hidden = !result;
      card.tile.disabled = !editable;
      card.tile.draggable = editable;
      card.reason.textContent = result?.reason ?? '';
    }
    // Reorder only on explicit browse/search actions, never on simulation frames.
    for (const { type } of rows) grid.append(cards.get(type).wrapper);
    for (const [label, b] of tabs)
      b.setAttribute('aria-pressed', String(!query && label === category));
    count.textContent = rows.length
      ? `${query ? 'All parts' : category} · ${rows.length}`
      : query
        ? 'No matching parts. Try battery, wheel, or sensor.'
        : category === 'Recent'
          ? 'Parts appear here after placement.'
          : 'Save parts using the favorite action.';
    assemblies.hidden = !/spring|suspension/i.test(query) || !openAssemblies;
    summary.hidden = !rows.length;
    if (rows.length)
      describe(visible.has(selected) ? selected : rows[0].type, visible.get(selected)?.reason);
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
  function restore(saved) {
    category = saved.category;
    search.value = saved.query;
    selected = saved.selected;
    savedScroll = new Map(saved.savedScroll);
    refresh();
    if (saved.expanded) show();
    else conceal();
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
    close.hidden = false;
    expand.textContent = 'Return to workbench';
  }
  function conceal() {
    expanded = false;
    panel.classList.remove('catalog-expanded');
    close.hidden = true;
    expand.textContent = 'Expand parts';
  }
  expand.onclick = () => (expanded ? conceal() : show());
  close.onclick = () => {
    conceal();
    expand.focus();
  };
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
  favorite.onclick = () => {
    favorites = favorites.includes(selected)
      ? favorites.filter((t) => t !== selected)
      : [...favorites, selected];
    persist();
    refresh();
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
      expand.focus();
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
      if (origin) restore(origin);
      const tile = cards.get(type)?.tile;
      (tile && !tile.disabled ? tile : expand).focus({ preventScroll: true });
    },
    update(mode, busy = false) {
      const next = mode === 'build' && !busy;
      const message = busy
        ? 'Finish or cancel the assembly operation to add parts.'
        : next
          ? ''
          : 'Return to Build to add parts.';
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

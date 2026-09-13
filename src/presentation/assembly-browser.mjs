import { DEFAULT_CONTROL_BINDING } from '../model/control-bindings.mjs';
import { createDialogClose, createDialogHeader } from './dialog-close.mjs';
const el = (tag, text = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
const button = (text, action) => {
  const n = el('button', text);
  n.type = 'button';
  n.onclick = action;
  return n;
};
/** Saved definitions have a separate selection and lifetime from machine instances. */
export function createAssemblyBrowser({
  library,
  builtInAssemblies = [],
  onPlace,
  onCreate,
  thumbnail,
  editable,
  canCreate = editable,
}) {
  const dialog = el('dialog');
  dialog.className = 'assembly-browser';
  dialog.setAttribute('aria-label', 'Assemblies');
  const header = createDialogHeader(
    el('h2', 'Assemblies'),
    createDialogClose('Close assemblies', () => dialog.close()),
  );
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Search assemblies';
  search.setAttribute('aria-label', 'Search assemblies');
  const sort = el('select');
  sort.setAttribute('aria-label', 'Sort assemblies');
  for (const [v, t] of [
    ['recent', 'Recent first'],
    ['name', 'Name'],
  ]) {
    const o = el('option', t);
    o.value = v;
    sort.append(o);
  }
  const collection = el('select');
  collection.setAttribute('aria-label', 'Assembly collection');
  for (const [value, label] of [
    ['all', 'All assemblies'],
    ['builtin', 'Built-in'],
    ['saved', 'My saved'],
  ]) {
    const option = el('option', label);
    option.value = value;
    collection.append(option);
  }
  const filters = el('div');
  filters.className = 'assembly-filters';
  filters.append(search, collection, sort);
  const body = el('div');
  body.className = 'assembly-browser-body';
  const list = el('div'),
    detail = el('section');
  list.className = 'assembly-results';
  detail.className = 'assembly-detail';
  detail.setAttribute('aria-label', 'Assembly details');
  body.append(list, detail);
  const status = el('p');
  status.setAttribute('role', 'status');
  dialog.append(header, filters, body, status);
  let selected = null,
    scroll = 0,
    invoker = null,
    observer = null;
  const fail = (e) => {
    status.textContent = e.message ?? String(e);
  };
  function image(item) {
    const box = el('div');
    box.className = 'assembly-thumbnail';
    box.setAttribute('aria-label', item.definition.name + ' preview');
    box.textContent = 'Preview';
    box.dataset.thumbnail = item.id;
    return box;
  }
  function drawDetail(item) {
    detail.replaceChildren();
    if (!item) dialog.classList.remove('show-assembly-detail');
    if (!item) return;
    const back = button('Back to results', () => {
      dialog.classList.remove('show-assembly-detail');
      list.querySelector(`[data-library-id="${CSS.escape(item.id)}"]`)?.focus();
    });
    back.className = 'assembly-back';
    const place = button('Place in machine', () => {
      scroll = list.scrollTop;
      dialog.close();
      onPlace(item);
    });
    place.className = 'primary';
    place.disabled = !editable();
    detail.append(
      back,
      image(item),
      el('h3', item.definition.name),
      el(
        'p',
        `${item.definition.parts.length} parts · ${item.definition.assemblies[0].ports.map((p) => p.name).join(', ') || 'No named connection points'}`,
      ),
      place,
    );
    if (!editable()) detail.append(el('p', 'Return to Build to place this assembly.'));
    const settings = el('details');
    settings.append(el('summary', item.builtIn ? 'Inspect parts' : 'Inspect saved parts'));
    for (const part of item.definition.parts) {
      settings.append(el('strong', part.name));
      for (const [key, value] of Object.entries(part.parameters))
        settings.append(el('small', `${key}: ${value}`));
      if (part.type === 'commandReceiver') {
        const b = part.controlBinding ?? DEFAULT_CONTROL_BINDING;
        for (const axis of ['drive', 'steer'])
          settings.append(
            el(
              'small',
              `${axis}: ${b[axis].positiveKeys.join(', ')} / ${b[axis].negativeKeys.join(', ')} · gain ${b[axis].gain}`,
            ),
          );
      }
    }
    detail.append(settings);
    if (item.builtIn) return;
    const actions = el('details');
    actions.append(el('summary', 'Saved item actions'));
    const name = el('input');
    name.value = item.definition.name;
    name.maxLength = 128;
    name.setAttribute('aria-label', `Saved name ${item.definition.name}`);
    actions.append(
      name,
      button('Rename saved assembly', () => {
        try {
          library.rename(item.id, name.value.trim());
          draw();
          status.textContent = 'Saved assembly renamed.';
          detail.querySelector('.primary')?.focus();
        } catch (e) {
          fail(e);
        }
      }),
    );
    const remove = button(`Remove saved ${item.definition.name}`, () => {
      const confirm = el('div');
      confirm.append(
        el('p', `Remove saved ${item.definition.name}? Placed copies remain in the machine.`),
        button('Remove saved item', () => {
          try {
            library.remove(item.id);
            selected = null;
            draw();
            status.textContent = 'Removed saved item. Placed copies remain.';
            search.focus();
          } catch (e) {
            fail(e);
          }
        }),
        button('Keep saved item', () => {
          confirm.remove();
          remove.focus();
        }),
      );
      actions.append(confirm);
      confirm.querySelector('button').focus();
    });
    actions.append(remove);
    detail.append(actions);
  }
  function draw() {
    observer?.disconnect();
    list.replaceChildren();
    try {
      const saved = library.list();
      const builtIns = builtInAssemblies.map((item) => ({ ...item, builtIn: true }));
      const all =
        collection.value === 'saved'
          ? saved
          : collection.value === 'builtin'
            ? builtIns
            : [...builtIns, ...saved];
      let items = all.filter((x) =>
        x.definition.name.toLowerCase().includes(search.value.toLowerCase()),
      );
      if (sort.value === 'name')
        items.sort((a, b) => a.definition.name.localeCompare(b.definition.name));
      else items.reverse();
      if (!items.length) {
        list.append(el('p', search.value ? 'No matching assemblies.' : 'No saved assemblies yet.'));
        list.append(
          search.value
            ? button('Clear search', () => {
                search.value = '';
                draw();
                search.focus();
              })
            : button('Create assembly…', () => {
                dialog.close();
                onCreate();
              }),
        );
        if (!search.value && !canCreate()) {
          list.lastElementChild.disabled = true;
          list.append(el('p', 'Place some ungrouped parts in Build, then create an assembly.'));
        }
      }
      if (!items.some((x) => x.id === selected)) selected = items[0]?.id ?? null;
      for (const item of items) {
        const tile = button('', () => {
          selected = item.id;
          dialog.classList.add('show-assembly-detail');
          draw();
          (matchMedia('(max-width: 700px)').matches
            ? detail.querySelector('button')
            : list.querySelector(`[data-library-id="${CSS.escape(item.id)}"]`)
          )?.focus();
        });
        tile.className = 'assembly-card';
        tile.dataset.libraryId = item.id;
        tile.setAttribute('aria-label', item.definition.name);
        tile.setAttribute('aria-pressed', String(item.id === selected));
        tile.append(
          image(item),
          el('strong', item.definition.name),
          el(
            'small',
            `${item.definition.parts.length} parts · ${item.builtIn ? 'Built-in' : 'My saved'}`,
          ),
        );
        list.append(tile);
      }
      drawDetail(items.find((x) => x.id === selected));
      list.scrollTop = scroll;
      const hydrate = (box) => {
        try {
          const item = items.find((x) => x.id === box.dataset.thumbnail);
          if (item) box.replaceChildren(thumbnail(item.definition));
        } catch {
          box.textContent = 'Preview unavailable';
        }
      };
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            hydrate(entry.target);
            observer.unobserve(entry.target);
          }
      });
      for (const box of body.querySelectorAll('[data-thumbnail]')) observer.observe(box);
    } catch (e) {
      fail(e);
    }
  }
  list.onscroll = () => {
    scroll = list.scrollTop;
  };
  search.oninput = () => {
    scroll = 0;
    draw();
    dialog.classList.remove('show-assembly-detail');
  };
  collection.onchange = () => {
    scroll = 0;
    selected = null;
    dialog.classList.remove('show-assembly-detail');
    draw();
  };
  sort.onchange = () => {
    scroll = 0;
    draw();
  };
  dialog.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dialog.close();
      }
    },
    true,
  );
  dialog.addEventListener('close', () => {
    observer?.disconnect();
    if (invoker?.isConnected) invoker.focus();
  });
  return {
    dialog,
    open(returnFocus = document.activeElement) {
      invoker = returnFocus;
      status.textContent = '';
      dialog.showModal();
      draw();
      dialog.classList.remove('show-assembly-detail');
      search.focus();
    },
    dispose() {
      observer?.disconnect();
      dialog.remove();
    },
  };
}

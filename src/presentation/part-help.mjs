import { CATALOG } from '../model/catalog.mjs';
import { PART_HELP, PART_EXAMPLES } from './part-help-content.mjs';
import {
  createPartHelpDiagram,
  connectionKindText,
  examplePartName,
  examplePortLabel,
} from './part-help-diagram.mjs';
const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
const endpointText = (example, endpoint) => {
  return `${examplePartName(example, endpoint.node)} · ${examplePortLabel(example.nodes[endpoint.node], endpoint.port)}`;
};
export function createPartHelp({ container, fallback, icon, busy, reveal }) {
  let current = null,
    opener = null,
    timer,
    tooltipTarget = null;
  const panel = el('section', '', 'part-help');
  panel.hidden = true;
  panel.dataset.partHelpInput = '';
  panel.setAttribute('aria-label', 'Part help');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  let diagrams = [],
    drag = null,
    expanded = false,
    savedBounds = null;
  function clearDiagrams() {
    diagrams.forEach((diagram) => diagram.dispose());
    diagrams = [];
  }
  function clampWindow() {
    if (panel.hidden) return;
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - rect.height - 8))}px`;
  }
  const cancelDrag = () => {
    drag = null;
  };
  window.addEventListener('blur', cancelDrag);
  window.addEventListener('resize', clampWindow);
  const windowObserver = new ResizeObserver(clampWindow);
  windowObserver.observe(panel);
  const tooltip = el('div', '', 'part-help-tooltip');
  tooltip.id = 'part-help-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  container.append(tooltip);
  function dismissTooltip() {
    clearTimeout(timer);
    const visible = !tooltip.hidden;
    tooltip.hidden = true;
    tooltipTarget = null;
    return visible;
  }
  function close() {
    if (panel.hidden) return;
    drag = null;
    panel.hidden = true;
    if (opener?.isConnected) {
      opener.catalogRestore?.();
      for (
        let ancestor = opener.parentElement;
        ancestor && ancestor !== container;
        ancestor = ancestor.parentElement
      ) {
        if (ancestor.tagName === 'DETAILS') ancestor.open = true;
      }
      opener.focus({ preventScroll: true });
      opener.scrollIntoView({ block: 'nearest' });
    } else fallback.focus({ preventScroll: true });
  }
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.target.closest('.part-help-content')
    )
      return;
    // Header focus is outside the scroll container; forward reading keys there.
    // Space on a button retains native activation, and tab arrows remain roving.
    if (event.key === ' ' && event.target.tagName !== 'H3') return;
    const content = panel.querySelector('.part-help-content:not([hidden])');
    if (!content) return;
    const page = Math.max(40, content.clientHeight - 40);
    const delta = {
      ' ': event.shiftKey ? -page : page,
      PageDown: page,
      PageUp: -page,
      ArrowDown: 40,
      ArrowUp: -40,
      Home: -content.scrollHeight,
      End: content.scrollHeight,
    }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    content.scrollBy({ top: delta, behavior: 'instant' });
  });
  function thumbnail(type) {
    const image = icon(type);
    const existing = container.querySelector(`[data-icon-type="${type}"][src]`);
    if (existing) image.src = existing.src;
    return image;
  }
  function exampleView(id) {
    const example = PART_EXAMPLES[id];
    const figure = el('figure', '', 'part-help-example');
    figure.append(
      el('h4', example.title),
      el('figcaption', 'Example connections — schematic, not to scale.'),
    );
    const diagram = createPartHelpDiagram(
      id,
      example,
      thumbnail,
      reveal
        ? (type) => {
            close();
            reveal(type);
          }
        : null,
    );
    diagrams.push(diagram);
    const legend = el('div', '', 'help-diagram-legend');
    for (const kind of new Set(example.edges.map((edge) => edge.kind))) {
      legend.append(el('span', connectionKindText[kind], `legend-${kind}`));
    }
    figure.append(diagram.element, legend);
    const steps = el('ol');
    for (const edge of example.edges)
      steps.append(
        el(
          'li',
          `${edge.kind === 'mount' ? 'Fix' : 'Connect'} ${endpointText(example, edge.a)} to ${endpointText(example, edge.b)} (${connectionKindText[edge.kind].toLowerCase()}).`,
        ),
      );
    figure.append(steps);
    for (const note of example.notes) figure.append(el('p', note));
    return figure;
  }
  function open(type, source) {
    dismissTooltip();
    opener = source;
    if (current !== type) {
      current = type;
      clearDiagrams();
      const content = PART_HELP[type];
      panel.replaceChildren();
      const titlebar = el('div', '', 'part-help-titlebar');
      const heading = el('h3', `About ${CATALOG[type].name}`);
      heading.tabIndex = -1;
      heading.setAttribute(
        'aria-description',
        'Drag to move this window. Use Alt and arrow keys to move with the keyboard.',
      );
      const expand = el('button', expanded ? '↙' : '↗');
      expand.type = 'button';
      expand.setAttribute('aria-label', expanded ? 'Restore help window' : 'Expand help window');
      expand.onclick = () => {
        if (expanded) {
          Object.assign(panel.style, savedBounds);
        } else {
          savedBounds = {
            left: panel.style.left,
            top: panel.style.top,
            width: panel.style.width,
            height: panel.style.height,
          };
          Object.assign(panel.style, {
            left: '8px',
            top: '8px',
            width: 'calc(100vw - 16px)',
            height: 'calc(100vh - 16px)',
          });
        }
        expanded = !expanded;
        expand.textContent = expanded ? '↙' : '↗';
        expand.setAttribute('aria-label', expanded ? 'Restore help window' : 'Expand help window');
        clampWindow();
      };
      const closeButton = el('button', '×');
      closeButton.type = 'button';
      closeButton.setAttribute('aria-label', 'Close part help');
      closeButton.onclick = close;
      titlebar.append(heading, expand, closeButton);
      titlebar.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('button') || expanded) return;
        event.preventDefault();
        heading.focus({ preventScroll: true });
        const rect = panel.getBoundingClientRect();
        drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        titlebar.setPointerCapture(event.pointerId);
      });
      titlebar.addEventListener('pointermove', (event) => {
        if (!drag) return;
        panel.style.left = `${drag.left + event.clientX - drag.x}px`;
        panel.style.top = `${drag.top + event.clientY - drag.y}px`;
        clampWindow();
      });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
        titlebar.addEventListener(event, () => {
          drag = null;
        });
      heading.addEventListener('keydown', (event) => {
        const delta = {
          ArrowLeft: [-20, 0],
          ArrowRight: [20, 0],
          ArrowUp: [0, -20],
          ArrowDown: [0, 20],
        }[event.key];
        if (!event.altKey || !delta || expanded) return;
        event.preventDefault();
        const rect = panel.getBoundingClientRect();
        panel.style.left = `${rect.left + delta[0]}px`;
        panel.style.top = `${rect.top + delta[1]}px`;
        clampWindow();
      });
      const tabs = el('div', '', 'part-help-tabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Part information');
      const overview = el('div', '', 'part-help-content');
      const portrait = thumbnail(type);
      portrait.classList.add('help-portrait');
      overview.append(
        portrait,
        el('p', content.purpose, 'help-purpose'),
        el('p', content.explanation),
        el('h4', 'What it needs'),
        el('p', content.needs),
      );
      const connections = el('div', '', 'part-help-content');
      connections.append(
        el(
          'p',
          'Examples explain this kind of part; they do not show your current wiring.',
          'muted small',
        ),
      );
      for (const id of content.examples) {
        if (type === 'powerCell' && id === 'power') {
          const extra = el('details');
          extra.append(el('summary', 'Power several parts'), exampleView(id));
          connections.append(extra);
        } else connections.append(exampleView(id));
      }
      connections.append(el('h4', 'How to connect'));
      const steps = el('ol');
      for (const step of content.steps) steps.append(el('li', step));
      connections.append(steps);
      const pages = [overview, connections];
      const buttons = ['Overview', 'How to connect'].map((label, index) => {
        const button = el('button', label);
        button.type = 'button';
        button.id = `part-help-tab-${index}`;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', `part-help-page-${index}`);
        pages[index].id = `part-help-page-${index}`;
        pages[index].setAttribute('role', 'tabpanel');
        pages[index].setAttribute('aria-labelledby', button.id);
        pages[index].tabIndex = 0;
        button.onclick = () => selectTab(index);
        tabs.append(button);
        return button;
      });
      function selectTab(index) {
        pages.forEach((page, i) => {
          page.hidden = i !== index;
          buttons[i].setAttribute('aria-selected', String(i === index));
          buttons[i].tabIndex = i === index ? 0 : -1;
        });
      }
      tabs.addEventListener('keydown', (event) => {
        const index = buttons.indexOf(event.target);
        const next = { ArrowLeft: 1 - index, ArrowRight: 1 - index, Home: 0, End: 1 }[event.key];
        if (index < 0 || next === undefined) return;
        event.preventDefault();
        selectTab(next);
        buttons[next].focus();
      });
      selectTab(0);
      panel.append(titlebar, tabs, ...pages);
    }
    panel.hidden = false;
    if (!panel.style.left) {
      panel.style.left = `${Math.max(8, Math.min(window.innerWidth - Math.min(700, window.innerWidth - 16) - 8, Math.max(container.getBoundingClientRect().right + 24, (window.innerWidth - 700) / 2)))}px`;
      panel.style.top = '72px';
    }
    clampWindow();
    panel.querySelector('h3').focus({ preventScroll: true });
  }
  function about(type, label = `About ${CATALOG[type].name}`) {
    const button = el('button', label, 'part-about');
    button.type = 'button';
    button.dataset.partHelpInput = '';
    button.dataset.helpType = type;
    button.onclick = () => open(type, button);
    return button;
  }
  function showTooltip(target, type) {
    clearTimeout(timer);
    if (busy()) return;
    tooltipTarget = target;
    tooltip.textContent = PART_HELP[type].explanation;
    tooltip.hidden = false;
    const rect = target.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 288))}px`;
    const height = tooltip.offsetHeight;
    const top =
      rect.bottom + height + 12 <= window.innerHeight ? rect.bottom + 4 : rect.top - height - 4;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }
  const deferHide = () => {
    clearTimeout(timer);
    timer = setTimeout(dismissTooltip, 150);
  };
  tooltip.addEventListener('pointerenter', () => clearTimeout(timer));
  tooltip.addEventListener('pointerleave', deferHide);
  function entry(target, type) {
    const wrapper = el('div', '', 'part-entry');
    const copy = el('span', PART_HELP[type].purpose, 'part-purpose');
    target.append(copy);
    target.setAttribute('aria-label', CATALOG[type].name);
    const description = el('span', PART_HELP[type].explanation, 'sr-only');
    description.id = `part-description-${type}`;
    target.setAttribute('aria-describedby', description.id);
    target.addEventListener('pointerenter', () => {
      dismissTooltip();
      timer = setTimeout(() => showTooltip(target, type), 350);
    });
    target.addEventListener('pointerleave', deferHide);
    let pointerFocus = false;
    target.addEventListener('pointerdown', () => {
      pointerFocus = true;
      dismissTooltip();
    });
    target.addEventListener('pointerup', () => {
      pointerFocus = false;
    });
    target.addEventListener('focus', () => {
      if (!pointerFocus) showTooltip(target, type);
    });
    target.addEventListener('blur', () => {
      pointerFocus = false;
      dismissTooltip();
    });
    const info = about(type);
    info.textContent = 'ⓘ';
    info.setAttribute('aria-label', `About ${CATALOG[type].name}`);
    wrapper.append(target, info, description);
    return wrapper;
  }
  function suppress() {
    dismissTooltip();
  }
  document.addEventListener('pointerdown', suppress, true);
  document.addEventListener('dragstart', suppress, true);
  return {
    panel,
    close,
    about,
    entry,
    dismissTooltip,
    update() {
      if (tooltipTarget && busy()) dismissTooltip();
    },
    dispose() {
      dismissTooltip();
      document.removeEventListener('pointerdown', suppress, true);
      document.removeEventListener('dragstart', suppress, true);
      clearDiagrams();
      drag = null;
      windowObserver.disconnect();
      window.removeEventListener('resize', clampWindow);
      window.removeEventListener('blur', cancelDrag);
      panel.remove();
      tooltip.remove();
    },
  };
}

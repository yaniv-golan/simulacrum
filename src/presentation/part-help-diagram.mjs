import { CATALOG } from '../model/catalog.mjs';
import { portLabel } from './port-wording.mjs';
// Only schematic placement: no physical pose, mounting or admission policy.
const layouts = {
  powerOne: { cell: [0, 0], motor: [1, 0] },
  spring: { guide: [0, 0], carriage: [1, 0] },
  power: { cell: [0, 0], bus: [1, 0], first: [2, 0], second: [2, 1] },
  drive: { cell: [0, 0], motor: [1, 0], wheel: [2, 0], support: [1, 1] },
  free: { bearing: [0, 0], wheel: [2, 0], support: [0, 1] },
  steer: { cell: [0, 0], hinge: [1, 0], hub: [2, 0], support: [1, 1], wheel: [2, 1] },
};
export const connectionKindText = {
  mount: 'Fixed mounting',
  spring: 'Guided slide',
  power: 'Power wire',
  shaft: 'Rotating attachment',
  pivot: 'Pinned joint',
};
export function examplePartName(example, id) {
  const type = example.nodes[id],
    peers = Object.keys(example.nodes).filter((key) => example.nodes[key] === type);
  return CATALOG[type].name + (peers.length > 1 ? ` ${peers.indexOf(id) + 1}` : '');
}
export function examplePortLabel(type, id) {
  const port = CATALOG[type].ports.find((p) => p.id === id);
  return port ? portLabel({ type }, port) : `${id} surface`;
}
const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
const svgEl = (tag, attrs) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};
export function createPartHelpDiagram(id, example, thumbnail, reveal) {
  const graph = el('div', '', 'help-diagram'),
    nodes = new Map();
  if (!reveal) graph.setAttribute('aria-hidden', 'true');
  const lines = svgEl('svg', { class: 'help-diagram-lines' });
  graph.append(lines);
  for (const [key, type] of Object.entries(example.nodes)) {
    const card = el('div', '', 'help-diagram-node');
    card.dataset.exampleNode = key;
    const [col, row] = layouts[id][key];
    card.style.setProperty('--diagram-col', col + 1);
    card.style.setProperty('--diagram-row', row + 1);
    card.append(thumbnail(type), el('strong', examplePartName(example, key)));
    const ports = new Set(
      example.edges
        .flatMap((edge) => [edge.a, edge.b])
        .filter((end) => end.node === key)
        .map((end) => end.port),
    );
    for (const port of ports)
      card.append(el('span', examplePortLabel(type, port), 'help-diagram-port'));
    if (example.motions?.[key]) {
      const motion = el('span', '', 'help-motion');
      const svg = svgEl('svg', { viewBox: '0 0 40 28' });
      svg.append(
        svgEl('path', {
          d:
            id === 'spring'
              ? 'M5 14 L35 14 M11 8 L5 14 L11 20 M29 8 L35 14 L29 20'
              : 'M8 22 A13 10 0 1 1 31 20 M31 13 L31 20 L24 19',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 2,
        }),
      );
      motion.append(svg, el('span', example.motions[key]));
      card.append(motion);
    }
    if (reveal) {
      const find = el('button', 'Find in parts', 'help-find-part');
      find.type = 'button';
      find.setAttribute('aria-label', `Find ${CATALOG[type].name} in parts`);
      find.onclick = () => reveal(type);
      card.append(find);
    }
    graph.append(card);
    nodes.set(key, card);
  }
  function draw() {
    const bounds = graph.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    lines.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    const wires = svgEl('g', {}),
      badges = svgEl('g', {});
    lines.replaceChildren(wires, badges);
    const narrow = bounds.width < 470;
    for (const [index, edge] of example.edges.entries()) {
      const a = nodes.get(edge.a.node).getBoundingClientRect(),
        b = nodes.get(edge.b.node).getBoundingClientRect();
      let x1, y1, x2, y2, mx, my, d;
      if (narrow) {
        x1 = a.left - bounds.left;
        y1 = a.top + a.height / 2 - bounds.top;
        x2 = b.left - bounds.left;
        y2 = b.top + b.height / 2 - bounds.top;
        mx = 14 + index * 13;
        my = (y1 + y2) / 2;
        d = `M${x1} ${y1}H${mx}V${y2}H${x2}`;
      } else if (Math.abs(a.left - b.left) < 10) {
        const downward = b.top > a.top;
        x1 = a.left + a.width / 2 - bounds.left;
        y1 = (downward ? a.bottom : a.top) - bounds.top;
        x2 = b.left + b.width / 2 - bounds.left;
        y2 = (downward ? b.top : b.bottom) - bounds.top;
        mx = x1;
        my = (y1 + y2) / 2;
        d = `M${x1} ${y1}V${my}H${x2}V${y2}`;
      } else {
        const rightward = b.left > a.left;
        x1 = (rightward ? a.right : a.left) - bounds.left;
        y1 = a.top + a.height / 2 - bounds.top;
        x2 = (rightward ? b.left : b.right) - bounds.left;
        y2 = b.top + b.height / 2 - bounds.top;
        mx = (x1 + x2) / 2;
        my = (y1 + y2) / 2;
        d = `M${x1} ${y1}H${mx}V${y2}H${x2}`;
      }
      wires.append(
        svgEl('path', { d, class: `diagram-wire diagram-wire-${edge.kind}`, fill: 'none' }),
      );
      if (edge.kind === 'mount')
        wires.append(svgEl('path', { d, class: 'diagram-wire-mount-center', fill: 'none' }));
      badges.append(svgEl('circle', { cx: mx, cy: my, r: 10, class: 'diagram-edge-number' }));
      const label = svgEl('text', {
        x: mx,
        y: my + 4,
        'text-anchor': 'middle',
        class: 'diagram-edge-text',
      });
      label.textContent = String(index + 1);
      badges.append(label);
    }
  }
  const observer = new ResizeObserver(draw);
  observer.observe(graph);
  return {
    element: graph,
    dispose() {
      observer.disconnect();
    },
  };
}

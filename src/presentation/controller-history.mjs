import { portLabel } from './port-wording.mjs';
const statusLabel = {
  ok: 'Ready',
  'no-power': 'Needs power',
  'no-return': 'No object detected',
  initializing: 'Waiting for a second reading',
  unavailable: 'Unavailable',
  disconnected: 'Not connected',
};
export function decisionText(row) {
  return [
    `Inputs measured at ${(row.sampleTick / 120).toFixed(3)} s → decision at ${(row.tick / 120).toFixed(3)} s`,
    ...row.inputs.map(
      (i) =>
        `${i.name} · ${portLabel({ type: i.kind + 'Sensor' }, { id: i.channel, kind: 'signal' })}: ${i.status === 'ok' ? i.value.toFixed(3) + ' ' + i.unit : statusLabel[i.status]}`,
    ),
    ...row.markers.map(
      (m) => `Rule ${Math.floor(m / 2) + 1}: ${m % 2 ? 'otherwise' : 'condition met'}`,
    ),
    ...row.outputs.map(
      (o) =>
        `${o.name}: ${o.requested === null ? 'Requested duty unavailable' : 'Requested ' + o.requested.toFixed(2)} → applied ${o.applied?.toFixed(2) ?? 'unavailable'} · ${o.owner}${o.reason === 'OK' ? '' : ' · ' + o.reason}`,
    ),
    ...(row.error ? [row.error] : []),
    'A command does not prove that the machine moved.',
  ].join('\n');
}
export function mountControllerHistory({ right, part, blueprint, history, send, inspectPart }) {
  if (!history || !['logicController', 'learningController'].includes(part.type)) return;
  const el = (tag, text = '') => {
    const e = document.createElement(tag);
    e.textContent = text;
    return e;
  };
  const details = el('details');
  details.className = 'controller-history';
  details.append(el('summary', 'Inspect previous decisions'));
  details.append(
    el('p', 'Historical, never live. Recent history is temporary. Export a decision to keep it.'),
  );
  const select = el('select');
  select.setAttribute('aria-label', 'Historical controller decision');
  const pre = el('pre'),
    actions = el('div');
  let rows = [];
  const button = (name, fn) => {
    const b = el('button', name);
    b.type = 'button';
    b.onclick = fn;
    return b;
  };
  function show() {
    const row = rows[Number(select.value)];
    actions.replaceChildren();
    pre.textContent = row
      ? 'Historical · ' + decisionText(row)
      : 'Run the machine to record decisions.';
    if (!row) return;
    for (const input of row.inputs)
      actions.append(
        button('Repair ' + input.name, async () => {
          const r = await send({ type: 'build' });
          if (r?.ok !== false) inspectPart(input.partId);
        }),
      );
    actions.append(
      button('Change rule or mechanism', async () => {
        const r = await send({ type: 'build' });
        if (r?.ok !== false) inspectPart(part.id);
      }),
    );
    actions.append(
      button('Export this decision', () => {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(row, null, 2)], { type: 'application/json' }),
        );
        const a = el('a');
        a.href = url;
        a.download = 'controller-decision.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
    );
    const source = el('details');
    source.append(
      el('summary', 'Program at this historical moment'),
      el('pre', row.source ?? 'Learning policy; inspect its saved attempt for model details.'),
    );
    actions.append(source);
  }
  function refresh() {
    rows = history.read(blueprint.id, part.id);
    select.replaceChildren();
    rows.forEach((r, i) => {
      const o = el(
        'option',
        `Run ${r.run} · ${(r.tick / 120).toFixed(3)} s${r.error || r.inputs.some((x) => x.status === 'no-power') ? ' · fault' : ''}`,
      );
      o.value = i;
      select.append(o);
    });
    select.value = Math.max(0, rows.length - 1);
    show();
  }
  select.onchange = show;
  details.addEventListener('toggle', () => {
    if (details.open) refresh();
  });
  details.append(button('Refresh captured decisions', refresh), select, pre, actions);
  right.append(details);
}

import { SENSOR_DEFINITIONS } from '../model/sensors.mjs';
const label = {
  ok: 'Ready',
  'no-power': 'Needs power',
  'no-return': 'No object detected',
  initializing: 'Waiting for a second compatible reading',
  unavailable: 'Measurement unavailable',
  disconnected: 'Not connected',
};
const element = (tag, text = '') => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};
export function sensorInspector({ part, blueprint, right, editable, send }) {
  const kind = part.type.endsWith('Sensor') ? part.type.slice(0, -6) : null;
  if (!SENSOR_DEFINITIONS[kind]) return;
  const box = element('section');
  box.className = 'sensor-inspector';
  box.dataset.sensorId = part.id;
  box.append(
    element('h3', 'What this sensor sees'),
    element(
      'p',
      'Connect Power to a cell. Signal wires carry measurements; they do not supply power.',
    ),
  );
  const readout = element('p');
  readout.className = 'sensor-live';
  readout.setAttribute('aria-live', 'off');
  box.append(readout);
  if (part.type === 'jointAngleSensor') {
    const text = element('label', 'Measured axle connection'),
      select = element('select');
    select.disabled = !editable;
    select.setAttribute('aria-label', 'Measured axle connection');
    const none = element('option', 'Unbound');
    none.value = '';
    select.append(none);
    for (const edge of blueprint.connections.filter((c) => c.kind === 'shaft')) {
      const o = element(
        'option',
        [edge.a.part, edge.b.part]
          .map((id) => blueprint.parts.find((p) => p.id === id)?.name ?? id)
          .join(' ↔ '),
      );
      o.value = edge.id;
      select.append(o);
    }
    select.value = part.jointBinding ?? '';
    select.onchange = () =>
      send({ type: 'bind-joint-sensor', id: part.id, connection: select.value || null });
    text.append(select);
    box.append(text);
    const diagram = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    diagram.setAttribute('viewBox', '0 0 120 90');
    diagram.setAttribute('width', '120');
    diagram.setAttribute('height', '90');
    diagram.setAttribute('role', 'img');
    diagram.setAttribute('aria-label', 'Measured joint angle relative to authored zero');
    diagram.classList.add('joint-angle-preview');
    const circle = document.createElementNS(diagram.namespaceURI, 'circle');
    for (const [k, v] of Object.entries({ cx: 60, cy: 45, r: 30, fill: 'none', stroke: '#789' }))
      circle.setAttribute(k, v);
    const zero = document.createElementNS(diagram.namespaceURI, 'line');
    for (const [k, v] of Object.entries({ x1: 60, y1: 45, x2: 90, y2: 45, stroke: '#789' }))
      zero.setAttribute(k, v);
    const needle = document.createElementNS(diagram.namespaceURI, 'line');
    needle.classList.add('joint-angle-needle');
    for (const [k, v] of Object.entries({
      x1: 60,
      y1: 45,
      x2: 90,
      y2: 45,
      stroke: '#ffd36b',
      'stroke-width': 3,
    }))
      needle.setAttribute(k, v);
    diagram.append(circle, zero, needle);
    box.append(
      diagram,
      element(
        'p',
        'Angle from your authored zero, wrapped to −π…π. The diagram shows the measurement, not a motor target.',
      ),
    );
  }
  box.append(
    element(
      'p',
      {
        loadCell:
          'Mount A — support on the left and B — measured on the right. The arrow points A → B: positive axial force means pull, negative means push. Attachment force includes sideways load; neither channel measures torque or peak force.',
        range:
          'The ray stops at the first surface. Closing speed is not the machine’s driving speed. Rotate or move this part to aim it.',
        contact:
          'Only the outlined front face senses touch and average normal load. Side and back contacts belong to the casing.',
        tilt: 'Tilt is relative to gravity. Angular velocity uses this part’s local axes; there is no absolute compass heading.',
        linearMotion:
          'Velocity is measured at this sensor’s origin in its local X, Y and Z directions, relative to the stationary world.',
        jointAngle: 'This measures the selected joint. It does not move or hold the joint.',
        rotation: 'Angular speed is measured around the selected local axis.',
        travel: 'Length is the total spring length. Speed is signed along its guide.',
        target: 'Legacy paired-centre measurement. It does not detect intervening obstacles.',
      }[kind],
    ),
  );
  if (kind === 'loadCell')
    box.append(
      element(
        'p',
        'Start with the receiver Off or Manual. Run until a valid reading appears, then select Automatic. After an invalid reading switches it Off, repair the cause and select Automatic again.',
      ),
      element(
        'p',
        'If another connection bypasses B, the measurement is unavailable. Check both mounts and power first; an unavailable reading can also mean the force could not be measured.',
      ),
    );
  right.append(box);
}
export function updateSensorInspector(frame, right) {
  const box = right.querySelector('.sensor-inspector');
  if (!box) return;
  const index = frame.metadata.blueprint.parts.findIndex((p) => p.id === box.dataset.sensorId),
    part = frame.metadata.blueprint.parts[index],
    kind = part?.type.slice(0, -6),
    reading = frame.sensors.readings.find((r) => r.node === index);
  const needle = box.querySelector('.joint-angle-needle'),
    angle = reading?.channels.angle;
  if (needle) {
    needle.style.display = angle?.status === 'ok' ? '' : 'none';
    if (angle?.status === 'ok') {
      needle.setAttribute('x2', 60 + 30 * Math.cos(angle.value));
      needle.setAttribute('y2', 45 - 30 * Math.sin(angle.value));
    }
  }
  box.querySelector('.sensor-live').textContent = reading
    ? Object.entries(reading.channels)
        .map(([name, s]) => {
          const channel =
              kind === 'loadCell'
                ? { axialForce: 'Axial force (+ pull / − push)', load: 'Attachment force' }[name]
                : name,
            status =
              kind === 'loadCell' && s.status === 'initializing'
                ? 'Waiting for the first completed force reading'
                : label[s.status];
          return `${channel}: ${s.status === 'ok' ? s.value.toFixed(3) + ' ' + SENSOR_DEFINITIONS[kind][name].unit : status}`;
        })
        .join(' · ')
    : 'No completed reading yet.';
}

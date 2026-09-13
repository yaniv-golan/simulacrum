import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { proposeSurfaceMount, snapConnection } from '../src/model/assembly.mjs';

// Ordinary authored geometry only. The browser must add every control and wire.
export function mechanicalLoadCellPress() {
  let b = createEmptyBlueprint('force-press-browser', 'Force press');
  b.parts.push(
    createPart('chassis', 'base', [0, 0.02, 0]),
    createPart('loadCellSensor', 'sensor', [2, 1, 0]),
  );
  const mount = (part, sourceRegion, targetPart, targetRegion, id, u = 0, v = 0, twist = 0) => {
    b = proposeSurfaceMount(b, {
      part,
      sourceRegion,
      targetPart,
      targetRegion,
      id,
      u,
      v,
      twist,
    }).blueprint;
  };
  mount('sensor', 'left', 'base', 'top', 'sensor-A', 0.1);
  b.parts.push(createPart('spacerBlock', 'pressed', [2, 1, 1]));
  mount('pressed', 'left', 'sensor', 'right', 'sensor-B');
  b.parts.push(createPart('chassis', 'column', [2, 1, 2]));
  mount('column', 'back', 'base', 'top', 'column-base');
  b.parts.push(createPart('linearActuator', 'drive', [2, 1, 3]));
  mount('drive', 'right', 'column', 'top', 'drive-column', 0, 0.18, -Math.PI / 2);
  b.parts.push(createPart('springCarriage', 'carriage', [2, 1, 4]));
  const a = { part: 'drive', port: 'slide' },
    output = { part: 'carriage', port: 'slide' };
  b = snapConnection(b, a, output);
  b.connections.push({ id: 'stroke', kind: 'spring', a, b: output });
  return b;
}

export function mechanicalLoadCellStand() {
  const press = mechanicalLoadCellPress();
  const ids = new Set(['base', 'sensor', 'pressed']);
  press.parts = press.parts.filter((part) => ids.has(part.id));
  press.connections = press.connections.filter((c) => ids.has(c.a.part) && ids.has(c.b.part));
  press.id = 'load-cell-copy-browser';
  press.name = 'Load Cell stand';
  return press;
}

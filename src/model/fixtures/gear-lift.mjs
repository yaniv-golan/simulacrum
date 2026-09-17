import { createEmptyBlueprint, createPart } from '../blueprint.mjs';
import { proposeSurfaceMount, snapConnection, compileAssembly } from '../assembly.mjs';

/** An editable gravity-loaded arm with a supported 12:24 (or 24:12) transmission. */
export function createGearLift({ reduction = true } = {}) {
  let bp = createEmptyBlueprint('gear-lift', 'Gear lift');
  const part = (type, id, position = [0, 1, 0]) => {
    bp.parts.push(createPart(type, id, position));
    return bp.parts.at(-1);
  };
  const mount = (id, sourceRegion, targetPart, targetRegion, u = 0, v = 0, twist = 0) => {
    bp = proposeSurfaceMount(bp, {
      part: id,
      sourceRegion,
      targetPart,
      targetRegion,
      u,
      v,
      twist,
      id: `mount-${id}`,
    }).blueprint;
  };
  const shaft = (id, a, ap, b, bpPort) => {
    const edge = { id, kind: 'shaft', a: { part: a, port: ap }, b: { part: b, port: bpPort } };
    bp = snapConnection(bp, edge.a, edge.b);
    bp.connections.push(edge);
  };
  // The wide chassis is an ordinary movable carrier, held by its ground contacts.
  part('chassis', 'base', [0, 0.02, 0]);
  part('chassis', 'carrier');
  mount('carrier', 'left', 'base', 'top');
  part('poweredMotor', 'motor').parameters.currentLimit = 0.45;
  mount('motor', 'left', 'carrier', 'bottom', 0, -0.09);
  part('plate', 'bearing-spacer');
  mount('bearing-spacer', 'bottom', 'carrier', 'bottom', 0, 0.09);
  part('passiveBearing', 'bearing');
  mount('bearing', 'left', 'bearing-spacer', 'top');
  // Both gears are the same catalog row; the tooth count is the authored choice that makes the
  // ratio, and 12 + 24 keeps the shaft spacing the two surface mounts above already fix.
  part('spurGear', 'input-gear').parameters.teeth = reduction ? 12 : 24;
  shaft('input-shaft', 'motor', 'shaft', 'input-gear', 'left');
  part('steelAxle', 'output-axle');
  shaft('bearing-shaft', 'bearing', 'shaft', 'output-axle', 'left');
  part('spurGear', 'output-gear').parameters.teeth = reduction ? 24 : 12;
  shaft('output-shaft', 'output-axle', 'right', 'output-gear', 'left');
  // Separate the arm plane from the gears so both faces remain inspectable
  // from the workshop camera; the extra axle is an ordinary authored part.
  part('steelAxle', 'arm-axle');
  shaft('arm-extension', 'output-gear', 'right', 'arm-axle', 'left');
  part('shaftMount', 'arm-adapter');
  shaft('arm-shaft', 'arm-axle', 'right', 'arm-adapter', 'shaft');
  part('plate', 'arm');
  mount('arm', 'bottom', 'arm-adapter', 'right');
  part('mountingBlock', 'load').authoredMaterial.body = 'steel';
  mount('load', 'back', 'arm', 'top', 0, 0.06);
  part('powerCell', 'cell');
  mount('cell', 'left', 'carrier', 'top');
  bp.connections.push({
    id: 'power',
    kind: 'power',
    a: { part: 'cell', port: 'power' },
    b: { part: 'motor', port: 'power' },
  });
  bp.connections.push({
    id: 'gear-mesh',
    kind: 'gear',
    a: { part: 'input-gear', port: 'mesh' },
    b: { part: 'output-gear', port: 'mesh' },
  });
  compileAssembly(bp);
  return bp;
}

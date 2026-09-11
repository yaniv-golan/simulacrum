import { createSpringPlayground } from './spring-playground.mjs';
import { createPart } from '../blueprint.mjs';
import { rotateVector } from '../transforms.mjs';
/** A gravity-driven ramp over an ordinary spring plate, supported by stacked solids. */
export function createBallDrop() {
  const bp = createSpringPlayground({ damping: 2 });
  bp.id = 'ball-drop';
  bp.name = 'Roll onto a spring';
  bp.parts = bp.parts.filter((p) => p.id !== 'weight');
  const add = (type, id, position, rotation = [0, 0, 0, 1]) => {
    const p = createPart(type, id, position);
    p.rotation = rotation;
    p.authoredMaterial.body = 'steel';
    bp.parts.push(p);
    return p;
  };
  for (const [side, x, levels] of [
    ['high', -0.57, 6],
    ['low', -0.28, 5],
  ]) {
    for (let i = 0; i < levels; i++) add('chassis', `${side}-foot-${i}`, [x, 0.02 + i * 0.04, 0]);
    add('beam', `${side}-support`, [x, levels * 0.04 + 0.2, 0], [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  }
  const angle = Math.atan2(-0.04, 0.29),
    rotation = [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
  const ramp = add(
    'beam',
    'ramp',
    [-0.4, 0.64 + Math.tan(angle) * 0.15 + 0.02 / Math.cos(angle), 0],
    rotation,
  );
  const offset = rotateVector(rotation, [-0.15, 0.07, 0]);
  const ball = add(
    'ball',
    'ball',
    ramp.position.map((v, i) => v + offset[i]),
  );
  ball.authoredMaterial.body = 'rubber';
  return bp;
}

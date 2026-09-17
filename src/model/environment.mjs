import { rotateVector, normalizeQuaternion } from './transforms.mjs';
import validateSchema from './generated/blueprint-validator.mjs';
import { MATERIALS } from './catalog.mjs';
import { immutableCopy } from './observation.mjs';

/** Workshop floor in SI units. Terrain qualification uses its own frozen apparatus. */
export const BUILD_ENVIRONMENT = immutableCopy({
  gravity: [0, -9.81, 0],
  ground: {
    position: [0, -0.1, 0],
    halfExtents: [100, 0.1, 100],
    friction: 0.6,
    restitution: 0,
  },
});

/** Bounded saved workshop choices. The same preset applies to every machine. */
export const ENVIRONMENT_PRESETS = immutableCopy({
  flat: { label: 'Flat floor', obstacles: [] },
  'rounded-bump': {
    label: 'Rounded bump (1 cm)',
    obstacles: [
      {
        shape: 'cylinder',
        halfExtents: [1, 0.03, 0.03],
        position: [0.14, -0.02, -0.6],
        rotation: [0, 0, 0, 1],
        velocity: [0, 0, 0],
        mass: 1,
        fixed: true,
        friction: 0.8,
        restitution: 0,
      },
    ],
  },
});
export function environmentObstacles(environment = 'flat') {
  if (environment && typeof environment === 'object' && !Array.isArray(environment)) {
    validateScene(environment);
    return immutableCopy(
      mergeSceneSolids(
        environment.objects.map(
          ({ shape, halfExtents, position, rotation, material, friction, restitution, fixed }) => ({
            shape,
            halfExtents,
            position,
            rotation: normalizeQuaternion(rotation),
            velocity: [0, 0, 0],
            mass:
              MATERIALS[material].density *
              (shape === 'box'
                ? 8 * halfExtents[0] * halfExtents[1] * halfExtents[2]
                : 2 * Math.PI * halfExtents[0] * halfExtents[1] ** 2),
            fixed,
            friction,
            restitution,
          }),
        ),
      ),
    );
  }
  if (typeof environment !== 'string' || !Object.hasOwn(ENVIRONMENT_PRESETS, environment))
    throw new TypeError('INVALID_BLUEPRINT');
  return ENVIRONMENT_PRESETS[environment].obstacles;
}

/** Bounded authored fixed solids; legacy presets above retain their exact bytes. */
export function validateScene(scene) {
  if (
    !validateSchema({
      // The current save version, written out because blueprint.mjs reads this module.
      version: 4,
      id: 'scene',
      name: 'Scene',
      parts: [],
      connections: [],
      environment: scene,
    }) ||
    !scene ||
    typeof scene !== 'object' ||
    Array.isArray(scene)
  )
    throw new TypeError('INVALID_BLUEPRINT');
  const ids = new Set();
  for (const o of scene.objects) {
    if (
      ids.has(o.id) ||
      Math.abs(o.rotation.reduce((s, x) => s + x * x, 0) - 1) > 1e-8 ||
      (o.shape === 'cylinder' && o.halfExtents[1] !== o.halfExtents[2])
    )
      throw new TypeError('INVALID_BLUEPRINT');
    ids.add(o.id);
  }
  return scene;
}
export function authoredScene(environment = 'flat') {
  if (typeof environment === 'object') return structuredClone(validateScene(environment));
  return {
    ground: { friction: 0.6, restitution: 0 },
    objects: environmentObstacles(environment).map((o, i) => ({
      id: `obstacle-${i + 1}`,
      name: 'Rounded bump',
      shape: o.shape,
      halfExtents: [...o.halfExtents],
      position: [...o.position],
      rotation: [...o.rotation],
      material: 'steel',
      friction: o.friction,
      restitution: o.restitution,
      fixed: true,
    })),
  };
}
export function hasWorkshopContent(blueprint) {
  return (
    !!blueprint.parts.length ||
    (blueprint.environment !== undefined &&
      blueprint.environment !== 'flat' &&
      (typeof blueprint.environment === 'string' ||
        blueprint.environment.objects.length > 0 ||
        blueprint.environment.ground.friction !== 0.6 ||
        blueprint.environment.ground.restitution !== 0))
  );
}
export function createSceneObject(kind, id) {
  const base = {
    id,
    name: kind === 'ramp' ? 'Straight ramp' : kind === 'bump' ? 'Rounded bump' : 'Platform',
    shape: kind === 'bump' ? 'cylinder' : 'box',
    halfExtents: [0.3, 0.025, 0.3],
    position: [1, 0.025, 0],
    rotation: [0, 0, 0, 1],
    material: 'steel',
    friction: 0.8,
    restitution: 0,
    fixed: true,
  };
  if (kind === 'bump')
    Object.assign(base, { halfExtents: [0.3, 0.03, 0.03], position: [1, -0.02, 0] });
  if (kind === 'ramp')
    Object.assign(base, {
      halfExtents: [0.3, 0.01, 0.5],
      position: [1, 0.5 * Math.sin(0.15) - 0.01 * Math.cos(0.15), 0],
      rotation: [Math.sin(-0.075), 0, 0, Math.cos(-0.075)],
    });
  return base;
}
export function sceneLayout(name) {
  const scene = authoredScene('flat');
  if (name === 'bump') return authoredScene('rounded-bump');
  else if (name === 'hill') scene.objects.push(createSceneObject('ramp', 'ramp-1'));
  else if (name === 'steps')
    for (let i = 0; i < 3; i++)
      scene.objects.push({
        ...createSceneObject('block', `step-${i + 1}`),
        halfExtents: [0.3, 0.025 * (i + 1), 0.15],
        position: [1, 0.025 * (i + 1), i * 0.3],
      });
  else if (name !== 'flat') throw new TypeError('INVALID_BLUEPRINT');
  return scene;
}

/** Union face-adjacent equal-section boxes with identical contact/material density.
 * This removes internal collision faces; no pose, support force or identity dispatch is added.
 * Objects remain independent authoring records and are rendered/picked separately.
 */
function mergeSceneSolids(input) {
  const solids = structuredClone(input);
  const volume = (o) => 8 * o.halfExtents.reduce((a, b) => a * b, 1);
  const near = (a, b) => Math.abs(a - b) < 1e-10;
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < solids.length; i++)
      for (let j = i + 1; j < solids.length; j++) {
        const a = solids[i],
          b = solids[j];
        if (
          a.shape !== 'box' ||
          b.shape !== 'box' ||
          a.friction !== b.friction ||
          a.restitution !== b.restitution ||
          !near(a.mass / volume(a), b.mass / volume(b)) ||
          !(
            a.rotation.every((v, k) => near(v, b.rotation[k])) ||
            a.rotation.every((v, k) => near(v, -b.rotation[k]))
          )
        )
          continue;
        const delta = rotateVector(
          [-a.rotation[0], -a.rotation[1], -a.rotation[2], a.rotation[3]],
          b.position.map((v, k) => v - a.position[k]),
        );
        for (let axis = 0; axis < 3; axis++) {
          if (
            !near(Math.abs(delta[axis]), a.halfExtents[axis] + b.halfExtents[axis]) ||
            !delta.every(
              (v, k) => k === axis || (near(v, 0) && near(a.halfExtents[k], b.halfExtents[k])),
            )
          )
            continue;
          const offset = [0, 0, 0];
          offset[axis] = Math.sign(delta[axis]) * b.halfExtents[axis];
          const shift = rotateVector(a.rotation, offset);
          a.position = a.position.map((v, k) => v + shift[k]);
          a.halfExtents[axis] += b.halfExtents[axis];
          a.mass += b.mass;
          solids.splice(j, 1);
          changed = true;
          break outer;
        }
      }
  }
  return solids;
}
/** Individual canonical solids retain stable authoring selection and visual-recording IDs. */
export function sceneObjectDescriptors(environment = 'flat') {
  if (typeof environment === 'string') return environmentObstacles(environment);
  validateScene(environment);
  return environment.objects.map(
    (object) => environmentObstacles({ ...environment, objects: [object] })[0],
  );
}

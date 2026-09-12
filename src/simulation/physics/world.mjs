import { admitGearTopology } from './gear-topology.mjs';
import { coupledGearImpulses } from './law/gear.mjs';
import { springTopologyDomain } from './spring-topology.mjs';
import { readNativeResponse } from './native-response.mjs';
import { coupledSpringImpulses } from './law/spring.mjs';
import { readBody } from './read-body.mjs';
import { readContacts } from './read-contacts.mjs';
import { CYLINDER_SEGMENTS } from '../../model/geometry.mjs';
const MAX_BODIES = 4097; // 4096 authored primitives plus the workshop ground.
// Sole library importer. The closure exports capabilities and copied numeric
// values; no Rapier world, body, collider, vector or query object crosses it.
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { DT } from '../../model/tick.mjs';
const PHYSICS_BACKEND = '0.20.0-simulacrum.spring.9.f64';
let initialization;
function record(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new TypeError('invalid physics fields');
}
function vector(value, size = 3) {
  if (
    !Array.isArray(value) ||
    value.length !== size ||
    value.some((number) => !Number.isFinite(number))
  )
    throw new TypeError('invalid numeric vector');
  return [...value];
}
function quaternion(value) {
  const result = vector(value, 4);
  if (Math.abs(Math.hypot(...result) - 1) > 1e-6) throw new TypeError('invalid unit quaternion');
  return result;
}
function xyzw(value) {
  return { x: value[0], y: value[1], z: value[2], w: value[3] };
}
function rotationArray(value) {
  return [value.x, value.y, value.z, value.w];
}
function unit(value) {
  const v = vector(value),
    length = Math.hypot(...v);
  if (!Number.isFinite(length) || length < 1e-12) throw new TypeError('invalid axis');
  return v.map((n) => n / length);
}
function multiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function conjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}
function rotate(q, v) {
  return multiply(multiply(q, [...v, 0]), conjugate(q)).slice(0, 3);
}
function xyz(value) {
  return { x: value[0], y: value[1], z: value[2] };
}
function array(value) {
  return [value.x, value.y, value.z];
}
function hash(bytes) {
  let h = 2166136261;
  for (const byte of bytes) h = Math.imul(h ^ byte, 16777619);
  return h >>> 0;
}
function encode(payload, handles, configuration, gearState) {
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      version: gearState.length ? 5 : 4,
      ...(gearState.length ? { gearState } : {}),
      backend: PHYSICS_BACKEND,
      handles,
      configuration,
    }),
  );
  const bytes = new Uint8Array(12 + metadata.length + payload.length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x53494d31);
  view.setUint32(4, metadata.length);
  bytes.set(metadata, 12);
  bytes.set(payload, 12 + metadata.length);
  view.setUint32(8, hash(bytes.subarray(12)));
  return bytes;
}
function decode(input) {
  if (!(input instanceof Uint8Array) || input.length < 13 || input.length > 32 * 1024 * 1024)
    throw new TypeError('invalid physics snapshot');
  const bytes = new Uint8Array(input),
    view = new DataView(bytes.buffer),
    size = view.getUint32(4);
  if (
    view.getUint32(0) !== 0x53494d31 ||
    size === 0 ||
    12 + size >= bytes.length ||
    view.getUint32(8) !== hash(bytes.subarray(12))
  )
    throw new TypeError('invalid physics snapshot envelope');
  const metadata = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(12, 12 + size)),
  );
  record(metadata, [
    'version',
    'backend',
    'handles',
    'configuration',
    ...(metadata.version === 5 ? ['gearState'] : []),
  ]);
  if (
    ![4, 5].includes(metadata.version) ||
    metadata.backend !== PHYSICS_BACKEND ||
    !Array.isArray(metadata.handles) ||
    metadata.handles.length > MAX_BODIES ||
    metadata.handles.some((handle) => !Number.isFinite(handle)) ||
    new Set(metadata.handles).size !== metadata.handles.length
  )
    throw new TypeError('invalid physics snapshot handles');
  return {
    handles: metadata.handles,
    gearState: metadata.gearState ?? [],
    configuration: metadata.configuration,
    payload: bytes.slice(12 + size),
  };
}
/** @param {import('../../model/boundaries.js').PhysicsConfiguration} configuration */
export async function createPhysicsWorld(configuration) {
  record(configuration, ['gravity', 'bodies', 'joints']);
  const gravity = vector(configuration.gravity);
  if (!Array.isArray(configuration.bodies) || configuration.bodies.length > MAX_BODIES)
    throw new TypeError('invalid bodies');
  const descriptions = configuration.bodies.map((body) => {
    record(body, [
      'shape',
      'position',
      'rotation',
      'velocity',
      'mass',
      'halfExtents',
      'fixed',
      'friction',
      'restitution',
    ]);
    const rotation = quaternion(body.rotation),
      position = vector(body.position),
      velocity = vector(body.velocity),
      halfExtents = vector(body.halfExtents);
    if (
      !Number.isFinite(body.mass) ||
      body.mass <= 0 ||
      halfExtents.some((value) => value <= 0) ||
      typeof body.fixed !== 'boolean' ||
      !Number.isFinite(body.friction) ||
      body.friction < 0 ||
      !Number.isFinite(body.restitution) ||
      body.restitution < 0 ||
      body.restitution > 1
    )
      throw new TypeError('invalid body properties');
    if (
      !['box', 'cylinder', 'sphere'].includes(body.shape) ||
      (body.shape === 'sphere' && !halfExtents.every((r) => r === halfExtents[0])) ||
      (body.shape === 'cylinder' && halfExtents[1] !== halfExtents[2])
    )
      throw new TypeError('invalid physical shape');
    return {
      shape: body.shape,
      position,
      rotation,
      velocity,
      halfExtents,
      mass: body.mass,
      fixed: body.fixed,
      friction: body.friction,
      restitution: body.restitution,
    };
  });
  if (!Array.isArray(configuration.joints) || configuration.joints.length > 8192)
    throw new TypeError('invalid joints');
  const joints = configuration.joints.map((joint) => {
    if (!['fixed', 'revolute', 'spring', 'gear'].includes(joint?.kind))
      throw new TypeError('invalid joint kind');
    record(
      joint,
      joint.kind === 'fixed'
        ? ['kind', 'a', 'b', 'anchorA', 'anchorB', 'rotationA', 'rotationB']
        : [
            'kind',
            'a',
            'b',
            'anchorA',
            'anchorB',
            'axisA',
            'axisB',
            ...(Object.hasOwn(joint, 'limits') ? ['limits'] : []),
            ...(joint.kind === 'spring' ? ['stiffness', 'damping', 'restLength'] : []),
            ...(joint.kind === 'gear' ? ['stiffness', 'damping', 'radiusA', 'radiusB'] : []),
          ],
    );
    if (
      !Number.isInteger(joint.a) ||
      !Number.isInteger(joint.b) ||
      joint.a < 0 ||
      joint.b < 0 ||
      joint.a >= descriptions.length ||
      joint.b >= descriptions.length ||
      joint.a === joint.b
    )
      throw new TypeError('invalid joint body binding');
    if (
      joint.kind !== 'spring' &&
      Object.hasOwn(joint, 'limits') &&
      (!Array.isArray(joint.limits) ||
        joint.limits.length !== 2 ||
        !joint.limits.every(Number.isFinite) ||
        joint.limits[0] >= 0 ||
        joint.limits[1] <= 0 ||
        joint.limits[0] < -3 ||
        joint.limits[1] > 3)
    )
      throw new TypeError('invalid angular limits');
    if (
      joint.kind === 'spring' &&
      (![joint.stiffness, joint.damping, joint.restLength].every(Number.isFinite) ||
        joint.stiffness < 0 ||
        joint.stiffness > 300 ||
        joint.damping < 0 ||
        joint.damping > 100 ||
        !Array.isArray(joint.limits) ||
        joint.limits.length !== 2 ||
        !joint.limits.every(Number.isFinite) ||
        joint.limits[0] < 0.08 ||
        joint.limits[1] > 0.4 ||
        joint.limits[0] >= joint.limits[1] ||
        joint.restLength < joint.limits[0] ||
        joint.restLength > joint.limits[1] ||
        joint.axisA.some((x, i) => Math.abs(x - joint.axisB[i]) > 1e-10))
    )
      throw new TypeError('invalid spring settings');
    if (
      joint.kind === 'gear' &&
      (joint.limits ||
        ![joint.radiusA, joint.radiusB, joint.stiffness, joint.damping].every(Number.isFinite) ||
        joint.radiusA <= 0 ||
        joint.radiusB <= 0 ||
        joint.radiusA > 1 ||
        joint.radiusB > 1 ||
        joint.stiffness <= 0 ||
        joint.stiffness > 20000 ||
        joint.damping < 0 ||
        joint.damping > 100)
    )
      throw new TypeError('invalid gear settings');
    const common = {
      ...(joint.limits ? { limits: [...joint.limits] } : {}),
      kind: joint.kind,
      ...(joint.kind === 'gear'
        ? {
            radiusA: joint.radiusA,
            radiusB: joint.radiusB,
            stiffness: joint.stiffness,
            damping: joint.damping,
          }
        : {}),
      ...(joint.kind === 'spring'
        ? {
            stiffness: joint.stiffness,
            damping: joint.damping,
            restLength: joint.restLength,
          }
        : {}),
      a: joint.a,
      b: joint.b,
      anchorA: vector(joint.anchorA),
      anchorB: vector(joint.anchorB),
    };
    return joint.kind === 'fixed'
      ? {
          ...common,
          rotationA: quaternion(joint.rotationA),
          rotationB: quaternion(joint.rotationB),
        }
      : { ...common, axisA: unit(joint.axisA), axisB: unit(joint.axisB) };
  });
  if (joints.filter((j) => j.kind === 'spring').length > 8)
    throw new RangeError('at most 8 guided springs');
  admitGearTopology(descriptions, joints);
  const gearIndices = joints.flatMap((j, i) => (j.kind === 'gear' ? [i] : []));
  let gearMemory = gearIndices.map((index) => ({
    index,
    strain: 0,
    completedSlipM: 0,
    predictorSlipM: 0,
    splitDriftM: 0,
    splitStepM: 0,
    splitElasticDeltaJ: 0,
  }));
  const topology = springTopologyDomain(descriptions, joints),
    activeElastic = new Set(topology.activeElastic);
  await (initialization ??= RAPIER.init().then(() => {
    if (RAPIER.version() !== PHYSICS_BACKEND) throw new Error('physics backend mismatch');
  }));
  let contactPadCache = null;
  let world = new RAPIER.World(xyz(gravity)),
    handles = [];
  // Only authored fixed paths constitute one rigid assembly. Distinct grounded
  // groups and articulated paths retain their ordinary contacts.
  const fixedParents = descriptions.map((_, i) => i);
  const fixedRoot = (i) => {
    while (fixedParents[i] !== i) i = fixedParents[i];
    return i;
  };
  for (const joint of joints)
    if (joint.kind === 'fixed') fixedParents[fixedRoot(joint.b)] = fixedRoot(joint.a);
  const fixedRoots = descriptions.map((_, i) => fixedRoot(i));
  const fixedSizes = new Map();
  for (const root of fixedRoots) fixedSizes.set(root, (fixedSizes.get(root) ?? 0) + 1);
  let fixedByHandle = new Map();
  const rebuildFixedHandles = () => {
    fixedByHandle = new Map(handles.map((handle, i) => [handle, fixedRoots[i]]));
  };
  // This Rapier binding only dispatches hooks through stepWithEvents. No collider
  // enables events; the auto-drained queue solely selects that native entry point.
  const contactEvents = [...fixedSizes.values()].some((size) => size > 1)
    ? new RAPIER.EventQueue(true)
    : undefined;
  const contactHooks = {
    filterContactPair(_colliderA, _colliderB, bodyA, bodyB) {
      const a = fixedByHandle.get(bodyA),
        b = fixedByHandle.get(bodyB);
      return a !== undefined && b !== undefined && a === b
        ? null
        : RAPIER.SolverFlags.COMPUTE_IMPULSE;
    },
    filterIntersectionPair() {
      return true;
    },
  };
  const jointHandles = [];
  try {
    world.timestep = DT;
    world.integrationParameters.numSolverIterations = 4; // Frozen temporal solver subdivision.
    // Contact impulses disturb coupled joint velocities. Additional internal passes
    // resolve that alternating solve without changing the temporal subdivision.
    world.integrationParameters.numInternalPgsIterations = 32;
    // Bound sphere sweep penetration to a tenth of its radius; old scenes retain native slop.
    world.integrationParameters.normalizedAllowedLinearError = Math.min(
      world.integrationParameters.normalizedAllowedLinearError,
      ...descriptions
        .filter((body) => body.shape === 'sphere')
        .map((body) => body.halfExtents[0] / 10),
    );
    world.integrationParameters.maxCcdSubsteps = 1; // Contact diagnostics cover one physical interval.
    for (const body of descriptions) {
      const descriptor = (
        body.fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic()
      )
        .setTranslation(...body.position)
        .setRotation(xyzw(body.rotation))
        .setLinvel(...body.velocity)
        .setCanSleep(false)
        // Native full sweeps ignore other full-sweep bodies. Reserve them for spheres
        // so a fast sphere can sweep against an ordinary moving plate or beam.
        .setCcdEnabled(!body.fixed && body.shape === 'sphere');
      const rigidBody = world.createRigidBody(descriptor);
      let collider;
      if (body.shape === 'box')
        collider = RAPIER.ColliderDesc.cuboid(...body.halfExtents).setMass(body.mass);
      else if (body.shape === 'sphere') {
        const radius = body.halfExtents[0],
          inertia = (2 * body.mass * radius ** 2) / 5;
        collider = RAPIER.ColliderDesc.ball(radius).setMassProperties(
          body.mass,
          { x: 0, y: 0, z: 0 },
          { x: inertia, y: inertia, z: inertia },
          { x: 0, y: 0, z: 0, w: 1 },
        );
      } else {
        // Frozen regular 64-sided collision approximation, shared by every cylinder.
        // Preserve canonical solid-cylinder mass and inertia independently of contact mesh.
        const [h, r] = body.halfExtents,
          segments = CYLINDER_SEGMENTS;
        const vertices = new Float64Array(
          Array.from({ length: segments * 2 }, (_, i) => {
            const angle = ((i % segments) * 2 * Math.PI) / segments;
            return [i < segments ? -h : h, r * Math.cos(angle), r * Math.sin(angle)];
          }).flat(),
        );
        const transverse = (body.mass * (3 * r * r + 4 * h * h)) / 12;
        collider = RAPIER.ColliderDesc.convexHull(vertices).setMassProperties(
          body.mass,
          { x: 0, y: 0, z: 0 },
          { x: (body.mass * r * r) / 2, y: transverse, z: transverse },
          { x: 0, y: 0, z: 0, w: 1 },
        );
      }
      world.createCollider(
        collider
          .setFriction(body.friction)
          .setRestitution(body.restitution)
          .setActiveHooks(
            fixedSizes.get(fixedRoots[handles.length]) > 1
              ? RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS
              : RAPIER.ActiveHooks.NONE,
          ),
        rigidBody,
      );
      handles.push(rigidBody.handle);
    }
    rebuildFixedHandles();
    for (const joint of joints) {
      if (joint.kind === 'gear') {
        jointHandles.push(null);
        continue;
      }
      const data =
        joint.kind === 'fixed'
          ? RAPIER.JointData.fixed(
              xyz(joint.anchorA),
              xyzw(joint.rotationA),
              xyz(joint.anchorB),
              xyzw(joint.rotationB),
            )
          : joint.kind === 'spring'
            ? RAPIER.JointData.prismatic(xyz(joint.anchorA), xyz(joint.anchorB), xyz(joint.axisA))
            : RAPIER.JointData.revoluteWithAxes(
                xyz(joint.anchorA),
                xyz(joint.anchorB),
                xyz(joint.axisA),
                xyz(joint.axisB),
              );
      const connection = world.createImpulseJoint(
        data,
        world.getRigidBody(handles[joint.a]),
        world.getRigidBody(handles[joint.b]),
        true,
      );
      if (joint.limits) connection.setLimits(...joint.limits);
      // Elastic force is solved beside contacts at every temporal subdivision.
      // Physical damping remains the measured, passive pre-motor impulse below.
      // A zero-stiffness row must stay disabled, not become a velocity motor.
      if (activeElastic.has(joints.indexOf(joint))) {
        connection.configureMotorModel(RAPIER.MotorModel.SymplecticSpring);
        connection.configureMotorPosition(joint.restLength, joint.stiffness, 0);
      }
      connection.setContactsEnabled(joint.kind === 'spring');
      jointHandles.push(connection.handle);
    }
  } catch (error) {
    world.free();
    contactEvents?.free();
    throw error;
  }
  const configurationIdentity = JSON.stringify({
    gravity,
    bodies: descriptions,
    joints,
  });
  function dimensions(collider) {
    if (collider.shapeType() === RAPIER.ShapeType.Ball) return [collider.radius()];
    if (collider.shapeType() === RAPIER.ShapeType.Cuboid) return array(collider.halfExtents());
    if (collider.shapeType() === RAPIER.ShapeType.ConvexPolyhedron)
      return {
        vertices: Array.from(collider.vertices()),
        indices: Array.from(collider.indices()),
      };
    throw new Error('unsupported snapshot shape');
  }
  function plant(candidate, mapping) {
    const connections = [];
    candidate.impulseJoints.forEach((joint) =>
      connections.push({
        handle: joint.handle,
        a: mapping.indexOf(joint.body1().handle),
        b: mapping.indexOf(joint.body2().handle),
        type: joint.type(),
        anchorA: array(joint.anchor1()),
        anchorB: array(joint.anchor2()),
        rotationA: rotationArray(joint.frameX1()),
        rotationB: rotationArray(joint.frameX2()),
        contactsEnabled: joint.contactsEnabled(),
        motors: joint.motorConfiguration(),
        ...([RAPIER.JointType.Revolute, RAPIER.JointType.Prismatic].includes(joint.type())
          ? {
              limitsEnabled: joint.limitsEnabled(),
              limits: [joint.limitsMin(), joint.limitsMax()],
            }
          : {}),
      }),
    );
    connections.sort((a, b) => a.handle - b.handle);
    if (connections.some((joint) => joint.a < 0 || joint.b < 0))
      throw new Error('invalid snapshot joint bindings');
    return {
      gravity: array(candidate.gravity),
      timestep: candidate.timestep,
      solverIterations: candidate.integrationParameters.numSolverIterations,
      internalPgsIterations: candidate.integrationParameters.numInternalPgsIterations,
      maxCcdSubsteps: candidate.integrationParameters.maxCcdSubsteps,
      allowedLinearError: candidate.integrationParameters.normalizedAllowedLinearError,
      joints: connections,
      bodies: mapping.map((handle) => {
        const body = candidate.getRigidBody(handle);
        if (!body || body.numColliders() !== 1) throw new Error('snapshot collider count mismatch');
        const collider = body.collider(0),
          rotation = collider.rotationWrtParent();
        return {
          type: body.bodyType(),
          ccd: body.isCcdEnabled(),
          softCcdPrediction: body.softCcdPrediction(),
          additionalSolverIterations: body.additionalSolverIterations(),
          mass: body.mass(),
          localCom: array(body.localCom()),
          principalInertia: array(body.principalInertia()),
          inertiaFrame: rotationArray(body.principalInertiaLocalFrame()),
          gravityScale: body.gravityScale(),
          linearDamping: body.linearDamping(),
          angularDamping: body.angularDamping(),
          shape: collider.shapeType(),
          halfExtents: dimensions(collider),
          colliderMass: collider.mass(),
          friction: collider.friction(),
          restitution: collider.restitution(),
          activeHooks: collider.activeHooks(),
          offset: array(collider.translationWrtParent()),
          rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
        };
      }),
    };
  }
  const originalPlant = JSON.stringify(plant(world, handles));
  function alive() {
    if (!world) throw new Error('physics world disposed');
  }
  function readWorld(candidate, mapping) {
    return mapping.map((handle) => {
      const body = candidate.getRigidBody(handle);
      if (!body) throw new Error('snapshot body missing');
      return readBody(body);
    });
  }
  function assertFinite(states) {
    for (const state of states)
      if (!Object.values(state).flat().every(Number.isFinite))
        throw new Error('non-finite physics state');
  }
  function bodyAt(index) {
    alive();
    if (!Number.isInteger(index) || index < 0 || index >= handles.length)
      throw new TypeError('invalid body index');
    return world.getRigidBody(handles[index]);
  }
  function getAxisInverseInertia(index, axisWorld) {
    const body = bodyAt(index),
      [x, y, z] = unit(axisWorld),
      m = body.effectiveWorldInvInertia();
    return (
      x * x * m.m11 +
      y * y * m.m22 +
      z * z * m.m33 +
      2 * x * y * m.m12 +
      2 * x * z * m.m13 +
      2 * y * z * m.m23
    );
  }
  function kinetic(body) {
    if (body.isFixed()) return 0;
    const v = array(body.linvel()),
      q = multiply(
        rotationArray(body.rotation()),
        rotationArray(body.principalInertiaLocalFrame()),
      ),
      w = rotate(conjugate(q), array(body.angvel())),
      inertia = array(body.principalInertia());
    return (
      0.5 * body.mass() * v.reduce((sum, n) => sum + n * n, 0) +
      0.5 * w.reduce((sum, n, i) => sum + inertia[i] * n * n, 0)
    );
  }
  function energyOf(candidate, mapping, memory = gearMemory) {
    let kineticJ = 0,
      potentialJ = 0;
    for (const handle of mapping) {
      const b = candidate.getRigidBody(handle);
      if (b.isFixed()) continue;
      kineticJ += kinetic(b);
      potentialJ -= b.mass() * array(b.worldCom()).reduce((sum, x, i) => sum + x * gravity[i], 0);
    }
    return {
      kineticJ,
      potentialJ,
      ...(gearIndices.length
        ? {
            gearPotentialJ: memory.reduce(
              (sum, r) => sum + 0.5 * joints[r.index].stiffness * r.strain * r.strain,
              0,
            ),
          }
        : {}),
      ...(joints.some((j) => j.kind === 'spring')
        ? {
            springPotentialJ: joints.reduce(
              (sum, j, i) =>
                sum + (j.kind === 'spring' ? springState(i, candidate, mapping).potentialJ : 0),
              0,
            ),
          }
        : {}),
    };
  }
  let preparedTorqueIslands = new Map(),
    constraintsApplied = true,
    preparedSprings = null,
    springsApplied = false,
    gearsApplied = false,
    gearBefore = null;
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  function makeTorqueIsland(indices) {
    const offsets = new Map(indices.map((body, i) => [body, i * 6]));
    const n = indices.length * 6;
    const centres = indices.map((i) => array(bodyAt(i).translation()));
    const factor = world.impulseJoints.raw.prepareBilateralResponse(
      world.bodies.raw,
      new Float64Array(indices.map((i) => handles[i])),
      new Float64Array(
        joints.flatMap((j, i) =>
          j.kind !== 'gear' && offsets.has(j.a) && offsets.has(j.b) ? [jointHandles[i]] : [],
        ),
      ),
      world.integrationParameters.raw,
    );
    const projection = readNativeResponse(factor, indices.length);
    try {
      const vector = () =>
        indices.flatMap((i) => {
          const body = bodyAt(i);
          return body.isFixed()
            ? [0, 0, 0, 0, 0, 0]
            : [...array(body.linvel()), ...array(body.angvel())];
        });
      const apply = (impulse) => {
        for (const [slot, index] of indices.entries()) {
          const body = bodyAt(index);
          if (body.isFixed()) continue;
          body.applyImpulse(xyz(impulse.slice(slot * 6, slot * 6 + 3)), true);
          body.applyTorqueImpulse(xyz(impulse.slice(slot * 6 + 3, slot * 6 + 6)), true);
        }
      };
      const initial = vector(),
        passive = projection.project(initial);
      const projectedVector = initial.map((value, i) => value + passive.velocity[i]);
      const force = (a, b, axis) => {
        const out = Array(n).fill(0);
        for (let k = 0; k < 3; k++) {
          out[offsets.get(a) + 3 + k] -= axis[k];
          out[offsets.get(b) + 3 + k] += axis[k];
        }
        return out;
      };
      return {
        indices,
        offsets,
        projection,
        vector,
        apply,
        force,
        projectedVector,
        dispose: projection.dispose,
        applyPassive: () => apply(passive.impulse),
        kinetic: () => indices.reduce((sum, i) => sum + kinetic(bodyAt(i)), 0),
        axialForce(a, b, axis, pointA, pointB) {
          const out = Array(n).fill(0);
          for (const [body, sign, point] of [
            [a, -1, pointA],
            [b, 1, pointB],
          ]) {
            const offset = offsets.get(body);
            const torque = cross(
              point.map((value, k) => value - centres[offset / 6][k]),
              axis,
            );
            for (let k = 0; k < 3; k++) {
              out[offset + k] += sign * axis[k];
              out[offset + 3 + k] += sign * torque[k];
            }
          }
          return out;
        },
      };
    } catch (error) {
      projection.dispose();
      throw error;
    }
  }
  function clearPreparedTorqueIslands() {
    for (const island of new Set(preparedTorqueIslands.values())) island.dispose();
    preparedTorqueIslands = new Map();
  }
  function springState(index, physics = world, mapping = handles) {
    const j = joints[index];
    if (j?.kind !== 'spring') throw new TypeError('joint has no spring');
    const a = physics.getRigidBody(mapping[j.a]),
      b = physics.getRigidBody(mapping[j.b]),
      qa = rotationArray(a.rotation()),
      qb = rotationArray(b.rotation());
    const axis = rotate(qa, j.axisA);
    const positionA = array(a.translation()),
      positionB = array(b.translation());
    const pointA = rotate(qa, j.anchorA).map((x, i) => x + positionA[i]);
    const pointB = rotate(qb, j.anchorB).map((x, i) => x + positionB[i]);
    const length = axis.reduce((sum, x, i) => sum + x * (pointB[i] - pointA[i]), 0);
    const va = array(a.velocityAtPoint(xyz(pointA))),
      vb = array(b.velocityAtPoint(xyz(pointB)));
    const speed = axis.reduce((sum, x, i) => sum + x * (vb[i] - va[i]), 0);
    return {
      index,
      bodyA: j.a,
      bodyB: j.b,
      axis,
      pointA,
      pointB,
      length,
      speed,
      extension: length - j.restLength,
      potentialJ: 0.5 * j.stiffness * (length - j.restLength) ** 2,
      forceN: -j.stiffness * (length - j.restLength) - j.damping * speed,
      minLength: j.limits[0],
      maxLength: j.limits[1],
      restLength: j.restLength,
    };
  }
  function measuredJointAngle(physics, index, bodyHandles) {
    const config = joints[index],
      joint = physics.getImpulseJoint(jointHandles[index]);
    const qa = rotationArray(physics.getRigidBody(bodyHandles[config.a]).rotation());
    const qb = rotationArray(physics.getRigidBody(bodyHandles[config.b]).rotation());
    const local = multiply(
      conjugate(multiply(qa, rotationArray(joint.frameX1()))),
      multiply(qb, rotationArray(joint.frameX2())),
    );
    const raw = 2 * Math.atan2(local[0], local[3]);
    return Math.atan2(Math.sin(raw), Math.cos(raw));
  }
  function prepareSpringAllocations() {
    const groups = new Map();
    for (const [i, j] of joints.entries()) {
      if (j.kind !== 'spring') continue;
      const state = springState(i),
        island = preparedTorqueIslands.get(j.a);
      if (!island) throw new Error('spring island missing');
      const f = island.axialForce(j.a, j.b, state.axis, state.pointA, state.pointB),
        response = island.projection.response(f);
      if (!groups.has(island)) groups.set(island, []);
      groups.get(island).push({ j, state, f, response });
    }
    const allocations = [];
    for (const [island, rows] of groups) {
      const mobility = rows.map((a) =>
        rows.map((b) => a.f.reduce((sum, x, k) => sum + x * b.response.velocity[k], 0)),
      );
      const trace = rows.reduce(
        (sum, r, i) => sum + DT * DT * r.j.stiffness * Math.max(0, mobility[i][i]),
        0,
      );
      if (trace > 0.09)
        throw new RangeError(
          'spring island exceeds validated frequency range; reduce stiffness or number of springs',
        );
      const receipt = coupledSpringImpulses({
        extensions: rows.map((r) => r.state.extension),
        speeds: rows.map((r) =>
          constraintsApplied
            ? r.state.speed
            : r.f.reduce((sum, x, k) => sum + x * island.projectedVector[k], 0),
        ),
        // Split the dissipative impulse from the solver-integrated elastic force.
        stiffnesses: rows.map(() => 0),
        dampings: rows.map((r) => r.j.damping),
        mobility,
        dt: DT,
      });
      const impulse = Array(rows[0].f.length).fill(0),
        velocity = Array(rows[0].f.length).fill(0);
      rows.forEach((row, i) =>
        row.response.impulse.forEach((x, k) => (impulse[k] += x * receipt.impulses[i])),
      );
      rows.forEach((row, i) =>
        row.response.velocity.forEach((x, k) => (velocity[k] += x * receipt.impulses[i])),
      );
      allocations.push({ island, impulse, velocity, receipt });
    }
    return allocations;
  }
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  function gearGeometry(index, physics = world, mapping = handles, tolerance = 0.005) {
    const j = joints[index],
      a = physics.getRigidBody(mapping[j.a]),
      b = physics.getRigidBody(mapping[j.b]),
      qa = rotationArray(a.rotation()),
      qb = rotationArray(b.rotation()),
      axis = rotate(qa, j.axisA),
      other = rotate(qb, j.axisB),
      centreA = rotate(qa, j.anchorA).map((x, i) => x + array(a.translation())[i]),
      centreB = rotate(qb, j.anchorB).map((x, i) => x + array(b.translation())[i]),
      delta = centreB.map((x, i) => x - centreA[i]),
      distance = Math.hypot(...delta),
      radial = delta.map((x) => x / distance);
    if (
      !Number.isFinite(distance) ||
      Math.abs(distance - j.radiusA - j.radiusB) > tolerance ||
      Math.abs(dot(delta, axis)) > tolerance ||
      Math.abs(dot(axis, other)) < 0.99999
    )
      throw Object.assign(new RangeError('gear mesh lost alignment'), {
        reasonCode: 'GEAR_MOTION_LIMIT',
      });
    if (
      Math.max(Math.hypot(...array(a.angvel())), Math.hypot(...array(b.angvel()))) * DT >=
      Math.PI / 2
    )
      throw Object.assign(
        new RangeError('gear rotation exceeds unambiguous phase sampling domain'),
        { reasonCode: 'GEAR_MOTION_LIMIT' },
      );
    const tangent = unit(cross(axis, radial)),
      point = centreA.map((x, i) => x + (delta[i] * j.radiusA) / (j.radiusA + j.radiusB));
    return {
      axis,
      tangent,
      point,
      localA: rotate(conjugate(qa), radial),
      localB: rotate(conjugate(qb), radial),
      axisB: rotate(conjugate(qb), axis),
      speed: dot(
        tangent,
        array(b.velocityAtPoint(xyz(point))).map(
          (x, i) => x - array(a.velocityAtPoint(xyz(point)))[i],
        ),
      ),
    };
  }
  function validateGearMemory(input) {
    if (!Array.isArray(input) || input.length !== gearIndices.length)
      throw new TypeError('invalid gear snapshot state');
    return input.map((r, i) => {
      record(r, [
        'index',
        'strain',
        'completedSlipM',
        'predictorSlipM',
        'splitDriftM',
        'splitStepM',
        'splitElasticDeltaJ',
      ]);
      if (
        r.index !== gearIndices[i] ||
        ![
          r.strain,
          r.completedSlipM,
          r.predictorSlipM,
          r.splitDriftM,
          r.splitStepM,
          r.splitElasticDeltaJ,
        ].every(Number.isFinite) ||
        Math.abs(r.strain) > 0.02 ||
        Math.abs(r.splitStepM) > 0.002 ||
        r.completedSlipM !== r.strain ||
        r.splitDriftM !== r.completedSlipM - r.predictorSlipM
      )
        throw new TypeError('invalid gear snapshot state');
      return { ...r };
    });
  }
  /** @returns {import('../../model/boundaries.js').GearObservation[]} */
  function gearReadings() {
    return gearMemory.map((r) => ({
      ...r,
      potentialJ: 0.5 * joints[r.index].stiffness * r.strain * r.strain,
      speed: gearGeometry(r.index).speed,
    }));
  }
  // Native gravity/contact integration follows the predictor. Reconcile elastic
  // travel to measured phase; expose its signed energy change as numerical split
  // work, not damping or externally supplied energy. Cumulative predictor drift
  // remains visible; only per-step mismatch and actual strain bound admission.
  function completeGearSlip() {
    if (!gearBefore) return;
    const angle = (before, after, axis) =>
      Math.atan2(dot(axis, cross(before, after)), dot(before, after));
    const next = gearMemory.map((r, i) => {
      const old = gearBefore[i],
        current = gearGeometry(r.index),
        j = joints[r.index],
        slip =
          j.radiusA * angle(old.localA, current.localA, j.axisA) +
          j.radiusB * angle(old.localB, current.localB, old.axisB),
        completedSlipM = r.completedSlipM + slip;
      return {
        ...r,
        strain: completedSlipM,
        completedSlipM,
        splitDriftM: completedSlipM - r.predictorSlipM,
        splitStepM: completedSlipM - r.strain,
        splitElasticDeltaJ: 0.5 * j.stiffness * (completedSlipM ** 2 - r.strain ** 2),
      };
    });
    if (next.some((r) => Math.abs(r.splitStepM) > 0.002 || Math.abs(r.strain) > 0.02))
      throw Object.assign(
        new RangeError('gear mesh completed strain or split step exceeds domain'),
        { reasonCode: 'GEAR_MOTION_LIMIT' },
      );
    gearMemory = next;
  }
  /** @returns {import('../../model/boundaries.js').GearImpulseResult} */
  function applyGears() {
    alive();
    if (!constraintsApplied) throw new Error('passive constraints not applied');
    if (gearsApplied) throw new Error('gears already applied');
    if (preparedSprings && !springsApplied)
      throw new Error('spring damping must precede gear solve');
    const groups = new Map(),
      beforeGeometry = gearIndices.map((i) => gearGeometry(i));
    for (const [slot, index] of gearIndices.entries()) {
      const j = joints[index],
        island = preparedTorqueIslands.get(j.a),
        geometry = beforeGeometry[slot];
      if (!island || island !== preparedTorqueIslands.get(j.b))
        throw new Error('gear island missing');
      const f = island.axialForce(j.a, j.b, geometry.tangent, geometry.point, geometry.point),
        response = island.projection.response(f);
      if (!groups.has(island)) groups.set(island, []);
      groups.get(island).push({ slot, j, f, response });
    }
    const allocations = [];
    for (const [island, rows] of groups) {
      const prior = island.vector(),
        mobility = rows.map((a) => rows.map((b) => dot(a.f, b.response.velocity))),
        receipt = coupledGearImpulses({
          extensions: rows.map((r) => gearMemory[r.slot].strain),
          speeds: rows.map((r) => dot(r.f, prior)),
          stiffnesses: rows.map((r) => r.j.stiffness),
          dampings: rows.map((r) => r.j.damping),
          mobility,
          dt: DT,
        });
      if (receipt.extensions.some((x) => Math.abs(x) > 0.02))
        throw Object.assign(new RangeError('gear strain exceeds compliant mesh domain'), {
          reasonCode: 'GEAR_MOTION_LIMIT',
        });
      const impulse = Array(prior.length).fill(0),
        raw = Array(prior.length).fill(0);
      rows.forEach((r, i) =>
        r.f.forEach((x, k) => {
          raw[k] += x * receipt.impulses[i];
          impulse[k] += r.response.impulse[k] * receipt.impulses[i];
        }),
      );
      allocations.push({ island, rows, prior, receipt, impulse, raw });
    }
    const result = {
      dampingWorkJ: 0,
      numericalLossJ: 0,
      kineticDeltaJ: 0,
      potentialDeltaJ: 0,
      rawWorkJ: 0,
      constraintWorkJ: 0,
    };
    for (const { island, rows, prior, receipt, impulse, raw } of allocations) {
      const before = island.kinetic();
      island.apply(impulse);
      const current = island.vector(),
        average = current.map((v, i) => (v + prior[i]) / 2);
      result.kineticDeltaJ += island.kinetic() - before;
      result.rawWorkJ += dot(raw, average);
      result.constraintWorkJ += dot(
        impulse.map((x, i) => x - raw[i]),
        average,
      );
      result.dampingWorkJ += receipt.dampingWorkJ;
      result.numericalLossJ += receipt.numericalLossJ;
      rows.forEach((r, i) => {
        const memory = gearMemory[r.slot],
          strain = receipt.extensions[i];
        result.potentialDeltaJ +=
          0.5 * r.j.stiffness * (strain * strain - memory.strain * memory.strain);
        gearMemory[r.slot] = {
          ...memory,
          strain,
          predictorSlipM: memory.predictorSlipM + strain - memory.strain,
          splitDriftM: memory.completedSlipM - (memory.predictorSlipM + strain - memory.strain),
          splitStepM: 0,
          splitElasticDeltaJ: 0,
        };
      });
    }
    gearsApplied = true;
    gearBefore = beforeGeometry;
    return result;
  }
  try {
    for (const index of gearIndices) gearGeometry(index, world, handles, 1e-5);
  } catch (error) {
    world.free();
    contactEvents?.free();
    throw error;
  }
  return Object.freeze({
    applyGears,
    gears: gearReadings,
    prepareConstraints() {
      clearPreparedTorqueIslands();
      preparedSprings = null;
      springsApplied = false;
      gearsApplied = false;
      gearBefore = null;
      constraintsApplied = true;
      const parent = handles.map((_, i) => i),
        root = (i) => {
          while (parent[i] !== i) i = parent[i];
          return i;
        };
      for (const j of joints) parent[root(j.b)] = root(j.a);
      const active = new Set(joints.flatMap((j) => [root(j.a), root(j.b)]));
      constraintsApplied = false;
      for (const id of active) {
        const indices = handles.map((_, i) => i).filter((i) => root(i) === id),
          island = makeTorqueIsland(indices);
        for (const i of indices) preparedTorqueIslands.set(i, island);
      }
    },
    prepareSprings() {
      alive();
      if (constraintsApplied) throw new Error('prepare springs before passive constraints');
      preparedSprings = prepareSpringAllocations();
    },
    applyPreparedConstraints() {
      if (constraintsApplied) throw new Error('constraints already applied');
      let loss = 0;
      for (const island of new Set(preparedTorqueIslands.values())) {
        const before = island.kinetic();
        island.applyPassive();
        const after = island.kinetic();
        if (after > before + 1e-8 + 4e-6 * before)
          throw new Error('constraint projection created energy');
        loss += Math.max(0, before - after);
      }
      constraintsApplied = true;
      return loss;
    },
    springs() {
      alive();
      return joints.flatMap((j, i) => (j.kind === 'spring' ? [springState(i)] : []));
    },
    applySprings() {
      alive();
      if (!constraintsApplied) throw new Error('passive constraints not applied');
      if (springsApplied) throw new Error('springs already applied');
      const allocations = preparedSprings ?? prepareSpringAllocations();
      let dampingWorkJ = 0,
        kineticDeltaJ = 0;
      for (const { island, impulse, receipt } of allocations) {
        const before = island.kinetic();
        island.apply(impulse);
        kineticDeltaJ += island.kinetic() - before;
        dampingWorkJ += receipt.dampingWorkJ;
      }
      springsApplied = true;
      return { dampingWorkJ, kineticDeltaJ };
    },
    sensorPointVelocity({ body, origin }) {
      const rigid = bodyAt(body);
      if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite))
        throw TypeError('invalid sensor origin');
      const position = array(rigid.translation()),
        offset = rotate(rotationArray(rigid.rotation()), origin);
      return array(rigid.velocityAtPoint(xyz(position.map((v, i) => v + offset[i]))));
    },
    rangeSample({ body, origin, axis, range }) {
      alive();
      bodyAt(body);
      if (
        !Array.isArray(origin) ||
        origin.length !== 3 ||
        !origin.every(Number.isFinite) ||
        !Number.isFinite(range) ||
        range <= 0 ||
        range > 100
      )
        throw TypeError('invalid range query');
      const direction = unit(axis),
        ray = new RAPIER.Ray(xyz(origin), xyz(direction));
      let result = null;
      // Direct shape queries include initial authored poses before broad-phase stepping.
      // Stable body order also makes equal-distance ties deterministic.
      for (let i = 0; i < handles.length; i++) {
        if (i === body) continue;
        const distance = bodyAt(i).collider(0).castRay(ray, range, true);
        if (
          Number.isFinite(distance) &&
          distance >= 0 &&
          distance <= range &&
          (!result || distance < result.distance)
        )
          result = { distance, surface: i };
      }
      return result;
    },
    contactPadSample({ body, origin, axis, halfWidth, halfHeight }) {
      alive();
      const rigid = bodyAt(body),
        normal = unit(axis);
      if (
        !Array.isArray(origin) ||
        origin.length !== 3 ||
        !origin.every(Number.isFinite) ||
        ![halfWidth, halfHeight].every((v) => Number.isFinite(v) && v > 0)
      )
        throw TypeError('invalid contact pad');
      if (!contactPadCache) {
        const completed = readContacts(world, handles),
          byBody = new Map();
        for (const row of completed.rows)
          for (const index of [row.a, row.b]) {
            if (!byBody.has(index)) byBody.set(index, []);
            byBody.get(index).push(row);
          }
        contactPadCache = { available: completed.available, byBody };
      }
      const sample = {
          available: contactPadCache.available,
          rows: contactPadCache.byBody.get(body) ?? [],
        },
        rotation = rotationArray(rigid.rotation());
      const worldNormal = rotate(rotation, normal);
      // Authored contact pads use their local +Z face; other faces are ordinary casing.
      if (normal.some((v, i) => Math.abs(v - [0, 0, 1][i]) > 1e-12))
        throw TypeError('unsupported contact face');
      let touching = false,
        normalImpulse = 0,
        available = sample.available;
      for (const row of sample.rows) {
        if (row.a !== body && row.b !== body) continue;
        const point = row.a === body ? row.localPointA : row.localPointB;
        const outward = row.normal.map((v) => v * (row.a === body ? 1 : -1));
        if (
          Math.abs(point[2] - origin[2]) > 1e-5 ||
          Math.abs(point[0] - origin[0]) > halfWidth + 1e-7 ||
          Math.abs(point[1] - origin[1]) > halfHeight + 1e-7 ||
          outward.reduce((s, v, i) => s + v * worldNormal[i], 0) < 0.999
        )
          continue;
        // Manifold distance can predate cached-contact motion. Resolve its anchors
        // against completed poses; a measured normal impulse also establishes touch
        // within the solver's finite contact skin, without inventing proximity load.
        const pointInWorld = (index, local) => {
          const body = bodyAt(index),
            position = body.translation();
          return rotate(rotationArray(body.rotation()), local).map(
            (v, i) => v + [position.x, position.y, position.z][i],
          );
        };
        const a = pointInWorld(row.a, row.localPointA),
          b = pointInWorld(row.b, row.localPointB);
        const separation = row.normal.reduce((sum, v, i) => sum + v * (b[i] - a[i]), 0);
        const impulse = row.normalImpulse ? Math.hypot(...row.normalImpulse) : 0;
        if (separation > 1e-7 && !(row.available && impulse > 0)) continue;
        touching = true;
        available &&= row.available;
        if (row.normalImpulse) normalImpulse += Math.hypot(...row.normalImpulse);
      }
      return { touching, normalImpulse, available };
    },
    contacts() {
      alive();
      return readContacts(world, handles);
    },
    mechanicalEnergy() {
      alive();
      return energyOf(world, handles);
    },
    getAxisInverseInertia,
    torquePairResponse(a, b, axisWorld, c, d, otherAxisWorld) {
      const axis = unit(axisWorld),
        other = unit(otherAxisWorld);
      for (const index of [a, b, c, d]) bodyAt(index);
      if (topology.isRigidPair(a, b) || topology.isRigidPair(c, d)) return 0;
      const island = preparedTorqueIslands.get(a);
      if (island && island === preparedTorqueIslands.get(b)) {
        if (island !== preparedTorqueIslands.get(c) || island !== preparedTorqueIslands.get(d))
          return 0;
        const response = island.projection.response(island.force(c, d, other)).velocity;
        return island.force(a, b, axis).reduce((sum, x, i) => sum + x * response[i], 0);
      }
      let response = 0;
      for (const [body, sign] of [
        [a, -1],
        [b, 1],
      ]) {
        const otherSign = (body === d ? 1 : 0) - (body === c ? 1 : 0);
        if (!otherSign) continue;
        const m = bodyAt(body).effectiveWorldInvInertia();
        const v = [
          m.m11 * other[0] + m.m12 * other[1] + m.m13 * other[2],
          m.m12 * other[0] + m.m22 * other[1] + m.m23 * other[2],
          m.m13 * other[0] + m.m23 * other[1] + m.m33 * other[2],
        ];
        response += sign * otherSign * axis.reduce((sum, x, i) => sum + x * v[i], 0);
      }
      return response;
    },
    /** @param {number} a @param {number} b @param {import('../../model/boundaries.js').Vec3} axisWorld @param {number} torqueNm
     * @returns {import('../../model/boundaries.js').TorqueResult} */
    applyTorquePair(a, b, axisWorld, torqueNm) {
      if (preparedSprings && !springsApplied)
        throw new Error('prepared spring kick must precede actuator impulses');
      const bodyA = bodyAt(a),
        bodyB = bodyAt(b),
        axis = unit(axisWorld);
      if (a === b || !Number.isFinite(torqueNm) || !Number.isFinite(torqueNm * DT))
        throw new TypeError('invalid torque allocation');
      const speed = () =>
        axis.reduce(
          (sum, v, i) => sum + v * (array(bodyB.angvel())[i] - array(bodyA.angvel())[i]),
          0,
        );
      const island = preparedTorqueIslands.get(a);
      if (island && !constraintsApplied) throw new Error('passive constraints not applied');
      const before = island ? island.kinetic() : kinetic(bodyA) + kinetic(bodyB);
      // A torque inside one authored rigid assembly is internal stress. Native
      // CFM stabilizes constraints; it does not grant this winding a shaft DOF.
      if (topology.isRigidPair(a, b))
        return {
          speedBefore: 0,
          speedAfter: 0,
          workJ: 0,
          constraintWorkJ: 0,
          kineticBeforeJ: before,
          kineticAfterJ: before,
          kineticDeltaJ: 0,
        };
      const speedBefore = speed(),
        impulse = axis.map((value) => value * torqueNm * DT);
      let constraintWorkJ = 0;
      if (island) {
        const raw = island.force(a, b, axis),
          projected = island.projection.response(raw).impulse,
          prior = island.vector(),
          scaled = projected.map((x) => x * torqueNm * DT);
        island.apply(scaled);
        const current = island.vector();
        // Independent impulse work of the regularized constraint reactions.
        // It may have either sign; it is neither funded motor work nor heat.
        constraintWorkJ = scaled.reduce(
          (sum, value, i) => sum + ((value - raw[i] * torqueNm * DT) * (prior[i] + current[i])) / 2,
          0,
        );
      } else {
        bodyA.applyTorqueImpulse(xyz(impulse.map((value) => -value)), true);
        bodyB.applyTorqueImpulse(xyz(impulse), true);
      }
      const after = island ? island.kinetic() : kinetic(bodyA) + kinetic(bodyB);
      const speedAfter = speed();
      return {
        speedBefore,
        speedAfter,
        workJ: (torqueNm * DT * (speedBefore + speedAfter)) / 2,
        constraintWorkJ,
        kineticBeforeJ: before,
        kineticAfterJ: after,
        kineticDeltaJ: after - before,
      };
    },
    jointState(index) {
      alive();
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= joints.length ||
        joints[index].kind !== 'revolute'
      )
        throw new TypeError('joint has no angular degree of freedom');
      const config = joints[index],
        a = bodyAt(config.a),
        b = bodyAt(config.b);
      const qa = rotationArray(a.rotation()),
        axis = unit(rotate(qa, config.axisA));
      const angle = measuredJointAngle(world, index, handles);
      const wa = array(a.angvel()),
        wb = array(b.angvel()),
        rawSpeed = axis.reduce((sum, value, i) => sum + value * (wb[i] - wa[i]), 0);
      const plan = preparedTorqueIslands.get(config.a),
        speed =
          plan && !constraintsApplied
            ? plan
                .force(config.a, config.b, axis)
                .reduce(
                  (sum, x, i) =>
                    sum +
                    x *
                      (plan.projectedVector[i] +
                        (preparedSprings?.find((a) => a.island === plan)?.velocity[i] ?? 0)),
                  0,
                )
            : rawSpeed;
      const locked = topology.isRigidPair(config.a, config.b);
      return {
        angle,
        speed: locked ? 0 : speed,
        effectiveInverseInertia: locked
          ? 0
          : preparedTorqueIslands.has(config.a)
            ? (() => {
                const island = preparedTorqueIslands.get(config.a),
                  f = island.force(config.a, config.b, axis),
                  v = island.projection.response(f).velocity;
                return f.reduce((sum, x, i) => sum + x * v[i], 0);
              })()
            : getAxisInverseInertia(config.a, axis) + getAxisInverseInertia(config.b, axis),
      };
    },
    step() {
      contactPadCache = null;
      alive();
      if (joints.some((j) => j.kind === 'spring') && !springsApplied)
        throw new Error('spring preparation and damping must precede integration');
      if (gearIndices.length && !gearsApplied)
        throw new Error('gear solve must precede integration');
      world.step(contactEvents, contactHooks);
      completeGearSlip();
      clearPreparedTorqueIslands();
      preparedSprings = null;
      springsApplied = false;
      gearsApplied = false;
      gearBefore = null;
      constraintsApplied = true;
      const states = readWorld(world, handles);
      assertFinite(states);
      // A copied, validated post-integration sample; no live native object escapes.
      return states;
    },
    read() {
      alive();
      return readWorld(world, handles);
    },
    snapshot() {
      alive();
      if (gearIndices.length && gearsApplied)
        throw new Error('snapshot requires completed gear step');
      return encode(world.takeSnapshot(), handles, JSON.parse(configurationIdentity), gearMemory);
    },
    restore(bytes, expectedEnergy, expectedJointAngles = [], previousSpringLengths) {
      alive();
      const decoded = decode(bytes);
      if (JSON.stringify(decoded.configuration) !== configurationIdentity)
        throw new Error('snapshot configuration mismatch');
      const memory = validateGearMemory(decoded.gearState);
      let candidate;
      try {
        candidate = RAPIER.World.restoreSnapshot(decoded.payload);
        if (!candidate) throw new Error('invalid library snapshot');
        if (
          candidate.bodies.len() !== decoded.handles.length ||
          candidate.colliders.len() !== decoded.handles.length ||
          candidate.impulseJoints.len() !== joints.length - gearIndices.length ||
          candidate.multibodyJoints.len() !== 0 ||
          candidate.timestep !== world.timestep
        )
          throw new Error('snapshot topology or step mismatch');
        assertFinite(readWorld(candidate, decoded.handles));
        if (expectedEnergy) {
          record(expectedEnergy, [
            'kineticJ',
            'potentialJ',
            ...(joints.some((j) => j.kind === 'spring') ? ['springPotentialJ'] : []),
            ...(gearIndices.length ? ['gearPotentialJ'] : []),
          ]);
          const measured = energyOf(candidate, decoded.handles, memory);
          if (
            expectedEnergy.kineticJ !== measured.kineticJ ||
            expectedEnergy.potentialJ !== measured.potentialJ ||
            expectedEnergy.springPotentialJ !== measured.springPotentialJ ||
            expectedEnergy.gearPotentialJ !== measured.gearPotentialJ
          )
            throw new Error('snapshot energy mismatch');
        }
        if (!Array.isArray(expectedJointAngles))
          throw new TypeError('invalid expected joint angles');
        for (const expected of expectedJointAngles) {
          record(expected, ['joint', 'angle']);
          if (
            !Number.isInteger(expected.joint) ||
            joints[expected.joint]?.kind !== 'revolute' ||
            !Number.isFinite(expected.angle) ||
            measuredJointAngle(candidate, expected.joint, decoded.handles) !== expected.angle
          )
            throw new Error('snapshot joint angle mismatch');
        }
        if (previousSpringLengths !== undefined) {
          if (
            !Array.isArray(previousSpringLengths) ||
            previousSpringLengths.length !== joints.filter((j) => j.kind === 'spring').length
          )
            throw new TypeError('invalid spring history');
          const seen = new Set();
          for (const previous of previousSpringLengths) {
            record(previous, ['joint', 'length']);
            if (
              !Number.isInteger(previous.joint) ||
              joints[previous.joint]?.kind !== 'spring' ||
              seen.has(previous.joint) ||
              !Number.isFinite(previous.length) ||
              !Number.isFinite(
                (springState(previous.joint, candidate, decoded.handles).length - previous.length) /
                  DT,
              )
            )
              throw new TypeError('invalid spring history');
            seen.add(previous.joint);
          }
        }
        for (const index of gearIndices) gearGeometry(index, candidate, decoded.handles);
        readContacts(candidate, decoded.handles);
        if (JSON.stringify(plant(candidate, decoded.handles)) !== originalPlant)
          throw new Error('snapshot physical plant mismatch');
      } catch (error) {
        candidate?.free();
        throw error;
      }
      const previous = world;
      contactPadCache = null;
      world = candidate;
      gearMemory = memory;
      clearPreparedTorqueIslands();
      preparedSprings = null;
      springsApplied = false;
      gearsApplied = false;
      gearBefore = null;
      constraintsApplied = true;
      handles = [...decoded.handles];
      rebuildFixedHandles();
      previous.free();
    },
    applyImpulse(index, impulse) {
      alive();
      if (!constraintsApplied || (preparedSprings && !springsApplied))
        throw new Error(
          'prepared spring/constraint allocation cannot accept an intervening impulse',
        );
      if (!Number.isInteger(index) || index < 0 || index >= handles.length)
        throw new TypeError('invalid body index');
      const value = vector(impulse);
      if (value.some((number) => !Number.isFinite(number)))
        throw new RangeError('impulse exceeds physics numeric range');
      world.getRigidBody(handles[index]).applyImpulse(xyz(value), true);
    },
    dispose() {
      if (world) {
        clearPreparedTorqueIslands();
        world.free();
        contactEvents?.free();
        world = null;
        handles = [];
      }
    },
  });
}

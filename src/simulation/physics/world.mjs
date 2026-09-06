import { CYLINDER_SEGMENTS } from '../../model/geometry.mjs';
const MAX_BODIES = 4097; // 4096 authored primitives plus the workshop ground.
// Sole library importer. The closure exports capabilities and copied numeric
// values; no Rapier world, body, collider, vector or query object crosses it.
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { DT } from '../../model/tick.mjs';
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
function encode(payload, handles, configuration) {
  const metadata = new TextEncoder().encode(JSON.stringify({ version: 1, handles, configuration }));
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
  record(metadata, ['version', 'handles', 'configuration']);
  if (
    metadata.version !== 1 ||
    !Array.isArray(metadata.handles) ||
    metadata.handles.length > MAX_BODIES ||
    metadata.handles.some((handle) => !Number.isFinite(handle)) ||
    new Set(metadata.handles).size !== metadata.handles.length
  )
    throw new TypeError('invalid physics snapshot handles');
  return {
    handles: metadata.handles,
    configuration: metadata.configuration,
    payload: bytes.slice(12 + size),
  };
}
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
      !['box', 'cylinder'].includes(body.shape) ||
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
    if (!['fixed', 'revolute'].includes(joint?.kind)) throw new TypeError('invalid joint kind');
    record(
      joint,
      joint.kind === 'fixed'
        ? ['kind', 'a', 'b', 'anchorA', 'anchorB', 'rotationA', 'rotationB']
        : ['kind', 'a', 'b', 'anchorA', 'anchorB', 'axisA', 'axisB'],
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
    const common = {
      kind: joint.kind,
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
  await (initialization ??= RAPIER.init());
  let world = new RAPIER.World(xyz(gravity)),
    handles = [];
  const jointHandles = [];
  try {
    world.timestep = DT;
    world.integrationParameters.numSolverIterations = 4; // Frozen temporal solver subdivision.
    for (const body of descriptions) {
      const descriptor = (
        body.fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic()
      )
        .setTranslation(...body.position)
        .setRotation(xyzw(body.rotation))
        .setLinvel(...body.velocity)
        .setCanSleep(false);
      const rigidBody = world.createRigidBody(descriptor);
      let collider;
      if (body.shape === 'box')
        collider = RAPIER.ColliderDesc.cuboid(...body.halfExtents).setMass(body.mass);
      else {
        // Frozen regular 64-sided collision approximation, shared by every cylinder.
        // Preserve canonical solid-cylinder mass and inertia independently of contact mesh.
        const [h, r] = body.halfExtents,
          segments = CYLINDER_SEGMENTS;
        const vertices = new Float32Array(
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
        collider.setFriction(body.friction).setRestitution(body.restitution),
        rigidBody,
      );
      handles.push(rigidBody.handle);
    }
    for (const joint of joints) {
      const data =
        joint.kind === 'fixed'
          ? RAPIER.JointData.fixed(
              xyz(joint.anchorA),
              xyzw(joint.rotationA),
              xyz(joint.anchorB),
              xyzw(joint.rotationB),
            )
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
      connection.setContactsEnabled(false);
      jointHandles.push(connection.handle);
    }
  } catch (error) {
    world.free();
    throw error;
  }
  const configurationIdentity = JSON.stringify({ gravity, bodies: descriptions, joints });
  function dimensions(collider) {
    if (collider.shapeType() === RAPIER.ShapeType.Cuboid) return array(collider.halfExtents());
    if (collider.shapeType() === RAPIER.ShapeType.ConvexPolyhedron)
      return { vertices: Array.from(collider.vertices()), indices: Array.from(collider.indices()) };
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
      }),
    );
    connections.sort((a, b) => a.handle - b.handle);
    if (connections.some((joint) => joint.a < 0 || joint.b < 0))
      throw new Error('invalid snapshot joint bindings');
    return {
      gravity: array(candidate.gravity).map(Math.fround),
      timestep: candidate.timestep,
      solverIterations: candidate.integrationParameters.numSolverIterations,
      joints: connections,
      bodies: mapping.map((handle) => {
        const body = candidate.getRigidBody(handle);
        if (!body || body.numColliders() !== 1) throw new Error('snapshot collider count mismatch');
        const collider = body.collider(0),
          rotation = collider.rotationWrtParent();
        return {
          type: body.bodyType(),
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
      const rotation = body.rotation();
      return {
        position: array(body.translation()),
        rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
        velocity: array(body.linvel()),
        angularVelocity: array(body.angvel()),
        mass: body.mass(),
      };
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
  function energyOf(candidate, mapping) {
    let kineticJ = 0,
      potentialJ = 0;
    for (const handle of mapping) {
      const b = candidate.getRigidBody(handle);
      if (b.isFixed()) continue;
      kineticJ += kinetic(b);
      potentialJ -= b.mass() * array(b.worldCom()).reduce((sum, x, i) => sum + x * gravity[i], 0);
    }
    return { kineticJ, potentialJ };
  }
  return Object.freeze({
    mechanicalEnergy() {
      alive();
      return energyOf(world, handles);
    },
    getAxisInverseInertia,
    applyTorquePair(a, b, axisWorld, torqueNm) {
      const bodyA = bodyAt(a),
        bodyB = bodyAt(b),
        axis = unit(axisWorld);
      if (a === b || !Number.isFinite(torqueNm) || !Number.isFinite(Math.fround(torqueNm * DT)))
        throw new TypeError('invalid torque allocation');
      const speed = () =>
        axis.reduce(
          (sum, v, i) => sum + v * (array(bodyB.angvel())[i] - array(bodyA.angvel())[i]),
          0,
        );
      const speedBefore = speed(),
        before = kinetic(bodyA) + kinetic(bodyB),
        impulse = axis.map((value) => value * torqueNm * DT);
      bodyA.applyTorqueImpulse(xyz(impulse.map((value) => -value)), true);
      bodyB.applyTorqueImpulse(xyz(impulse), true);
      const speedAfter = speed();
      return {
        speedBefore,
        speedAfter,
        workJ: (torqueNm * DT * (speedBefore + speedAfter)) / 2,
        kineticBeforeJ: before,
        kineticAfterJ: kinetic(bodyA) + kinetic(bodyB),
        kineticDeltaJ: kinetic(bodyA) + kinetic(bodyB) - before,
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
        joint = world.getImpulseJoint(jointHandles[index]),
        a = bodyAt(config.a),
        b = bodyAt(config.b);
      const qa = rotationArray(a.rotation()),
        qb = rotationArray(b.rotation()),
        axis = unit(rotate(qa, config.axisA));
      const local = multiply(
        conjugate(multiply(qa, rotationArray(joint.frameX1()))),
        multiply(qb, rotationArray(joint.frameX2())),
      );
      const raw = 2 * Math.atan2(local[0], local[3]),
        angle = Math.atan2(Math.sin(raw), Math.cos(raw));
      const wa = array(a.angvel()),
        wb = array(b.angvel()),
        speed = axis.reduce((sum, value, i) => sum + value * (wb[i] - wa[i]), 0);
      return {
        angle,
        speed,
        effectiveInverseInertia:
          getAxisInverseInertia(config.a, axis) + getAxisInverseInertia(config.b, axis),
      };
    },
    step() {
      alive();
      world.step();
      assertFinite(readWorld(world, handles));
    },
    read() {
      alive();
      return readWorld(world, handles);
    },
    snapshot() {
      alive();
      return encode(world.takeSnapshot(), handles, JSON.parse(configurationIdentity));
    },
    restore(bytes, expectedEnergy) {
      alive();
      const decoded = decode(bytes);
      if (JSON.stringify(decoded.configuration) !== configurationIdentity)
        throw new Error('snapshot configuration mismatch');
      let candidate;
      try {
        candidate = RAPIER.World.restoreSnapshot(decoded.payload);
        if (!candidate) throw new Error('invalid library snapshot');
        if (
          candidate.bodies.len() !== decoded.handles.length ||
          candidate.colliders.len() !== decoded.handles.length ||
          candidate.impulseJoints.len() !== joints.length ||
          candidate.multibodyJoints.len() !== 0 ||
          candidate.timestep !== world.timestep
        )
          throw new Error('snapshot topology or step mismatch');
        assertFinite(readWorld(candidate, decoded.handles));
        if (expectedEnergy) {
          record(expectedEnergy, ['kineticJ', 'potentialJ']);
          const measured = energyOf(candidate, decoded.handles);
          if (
            expectedEnergy.kineticJ !== measured.kineticJ ||
            expectedEnergy.potentialJ !== measured.potentialJ
          )
            throw new Error('snapshot energy mismatch');
        }
        if (JSON.stringify(plant(candidate, decoded.handles)) !== originalPlant)
          throw new Error('snapshot physical plant mismatch');
      } catch (error) {
        candidate?.free();
        throw error;
      }
      const previous = world;
      world = candidate;
      handles = [...decoded.handles];
      previous.free();
    },
    applyImpulse(index, impulse) {
      alive();
      if (!Number.isInteger(index) || index < 0 || index >= handles.length)
        throw new TypeError('invalid body index');
      const value = vector(impulse);
      if (value.some((number) => !Number.isFinite(Math.fround(number))))
        throw new RangeError('impulse exceeds physics numeric range');
      world.getRigidBody(handles[index]).applyImpulse(xyz(value), true);
    },
    dispose() {
      if (world) {
        world.free();
        world = null;
        handles = [];
      }
    },
  });
}

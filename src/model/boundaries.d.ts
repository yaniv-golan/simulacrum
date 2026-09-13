import type { PartType, MaterialKey, Position, Rotation } from './generated/blueprint-types.js';

export type Vec3 = readonly [number, number, number];
export type Quaternion = readonly [number, number, number, number];
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export interface Primitive {
  id: 'body';
  kind: 'box' | 'cylinder' | 'sphere';
  halfExtents: Vec3;
  position: Vec3;
  rotation: Quaternion;
  materialKey: MaterialKey;
}
export interface Port {
  id: string;
  kind: 'shaft' | 'power' | 'signal' | 'spring' | 'gear';
  multiplicity: 'one' | 'many';
  direction: 'input' | 'output' | 'bidirectional';
  position: Vec3;
  rotation: Quaternion;
  joint?: 'revolute';
}
export interface ParameterDefinition {
  type: 'number' | 'integer';
  default: number;
  minimum: number;
  maximum: number;
  unit?: string;
  optional?: boolean;
  enum?: readonly number[];
}
export interface CatalogDefinition {
  type: PartType;
  name: string;
  milestone: string;
  primitives: readonly Primitive[];
  ports: readonly Port[];
  parameterDefinitions: Readonly<Record<string, ParameterDefinition>>;
  mountingFaces: readonly string[];
  mountingPads?: Readonly<Record<string, readonly [number, number]>>;
  controlBindingDefault?: import('./generated/blueprint-types.js').Part['controlBinding'];
  controlBindingMilestone?: string;
  releaseFace?: string;
  gear?: { teeth: number; module: number; pitchRadius: number; stiffness: number; damping: number };
  mirrorAxis?: 'x' | 'y' | 'z';
  sensorSupply?: Readonly<{ resistance: number; minVoltage: number }>;
}
export interface BodyConfiguration {
  collision?: false;
  shape: 'box' | 'cylinder' | 'sphere';
  position: Position;
  rotation: Rotation;
  velocity: Position;
  mass: number;
  halfExtents: Position;
  fixed: boolean;
  friction: number;
  restitution: number;
}
export interface BodyObservation {
  position: Vec3;
  rotation: Quaternion;
  velocity: Vec3;
  angularVelocity: Vec3;
  mass: number;
}
export type JointConfiguration = { a: number; b: number; anchorA: Vec3; anchorB: Vec3 } & (
  | {
      kind: 'fixed';
      rotationA: Quaternion;
      rotationB: Quaternion;
      axisA?: never;
      axisB?: never;
      limits?: never;
    }
  | { kind: 'spherical'; axisA?: never; axisB?: never; limits?: never }
  | {
      kind: 'rope';
      restLength: number;
      stiffness: number;
      damping: number;
      strength: number;
      maxStrain: number;
      axisA?: never;
      axisB?: never;
      limits?: never;
    }
  | {
      kind: 'gear';
      axisA: Vec3;
      axisB: Vec3;
      radiusA: number;
      radiusB: number;
      stiffness: number;
      damping: number;
      limits?: never;
    }
  | {
      kind: 'spring';
      axisA: Vec3;
      axisB: Vec3;
      limits: readonly [number, number];
      stiffness: number;
      damping: number;
      restLength: number;
    }
  | {
      kind: 'revolute';
      axisA: Vec3;
      axisB: Vec3;
      rotationA?: never;
      rotationB?: never;
      limits?: readonly [number, number];
    }
);
export interface PhysicsConfiguration {
  gravity: Vec3;
  bodies: readonly BodyConfiguration[];
  joints: readonly JointConfiguration[];
}
export type CompletedBodies = DeepReadonly<BodyObservation[]>;
export interface TorqueResult {
  constraintWorkJ: number;
  speedBefore: number;
  speedAfter: number;
  workJ: number;
  kineticBeforeJ: number;
  kineticAfterJ: number;
  kineticDeltaJ: number;
}

/** Copied completed solver observations. All impulse vectors act on canonical body b. */
export interface ContactObservation {
  a: number;
  b: number;
  localPointA: Vec3;
  localPointB: Vec3;
  distance: number;
  normal: Vec3;
  normalImpulse: Vec3 | null;
  frictionImpulse: Vec3 | null;
  pureTwistImpulse: Vec3 | null;
  frictionGroupSize: number;
  solved: boolean;
  available: boolean;
}
export interface ContactSample {
  sampleTick: number;
  intervalSeconds: number;
  available: boolean;
  rows: readonly ContactObservation[];
}

/** One coupled mesh solve. Signed reaction work is distinct from dissipation. */
export interface GearImpulseResult {
  dampingWorkJ: number;
  numericalLossJ: number;
  kineticDeltaJ: number;
  potentialDeltaJ: number;
  rawWorkJ: number;
  constraintWorkJ: number;
}
/** Completed mesh telemetry; strain is the checkpointed completed geometric travel in metres. */
export interface GearObservation {
  index: number;
  strain: number;
  potentialJ: number;
  speed: number;
  completedSlipM: number;
  predictorSlipM: number;
  splitDriftM: number;
  splitStepM: number;
  splitElasticDeltaJ: number;
}
/** These fields are present only for scenes containing a mesh. */
export interface GearEnergyLedger {
  gearPotentialJ?: number;
  gearDampingWorkJ?: number;
  gearNumericalLossJ?: number;
  gearConstraintWorkJ?: number;
  gearSplitElasticDeltaJ?: number;
}
export interface GearPhysicsBoundary {
  applyGears(): GearImpulseResult;
  gears(): readonly GearObservation[];
}
/** Completed segment geometry and mean tension from the last native integration. */
export interface RopeObservation {
  index: number;
  pointA: Vec3;
  pointB: Vec3;
  length: number;
  restLength: number;
  strain: number;
  elasticTension: number;
  appliedTension: number;
  potentialJ: number;
}
export interface RopeEnergyLedger {
  ropeWorkJ: number;
  ropeElasticDeltaJ: number;
  ropeDampingWorkJ: number;
  ropeNumericalLossJ: number;
  ropeSplitWorkJ: number;
}
export interface RopePhysicsBoundary {
  ropeEnergy(): RopeEnergyLedger;
  applyRopes(): { iterations: number; residual: number };
  ropes(): readonly RopeObservation[];
}

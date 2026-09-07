import type { PartType, MaterialKey, Position, Rotation } from './generated/blueprint-types.js';

export type Vec3 = readonly [number, number, number];
export type Quaternion = readonly [number, number, number, number];
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export interface Primitive {
  id: 'body';
  kind: 'box' | 'cylinder';
  halfExtents: Vec3;
  position: Vec3;
  rotation: Quaternion;
  materialKey: MaterialKey;
}
export interface Port {
  id: string;
  kind: 'shaft' | 'power' | 'signal';
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
}
export interface BodyConfiguration {
  shape: 'box' | 'cylinder';
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
  speedBefore: number;
  speedAfter: number;
  workJ: number;
  kineticBeforeJ: number;
  kineticAfterJ: number;
  kineticDeltaJ: number;
}

import type {
  Blueprint,
  AssemblyPort,
  Endpoint,
  Part,
  PartType,
  MaterialKey,
  Position,
  Rotation,
} from './generated/blueprint-types.js';
export interface Cursor {
  sessionId: string;
  epoch: number;
  revision: number;
  tick: number;
}
export interface CommandResult {
  ok: boolean;
  reasonCode: string;
  path: string;
}
export type ControlBinding = NonNullable<
  Extract<Part, { type: 'commandReceiver' }>['controlBinding']
>;
export type WorkshopCommand =
  | {
      type: 'install-controller-program';
      id: string;
      program: NonNullable<Extract<Part, { type: 'logicController' }>['controllerProgram']>;
    }
  | { type: 'bind-joint-sensor'; id: string; connection: string | null }
  | {
      type: 'contactProperty';
      id: string;
      primitive: 'body';
      property: 'friction' | 'restitution';
      value: number | null;
    }
  | { type: 'choose-environment'; environment: 'flat' | 'rounded-bump' }
  | { type: 'create-assembly'; name: string; ids: string[]; ports: AssemblyPort[] }
  | { type: 'edit-assembly'; id: string; name: string; ids: string[]; ports: AssemblyPort[] }
  | {
      type: 'insert-assembly';
      definition: Blueprint;
      position: Position;
      rotation: Rotation;
      expectedCursor?: Cursor;
    }
  | { type: 'transform-assembly'; id: string; position: Position; rotation: Rotation }
  | {
      type: 'connect-assembly';
      id: string;
      portName: string;
      target: Endpoint;
      connectionId: string;
    }
  | { type: 'ungroup-assembly'; id: string }
  | { type: 'run' | 'pause' | 'build' }
  | { type: 'undo' | 'redo' }
  | { type: 'control'; id: string; duty: number }
  | { type: 'control-release'; id: string; duty: number }
  | { type: 'suspend-controls' }
  | { type: 'control-mode'; id: string; mode: 'manual' | 'automatic' | 'learned' | 'off' }
  | { type: 'regulator-target'; id: string; target: number }
  | { type: 'install-learning-model'; id: string; model: object | null }
  | { type: 'bind-target-sensor'; id: string; target: string | null }
  | { type: 'bind-travel-sensor'; id: string; connection: string | null }
  | { type: 'insert'; part: Part }
  | { type: 'place'; id: string; partType: PartType; position: Position; expectedCursor?: Cursor }
  | { type: 'rename'; id: string; name: string }
  | { type: 'delete' | 'disconnect'; id: string }
  | { type: 'transform'; id: string; position: Position; rotation: Rotation }
  | {
      type: 'mirror-assembly';
      ids: string[];
      referenceId: string;
      axis: 'x' | 'y' | 'z';
      expectedCursor?: Cursor;
    }
  | { type: 'material'; id: string; primitive: 'body'; material: MaterialKey }
  | {
      type: 'surface-mount';
      part: string;
      sourceRegion: string;
      targetPart: string;
      targetRegion: string;
      u: number;
      v: number;
      twist: number;
      id: string;
      replaceConnection?: string;
      assemblyId?: string;
      attach?: boolean;
      insertPart?: Part;
      expectedCursor?: Cursor;
    }
  | { type: 'connect'; id: string; a: Endpoint; b: Endpoint }
  | { type: 'bind-control'; id: string; binding: ControlBinding }
  | { type: 'parameter'; id: string; key: string; value: number }
  | { type: 'load' | 'restore-build'; save: string | Blueprint };
export type SendCommand = (command: WorkshopCommand) => Promise<CommandResult>;

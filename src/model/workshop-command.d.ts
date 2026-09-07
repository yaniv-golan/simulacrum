import type {
  Blueprint,
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
  | { type: 'run' | 'pause' | 'build' }
  | { type: 'undo' | 'redo' }
  | { type: 'control'; id: string; duty: number }
  | { type: 'insert'; part: Part }
  | { type: 'place'; id: string; partType: PartType; position: Position }
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
      attach?: boolean;
      insertPart?: Part;
      expectedCursor?: Cursor;
    }
  | { type: 'connect'; id: string; a: Endpoint; b: Endpoint }
  | { type: 'bind-control'; id: string; binding: ControlBinding }
  | { type: 'parameter'; id: string; key: string; value: number }
  | { type: 'load'; save: string | Blueprint };
export type SendCommand = (command: WorkshopCommand) => Promise<CommandResult>;

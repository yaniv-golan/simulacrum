import type { Vector3 } from 'three';
import type { Connection, Endpoint } from '../model/generated/blueprint-types.js';
import type { DeepReadonly } from '../model/boundaries.js';

export interface ConnectionRenderSpec {
  id: string;
  kind: Connection['kind'];
  ends: [Vector3, Vector3];
  visible: boolean;
  highlighted: boolean;
  exploded: boolean;
  failed: boolean;
}
export interface ConnectionRenderInputs {
  connections: readonly DeepReadonly<Connection>[];
  diagnostics: readonly { id: string; reasonCode: string }[];
  resolveEndpoint: (endpoint: DeepReadonly<Endpoint>) => Vector3 | null;
  exploded: boolean;
  selectedPartId: string | null;
  tracedConnectionId: string | null;
  testConnectionIds: ReadonlySet<string>;
}

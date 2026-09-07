import type { Blueprint, Part, Endpoint } from '../../src/model/generated/blueprint-types.js';
import type { CompletedBodies, BodyConfiguration } from '../../src/model/boundaries.js';
import type { WorkshopCommand, CommandResult } from '../../src/model/workshop-command.js';
import { compileBody } from '../../src/model/compile-body.mjs';
import { readBody } from '../../src/simulation/physics/read-body.mjs';
import { partPrimitives } from '../../src/model/geometry.mjs';
import { connectionTestPaths } from '../../src/model/connection-test-paths.mjs';
import { controlCommand, commandResult, modeCommand } from '../../src/model/workshop-command.mjs';
import { createPlacementLifecycle } from '../../src/presentation/placement-lifecycle.mjs';

export const part = {
  id: 'wheel',
  type: 'gripWheel',
  name: 'Wheel',
  position: [0, 1, 0],
  rotation: [0, 0, 0, 1],
  authoredMaterial: { body: 'steel' },
  parameters: { diameter: 0.3 },
} satisfies Part;
export const blueprint: Blueprint = {
  version: 3,
  id: 'machine',
  name: 'Machine',
  parts: [part],
  connections: [],
};
export const endpoint: Endpoint = {
  part: part.id,
  surface: { region: 'left', u: 0, v: 0, twist: 0 },
};
export const body: BodyConfiguration = compileBody(part);
export const completed: CompletedBodies = [
  readBody({
    translation: () => ({ x: 0, y: 1, z: 0 }),
    rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    linvel: () => ({ x: 0, y: 0, z: 0 }),
    angvel: () => ({ x: 0, y: 0, z: 0 }),
    mass: () => body.mass,
  }),
];
export const command: WorkshopCommand = controlCommand('receiver', 0.5);
export const run: WorkshopCommand = modeCommand('run');
export const result: CommandResult = commandResult(true);
export const paths = connectionTestPaths(blueprint, part.id);
export const primitives = partPrimitives(part);
const placement = createPlacementLifecycle<{ blueprint: Blueprint }>();
placement.begin();
placement.assess({ blueprint });
placement.pointer(false);
const token = placement.commit();
if (token !== null) placement.settle(token, true);

// Actual producer returns cannot silently decay to an unchecked escape hatch.
type IsUnchecked<T> = 0 extends 1 & T ? true : false;
const checked: [
  IsUnchecked<typeof body.mass>,
  IsUnchecked<(typeof completed)[0]['position'][0]>,
  IsUnchecked<(typeof paths.shaftPeers)[0]['type']>,
  IsUnchecked<typeof command.duty>,
  IsUnchecked<(typeof primitives)[0]['halfExtents'][0]>,
] = [false, false, false, false, false];
void checked;

import {
  mechanicalGroup,
  classifySelectionConnections,
} from '../../src/model/connection-graph.mjs';
import { transformPoseBetweenFrames } from '../../src/model/transforms.mjs';
export const group = mechanicalGroup(blueprint, part.id, {
  eligible: (connection) => connection.kind === 'fixed',
});
export const selectionEdges = classifySelectionConnections(blueprint, [part.id]);
export const movedPose = transformPoseBetweenFrames(part, part, part);
const graphChecked: [
  IsUnchecked<(typeof group)[number]>,
  IsUnchecked<(typeof selectionEdges)[number]['classification']>,
  IsUnchecked<(typeof movedPose.position)[0]>,
] = [false, false, false];
void graphChecked;

import * as THREE from 'three';
import { connectionRenderSpecs } from '../../src/presentation/connection-render.mjs';
import { createConnectionView } from '../../src/presentation/connection-view.mjs';
const renderSpecs = connectionRenderSpecs({
  wiringVisible: true,
  revealedConnectionIds: new Set<string>(),
  sourceEndpoint: null,
  connections: blueprint.connections,
  diagnostics: [],
  resolveEndpoint: () => new THREE.Vector3(),
  exploded: false,
  selectedPartId: null,
  tracedConnectionId: null,
  testConnectionIds: new Set<string>(),
});
createConnectionView(new THREE.Group()).update(renderSpecs);
const renderChecked: [
  IsUnchecked<(typeof renderSpecs)[number]['visible']>,
  IsUnchecked<(typeof renderSpecs)[number]['ends'][0]>,
] = [false, false];
void renderChecked;

import type { ConnectionPathHighlight } from '../../src/presentation/connection-test.mjs';
const highlightPath: ConnectionPathHighlight = (ids) => {
  const edge: string | undefined = ids[0];
  void edge;
};
highlightPath(paths.powerConnectionIds);

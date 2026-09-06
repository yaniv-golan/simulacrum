import { pathToFileURL } from 'node:url';
import { createEmptyBlueprint, createPart } from '../../src/model/blueprint.mjs';
import { compileAssembly, snapConnection } from '../../src/model/assembly.mjs';
import { createSession } from '../../src/simulation/session.mjs';
import { deterministicProjection, DT } from '../../src/model/tick.mjs';
import { digest } from './m1-run.mjs';
export const links = [
  {
    id: 'power',
    kind: 'power',
    a: { part: 'cell', port: 'power' },
    b: { part: 'motor', port: 'power' },
  },
  {
    id: 'shaft',
    kind: 'shaft',
    a: { part: 'motor', port: 'shaft' },
    b: { part: 'wheel', port: 'axle' },
  },
  {
    id: 'signal',
    kind: 'signal',
    a: { part: 'receiver', port: 'signal' },
    b: { part: 'motor', port: 'signal' },
  },
];
export function createPoweredBlueprint({ connected = true } = {}) {
  let blueprint = createEmptyBlueprint('powered-fixture', 'Ordinary powered assembly');
  blueprint.parts = [
    createPart('powerCell', 'cell', [2, 3, 0]),
    createPart('poweredMotor', 'motor', [0, 3, 0]),
    createPart('gripWheel', 'wheel', [1, 3, 0]),
    createPart('commandReceiver', 'receiver', [3, 3, 0]),
  ];
  blueprint = snapConnection(
    blueprint,
    { part: 'motor', port: 'shaft' },
    { part: 'wheel', port: 'axle' },
  );
  if (connected) blueprint.connections = structuredClone(links);
  return blueprint;
}
export const blueprint = createPoweredBlueprint();
export const compiled = compileAssembly(blueprint);
export const configuration = compiled.configuration;
const receiverNode = compiled.mapping.findIndex((entry) => entry.part === 'receiver');
export const inputTrace = [
  { tick: 1, command: { type: 'receiver', node: receiverNode, duty: 1 } },
  { tick: 50, command: { type: 'receiver', node: receiverNode, duty: 0.4 } },
  { tick: 90, command: { type: 'receiver', node: receiverNode, duty: 0 } },
];
export async function runFixture(driver) {
  if (!['step', 'elapsed'].includes(driver)) throw Error('driver must be step or elapsed');
  if (compiled.connections.some((connection) => connection.reasonCode !== 'OK'))
    throw Error('fixture connection failed compilation');
  const session = await createSession(configuration),
    hashes = [];
  let maxRotorSpeed = 0,
    maxTorque = 0;
  try {
    const initialEnergy = session
      .observe()
      .frames[0].power.cells.reduce((sum, cell) => sum + cell.energyJ, 0);
    for (let tick = 1; tick <= 120; tick++) {
      for (const event of inputTrace.filter((event) => event.tick === tick)) {
        const result = session.act(event.command);
        if (!result.ok) throw Error(`receiver input rejected: ${result.reasonCode}`);
      }
      if (driver === 'step') session.step(1);
      else {
        session.advanceTime(DT * 1000 * 0.25);
        session.advanceTime(DT * 1000 * 0.75);
      }
      const frame = session.observe().frames[0];
      if (frame.tick !== tick) throw Error(`clock mismatch at tick ${tick}`);
      hashes.push({ tick, hash: digest(deterministicProjection(frame)) });
      maxRotorSpeed = Math.max(
        maxRotorSpeed,
        ...frame.power.motors.map((motor) =>
          Math.abs(
            frame.physics[
              configuration.power.motors.find((entry) => entry.node === motor.node).rotor
            ].angularVelocity[0],
          ),
        ),
      );
      maxTorque = Math.max(maxTorque, ...frame.power.motors.map((motor) => Math.abs(motor.torque)));
    }
    const final = session.observe().frames[0],
      energyUsedJ = initialEnergy - final.power.cells.reduce((sum, cell) => sum + cell.energyJ, 0);
    if (!(maxRotorSpeed > 0 && maxTorque > 0 && energyUsedJ > 0))
      throw Error('powered fixture did not physically turn and consume energy');
    return {
      pid: process.pid,
      driver,
      runtime: process.version,
      hashes,
      blueprintId: digest(blueprint),
      configurationId: digest(configuration),
      inputTraceId: digest(inputTrace),
      observed: { maxRotorSpeed, maxTorque, energyUsedJ },
      final: deterministicProjection(final),
    };
  } finally {
    session.dispose();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(JSON.stringify(await runFixture(process.argv[2])) + '\n');
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}

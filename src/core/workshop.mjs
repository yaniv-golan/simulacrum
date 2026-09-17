import { createProgramExecutors } from '../scripting/controller-executors.mjs';
import {
  groupAssembly,
  editAssembly,
  insertAssembly,
  transformAssembly,
  connectAssembly,
} from '../model/reusable-assemblies.mjs';
import { resolveSurfaceEndpoint, surfaceConnectionKind } from '../model/surfaces.mjs';
import { transformGroup, resizeMovesMount } from '../model/editing.mjs';
import { proposeMirroredAssembly } from '../model/mirror-assembly.mjs';
import { CATALOG } from '../model/catalog.mjs';
import { ENVIRONMENT_PRESETS } from '../model/environment.mjs';
import {
  createEmptyBlueprint,
  createPart,
  loadSave,
  canonicalizeContactOverrides,
  availablePartName,
} from '../model/blueprint.mjs';
import { compileAssembly, snapConnection, proposeSurfaceMount } from '../model/assembly.mjs';
import { immutableCopy } from '../model/observation.mjs';
import { isReasonCode } from '../model/reasons.mjs';
import { createSession } from '../simulation/session.mjs';
import { commandResult as result } from '../model/workshop-command.mjs';
function reject(reasonCode, path = '') {
  throw Object.assign(Error(reasonCode), { reasonCode, path });
}
function commandFailure(error) {
  const own = error && typeof error === 'object' ? Object.getOwnPropertyDescriptors(error) : {};
  const candidate = own.reasonCode?.value ?? own.message?.value;
  const reasonCode = candidate !== 'OK' && isReasonCode(candidate) ? candidate : 'INVALID_COMMAND';
  return result(
    false,
    reasonCode,
    typeof own.path?.value === 'string' ? own.path.value : 'command',
  );
}
function sameData(a, b) {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameData(a[key], b[key]))
  );
}
export async function createWorkshop(
  input = createEmptyBlueprint('machine', 'My machine'),
  identity = {},
) {
  const loaded = loadSave(input);
  if (!loaded.ok) reject(loaded.reasonCode, loaded.path);
  const compiled = compileAssembly(loaded.blueprint);
  const session = await createSession(
    compiled.configuration,
    identity,
    {
      blueprint: loaded.blueprint,
      mapping: compiled.mapping,
      connections: compiled.connections,
      mode: 'build',
      editing: { undoCount: 0, redoCount: 0 },
    },
    [],
    createProgramExecutors,
  );
  let busy = false,
    disposed = false;
  const past = [],
    future = [],
    historyLimit = 50;
  const retain = (stack, state, label = null) => {
    stack.push(immutableCopy({ blueprint: state, label }));
    if (stack.length > historyLimit) stack.shift();
  };
  const historyLabels = (undo, redo) => ({
    ...(undo?.label ? { undoLabel: undo.label } : {}),
    ...(redo?.label ? { redoLabel: redo.label } : {}),
  });
  // Published metadata is the sole authored read model. Local variables hold
  // candidates only; no private blueprint or mode can diverge from observation.
  const metadata = () => session.observe().frames[0].metadata;
  /** @param {import('../model/workshop-command.js').WorkshopCommand} inputCommand
   * @returns {Promise<import('../model/workshop-command.js').CommandResult>} */
  async function act(inputCommand) {
    if (disposed) return result(false, 'SESSION_DISPOSED');
    if (busy) return result(false, 'BUSY');
    let command;
    try {
      command = immutableCopy(inputCommand);
    } catch {
      return result(false, 'INVALID_COMMAND', 'command');
    }
    if (!command || typeof command !== 'object' || Array.isArray(command))
      return result(false, 'INVALID_COMMAND', 'command');
    busy = true;
    try {
      const current = metadata(),
        keys = Object.keys(command).sort().join(',');
      if (['run', 'pause', 'build'].includes(command.type)) {
        if (keys !== 'type') return result(false, 'INVALID_COMMAND', 'command');
        if (command.type === 'build') {
          const next = compileAssembly(current.blueprint);
          await session.replaceConfiguration(next.configuration, {
            blueprint: current.blueprint,
            mapping: next.mapping,
            connections: next.connections,
            mode: 'build',
            editing: current.editing,
          });
        } else {
          if (command.type === 'pause') {
            const suspended = session.act({ type: 'suspend-controls' });
            if (!suspended.ok) return suspended;
          }
          session.setMetadata({ ...current, mode: command.type === 'run' ? 'run' : 'paused' });
        }
        return result(true);
      }
      if (command.type === 'control' || command.type === 'control-release') {
        if (keys !== 'duty,id,type') return result(false, 'INVALID_COMMAND', 'command');
        const node = current.blueprint.parts.findIndex(
          (p) => p.id === command.id && p.type === 'commandReceiver',
        );
        return session.act({
          type: command.type === 'control' ? 'receiver' : 'receiver-release',
          node,
          duty: command.duty,
        });
      }
      if (command.type === 'camera-photo') {
        if (
          keys !== 'epoch,id,requestId,type' ||
          current.mode !== 'run' ||
          command.epoch !== session.observe().cursor.epoch
        )
          return result(false, 'INVALID_COMMAND', 'command');
        const node = current.blueprint.parts.findIndex(
          (p) => p.id === command.id && p.type === 'camera',
        );
        return session.act({ type: 'camera-photo', node, id: command.requestId });
      }
      if (command.type === 'suspend-controls') {
        if (keys !== 'type') return result(false, 'INVALID_COMMAND', 'command');
        return session.act(command);
      }
      if (command.type === 'control-mode' || command.type === 'regulator-target') {
        if (keys !== (command.type === 'control-mode' ? 'id,mode,type' : 'id,target,type'))
          return result(false, 'INVALID_COMMAND', 'command');
        const node = current.blueprint.parts.findIndex(
          (p) => p.id === command.id && p.type === 'commandReceiver',
        );
        return session.act(
          command.type === 'control-mode'
            ? { type: 'receiver-mode', node, mode: command.mode }
            : { type: 'regulator-target', node, target: command.target },
        );
      }
      if (current.mode !== 'build' && command.type !== 'restore-build')
        return result(false, 'EDIT_REQUIRES_BUILD', 'mode');
      if (['undo', 'redo'].includes(command.type)) {
        if (keys !== 'type') return result(false, 'INVALID_COMMAND', 'command');
        const from = command.type === 'undo' ? past : future,
          to = command.type === 'undo' ? future : past;
        if (!from.length)
          return result(false, command.type === 'undo' ? 'NOTHING_TO_UNDO' : 'NOTHING_TO_REDO');
        const entry = from.at(-1),
          blueprint = entry.blueprint,
          candidate = compileAssembly(blueprint);
        await session.replaceConfiguration(candidate.configuration, {
          blueprint,
          mapping: candidate.mapping,
          connections: candidate.connections,
          mode: 'build',
          editing: {
            ...historyLabels(
              command.type === 'undo' ? past.at(-2) : entry,
              command.type === 'redo' ? future.at(-2) : entry,
            ),
            undoCount:
              command.type === 'undo' ? past.length - 1 : Math.min(historyLimit, past.length + 1),
            redoCount:
              command.type === 'redo'
                ? future.length - 1
                : Math.min(historyLimit, future.length + 1),
          },
        });
        from.pop();
        retain(to, current.blueprint, entry.label);
        return result(true);
      }
      let next = structuredClone(current.blueprint);
      switch (command.type) {
        case 'replace-scene':
          if (keys !== 'environment,expectedCursor,type')
            return result(false, 'INVALID_COMMAND', 'command');
          if (!sameData(command.expectedCursor, session.observe().cursor))
            return result(false, 'STALE_PROPOSAL', 'expectedCursor');
          if (sameData(next.environment, command.environment)) return result(true);
          next.environment = command.environment;
          break;
        case 'choose-environment':
          if (
            keys !== 'environment,type' ||
            typeof command.environment !== 'string' ||
            !Object.hasOwn(ENVIRONMENT_PRESETS, command.environment)
          )
            return result(false, 'INVALID_COMMAND', 'environment');
          if ((next.environment ?? 'flat') === command.environment) return result(true);
          if (command.environment === 'flat') delete next.environment;
          else next.environment = command.environment;
          break;
        case 'create-assembly':
          if (keys !== 'ids,name,ports,type') return result(false, 'INVALID_COMMAND', 'command');
          next = groupAssembly(next, command);
          break;
        case 'edit-assembly':
          if (keys !== 'id,ids,name,ports,type') return result(false, 'INVALID_COMMAND', 'command');
          next = editAssembly(next, command);
          break;
        case 'insert-assembly':
          if (
            keys !== 'definition,position,rotation,type' &&
            keys !== 'definition,expectedCursor,position,rotation,type'
          )
            return result(false, 'INVALID_COMMAND', 'command');
          if (
            command.expectedCursor !== undefined &&
            !sameData(command.expectedCursor, session.observe().cursor)
          )
            return result(false, 'STALE_PROPOSAL', 'expectedCursor');
          next = insertAssembly(
            next,
            command.definition,
            command.position,
            command.rotation,
          ).blueprint;
          break;
        case 'transform-assembly':
          if (keys !== 'id,position,rotation,type')
            return result(false, 'INVALID_COMMAND', 'command');
          next = transformAssembly(next, command.id, command.position, command.rotation);
          break;
        case 'connect-assembly': {
          if (keys !== 'connectionId,id,portName,target,type')
            return result(false, 'INVALID_COMMAND', 'command');
          const proposal = connectAssembly(
            next,
            command.id,
            command.portName,
            command.target,
            command.connectionId,
          );
          next = proposal.blueprint;
          const part = next.parts.find((part) => part.id === proposal.endpoint.part);
          const port = proposal.endpoint.surface
            ? resolveSurfaceEndpoint(part, proposal.endpoint)
            : CATALOG[part.type].ports.find((port) => port.id === proposal.endpoint.port);
          const a =
            ['fixed', 'shaft', 'spring'].includes(port.kind) ||
            (port.kind === 'signal' && port.direction === 'input')
              ? proposal.target
              : proposal.endpoint;
          const b = a === proposal.endpoint ? proposal.target : proposal.endpoint;
          next.connections.push({
            id: command.connectionId,
            kind: surfaceConnectionKind(next, a, b, port.kind),
            a,
            b,
          });
          break;
        }
        case 'ungroup-assembly':
          if (keys !== 'id,type' || !next.assemblies?.some((group) => group.id === command.id))
            return result(false, 'INVALID_COMMAND', 'command');
          next.assemblies = next.assemblies.filter((group) => group.id !== command.id);
          if (!next.assemblies.length) delete next.assemblies;
          break;
        case 'insert':
          if (keys !== 'part,type') return result(false, 'INVALID_COMMAND', 'command');
          next.parts.push({
            ...command.part,
            name: availablePartName(next.parts, command.part.name),
          });
          break;
        case 'place':
          if (
            keys !== 'id,partType,position,type' &&
            keys !== 'expectedCursor,id,partType,position,type'
          )
            return result(false, 'INVALID_COMMAND', 'command');
          if (
            command.expectedCursor !== undefined &&
            !sameData(command.expectedCursor, session.observe().cursor)
          )
            return result(false, 'STALE_PROPOSAL', 'expectedCursor');
          {
            const part = createPart(command.partType, command.id, command.position);
            part.name = availablePartName(next.parts, part.name);
            next.parts.push(part);
          }
          break;
        case 'rename': {
          if (
            keys !== 'id,name,type' ||
            typeof command.name !== 'string' ||
            !command.name.trim() ||
            command.name.trim().length > 128
          )
            return result(false, 'INVALID_COMMAND', 'name');
          const part = next.parts.find((part) => part.id === command.id);
          if (!part) return result(false, 'UNKNOWN_PART', 'id');
          part.name = command.name.trim();
          break;
        }
        case 'install-controller-program': {
          if (keys !== 'id,program,type') reject('INVALID_COMMAND');
          const controller = next.parts.find(
            (p) => p.id === command.id && p.type === 'logicController',
          );
          if (!controller) reject('UNKNOWN_PART');
          controller.controllerProgram = command.program;
          break;
        }
        case 'bind-joint-sensor': {
          if (keys !== 'connection,id,type') reject('INVALID_COMMAND');
          const sensor = next.parts.find(
            (p) => p.id === command.id && p.type === 'jointAngleSensor',
          );
          if (!sensor) reject('UNKNOWN_PART');
          if (command.connection === null) delete sensor.jointBinding;
          else {
            if (
              !next.connections.some(
                (c) => c.id === command.connection && ['shaft', 'pivot'].includes(c.kind),
              )
            )
              reject('INVALID_COMMAND');
            sensor.jointBinding = command.connection;
          }
          break;
        }
        case 'install-learning-model': {
          if (keys !== 'id,model,type') reject('INVALID_COMMAND');
          const controller = next.parts.find(
            (p) => p.id === command.id && p.type === 'learningController',
          );
          if (!controller) reject('UNKNOWN_PART');
          if (command.model === null) delete controller.learningModel;
          else controller.learningModel = command.model;
          break;
        }
        case 'bind-target-sensor': {
          if (keys !== 'id,target,type') reject('INVALID_COMMAND');
          const sensor = next.parts.find((p) => p.id === command.id && p.type === 'targetSensor');
          if (!sensor) reject('UNKNOWN_PART');
          if (command.target === null) delete sensor.targetBinding;
          else sensor.targetBinding = command.target;
          break;
        }
        case 'bind-travel-sensor': {
          if (keys !== 'connection,id,type') return result(false, 'INVALID_COMMAND', 'command');
          const sensor = next.parts.find((p) => p.id === command.id && p.type === 'travelSensor');
          if (
            !sensor ||
            (command.connection !== null &&
              !next.connections.some((c) => c.id === command.connection && c.kind === 'spring'))
          )
            return result(false, 'INVALID_COMMAND', 'connection');
          if (command.connection === null) delete sensor.springBinding;
          else sensor.springBinding = command.connection;
          break;
        }
        case 'delete':
          if (keys !== 'id,type') return result(false, 'INVALID_COMMAND', 'command');
          if (!next.parts.some((part) => part.id === command.id))
            return result(false, 'UNKNOWN_PART', 'id');
          next.parts = next.parts.filter((part) => part.id !== command.id);
          for (const part of next.parts)
            if (part.targetBinding === command.id) delete part.targetBinding;
          if (next.assemblies) {
            for (const group of next.assemblies) {
              group.ids = group.ids.filter((id) => id !== command.id);
              group.ports = group.ports.filter((port) => port.endpoint.part !== command.id);
            }
            next.assemblies = next.assemblies.filter((group) => group.ids.length);
            if (!next.assemblies.length) delete next.assemblies;
          }
          next.connections = next.connections.filter(
            (connection) => connection.a.part !== command.id && connection.b.part !== command.id,
          );
          break;
        case 'transform': {
          if (keys !== 'id,position,rotation,type')
            return result(false, 'INVALID_COMMAND', 'command');
          next = transformGroup(current.blueprint, command.id, command.position, command.rotation);
          break;
        }
        case 'mirror-assembly': {
          if (
            keys !== 'axis,ids,referenceId,type' &&
            keys !== 'axis,expectedCursor,ids,referenceId,type'
          )
            return result(false, 'INVALID_COMMAND', 'command');
          if (
            command.expectedCursor !== undefined &&
            !sameData(command.expectedCursor, session.observe().cursor)
          )
            return result(false, 'STALE_PROPOSAL', 'expectedCursor');
          next = proposeMirroredAssembly(current.blueprint, {
            ids: command.ids,
            referenceId: command.referenceId,
            axis: command.axis,
          }).blueprint;
          break;
        }
        case 'contactProperty': {
          if (
            keys !== 'id,primitive,property,type,value' ||
            command.primitive !== 'body' ||
            !['friction', 'restitution'].includes(command.property)
          )
            return result(false, 'INVALID_COMMAND', 'command');
          const part = next.parts.find((p) => p.id === command.id);
          if (!part) return result(false, 'UNKNOWN_PART', 'id');
          if (command.value === null) {
            if (part.authoredContact?.body) {
              delete part.authoredContact.body[command.property];
              if (!Object.keys(part.authoredContact.body).length) delete part.authoredContact.body;
              if (!Object.keys(part.authoredContact).length) delete part.authoredContact;
            }
          } else {
            part.authoredContact ??= {};
            part.authoredContact.body ??= {};
            part.authoredContact.body[command.property] = command.value;
          }
          break;
        }
        case 'material': {
          if (keys !== 'id,material,primitive,type')
            return result(false, 'INVALID_COMMAND', 'command');
          const part = next.parts.find((part) => part.id === command.id);
          if (!part) return result(false, 'UNKNOWN_PART', 'id');
          if (typeof command.primitive !== 'string')
            return result(false, 'INVALID_COMMAND', 'primitive');
          Object.defineProperty(part.authoredMaterial, command.primitive, {
            value: command.material,
            enumerable: true,
            writable: true,
            configurable: true,
          });
          break;
        }
        case 'surface-mount': {
          const allowed = [
            'type',
            'part',
            'sourceRegion',
            'targetPart',
            'targetRegion',
            'u',
            'v',
            'twist',
            'id',
            'replaceConnection',
            'assemblyId',
            'attach',
            'insertPart',
            'expectedCursor',
          ];
          if (
            Object.keys(command).some((key) => !allowed.includes(key)) ||
            typeof command.id !== 'string' ||
            (command.attach !== undefined && typeof command.attach !== 'boolean')
          )
            return result(false, 'INVALID_COMMAND', 'command');
          if (
            command.expectedCursor !== undefined &&
            !sameData(command.expectedCursor, session.observe().cursor)
          )
            return result(false, 'STALE_PROPOSAL', 'expectedCursor');
          next = proposeSurfaceMount(
            next,
            command.insertPart
              ? {
                  ...command,
                  insertPart: {
                    ...command.insertPart,
                    name: availablePartName(next.parts, command.insertPart.name),
                  },
                }
              : command,
          ).blueprint;
          break;
        }
        case 'rope':
        case 'cord': {
          if (keys !== 'connection,type' || command.connection?.kind !== command.type)
            return result(false, 'INVALID_COMMAND', 'connection');
          const previous = next.connections.find((c) => c.id === command.connection.id);
          if (previous && previous.kind !== command.type)
            return result(false, 'INVALID_COMMAND', 'connection.id');
          if (previous) next.connections[next.connections.indexOf(previous)] = command.connection;
          else next.connections.push(command.connection);
          break;
        }
        case 'connect': {
          if (keys !== 'a,b,id,type') return result(false, 'INVALID_COMMAND', 'command');
          const part = next.parts.find((p) => p.id === command.a?.part);
          const port =
            part &&
            (command.a?.surface
              ? resolveSurfaceEndpoint(part, command.a)
              : CATALOG[part.type].ports.find((p) => p.id === command.a?.port));
          if (!port) return result(false, 'INVALID_ENDPOINT', 'a');
          if (['fixed', 'shaft', 'spring'].includes(port.kind))
            next = snapConnection(next, command.a, command.b);
          next.connections.push({
            id: command.id,
            kind: surfaceConnectionKind(next, command.a, command.b, port.kind),
            a: command.a,
            b: command.b,
          });
          break;
        }
        case 'disconnect':
          if (keys !== 'id,type') return result(false, 'INVALID_COMMAND', 'command');
          if (typeof command.id !== 'string') return result(false, 'INVALID_COMMAND', 'id');
          if (!next.connections.some((connection) => connection.id === command.id))
            return result(false, 'UNKNOWN_CONNECTION', 'id');
          next.connections = next.connections.filter((connection) => connection.id !== command.id);
          break;
        case 'bind-control': {
          if (keys !== 'binding,id,type') return result(false, 'INVALID_COMMAND', 'command');
          const part = next.parts.find((p) => p.id === command.id);
          if (!part) return result(false, 'UNKNOWN_PART', 'id');
          if (part.type !== 'commandReceiver') return result(false, 'INVALID_COMMAND', 'id');
          part.controlBinding = command.binding;
          break;
        }
        case 'parameter': {
          if (keys !== 'id,key,type,value') return result(false, 'INVALID_COMMAND', 'command');
          const part = next.parts.find((p) => p.id === command.id);
          if (!part) return result(false, 'UNKNOWN_PART', 'id');
          if (
            typeof command.key !== 'string' ||
            !Object.hasOwn(CATALOG[part.type].parameterDefinitions, command.key)
          )
            return result(false, 'INVALID_COMMAND', 'key');
          if (resizeMovesMount(next, part.id, { ...part.parameters, [command.key]: command.value }))
            return result(false, 'SURFACE_RESIZE_MOVES_MOUNT', 'key');
          part.parameters[command.key] = command.value;
          break;
        }
        case 'restore-build':
        case 'load': {
          if (keys !== 'save,type') return result(false, 'INVALID_COMMAND', 'command');
          const loaded = loadSave(command.save);
          if (!loaded.ok) return loaded;
          next = loaded.blueprint;
          break;
        }
        default:
          return result(false, 'INVALID_COMMAND', 'command.type');
      }
      // No-op commands preserve both editor history and the observation cursor.
      // Rename changes only authored metadata; the physical owners remain intact.
      if (!['load', 'restore-build'].includes(command.type) && sameData(current.blueprint, next))
        return result(true);
      if (command.type === 'rename') {
        const validated = loadSave(next);
        if (!validated.ok) return validated;
        session.setMetadata({
          ...current,
          blueprint: next,
          editing: { undoCount: Math.min(historyLimit, past.length + 1), redoCount: 0 },
        });
        retain(past, current.blueprint);
        future.length = 0;
        return result(true);
      }
      const nextCompiled = compileAssembly(next);
      canonicalizeContactOverrides(next);
      const editing = ['load', 'restore-build'].includes(command.type)
        ? { undoCount: 0, redoCount: 0 }
        : sameData(current.blueprint, next)
          ? current.editing
          : {
              undoCount: Math.min(historyLimit, past.length + 1),
              redoCount: 0,
              ...(command.type === 'replace-scene' ? { undoLabel: 'Scene edit' } : {}),
            };
      await session.replaceConfiguration(nextCompiled.configuration, {
        blueprint: next,
        mapping: nextCompiled.mapping,
        connections: nextCompiled.connections,
        mode: command.type === 'restore-build' ? 'build' : current.mode,
        editing,
      });
      if (['load', 'restore-build'].includes(command.type)) {
        past.length = 0;
        future.length = 0;
      } else if (!sameData(current.blueprint, next)) {
        retain(past, current.blueprint, command.type === 'replace-scene' ? 'Scene edit' : null);
        future.length = 0;
      }
      return result(true);
    } catch (error) {
      return commandFailure(error);
    } finally {
      busy = false;
    }
  }
  function available() {
    if (disposed) reject('SESSION_DISPOSED');
    if (busy) reject('BUSY');
  }
  function restore(input) {
    available();
    let checkpoint;
    try {
      checkpoint = immutableCopy(input);
      const data = checkpoint.metadata;
      if (
        !data ||
        Object.keys(data).sort().join(',') !== 'blueprint,connections,editing,mapping,mode' ||
        !['build', 'run', 'paused'].includes(data.mode)
      )
        reject('INVALID_CHECKPOINT', 'metadata');
      if (
        !data.editing ||
        ![
          'redoCount,undoCount',
          'redoCount,undoCount,undoLabel',
          'redoCount,redoLabel,undoCount',
          'redoCount,redoLabel,undoCount,undoLabel',
        ].includes(Object.keys(data.editing).sort().join(',')) ||
        ['undoLabel', 'redoLabel'].some(
          (key) => data.editing[key] !== undefined && data.editing[key] !== 'Scene edit',
        ) ||
        ![data.editing.undoCount, data.editing.redoCount].every(
          (value) => Number.isSafeInteger(value) && value >= 0 && value <= historyLimit,
        )
      )
        reject('INVALID_CHECKPOINT', 'metadata.editing');
      const next = compileAssembly(data.blueprint);
      if (
        !sameData(checkpoint.configuration, next.configuration) ||
        !sameData(data.mapping, next.mapping) ||
        !sameData(data.connections, next.connections)
      )
        reject('INVALID_CHECKPOINT', 'metadata');
    } catch {
      reject('INVALID_CHECKPOINT', 'metadata');
    }
    session.restore(checkpoint);
    past.length = 0;
    future.length = 0;
    session.setMetadata({ ...checkpoint.metadata, editing: { undoCount: 0, redoCount: 0 } });
    return session.observe();
  }
  return Object.freeze({
    act,
    observe: session.observe,
    step(n = 1) {
      available();
      return session.step(n);
    },
    advanceTime(ms) {
      available();
      return session.advanceTime(ms);
    },
    runUntil(predicate, n) {
      available();
      return session.runUntil(predicate, n);
    },
    checkpoint() {
      available();
      return session.checkpoint();
    },
    restore,
    save() {
      return immutableCopy(metadata().blueprint);
    },
    failureBundle: session.failureBundle,
    dispose() {
      disposed = true;
      session.dispose();
    },
  });
}

import { resolveSurfaceEndpoint } from '../model/surfaces.mjs';
import { transformGroup } from '../model/editing.mjs';
import { proposeMirroredAssembly } from '../model/mirror-assembly.mjs';
import { CATALOG } from '../model/catalog.mjs';
import {
  createEmptyBlueprint,
  createPart,
  loadSave,
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
  const session = await createSession(compiled.configuration, identity, {
    blueprint: loaded.blueprint,
    mapping: compiled.mapping,
    connections: compiled.connections,
    mode: 'build',
    editing: { undoCount: 0, redoCount: 0 },
  });
  let busy = false,
    disposed = false;
  const past = [],
    future = [],
    historyLimit = 50;
  const retain = (stack, state) => {
    stack.push(immutableCopy(state));
    if (stack.length > historyLimit) stack.shift();
  };
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
        } else session.setMetadata({ ...current, mode: command.type === 'run' ? 'run' : 'paused' });
        return result(true);
      }
      if (command.type === 'control') {
        if (keys !== 'duty,id,type') return result(false, 'INVALID_COMMAND', 'command');
        const node = current.blueprint.parts.findIndex(
          (p) => p.id === command.id && p.type === 'commandReceiver',
        );
        return session.act({ type: 'receiver', node, duty: command.duty });
      }
      if (current.mode !== 'build') return result(false, 'EDIT_REQUIRES_BUILD', 'mode');
      if (['undo', 'redo'].includes(command.type)) {
        if (keys !== 'type') return result(false, 'INVALID_COMMAND', 'command');
        const from = command.type === 'undo' ? past : future,
          to = command.type === 'undo' ? future : past;
        if (!from.length)
          return result(false, command.type === 'undo' ? 'NOTHING_TO_UNDO' : 'NOTHING_TO_REDO');
        const blueprint = from.at(-1),
          candidate = compileAssembly(blueprint);
        await session.replaceConfiguration(candidate.configuration, {
          blueprint,
          mapping: candidate.mapping,
          connections: candidate.connections,
          mode: 'build',
          editing: {
            undoCount:
              command.type === 'undo' ? past.length - 1 : Math.min(historyLimit, past.length + 1),
            redoCount:
              command.type === 'redo'
                ? future.length - 1
                : Math.min(historyLimit, future.length + 1),
          },
        });
        from.pop();
        retain(to, current.blueprint);
        return result(true);
      }
      let next = structuredClone(current.blueprint);
      switch (command.type) {
        case 'insert':
          if (keys !== 'part,type') return result(false, 'INVALID_COMMAND', 'command');
          next.parts.push({
            ...command.part,
            name: availablePartName(next.parts, command.part.name),
          });
          break;
        case 'place':
          if (keys !== 'id,partType,position,type')
            return result(false, 'INVALID_COMMAND', 'command');
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
        case 'delete':
          if (keys !== 'id,type') return result(false, 'INVALID_COMMAND', 'command');
          if (!next.parts.some((part) => part.id === command.id))
            return result(false, 'UNKNOWN_PART', 'id');
          next.parts = next.parts.filter((part) => part.id !== command.id);
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
        case 'connect': {
          if (keys !== 'a,b,id,type') return result(false, 'INVALID_COMMAND', 'command');
          const part = next.parts.find((p) => p.id === command.a?.part);
          const port =
            part &&
            (command.a?.surface
              ? resolveSurfaceEndpoint(part, command.a)
              : CATALOG[part.type].ports.find((p) => p.id === command.a?.port));
          if (!port) return result(false, 'INVALID_ENDPOINT', 'a');
          if (['fixed', 'shaft'].includes(port.kind))
            next = snapConnection(next, command.a, command.b);
          next.connections.push({ id: command.id, kind: port.kind, a: command.a, b: command.b });
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
          part.parameters[command.key] = command.value;
          break;
        }
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
      if (command.type !== 'load' && sameData(current.blueprint, next)) return result(true);
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
      const editing =
        command.type === 'load'
          ? { undoCount: 0, redoCount: 0 }
          : sameData(current.blueprint, next)
            ? current.editing
            : { undoCount: Math.min(historyLimit, past.length + 1), redoCount: 0 };
      await session.replaceConfiguration(nextCompiled.configuration, {
        blueprint: next,
        mapping: nextCompiled.mapping,
        connections: nextCompiled.connections,
        mode: current.mode,
        editing,
      });
      if (command.type === 'load') {
        past.length = 0;
        future.length = 0;
      } else if (!sameData(current.blueprint, next)) {
        retain(past, current.blueprint);
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
        Object.keys(data.editing).sort().join(',') !== 'redoCount,undoCount' ||
        !Object.values(data.editing).every(
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

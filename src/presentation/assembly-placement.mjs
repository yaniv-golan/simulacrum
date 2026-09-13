import { insertAssembly } from '../model/reusable-assemblies.mjs';
import { transformPoseBetweenFrames } from '../model/transforms.mjs';
import { createDocumentProposal } from './document-proposal.mjs';

/** Assembly geometry uses the same document/cursor and pending policy as scene placement. */
export function createAssemblyPlacement({ getFrame, send }) {
  let view = null;
  const proposal = createDocumentProposal({
    getFrame,
    evaluate(value, blueprint) {
      const source = value.definition.parts.find(
        (p) => p.id === value.definition.assemblies[0].ids[0],
      );
      Object.assign(view, value, {
        parts: value.definition.parts.map((part) => ({
          ...part,
          ...transformPoseBetweenFrames(part, source, value),
        })),
      });
      const result = insertAssembly(blueprint, value.definition, value.position, value.rotation);
      view.instanceId = result.instanceId;
      view.resultBlueprint = JSON.stringify(result.blueprint);
      return result.blueprint;
    },
    send: (value, expectedCursor) => send({ type: 'insert-assembly', ...value, expectedCursor }),
  });
  const sync = () => {
    if (!proposal.read()) return null;
    Object.assign(view, proposal.read());
    return view;
  };
  return {
    read: sync,
    start(definition, previous) {
      if (proposal.read()?.phase === 'committing' || getFrame().metadata.mode !== 'build')
        return false;
      const origin = definition.parts.find((p) => p.id === definition.assemblies[0].ids[0]);
      view = {};
      const value = {
        definition: structuredClone(definition),
        position: [...origin.position],
        rotation: [...(previous?.rotation ?? origin.rotation)],
      };
      const right = Math.max(0, ...getFrame().metadata.blueprint.parts.map((p) => p.position[0]));
      for (let n = 1; n <= 30; n++) {
        value.position[0] = right + n;
        proposal.start(value);
        if (proposal.read().valid) break;
      }
      sync();
      return true;
    },
    pose(position, rotation = view.rotation) {
      if (![...position, ...rotation].every(Number.isFinite)) return;
      proposal.change({
        ...proposal.read()?.value,
        position: [...position],
        rotation: [...rotation],
      });
      sync();
    },
    refresh() {
      const result = proposal.refresh();
      sync();
      return result;
    },
    reconcile() {
      return this.refresh();
    },
    revalidate() {
      proposal.revalidate();
      sync();
    },
    async commit() {
      const result = await proposal.commit();
      sync();
      return result;
    },
    cancel() {
      if (getFrame().metadata.mode !== 'build') return false;
      const result = proposal.cancel();
      if (result) view = null;
      return result;
    },
  };
}

import { insertAssembly } from '../model/reusable-assemblies.mjs';
import { transformPoseBetweenFrames } from '../model/transforms.mjs';

/** Presentation-only proposal lifetime. Only send can publish an authored edit. */
export function createAssemblyPlacement({ getFrame, send }) {
  let state = null;
  const identity = () =>
    JSON.stringify([getFrame().metadata.blueprint, getFrame().metadata.mode, getFrame().cursor]);
  function evaluate() {
    const source = state.definition.parts.find(
      (p) => p.id === state.definition.assemblies[0].ids[0],
    );
    state.parts = state.definition.parts.map((part) => ({
      ...part,
      ...transformPoseBetweenFrames(part, source, state),
    }));
    state.valid = false;
    state.error = null;
    try {
      const proposal = insertAssembly(
        getFrame().metadata.blueprint,
        state.definition,
        state.position,
        state.rotation,
      );
      state.instanceId = proposal.instanceId;
      state.resultBlueprint = JSON.stringify(proposal.blueprint);
      state.valid = true;
    } catch (error) {
      state.error = error;
    }
  }
  return {
    read: () => state,
    start(definition, previous) {
      if (state?.phase === 'committing' || getFrame().metadata.mode !== 'build') return false;
      const origin = definition.parts.find((p) => p.id === definition.assemblies[0].ids[0]);
      state = {
        definition: structuredClone(definition),
        position: [...origin.position],
        rotation: [...(previous?.rotation ?? origin.rotation)],
        phase: 'preview',
        source: identity(),
        cursor: structuredClone(getFrame().cursor),
        stale: false,
      };
      const right = Math.max(0, ...getFrame().metadata.blueprint.parts.map((p) => p.position[0]));
      for (let n = 1; n <= 30; n++) {
        state.position[0] = right + n;
        evaluate();
        if (state.valid) break;
      }
      return true;
    },
    pose(position, rotation = state.rotation) {
      if (!state || state.phase !== 'preview' || state.stale) return;
      if (![...position, ...rotation].every(Number.isFinite)) return;
      state.position = [...position];
      state.rotation = [...rotation];
      evaluate();
    },
    refresh() {
      if (state?.phase === 'preview' && state.source !== identity()) state.stale = true;
      return this.reconcile();
    },
    reconcile() {
      if (state?.phase !== 'committing' || !state.replySettled) return null;
      // A changed cursor alone cannot establish which edit was published. Accept
      // only the complete ordinary insertion result, including fresh identities.
      if (JSON.stringify(getFrame().metadata.blueprint) !== state.resultBlueprint) return null;
      state.phase = 'accepted';
      state.error = null;
      return { ok: true, reconciled: true };
    },
    revalidate() {
      if (!state || state.phase !== 'preview' || getFrame().metadata.mode !== 'build') return;
      state.source = identity();
      state.cursor = structuredClone(getFrame().cursor);
      state.stale = false;
      evaluate();
    },
    async commit() {
      if (!state || state.phase !== 'preview') return null;
      this.refresh();
      if (state.stale || !state.valid || getFrame().metadata.mode !== 'build') return null;
      state.phase = 'committing';
      state.replySettled = false;
      try {
        const reply = await send({
          type: 'insert-assembly',
          definition: state.definition,
          position: state.position,
          rotation: state.rotation,
          expectedCursor: state.cursor,
        });
        state.replySettled = true;
        if (
          !reply ||
          reply.reasonCode === 'SESSION_FAILED' ||
          reply.reasonCode === 'SESSION_DISPOSED'
        ) {
          state.error = {
            message:
              'Placement outcome is unresolved. Waiting for the session to confirm the result.',
          };
          return this.reconcile();
        }
        state.phase = reply.ok ? 'accepted' : 'preview';
        if (!reply.ok) {
          state.error = reply;
          this.refresh();
        }
        return reply;
      } catch (error) {
        // A thrown transport error cannot prove that the edit was rejected.
        state.replySettled = true;
        state.error = {
          message:
            'Placement outcome is unresolved. Waiting for the session to confirm the result.',
        };
        return this.reconcile();
      }
    },
    cancel() {
      if (state?.phase === 'committing' || getFrame().metadata.mode !== 'build') return false;
      state = null;
      return true;
    },
  };
}

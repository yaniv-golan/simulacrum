/** Shared authored proposal policy: source-bound preview, one submission, exact reconciliation. */
export function createDocumentProposal({ getFrame, evaluate, send }) {
  let state = null;
  const identity = () =>
    JSON.stringify([getFrame().metadata.blueprint, getFrame().metadata.mode, getFrame().cursor]);
  function assess() {
    state.valid = false;
    try {
      state.result = evaluate(structuredClone(state.value), getFrame().metadata.blueprint);
      state.valid = true;
      state.error = null;
    } catch (error) {
      state.error = error;
    }
  }
  return {
    read: () => state,
    start(value, { preserve = false } = {}) {
      if (state?.phase === 'committing' || getFrame().metadata.mode !== 'build') return false;
      const previous = preserve ? (state?.previous ?? state) : null;
      state = {
        previous,
        value: structuredClone(value),
        source: identity(),
        cursor: structuredClone(getFrame().cursor),
        phase: 'preview',
        stale: false,
      };
      assess();
      return true;
    },
    change(value) {
      if (!state || state.phase !== 'preview' || state.stale) return false;
      state.value = structuredClone(value);
      assess();
      return true;
    },
    refresh() {
      if (state?.phase === 'preview' && state.source !== identity()) state.stale = true;
      if (
        state?.phase === 'committing' &&
        state.replySettled &&
        getFrame().cursor.session === state.cursor.session &&
        JSON.stringify(getFrame().metadata.blueprint) === JSON.stringify(state.result)
      ) {
        state.phase = 'accepted';
        state.error = null;
        return { ok: true, reconciled: true };
      }
    },
    revalidate() {
      if (!state || state.phase !== 'preview' || getFrame().metadata.mode !== 'build') return;
      state.source = identity();
      state.cursor = structuredClone(getFrame().cursor);
      state.stale = false;
      assess();
    },
    async commit() {
      this.refresh();
      if (!state || state.phase !== 'preview' || state.stale || !state.valid) return null;
      state.phase = 'committing';
      state.replySettled = false;
      try {
        const reply = await send(state.value, state.cursor);
        state.replySettled = true;
        if (reply && !['SESSION_FAILED', 'SESSION_DISPOSED'].includes(reply.reasonCode)) {
          state.phase = reply.ok ? 'accepted' : 'preview';
          state.error = reply.ok ? null : reply;
        }
      } catch {
        state.replySettled = true;
      }
      this.refresh();
      if (state.phase === 'committing')
        state.error = Error(
          'Outcome unresolved. Waiting for the workshop to confirm this exact edit.',
        );
      return state.phase === 'accepted'
        ? { ok: true }
        : state.phase === 'preview'
          ? state.error
          : null;
    },
    cancel(all = false) {
      if (state?.phase === 'committing') return false;
      state = all || state?.phase === 'accepted' ? null : (state?.previous ?? null);
      return true;
    },
  };
}

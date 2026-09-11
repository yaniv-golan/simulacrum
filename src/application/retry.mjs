/** Compose ordinary Build/Run admission; never restore individual physics poses. */
export function createRetry({ prepare, execute, finish }) {
  let pending = false;
  return {
    pending: () => pending,
    async run() {
      if (pending) return { ok: false, reasonCode: 'RETRY_PENDING', path: 'mode' };
      pending = true;
      try {
        await prepare();
        const reset = await execute({ type: 'build' });
        if (!reset.ok) return reset;
        return await execute({ type: 'run' });
      } finally {
        pending = false;
        finish();
      }
    },
  };
}

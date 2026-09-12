/** M3b. Shared locks cover actual video production; exclusive locks cover private UI.
 * Every app-controlled tab recorder must acquire this gate before producing frames.
 * onSuppress resolves only after the recorder is stopped and its segment finalized.
 * Call leave/close only after protected content (including previews) is hidden.
 */
export function createFeedbackCaptureGate({
  onSuppress = async () => {},
  onResume = async () => {},
  locks = globalThis.navigator?.locks,
  channel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('simulacrum-feedback-video-v1')
    : null,
  timeoutMs = 5000,
} = {}) {
  const name = 'simulacrum-feedback-video-v1';
  const isSupported = !!locks?.request && !!channel?.postMessage;
  let desired = false,
    closed = false,
    captureTask,
    captureAbort,
    releaseCapture;
  let serial = Promise.resolve(),
    protection,
    opening;
  const serialize = (fn) => {
    const next = serial.then(fn);
    serial = next.catch(() => {});
    return next;
  };
  const supported = () => {
    if (!isSupported || closed) throw Error('Capture privacy coordination unavailable');
  };
  function suppress() {
    return serialize(async () => {
      if (!releaseCapture) return;
      // On failure retain the shared lock: nobody may display protected content.
      await onSuppress();
      const release = releaseCapture;
      releaseCapture = null;
      release();
    });
  }
  const receive = ({ data }) => {
    if (data?.protocolVersion === 1 && data.kind === 'suppress') void suppress().catch(() => {});
  };
  channel?.addEventListener('message', receive);
  async function startCapture() {
    supported();
    if (desired) throw Error('Tab capture is already requested');
    desired = true;
    let startedResolve, startedReject;
    const started = new Promise((resolve, reject) => {
      startedResolve = resolve;
      startedReject = reject;
    });
    captureTask = (async () => {
      try {
        while (desired && !closed) {
          captureAbort = new AbortController();
          await locks.request(name, { mode: 'shared', signal: captureAbort.signal }, async () => {
            if (!desired || closed) return;
            let release;
            const held = new Promise((resolve) => {
              release = resolve;
            });
            releaseCapture = release;
            try {
              await serialize(async () => {
                if (desired && !closed) await onResume();
              });
              startedResolve();
            } catch (error) {
              desired = false;
              startedReject(error);
              // A partially started recorder still needs confirmed suppression.
              await suppress().catch(() => {});
            }
            await held;
          });
        }
        startedReject(Error('Tab capture stopped before starting'));
      } catch (error) {
        desired = false;
        startedReject(error);
      }
    })();
    return started;
  }
  async function stopCapture() {
    desired = false;
    captureAbort?.abort();
    await suppress();
    await captureTask;
  }
  async function enter() {
    supported();
    if (protection) return;
    if (opening) return opening;
    const controller = new AbortController();
    let release,
      accepted = false,
      timer;
    opening = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          Error(
            'Tab capture suppression could not be confirmed. Stop tab recording before opening feedback.',
          ),
        );
      }, timeoutMs);
      // Queue exclusivity BEFORE asking captures to yield. New captures queue behind it.
      const request = locks.request(
        name,
        { mode: 'exclusive', signal: controller.signal },
        async () => {
          if (controller.signal.aborted || closed) return;
          accepted = true;
          clearTimeout(timer);
          const held = new Promise((done) => {
            release = done;
          });
          protection = () => release();
          resolve();
          await held;
        },
      );
      request.catch(() => {
        if (!accepted) reject(Error('Tab capture suppression could not be confirmed'));
      });
      channel.postMessage({ protocolVersion: 1, kind: 'suppress' });
      void suppress().catch(() => {});
    }).finally(() => {
      clearTimeout(timer);
      opening = null;
    });
    return opening;
  }
  function leave() {
    protection?.();
    protection = null;
  }
  async function close() {
    closed = true;
    await stopCapture();
    leave();
    channel?.removeEventListener('message', receive);
    channel?.close();
  }
  return { isSupported, startCapture, stopCapture, enter, leave, close };
}

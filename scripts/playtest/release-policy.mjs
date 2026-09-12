// Workflow run numbers are ordered within the one trusted release workflow.
export function assertStagingOrder({ candidate, latestSuccessful }) {
  if (
    !/^[1-9][0-9]*$/.test(String(candidate)) ||
    (latestSuccessful != null && !/^[1-9][0-9]*$/.test(String(latestSuccessful)))
  )
    throw Error('Release run identity required');
  if (latestSuccessful != null && BigInt(candidate) < BigInt(latestSuccessful))
    throw Error('Superseded staging release');
}
export function assertReservationLifetime(reservation, requiredMs, now = Date.now()) {
  if (!Number.isFinite(reservation?.expires) || reservation.expires - now < requiredMs)
    throw Error('Insufficient synthetic reservation lifetime before publication');
}

// A finite delivery deadline, not a throughput or endurance qualification.
const finalDrainMs = 120000;
export const feedbackReceiptMs = 120000;
export function captureBrowserTimeoutMs(captureSeconds) {
  if (!Number.isInteger(captureSeconds) || captureSeconds < 0 || captureSeconds > 1800)
    throw Error('Invalid capture duration');
  // Delivery deadlines stay independent of archive processing. A measured 30-minute
  // archive required over four minutes just for two-at-a-time verified reads.
  // Give setup one minute and checksum export plus indexing a finite 15 minutes.
  return captureSeconds * 1000 + feedbackReceiptMs + finalDrainMs + 60000 + 900000;
}
export async function waitForCaptureDrain({
  read,
  now = () => performance.now(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const start = now();
  let state;
  while (true) {
    state = await read();
    const elapsedMs = now() - start;
    if (
      !Number.isSafeInteger(state?.pending) ||
      state.pending < 0 ||
      !Number.isSafeInteger(state?.bytes) ||
      state.bytes < 0 ||
      typeof state.saved !== 'boolean'
    )
      throw Error('Invalid drain observation');
    if (elapsedMs <= finalDrainMs && state.pending === 0 && state.bytes === 0 && state.saved)
      return { elapsedMs, finalOutbox: state };
    if (elapsedMs >= finalDrainMs)
      throw Error(
        `Capture drain deadline: ${state.pending} uploads, ${state.bytes} bytes remain; saved=${state.saved}`,
      );
    await wait(Math.min(1000, finalDrainMs - elapsedMs));
  }
}

// Feedback v1 has a separate envelope transport and storage budget from capture v2.
export function assertFeedbackQualification(worker, verification = {}) {
  const enabled = worker.vars?.FEEDBACK_ENABLED !== 'false';
  if (enabled && verification.mode !== 'bypass-expensive')
    throw Error(
      'Feedback protocol v1 capacity is unqualified: recording-only capacity evidence cannot qualify ' +
        'the standalone feedback envelope transport. Disable feedback or use the explicitly authorized ' +
        'experimental exception; its source-bound verification and live smoke checks still apply.',
    );
  // This only defers to the existing exception policy; it does not authorize an exception.
  return {
    enabled,
    protocolVersion: 1,
    transport: 'standalone-envelope-v1',
    capacityQualification: enabled ? 'UNQUALIFIED' : 'NOT_OFFERED',
  };
}

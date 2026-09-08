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

// Retain execution and cleanup causes without letting one hide the other.
export function errorMessages(error, seen = new Set()) {
  if (seen.has(error)) return [];
  seen.add(error);
  return [
    error?.message ?? String(error),
    ...(error?.errors ?? []).flatMap((e) => errorMessages(e, seen)),
    ...(error?.cause ? errorMessages(error.cause, seen) : []),
  ];
}
export async function withCleanup(execute, ...cleanups) {
  const failures = [];
  let result;
  try {
    result = await execute();
  } catch (error) {
    failures.push(error);
  }
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, failures.flatMap((e) => errorMessages(e)).join('; '));
  return result;
}

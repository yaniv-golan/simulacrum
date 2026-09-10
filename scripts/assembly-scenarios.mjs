/** Alternate the retained ordered scenarios; every index belongs to exactly one worker. */
export function assemblyPartition(index) {
  if (!Number.isSafeInteger(index) || index < 0) throw Error('Invalid scenario index');
  return index % 2;
}

/** Recording is a disclosed subset of workshop capacity. Event codecs own byte limits. */
export function assertRecordableObservation(observation) {
  const parts = observation?.metadata?.blueprint?.parts;
  if (Array.isArray(parts) && parts.length > 512)
    throw Error('Recording supports up to 512 machine parts. Save the workshop instead.');
}

const OMITTED_CAPTURE_KEYS = new Set([
  'name',
  'source',
  'program',
  'controllerProgram',
  'save',
  'definition',
  'part',
  'learningModel',
]);
/** Strip player text, programs, nested numbers, and assembly bodies from capture payloads. */
export function redactCommandInput(input) {
  if (Array.isArray(input)) return input.map(redactCommandInput);
  if (!input || typeof input !== 'object') return input;
  const redacted = {};
  for (const [key, value] of Object.entries(input)) {
    if (OMITTED_CAPTURE_KEYS.has(key) || key === 'position' || key === 'rotation') {
      redacted[key] = 'not captured';
      continue;
    }
    if (typeof value === 'number') {
      redacted[key] = 'not captured';
      continue;
    }
    redacted[key] = redactCommandInput(value);
  }
  return redacted;
}

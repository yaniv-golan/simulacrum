function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Physical KeyboardEvent.code values. Frame/pause keys and browser modifiers
// are reserved; these codes are interpreted only by the running input owner.
export const CONTROL_KEYS = freeze([
  ...'ABCDEGHIJKLMNOQRSTUVWXYZ'.split('').map((letter) => `Key${letter}`),
  ...'0123456789'.split('').map((digit) => `Digit${digit}`),
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export const DEFAULT_CONTROL_BINDING = freeze({
  mode: 'hold',
  drive: { gain: 1, positiveKeys: ['KeyW', 'ArrowUp'], negativeKeys: ['KeyS', 'ArrowDown'] },
  steer: { gain: 0, positiveKeys: ['KeyD', 'ArrowRight'], negativeKeys: ['KeyA', 'ArrowLeft'] },
});

export function controlBindingPreset(name) {
  const binding = structuredClone(DEFAULT_CONTROL_BINDING);
  switch (name) {
    case 'drive':
      break;
    case 'steer':
      binding.drive.gain = 0;
      binding.steer.gain = 1;
      break;
    case 'leftDrive':
      binding.steer.gain = 1;
      break;
    case 'rightDrive':
      binding.steer.gain = -1;
      break;
    case 'custom':
      binding.drive.positiveKeys = ['KeyI'];
      binding.drive.negativeKeys = [];
      break;
    default:
      throw new TypeError(`Unknown control binding preset: ${name}`);
  }
  return binding;
}

const keyList = {
  type: 'array',
  minItems: 0,
  maxItems: CONTROL_KEYS.length,
  uniqueItems: true,
  items: { type: 'string', enum: CONTROL_KEYS },
};
const axisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['gain', 'positiveKeys', 'negativeKeys'],
  properties: {
    gain: { type: 'number', minimum: -1, maximum: 1 },
    positiveKeys: keyList,
    negativeKeys: keyList,
  },
};
export const CONTROL_BINDING_SCHEMA = freeze({
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'drive', 'steer'],
  properties: { mode: { enum: ['hold', 'toggle'] }, drive: axisSchema, steer: axisSchema },
});

// Pure input mapping: callers own prior state and reset it when input focus or
// the run ends. No part identity, selection, assembly or physical state enters.
export function evaluateControlBinding(
  binding = DEFAULT_CONTROL_BINDING,
  pressedCodes = [],
  previousState,
) {
  const pressed = new Set(pressedCodes),
    previous = new Set(previousState?.pressedCodes ?? []);
  const level = (axis, codes) =>
    Number(axis.positiveKeys.some((key) => codes.has(key))) -
    Number(axis.negativeKeys.some((key) => codes.has(key)));
  const state = { pressedCodes: [], drive: 0, steer: 0 };
  const relevant = new Set();
  for (const name of ['drive', 'steer']) {
    const axis = binding[name];
    for (const key of [...axis.positiveKeys, ...axis.negativeKeys]) relevant.add(key);
    if (binding.mode === 'hold') state[name] = level(axis, pressed);
    else {
      const positive = axis.positiveKeys.some((key) => pressed.has(key));
      const negative = axis.negativeKeys.some((key) => pressed.has(key));
      const positiveEdge = positive && !axis.positiveKeys.some((key) => previous.has(key));
      const negativeEdge = negative && !axis.negativeKeys.some((key) => previous.has(key));
      let value = previousState?.[name] ?? 0;
      if (positive && negative) value = 0;
      else if (positiveEdge) value = value === 1 ? 0 : 1;
      else if (negativeEdge) value = value === -1 ? 0 : -1;
      state[name] = value;
    }
  }
  state.pressedCodes = [...relevant].filter((key) => pressed.has(key)).sort();
  const mixed = state.drive * binding.drive.gain + state.steer * binding.steer.gain;
  return { duty: Math.max(-1, Math.min(1, mixed)), state };
}

function keyLabel(code) {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Arrow/, 'Arrow ');
}
export function controlBindingSummary(binding = DEFAULT_CONTROL_BINDING) {
  const axes = ['drive', 'steer']
    .filter((name) => binding[name].gain !== 0)
    .map((name) => {
      const axis = binding[name];
      return `${name === 'drive' ? 'Primary' : 'Secondary'}: ${axis.positiveKeys.map(keyLabel).join('/') || 'None'} +, ${axis.negativeKeys.map(keyLabel).join('/') || 'None'} − × ${axis.gain}`;
    });
  return `${axes.join('; ') || 'No keyboard output'} (${binding.mode})`;
}

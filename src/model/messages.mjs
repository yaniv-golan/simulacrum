import { REASON_CODES } from './reasons.mjs';
const messages = {
  MIRROR_UNREPRESENTABLE:
    'These parts cannot be mirrored with their current shapes or connections.',
  UNKNOWN_SURFACE: 'Choose a highlighted mounting surface.',
  RELEASE_LATCH_CONFLICT:
    'Two latch faces cannot own one attachment. Mount one coupler by a different face.',
  SURFACE_OUT_OF_BOUNDS:
    'The mounting base extends beyond this surface. Slide it inward or choose a larger surface.',
  SURFACE_OVERLAP: 'This placement overlaps another part. Slide or rotate it until clear.',
  MOUNT_HELD_BY_ANOTHER_CONNECTION:
    'Another attachment holds this group. Disconnect that attachment before adjusting this mount.',
  STALE_PROPOSAL: 'The machine changed. Choose the mounting position again.',
  OK: 'Ready.',
  INVALID_BLUEPRINT:
    'This machine has invalid or missing settings. Check its parts and connections.',
  INVALID_JSON: 'This file is not valid JSON. Choose a saved machine file.',
  SAVE_VERSION_UNSUPPORTED_OLD:
    'This workshop only opens the current save format. Choose a machine saved by this version.',
  SAVE_VERSION_FUTURE: 'This save needs a newer workshop version.',
  UNKNOWN_PART_TYPE: 'Choose a part from the available parts.',
  DUPLICATE_ID: 'Two items have the same identifier. Give each a unique identifier.',
  UNKNOWN_PART: 'That part is no longer here. Select another part.',
  UNKNOWN_PORT: 'That connector is not on this part. Choose a listed connector.',
  SELF_CONNECTION: 'Choose a connector on another part.',
  PORT_OCCUPIED: 'This connector is already used. Choose another connector.',
  UNKNOWN_MATERIAL: 'Choose one of the listed materials.',
  INVALID_ROTATION: 'The rotation is invalid. Reset the part orientation.',
  INCOMPATIBLE_PORT_DIRECTION: 'Connect an output to an input of the same kind.',
  RESYNC_REQUIRED: 'The machine changed. Its current state has been refreshed.',
  INVALID_SCOPE: 'Choose the scene view.',
  INVALID_DETAIL: 'Choose a supported detail level.',
  INVALID_GROUND: 'The ground configuration is invalid. Restore the default workshop environment.',
  INVALID_GRAVITY: 'Gravity must contain three finite values.',
  INVALID_ENDPOINT: 'Choose an existing connector on each part.',
  GEAR_MISALIGNED:
    'Align both shaft axes, then set the gear centres one pitch-radius sum apart (180 mm for 12T and 24T). Connecting a gear mesh does not move parts.',
  UNSUPPORTED_GEAR_TOPOLOGY:
    'Mount each gear on its own rotating shaft, with both shafts attached to the same rigid support. Use at most eight meshes, without a closed loop.',
  MISALIGNED: 'These connectors are not aligned. Reconnect them to snap the parts together.',
  INCOMPATIBLE_CONNECTION_LOOP:
    'These parts already belong to the same mechanism, and the mounts do not meet. Choose another mount or reposition the mechanism.',
  UNSUPPORTED_SHAFT_TOPOLOGY:
    'This shaft arrangement is not supported yet. Connect one motor to an axle or wheel.',
  INVALID_CONFIGURATION:
    'The machine configuration is invalid. Return to Build and check its connections.',
  ENERGY_INVARIANT:
    'The electrical model could not account for this motion. The run stopped; return to Build. Its failure record is available.',
  INVALID_COMMAND: 'That action is not valid. Check the selected part and its settings.',
  INVALID_BODY: 'Select an existing part.',
  INVALID_VECTOR: 'Enter three finite coordinate values.',
  INVALID_CHECKPOINT: 'This checkpoint does not match the machine. Load a matching checkpoint.',
  SESSION_FAILED: 'The run has stopped after a simulation failure. Return to Build to restart.',
  SESSION_DISPOSED: 'This workshop session is closed. Reload the page.',
  REPLACEMENT_PENDING: 'The machine is being rebuilt. Try again when it finishes.',
  NON_FINITE_STATE:
    'The simulation produced an invalid value and stopped. Return to Build; the failure record is available.',
  INPUT_LIMIT: 'Too many commands arrived at once. Release the controls and try again.',
  INVARIANT_VIOLATION:
    'A simulation consistency check failed. Return to Build; the failure record is available.',
  ROPE_DOMAIN_LIMIT:
    'Choose a rope length of 0.25–4 m near or above the attachment distance. Use at most four ropes. Previous settings are preserved.',
  ROPE_MOTION_LIMIT:
    'Rope load or stretch limit reached. Return to Build, increase rope length or diameter, reduce the load or speed, then try again. The rope has not broken.',
  GEAR_MOTION_LIMIT:
    'Gear motion exceeded this model’s limits. Return to Build; check shaft supports, reduce motor current, or start with the machine resting on the floor.',
  PHYSICS_FAILURE: 'The physics step failed. Return to Build; the failure record is available.',
  INVALID_PREDICATE: 'Choose a supported stopping condition.',
  INVALID_TICK_COUNT: 'Choose a whole number of ticks from 0 to 28,800.',
  INVALID_ELAPSED_TIME: 'The elapsed interval is too large or invalid. Pause and resume the run.',
  UNKNOWN_CONNECTION: 'That connection no longer exists.',
  NOTHING_TO_UNDO: 'There are no earlier edits to undo.',
  NOTHING_TO_REDO: 'There are no undone edits to redo.',
  BUSY: 'The previous action is still finishing. Try again in a moment.',
  EDIT_REQUIRES_BUILD: 'Return to Build before changing parts.',
  INVALID_POWER_CONFIGURATION:
    'The electrical configuration is invalid. Check the power connections.',
  UNSUPPORTED_POWER_TOPOLOGY:
    'A power circuit can have several motors, but only one cell. Disconnect the extra cell.',
  UNSUPPORTED_SIGNAL_TOPOLOGY: 'Connect one Command Receiver output to each motor input.',
  INVALID_POWER_CHECKPOINT: 'The saved electrical state is invalid. Load a matching checkpoint.',
  POWER_STEP_PENDING: 'The electrical step is still in progress. Wait for the completed frame.',
  INVALID_POWER_STEP: 'The electrical step failed. Return to Build to restart.',
  INVALID_SIGNAL_COMMAND: 'Set the receiver duty between -1 and 1.',
  INVALID_MOTOR_SAMPLE:
    'A motor reading is invalid. Return to Build; the failure record is available.',
  INVALID_MOTOR_INERTIA: 'The motor load could not be measured. Check the shaft connection.',
  INVALID_CONTROLLER_CONFIGURATION: 'Check the controller input and output wires.',
  INVALID_CONTROLLER_PROGRAM: 'This controller program cannot be run. Check its configuration.',
  INVALID_CONTROLLER_SNAPSHOT: 'A controller reading is invalid. Return to Build to restart.',
  INVALID_CONTROLLER_OUTPUT:
    'The controller tried an invalid output. Check its receiver wiring and command range.',
  OFF: 'The motor command is zero. Check its control signal or default duty.',
  NO_POWER: 'Connect a Power Cell to the motor power connector.',
  NO_SHAFT: 'Connect the motor shaft to a wheel or axle.',
  DEPLETED: 'The cell is empty. Return to Build to recharge and try a larger capacity.',
};
for (const code of REASON_CODES)
  if (!messages[code]) throw Error(`missing player message: ${code}`);
export function explainReason(code) {
  return Object.hasOwn(messages, code)
    ? messages[code]
    : 'The action could not finish. Return to Build and try again.';
}

const fieldLabels = {
  version: 'Save format',
  name: 'Name',
  id: 'Identifier',
  type: 'Part type',
  position: 'Position',
  rotation: 'Orientation',
  parameters: 'Settings',
  authoredMaterial: 'Material',
  defaultDuty: 'Drive setting',
  currentLimit: 'Current limit',
  torqueConstant: 'Torque per amp',
  capacityJ: 'Stored energy',
  internalResistance: 'Cell resistance',
  port: 'Connector',
  part: 'Part',
  surface: 'Mounting surface',
  region: 'Surface',
  u: 'Along surface',
  v: 'Across surface',
  twist: 'Turn',
  mode: 'Mode',
  command: 'Action',
  key: 'Setting',
  primitive: 'Shape',
};
const ownValue = (object, key) =>
  object !== null && (typeof object === 'object' || typeof object === 'function')
    ? Object.getOwnPropertyDescriptor(object, key)?.value
    : undefined;
const mirrorPartPath =
  /^parts\/([A-Za-z0-9_-]{1,64})\/(surface|geometry|ports\/[A-Za-z0-9_-]{1,64})$/;
function safePath(value) {
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)
  )
    return '';
  if (mirrorPartPath.test(value)) return value;
  // Error paths describe authored fields, never filesystem paths or stack traces.
  return /^(?:\/(?:parts|connections|version|id|name)(?:\/.*)?|(?:command|mode|name|id|key|primitive|connections|a|b)(?:[./].*)?)$/.test(
    value,
  )
    ? value
    : '';
}
/** A closed result envelope also accepts known reason-code Error messages. */
export function normalizeFailure(error, fallback = 'INVALID_COMMAND') {
  const candidate = ownValue(error, 'reasonCode') ?? ownValue(error, 'message');
  const known = candidate !== 'OK' && REASON_CODES.includes(candidate);
  const reasonCode = known
    ? candidate
    : REASON_CODES.includes(fallback) && fallback !== 'OK'
      ? fallback
      : 'INVALID_COMMAND';
  return { ok: false, reasonCode, path: known ? safePath(ownValue(error, 'path')) : '' };
}
/** Display only the admitted code, authored location and optional player part name. */
export function explainFailure(error, blueprint) {
  const failure = normalizeFailure(error),
    message = explainReason(failure.reasonCode),
    path = failure.path;
  if (!path) return message;
  const mirrorPart = mirrorPartPath.exec(path);
  if (failure.reasonCode === 'MIRROR_UNREPRESENTABLE' && mirrorPart) {
    const parts = ownValue(blueprint, 'parts');
    let name;
    if (Array.isArray(parts)) {
      for (let i = 0; i < parts.length; i++) {
        const part = ownValue(parts, String(i));
        if (ownValue(part, 'id') === mirrorPart[1]) name = ownValue(part, 'name');
      }
    }
    if (typeof name !== 'string' || !name.trim()) return message;
    name = name
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .trim()
      .slice(0, 128);
    if (mirrorPart[2] === 'surface')
      return `${name} has no mounting face at the mirrored position. Try another mirror plane, or mount the parts on a support with faces on both sides before mirroring.`;
    if (mirrorPart[2].startsWith('ports/'))
      return `${name} has no matching connector at the mirrored position. Try another mirror plane or a different attachment before mirroring.`;
    return `${name}'s shape or material layout cannot be mirrored with the same part. Choose a different part to copy, or build the opposite side separately.`;
  }
  const overlap = /^\/parts\/(\d+)\/overlaps\/(\d+)$/.exec(path);
  if (failure.reasonCode === 'SURFACE_OVERLAP' && overlap) {
    const names = overlap.slice(1).map((index) => {
      const name = ownValue(ownValue(ownValue(blueprint, 'parts'), index), 'name');
      return typeof name === 'string' ? name.slice(0, 128) : `Part ${Number(index) + 1}`;
    });
    return `${names.join(' overlaps ')}. Move the part clear; nothing was changed.`;
  }
  const tokens = path
    .replace(/^\//, '')
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
  const index = Number(tokens[1]);
  let subject = '',
    fieldStart = 0;
  if (
    ['parts', 'connections'].includes(tokens[0]) &&
    /^\d+$/.test(tokens[1] ?? '') &&
    Number.isSafeInteger(index)
  ) {
    subject = `${tokens[0] === 'parts' ? 'Part' : 'Connection'} ${index + 1}`;
    fieldStart = 2;
    if (tokens[0] === 'parts') {
      const name = ownValue(ownValue(ownValue(blueprint, 'parts'), String(index)), 'name');
      if (typeof name === 'string' && name.trim())
        subject = name
          .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
          .trim()
          .slice(0, 128);
    }
  }
  const fields = tokens.slice(fieldStart),
    specific = [...fields].reverse().find((token) => Object.hasOwn(fieldLabels, token)),
    label = specific
      ? fieldLabels[specific]
      : fields.filter((token) => !/^\d+$/.test(token)).join(' · ');
  const location = [subject, label].filter(Boolean).join(' · ');
  return `${message} ${location ? `${location} ` : ''}(${path}).`;
}

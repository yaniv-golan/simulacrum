/** Ordinary player-visible controller source embedded in the built-in cart. */
export const CART_CONTROLLER_TYPESCRIPT = `type InputBinding =
  | 'pilot.drive' | 'pilot.steering' | 'pilot.brake' | 'pilot.lights';
type OutputBinding =
  | 'motor.0.throttle' | 'motor.1.throttle'
  | 'motor.2.throttle' | 'motor.3.throttle'
  | 'motor.0.brake' | 'motor.1.brake'
  | 'motor.2.brake' | 'motor.3.brake'
  | 'steering.0.target' | 'steering.1.target'
  | 'lamp.0.lights' | 'lamp.1.lights';

interface ControlAPI {
  read(binding: InputBinding): number;
  write(binding: OutputBinding, value: number): void;
}

function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// The remote talks only to powered receiver parts. This ordinary script then
// commands each physically wired actuator; users can inspect or replace it.
function tick(api: ControlAPI, _dt: number): void {
  const drive = clampSigned(api.read('pilot.drive'));
  const steering = clampSigned(api.read('pilot.steering'));
  const brake = clamp01(api.read('pilot.brake'));
  const lights = api.read('pilot.lights') > 0.5 ? 1 : 0;

  api.write('motor.0.throttle', drive);
  api.write('motor.1.throttle', drive);
  api.write('motor.2.throttle', drive);
  api.write('motor.3.throttle', drive);
  api.write('motor.0.brake', brake);
  api.write('motor.1.brake', brake);
  api.write('motor.2.brake', brake);
  api.write('motor.3.brake', brake);
  api.write('steering.0.target', steering);
  api.write('steering.1.target', steering);
  api.write('lamp.0.lights', lights);
  api.write('lamp.1.lights', lights);
}`;

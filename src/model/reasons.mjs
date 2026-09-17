import { ROPE_REASON_CODES } from './rope.mjs';
import { CORD_REASON_CODES } from './cord.mjs';
import { SURFACE_REASON_CODES } from './surfaces.mjs';
import { MIRROR_REASON_CODES } from './mirror-assembly.mjs';
import { BLUEPRINT_REASON_CODES } from './blueprint.mjs';
import { OBSERVATION_REASON_CODES } from './observation.mjs';
import { ASSEMBLY_REASON_CODES } from './assembly.mjs';
import { REASON_CODES as SESSION_REASON_CODES } from './tick.mjs';
import { POWER_REASON_CODES, CONTROLLER_REASON_CODES } from './power.mjs';
export const CORE_REASON_CODES = Object.freeze([
  'BUSY',
  'EDIT_REQUIRES_BUILD',
  'UNKNOWN_CONNECTION',
  'NOTHING_TO_UNDO',
  'NOTHING_TO_REDO',
]);
// Each owner authors its own codes; the player surface exposes their union.
export const REASON_CODES = Object.freeze([
  ...new Set([
    ...ROPE_REASON_CODES,
    ...CORD_REASON_CODES,
    ...SURFACE_REASON_CODES,
    ...MIRROR_REASON_CODES,
    ...BLUEPRINT_REASON_CODES,
    ...OBSERVATION_REASON_CODES,
    ...ASSEMBLY_REASON_CODES,
    ...SESSION_REASON_CODES,
    ...CORE_REASON_CODES,
    ...POWER_REASON_CODES,
    ...CONTROLLER_REASON_CODES,
  ]),
]);
export function isReasonCode(value) {
  return REASON_CODES.includes(value);
}

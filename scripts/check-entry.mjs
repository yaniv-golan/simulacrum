import { CHECKS } from './checks.mjs';
export async function check(id) {
  if (typeof CHECKS[id] !== 'function') throw Error(`unknown check: ${id}`);
  await CHECKS[id]();
}

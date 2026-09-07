// @ts-check
/** @param {boolean} ok @param {string} [reasonCode] @param {string} [path]
 * @returns {import('./workshop-command.js').CommandResult} */
export function commandResult(ok, reasonCode = 'OK', path = '') {
  return { ok, reasonCode, path };
}
/** @param {string} id @param {number} duty
 * @returns {Extract<import('./workshop-command.js').WorkshopCommand, {type: 'control'}>} */
export function controlCommand(id, duty) {
  return { type: 'control', id, duty };
}
/** @param {'run' | 'pause' | 'build'} type
 * @returns {Extract<import('./workshop-command.js').WorkshopCommand, {type: 'run' | 'pause' | 'build'}>} */
export function modeCommand(type) {
  return { type };
}

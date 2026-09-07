// @ts-check
// Conversion names mark the presentation boundary; the stored model stays SI.
/** @param {number} radians @returns {number} */
export const radiansToDegrees = (radians) => (radians * 180) / Math.PI;
/** @param {number} degrees @returns {number} */
export const degreesToRadians = (degrees) => (degrees * Math.PI) / 180;
/** @param {number} metres @returns {number} */
export const metresToMillimetres = (metres) => metres * 1000;
/** @param {number} millimetres @returns {number} */
export const millimetresToMetres = (millimetres) => millimetres / 1000;

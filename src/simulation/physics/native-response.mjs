// @ts-check
/** Own a copied numerical native factor for one preparation lifetime.
 * No world, body, collider or joint is retained by the factor.
 * @param {{project(v:Float64Array):Float64Array,response(v:Float64Array):Float64Array,free():void}} factor
 * @param {number} bodyCount */
export function readNativeResponse(factor, bodyCount) {
  const n = bodyCount * 6;
  let disposed = false;
  /** @param {'project'|'response'} method @param {number[]|Float64Array} value */
  function evaluate(method, value) {
    if (disposed) throw new Error('disposed native response');
    if (
      (!Array.isArray(value) && !(value instanceof Float64Array)) ||
      value.length !== n ||
      !value.every(Number.isFinite)
    )
      throw new TypeError('invalid response vector');
    const data = factor[method](value instanceof Float64Array ? value : new Float64Array(value));
    if (!(data instanceof Float64Array) || data.length !== n * 2)
      throw new Error('invalid native response result');
    for (let i = 0; i < data.length; i++)
      if (!Number.isFinite(data[i])) throw new Error('invalid native response result');
    return {
      impulse: data.subarray(0, n),
      velocity: data.subarray(n),
    };
  }
  return Object.freeze({
    /** @param {number[]|Float64Array} value */
    project: (value) => evaluate('project', value),
    /** @param {number[]|Float64Array} value */
    response: (value) => evaluate('response', value),
    dispose() {
      if (!disposed) {
        disposed = true;
        factor.free();
      }
    },
  });
}

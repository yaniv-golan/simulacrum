// @ts-check
/** The numeric range a generic parameter control may reach.
 *
 * A parameter that declares an `enum` offers a fixed menu, so the control must not be able to
 * reach anything else: the bounds come from the menu and the step from its spacing. Without that
 * a number input is left on step `any`, which reports an off-menu value as valid, sends it, and
 * lets the generated schema deliver the refusal the field should have shown.
 *
 * A non-uniform menu can still leave an unreachable value HTML-valid between two of its entries;
 * the smallest spacing is the closest a single step attribute can come, and the schema remains
 * the authority. `step: null` means the control keeps `any`.
 *
 * @param {{ type: 'number' | 'integer', minimum: number, maximum: number, enum?: readonly number[] }} parameter
 * @returns {{ min: number, max: number, step: number | null }}
 */
export function parameterInputRange(parameter) {
  const menu = parameter.enum;
  if (!menu?.length)
    return {
      min: parameter.minimum,
      max: parameter.maximum,
      step: parameter.type === 'integer' ? 1 : null,
    };
  const values = [...menu].sort((a, b) => a - b);
  const spacing = values
    .slice(1)
    .reduce((smallest, value, index) => Math.min(smallest, value - values[index]), Infinity);
  return {
    min: values[0],
    max: values[values.length - 1],
    // Read the spacing back as the decimal the menu was authored in: subtracting two authored
    // decimals can land a few units in the last place away and then refuse the very values it
    // was derived from.
    step: values.length > 1 ? Number(spacing.toPrecision(12)) : null,
  };
}

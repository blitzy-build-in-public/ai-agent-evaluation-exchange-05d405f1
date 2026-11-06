/**
 * The single rounding point of the entire product.
 *
 * `allocate` returns the founder-participation allocation for an amount, in whole minor
 * units of the synthetic `DEMO` currency: the amount, multiplied by the rate in basis
 * points and divided by ten thousand, rounded half up. Every amount in this product is an
 * integer in minor units, so this multiplication is the only place a fraction is ever
 * produced, and the rounding below is the only place one is resolved: callers pass their
 * amount through here rather than applying a rate themselves.
 *
 * The function is pure — no clock, no random source, no I/O — so the same arguments always
 * yield the same allocation.
 *
 * @param amountMinorUnits The amount to allocate from, in whole minor units of `DEMO`.
 *   A non-negative safe integer.
 * @param rateBasisPoints The allocation rate in basis points, where a basis point is one
 *   hundredth of one percent and the default rate of 25 basis points is a quarter of one
 *   percent. A non-negative safe integer.
 * @returns The allocation in whole minor units.
 * @throws {RangeError} If either argument is negative or not a safe integer, or if their
 *   product is not a safe integer. The message names the offending argument.
 */
export function allocate(amountMinorUnits: number, rateBasisPoints: number): number {
  if (!Number.isSafeInteger(amountMinorUnits) || amountMinorUnits < 0) {
    throw new RangeError(
      `allocate: amountMinorUnits must be a non-negative safe integer, received ${renderReceived(amountMinorUnits)}`,
    );
  }

  if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0) {
    throw new RangeError(
      `allocate: rateBasisPoints must be a non-negative safe integer, received ${renderReceived(rateBasisPoints)}`,
    );
  }

  const product = amountMinorUnits * rateBasisPoints;

  // The product of two safe integers can pass Number.MAX_SAFE_INTEGER, and past it the
  // multiplication is silently inexact, which would make the rounding quietly wrong. A
  // refused call is a better outcome than a wrong allocation, so it is refused here.
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(
      `allocate: the product of amountMinorUnits ${renderReceived(amountMinorUnits)} and rateBasisPoints ${renderReceived(rateBasisPoints)} is not a safe integer`,
    );
  }

  // Basis points are ten-thousandths, so ten thousand is the divisor. `whole` is always an
  // exact multiple of it, which is why `whole / 10000` is exact integer division and never
  // produces a fraction. `frac >= 5000` is the half-up boundary: a fraction of exactly one
  // half rounds up, and the tie is broken by integer comparison rather than by the rounding
  // mode of the number type. No rounding helper is called for that reason — the built-in one
  // would break the tie the other way once a value is negative — and no fixed-precision text
  // conversion is used either, because it would return text rather than a number.
  const whole = product - (product % 10000);
  const frac = product % 10000;

  return whole / 10000 + (frac >= 5000 ? 1 : 0);
}

/**
 * Renders a received value for a refusal message. A refusal must be the documented
 * `RangeError` whatever an untyped caller passes, which interpolating the value into the
 * message cannot promise: `String` is defined for a symbol, and a value whose own text
 * conversion raises is answered with text read from its type, which no value can influence.
 */
function renderReceived(value: unknown): string {
  try {
    return String(value);
  } catch {
    return `a value of type ${typeof value}`;
  }
}

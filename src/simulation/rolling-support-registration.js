import { DomainValidationError } from "../model/primitives.js";

const registrationsByTransaction = new WeakMap();

export function rollingSupportRegistrations(transaction) {
  let registrations = registrationsByTransaction.get(transaction);
  if (!registrations) {
    registrations = new Map();
    registrationsByTransaction.set(transaction, registrations);
  }
  return registrations;
}

export function registerRollingSupport(
  transaction,
  { wheelBody, wheelShape, descriptor, constraint },
) {
  const registrations = rollingSupportRegistrations(transaction);
  if (
    !wheelBody ||
    !wheelShape ||
    !wheelBody.shapes?.includes(wheelShape) ||
    !descriptor ||
    !constraint
  )
    throw new DomainValidationError(
      "INVALID_ROLLING_SUPPORT_REGISTRATION",
      "Rolling support registration requires wheel, descriptor, and constraint",
    );
  const byShape = registrations.get(wheelBody) || new Map();
  if (byShape.has(wheelShape))
    throw new DomainValidationError(
      "DUPLICATE_ROLLING_SUPPORT_REGISTRATION",
      `Wheel body ${wheelBody.id} shape ${wheelShape.id} already has rolling support`,
    );
  byShape.set(
    wheelShape,
    Object.freeze({ wheelBody, wheelShape, descriptor, constraint }),
  );
  registrations.set(wheelBody, byShape);
}

export function unregisterRollingSupport(
  transaction,
  { wheelBody, wheelShape = null, constraint },
) {
  const registrations = rollingSupportRegistrations(transaction),
    byShape = registrations.get(wheelBody),
    targetShape = wheelShape || [...(byShape?.keys() || [])][0],
    current = byShape?.get(targetShape);
  if (!current || (wheelShape == null && byShape.size !== 1)) return false;
  if (constraint && current.constraint !== constraint)
    throw new DomainValidationError(
      "ROLLING_SUPPORT_REGISTRATION_MISMATCH",
      `Wheel body ${wheelBody.id} rolling support owner changed`,
    );
  byShape.delete(targetShape);
  if (!byShape.size) registrations.delete(wheelBody);
  return true;
}

export function clearRollingSupportRegistrations(transaction) {
  const registrations = registrationsByTransaction.get(transaction);
  registrations?.clear();
}

export function rollingSupportRegistrationCount(transaction) {
  let count = 0;
  for (const byShape of rollingSupportRegistrations(transaction).values())
    count += byShape.size;
  return count;
}

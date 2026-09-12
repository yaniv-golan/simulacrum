import { CATALOG } from '../model/catalog.mjs';
export const PRIMARY_PARTS = Object.freeze(['powerCell', 'poweredMotor', 'gripWheel']);
export const MORE_PARTS = Object.freeze(
  Object.keys(CATALOG).filter((type) => !PRIMARY_PARTS.includes(type)),
);

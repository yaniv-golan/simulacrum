/** Frozen collision resolution for every canonical local-X cylinder. */
export const CYLINDER_SEGMENTS = 64;
export const CYLINDER_MAX_RADIAL_ERROR_RATIO = 1 - Math.cos(Math.PI / CYLINDER_SEGMENTS);

export const AUTHORING_TRANSLATION_SNAP_M = 0.25;
export const WORKSHOP_PLATFORM_SIZE_M = 44;

/**
 * The construction board bounds only the ground-plane axes. Vertical authored
 * placement remains unconstrained because assemblies may legitimately extend
 * above or below the board surface.
 */
export const AUTHORING_WORKSPACE_BOUNDS_WORLD_M = Object.freeze({
  minimumM: Object.freeze([
    -WORKSHOP_PLATFORM_SIZE_M / 2,
    null,
    -WORKSHOP_PLATFORM_SIZE_M / 2,
  ]),
  maximumM: Object.freeze([
    WORKSHOP_PLATFORM_SIZE_M / 2,
    null,
    WORKSHOP_PLATFORM_SIZE_M / 2,
  ]),
});

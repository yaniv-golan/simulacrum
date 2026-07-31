/**
 * Frozen consumer inventory for the public component-geometry cutover.
 *
 * Each entry identifies an owning layer, the canonical field family it
 * consumes, and one source token that must remain present. This prevents a
 * presentation-only migration from silently omitting compiler, analysis,
 * runtime, editor, Core, documentation, or verification consumers.
 */
export const COMPONENT_GEOMETRY_CONSUMER_MATRIX_V1 = Object.freeze([
  Object.freeze({
    field: "bounds",
    layer: "model",
    file: "src/model/component-geometry-contract.js",
    token: "bodyBoundsPartM",
  }),
  Object.freeze({
    field: "bounds",
    layer: "compiler",
    file: "src/model/assembly-compiler-context.js",
    token: "geometryDescriptorForPart",
  }),
  Object.freeze({
    field: "bounds",
    layer: "analysis",
    file: "src/model/engineering-analysis.js",
    token: "geometryDescriptorForPart",
  }),
  Object.freeze({
    field: "bounds",
    layer: "runtime",
    file: "src/simulation/multibody-runtime.js",
    token: "deformedBodyBoundsPartM",
  }),
  Object.freeze({
    field: "bounds",
    layer: "presentation",
    file: "src/presentation/component-detail-controller.js",
    token: "selectionBoundsPartM",
  }),
  Object.freeze({
    field: "bounds",
    layer: "editor",
    file: "src/application/testing-playground-feature.js",
    token: "selectionBoundsPartM",
  }),
  Object.freeze({
    field: "bounds",
    layer: "core",
    file: "src/core/index.js",
    token: "geometryDescriptorForPart",
  }),
  Object.freeze({
    field: "bounds",
    layer: "docs",
    file: "docs/CORE_API.md",
    token: "GeometryDescriptorV2",
  }),
  Object.freeze({
    field: "bounds",
    layer: "tests",
    file: "scripts/verify-component-geometry-contract.mjs",
    token: "bodyBoundsPartM",
  }),
  Object.freeze({
    field: "appearance",
    layer: "model",
    file: "src/model/component-geometry-contract.js",
    token: "materialKey",
  }),
  Object.freeze({
    field: "appearance",
    layer: "presentation",
    file: "src/presentation/component-appearance-library.js",
    token: "componentAppearanceContract",
  }),
  Object.freeze({
    field: "appearance",
    layer: "runtime",
    file: "src/presentation/aerothermal-visuals.js",
    token: "material",
  }),
  Object.freeze({
    field: "appearance",
    layer: "editor",
    file: "src/application/component-mesh-replacement.js",
    token: "customColor",
  }),
  Object.freeze({
    field: "appearance",
    layer: "docs",
    file: "ARCHITECTURE.md",
    token: "material",
  }),
  Object.freeze({
    field: "appearance",
    layer: "tests",
    file: "scripts/fixtures/component-appearance-matrix.js",
    token: "COMPONENT_APPEARANCE_MATRIX_V1",
  }),
  Object.freeze({
    field: "deformation",
    layer: "model",
    file: "src/model/component-geometry-contract.js",
    token: "mechanismDeformationTransforms",
  }),
  Object.freeze({
    field: "deformation",
    layer: "runtime",
    file: "src/simulation/multibody-runtime.js",
    token: "coordinateId",
  }),
  Object.freeze({
    field: "deformation",
    layer: "presentation",
    file: "src/presentation/mechanism-pose-presenter.js",
    token: "coordinateM",
  }),
  Object.freeze({
    field: "deformation",
    layer: "core",
    file: "src/core/index.js",
    token: "component-geometry-contract.js",
  }),
  Object.freeze({
    field: "deformation",
    layer: "docs",
    file: "docs/CORE_API.md",
    token: "coordinateM",
  }),
  Object.freeze({
    field: "deformation",
    layer: "tests",
    file: "scripts/verify-guide-actuator-runtime.mjs",
    token: "deformedBodyBoundsPartM",
  }),
]);

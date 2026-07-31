/** Frozen product qualification map for canonical visuals and owned resources. */
export const COMPONENT_VISUAL_WORKFLOW_MATRIX_V1 = Object.freeze(
  [
    ["place", "scripts/verify-editor-tools.mjs", "battery placement"],
    [
      "duplicate",
      "scripts/verify-component-authored-carriers-browser.mjs",
      "component duplication",
    ],
    ["recolor", "scripts/verify-editor-tools.mjs", "battery recolor"],
    [
      "connect",
      "scripts/verify-port-editor-browser.mjs",
      "interactive port connection",
    ],
    ["move", "scripts/verify-editor-tools.mjs", "arrangement undo"],
    [
      "scale",
      "scripts/verify-component-inspection-browser.mjs",
      "inspector scale rebuild",
    ],
    ["box-select", "scripts/verify-editor-tools.mjs", "subassembly reuse"],
    [
      "inspect",
      "scripts/verify-component-inspection-browser.mjs",
      "inspect isolate and frame",
    ],
    ["explode", "scripts/verify-keyboard-workflows.mjs", "exploded view"],
    [
      "isolate",
      "scripts/verify-component-visual-realism-browser.mjs",
      "isolated detail",
    ],
    [
      "frame",
      "scripts/verify-component-visual-realism-browser.mjs",
      "isolated detail",
    ],
    ["undo-redo", "scripts/verify-editor-tools.mjs", "battery recolor redo"],
    [
      "save-load",
      "scripts/verify-component-authored-carriers-browser.mjs",
      "workspace reload",
    ],
    [
      "subassembly-reuse",
      "scripts/verify-editor-tools.mjs",
      "subassembly reuse",
    ],
    [
      "share-round-trip",
      "scripts/verify-component-authored-carriers-browser.mjs",
      "shared blueprint load",
    ],
    [
      "start-stop",
      "scripts/verify-component-visual-realism-browser.mjs",
      "night run",
    ],
    [
      "exact-step",
      "scripts/verify-failure-analysis.mjs",
      "completed failure state",
    ],
    [
      "checkpoint-replay",
      "scripts/verify-mechanism-sharing-proof.mjs",
      "exact mechanism checkpoint restore",
    ],
    [
      "failure-replay",
      "scripts/verify-failure-analysis.mjs",
      "failure replay frame",
    ],
    [
      "day-night",
      "scripts/verify-component-visual-realism-browser.mjs",
      "daylight overview",
    ],
    [
      "clear-reload",
      "scripts/verify-component-authored-carriers-browser.mjs",
      "My Parts reuse",
    ],
  ].map(([operation, file, assertionLabel]) =>
    Object.freeze({ operation, file, assertionLabel }),
  ),
);

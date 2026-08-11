import { validateControllerBindingManifest } from "./controller-bindings.js";
import {
  validatePointContactWrenchControllerSpec,
  validatePointContactWrenchOutputBindingIds,
} from "./point-contact-wrench-controller-contract.js";

function assertBindingId(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function exactRecord(value, fields, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")
  )
    throw new TypeError(`${label} has an invalid field set`);
  return value;
}

function numberLiteral(value) {
  return Object.is(value, -0) ? "-0" : String(value);
}

function contactCandidate(candidate, index) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    throw new TypeError(`candidates[${index}] must be an object`);
  return {
    contactInputBindingId: assertBindingId(
      candidate.contactInputBindingId,
      `candidates[${index}].contactInputBindingId`,
    ),
    normalForceInputBindingId: assertBindingId(
      candidate.normalForceInputBindingId,
      `candidates[${index}].normalForceInputBindingId`,
    ),
    membershipOutputBindingId: assertBindingId(
      candidate.membershipOutputBindingId,
      `candidates[${index}].membershipOutputBindingId`,
    ),
    confidenceOutputBindingId: assertBindingId(
      candidate.confidenceOutputBindingId,
      `candidates[${index}].confidenceOutputBindingId`,
    ),
  };
}

function assertDistinctBindingIds(bindings) {
  const seen = new Set();
  for (const [label, bindingId] of bindings) {
    if (seen.has(bindingId))
      throw new Error(
        `controller binding ID ${bindingId} is reused at ${label}`,
      );
    seen.add(bindingId);
  }
}

function validateContactSetManifest(
  contacts,
  outputBindingIds,
  bindingManifest,
) {
  const manifest = validateControllerBindingManifest(bindingManifest),
    byId = new Map(manifest.map((binding) => [binding.id, binding])),
    requireBinding = (bindingId, direction, label) => {
      const binding = byId.get(bindingId);
      if (!binding || binding.direction !== direction)
        throw new Error(`${label} must name a declared ${direction} binding`);
      return binding;
    };
  for (const [index, candidate] of contacts.entries()) {
    const contact = requireBinding(
        candidate.contactInputBindingId,
        "input",
        `candidates[${index}].contactInputBindingId`,
      ),
      force = requireBinding(
        candidate.normalForceInputBindingId,
        "input",
        `candidates[${index}].normalForceInputBindingId`,
      );
    if (contact.reading !== "contact")
      throw new Error(`candidates[${index}] contact input must read contact`);
    if (force.reading !== "contact_force_n")
      throw new Error(
        `candidates[${index}] normal-force input must read contact_force_n`,
      );
    if (
      contact.endpointPartId !== force.endpointPartId ||
      contact.endpointPortId !== force.endpointPortId
    )
      throw new Error(
        `candidates[${index}] contact and normal-force evidence must come from the same sensor endpoint`,
      );
  }
  for (const [label, bindingId] of outputBindingIds) {
    const binding = requireBinding(bindingId, "output", label);
    if (binding.channel !== "command")
      throw new Error(
        `${label} must publish through the command relay channel`,
      );
  }
  return manifest;
}

/**
 * Builds an ordinary restricted controller program that estimates one scalar
 * from routed sensor evidence. Valid evidence re-seeds the estimate immediately;
 * unavailable evidence moves toward an explicit fallback at a bounded rate.
 *
 * @param {{
 *   inputBindingId?: string,
 *   estimateOutputBindingId?: string,
 *   confidenceOutputBindingId?: string,
 *   minimum?: number,
 *   maximum?: number,
 *   fallback?: number,
 *   maximumFallbackRatePerSecond?: number,
 *   maximumTickSeconds?: number,
 * }} options
 */
export function boundedEvidenceEstimatorProgram({
  inputBindingId,
  estimateOutputBindingId,
  confidenceOutputBindingId,
  minimum,
  maximum,
  fallback = 0,
  maximumFallbackRatePerSecond,
  maximumTickSeconds = 0.1,
} = {}) {
  const input = assertBindingId(inputBindingId, "inputBindingId"),
    estimateOutput = assertBindingId(
      estimateOutputBindingId,
      "estimateOutputBindingId",
    ),
    confidenceOutput = assertBindingId(
      confidenceOutputBindingId,
      "confidenceOutputBindingId",
    ),
    lower = assertFinite(minimum, "minimum"),
    upper = assertFinite(maximum, "maximum"),
    fallbackValue = assertFinite(fallback, "fallback"),
    fallbackRate = assertFinite(
      maximumFallbackRatePerSecond,
      "maximumFallbackRatePerSecond",
    ),
    maximumDt = assertFinite(maximumTickSeconds, "maximumTickSeconds");
  if (estimateOutput === confidenceOutput)
    throw new Error("estimator output binding IDs must be distinct");
  if (lower >= upper) throw new Error("minimum must be less than maximum");
  if (fallbackValue < lower || fallbackValue > upper)
    throw new Error("fallback must be inside the estimator range");
  if (fallbackRate <= 0)
    throw new Error("maximumFallbackRatePerSecond must be positive");
  if (maximumDt <= 0) throw new Error("maximumTickSeconds must be positive");

  return `interface ControlAPI {
  read(binding: string): number;
  valid(binding: string): number;
  write(binding: string, value: number): void;
}
let estimate = ${numberLiteral(fallbackValue)};
function clamp(value: number): number {
  return Math.max(${numberLiteral(lower)}, Math.min(${numberLiteral(upper)}, value));
}
function moveToward(current: number, target: number, maximumDelta: number): number {
  return current < target
    ? Math.min(target, current + maximumDelta)
    : Math.max(target, current - maximumDelta);
}
function tick(api: ControlAPI, dt: number): void {
  const evidenceValid = api.valid(${JSON.stringify(input)}) > 0.5;
  const boundedDt = dt === dt ? Math.max(0, Math.min(${numberLiteral(maximumDt)}, dt)) : 0;
  if (evidenceValid) {
    estimate = clamp(api.read(${JSON.stringify(input)}));
  } else {
    estimate = moveToward(
      estimate,
      ${numberLiteral(fallbackValue)},
      ${numberLiteral(fallbackRate)} * boundedDt,
    );
  }
  api.write(${JSON.stringify(estimateOutput)}, estimate);
  api.write(${JSON.stringify(confidenceOutput)}, evidenceValid ? 1 : 0);
}`;
}

/**
 * Builds an ordinary restricted controller program that owns a conservative
 * set of coherently loaded contact candidates. Each candidate is independent:
 * valid contact and solved normal-force evidence enters or exits membership
 * through force hysteresis, while unavailable or contradictory evidence clears
 * that candidate immediately. The program publishes observations only; it has
 * no actuator, topology, gait, role, or sequencing authority.
 *
 * The scalar normal-force reading establishes loaded-contact membership only.
 * It does not establish contact location, a support polygon, a friction cone,
 * a feasible wrench, balance, or locomotion.
 *
 * @param {{
 *   candidates?: Array<{
 *     contactInputBindingId?: string,
 *     normalForceInputBindingId?: string,
 *     membershipOutputBindingId?: string,
 *     confidenceOutputBindingId?: string,
 *   }>,
 *   supportCountOutputBindingId?: string,
 *   setConfidenceOutputBindingId?: string,
 *   bindingManifest?: object[],
 *   enterForceN?: number,
 *   exitForceN?: number,
 * }} options
 */
export function loadBearingContactSetProgram({
  candidates,
  supportCountOutputBindingId,
  setConfidenceOutputBindingId,
  bindingManifest,
  enterForceN,
  exitForceN,
} = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0)
    throw new TypeError("candidates must be a non-empty array");
  const contacts = candidates.map(contactCandidate),
    supportCountOutput = assertBindingId(
      supportCountOutputBindingId,
      "supportCountOutputBindingId",
    ),
    setConfidenceOutput = assertBindingId(
      setConfidenceOutputBindingId,
      "setConfidenceOutputBindingId",
    ),
    enter = assertFinite(enterForceN, "enterForceN"),
    exit = assertFinite(exitForceN, "exitForceN");
  if (exit < 0) throw new Error("exitForceN must be non-negative");
  if (enter <= exit)
    throw new Error("enterForceN must be greater than exitForceN");
  assertDistinctBindingIds([
    ["supportCountOutputBindingId", supportCountOutput],
    ["setConfidenceOutputBindingId", setConfidenceOutput],
    ...contacts.flatMap((candidate, index) => [
      [
        `candidates[${index}].contactInputBindingId`,
        candidate.contactInputBindingId,
      ],
      [
        `candidates[${index}].normalForceInputBindingId`,
        candidate.normalForceInputBindingId,
      ],
      [
        `candidates[${index}].membershipOutputBindingId`,
        candidate.membershipOutputBindingId,
      ],
      [
        `candidates[${index}].confidenceOutputBindingId`,
        candidate.confidenceOutputBindingId,
      ],
    ]),
  ]);
  validateContactSetManifest(
    contacts,
    [
      ["supportCountOutputBindingId", supportCountOutput],
      ["setConfidenceOutputBindingId", setConfidenceOutput],
      ...contacts.flatMap((candidate, index) => [
        [
          `candidates[${index}].membershipOutputBindingId`,
          candidate.membershipOutputBindingId,
        ],
        [
          `candidates[${index}].confidenceOutputBindingId`,
          candidate.confidenceOutputBindingId,
        ],
      ]),
    ],
    bindingManifest,
  );

  const state = contacts.map((_candidate, index) => `let member${index} = 0;`),
    body = contacts.flatMap((candidate, index) => {
      const contact = JSON.stringify(candidate.contactInputBindingId),
        force = JSON.stringify(candidate.normalForceInputBindingId),
        membership = JSON.stringify(candidate.membershipOutputBindingId),
        confidence = JSON.stringify(candidate.confidenceOutputBindingId);
      return [
        `  const contact${index} = api.read(${contact});`,
        `  const normalForce${index} = api.read(${force});`,
        `  const coherent${index} =`,
        `    api.valid(${contact}) > 0.5 &&`,
        `    api.valid(${force}) > 0.5 &&`,
        `    (contact${index} === 0 || contact${index} === 1) &&`,
        `    normalForce${index} >= 0 &&`,
        `    normalForce${index} - normalForce${index} === 0 &&`,
        `    (contact${index} === 1 || normalForce${index} === 0);`,
        `  if (!coherent${index}) {`,
        `    member${index} = 0;`,
        `    allEvidenceCoherent = 0;`,
        `  } else if (contact${index} === 0 || normalForce${index} <= ${numberLiteral(exit)}) {`,
        `    member${index} = 0;`,
        `  } else if (normalForce${index} >= ${numberLiteral(enter)}) {`,
        `    member${index} = 1;`,
        `  }`,
        `  supportCount += member${index};`,
        `  api.write(${membership}, member${index});`,
        `  api.write(${confidence}, coherent${index} ? 1 : 0);`,
      ];
    });

  return `interface ControlAPI {
  read(binding: string): number;
  valid(binding: string): number;
  write(binding: string, value: number): void;
}
${state.join("\n")}
function tick(api: ControlAPI, dt: number): void {
  void dt;
  let supportCount = 0;
  let allEvidenceCoherent = 1;
${body.join("\n")}
  api.write(${JSON.stringify(supportCountOutput)}, supportCount);
  api.write(${JSON.stringify(setConfidenceOutput)}, allEvidenceCoherent);
}`;
}

/**
 * Builds a restricted controller program that invokes the canonical bounded
 * point-contact allocator through scalar value-plus-validity bindings. Rejected
 * allocations publish explicit diagnostics and zero force demands.
 *
 * @param {{
 *   allocationSpec?: object,
 *   diagnosticOutputBindingIds?: {
 *     authorityValid?: string,
 *     solverConverged?: string,
 *     accepted?: string,
 *     rejectionCode?: string,
 *     forceResidualNormN?: string,
 *     momentResidualNormNm?: string,
 *     saturated?: string,
 *     residualClipped?: string,
 *   },
 *   contactForceOutputs?: Array<{
 *     contactId?: string,
 *     forceWorldOutputBindingIds?: string[],
 *   }>,
 *   bindingManifest?: object[],
 * }} options
 */
export function pointContactWrenchAllocatorProgram({
  allocationSpec,
  diagnosticOutputBindingIds,
  contactForceOutputs,
  bindingManifest,
} = {}) {
  const manifest = validateControllerBindingManifest(bindingManifest),
    spec = validatePointContactWrenchControllerSpec(allocationSpec, manifest),
    diagnostics = exactRecord(
      diagnosticOutputBindingIds,
      [
        "authorityValid",
        "solverConverged",
        "accepted",
        "rejectionCode",
        "forceResidualNormN",
        "momentResidualNormNm",
        "saturated",
        "residualClipped",
      ],
      "allocation diagnostic outputs",
    ),
    diagnosticBindings = [
      ["authorityValid", diagnostics.authorityValid],
      ["solverConverged", diagnostics.solverConverged],
      ["accepted", diagnostics.accepted],
      ["rejectionCode", diagnostics.rejectionCode],
      ["forceResidualNormN", diagnostics.forceResidualNormN],
      ["momentResidualNormNm", diagnostics.momentResidualNormNm],
      ["saturated", diagnostics.saturated],
      ["residualClipped", diagnostics.residualClipped],
    ].map(([label, value]) => [label, assertBindingId(value, label)]);
  if (
    !Array.isArray(contactForceOutputs) ||
    contactForceOutputs.length !== spec.contacts.length
  )
    throw new TypeError(
      "contact force outputs must match the allocation contact count",
    );
  const forceByContact = new Map();
  for (const [index, raw] of contactForceOutputs.entries()) {
    const output = exactRecord(
        raw,
        ["contactId", "forceWorldOutputBindingIds"],
        `contact force output ${index}`,
      ),
      contactId = String(output.contactId || ""),
      bindings = Array.isArray(output.forceWorldOutputBindingIds)
        ? output.forceWorldOutputBindingIds.map((value, axis) =>
            assertBindingId(
              value,
              `contact ${contactId} force output ${["x", "y", "z"][axis]}`,
            ),
          )
        : [];
    if (!spec.contacts.some((contact) => contact.contactId === contactId))
      throw new Error(`unknown force-output contact ${contactId}`);
    if (forceByContact.has(contactId))
      throw new Error(`duplicate force-output contact ${contactId}`);
    if (bindings.length !== 3)
      throw new TypeError(
        `contact ${contactId} force output must contain three binding IDs`,
      );
    forceByContact.set(contactId, bindings);
  }
  const orderedForceBindings = spec.contacts.map((contact) => {
      return forceByContact.get(contact.contactId);
    }),
    allOutputBindings = [
      ...diagnosticBindings,
      ...spec.contacts.flatMap((contact, index) =>
        orderedForceBindings[index].map((bindingId, axis) => [
          `contact ${contact.contactId} force output ${["x", "y", "z"][axis]}`,
          bindingId,
        ]),
      ),
    ];
  assertDistinctBindingIds(allOutputBindings);
  const orderedOutputBindingIds = [
      ...diagnosticBindings.map(([, outputBindingId]) => outputBindingId),
      ...orderedForceBindings.flat(),
    ],
    validatedOutputBindingIds = validatePointContactWrenchOutputBindingIds(
      spec,
      orderedOutputBindingIds,
      manifest,
    ),
    encodedSpec = JSON.stringify(JSON.stringify(spec)),
    encodedOutputBindings = JSON.stringify(
      JSON.stringify(validatedOutputBindingIds),
    );
  return `interface ControlAPI {
  read(binding: string): number;
  valid(binding: string): number;
  write(binding: string, value: number): void;
  writePointContactWrench(
    specification: string,
    outputBindings: string,
  ): void;
}
function tick(api: ControlAPI, dt: number): void {
  void dt;
  api.writePointContactWrench(${encodedSpec}, ${encodedOutputBindings});
}`;
}

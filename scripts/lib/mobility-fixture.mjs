/** Test-only projection for fixtures known to contain one physical component. */
export function fixturePhysicalComponent(
  runtime,
  id = "fixture-physical",
  partIds = runtime.compiled.parts.map((part) => part.id),
) {
  const members = new Set(partIds);
  return Object.freeze({
    id,
    supportPartIds: Object.freeze([...members]),
    bodyPartIds: Object.freeze(
      [...runtime.bodyByPart.keys()].filter((partId) => members.has(partId)),
    ),
    framePartId: [...runtime.bodyByPart.keys()].find((partId) =>
      members.has(partId),
    ),
    lineage: Object.freeze({
      parentIds: Object.freeze([]),
      splitFromIds: Object.freeze([]),
      structuralEventIds: Object.freeze([]),
    }),
  });
}

export function fixtureMobilityTelemetry(
  runtime,
  { context = null, dt = 0, partIds = undefined } = {},
) {
  return runtime.mobilityTelemetryFor(
    fixturePhysicalComponent(runtime, "fixture-physical", partIds),
    context,
    dt,
  );
}

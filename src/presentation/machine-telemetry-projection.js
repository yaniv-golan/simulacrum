/**
 * Selects one mobility component by exact authored target, never array order.
 * @template T
 * @param {ReadonlyArray<T>} assemblies
 * @param {ReadonlyArray<number>} targetPartIds
 * @returns {T|null}
 */
export function selectMobilityAssembly(assemblies, targetPartIds) {
  const targetIds = new Set(targetPartIds),
    exact = assemblies.find((assembly) =>
      /** @type {{memberPartIds:ReadonlyArray<number>}} */ (
        assembly
      ).memberPartIds.some((id) => targetIds.has(id)),
    );
  return exact || (assemblies.length === 1 ? assemblies[0] : null);
}

/**
 * Projects one completed telemetry frame into the machine debug input.
 * @param {object} frame
 * @param {object[]} parts
 * @param {unknown} editorPosition
 * @param {ReadonlyArray<number>} [mobilityTargetPartIds]
 */
export function projectMachineTelemetry(
  frame,
  parts,
  editorPosition,
  mobilityTargetPartIds = [],
) {
  const mobility = frame.systems?.mobility || null,
    mobilityAssembly = selectMobilityAssembly(
      mobility?.assemblies || [],
      mobilityTargetPartIds,
    ),
    flight = frame.systems?.flight || null,
    position =
      mobilityAssembly?.pose?.position ||
      flight?.pose?.position ||
      frame.bodies?.bodies?.[0]?.pose?.position ||
      editorPosition,
    mechanismPoses = new Map(
      (frame.systems?.mechanisms?.poses || []).map((pose) => [pose.id, pose]),
    );
  return {
    mobility:
      mobility == null
        ? null
        : { assemblies: mobilityAssembly ? [mobilityAssembly] : [] },
    flight,
    position,
    parts: parts.map((part) => ({
      ...part,
      phase: mechanismPoses.get(part.id)?.phase ?? part.phase,
    })),
  };
}

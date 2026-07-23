const title = (value) =>
  value
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");

/** Derives a compact mission card from completed Test Reserve course telemetry. */
export function testCourseMissionReadModel(course) {
  if (!course) return null;
  const unmet = course.requirements?.find(({ met }) => !met),
    name =
      course.status === "complete"
        ? "TRIAL COMPLETE"
        : course.status === "failed"
          ? "TRIAL INVALID"
          : title(course.routeId).toUpperCase(),
    description =
      course.status === "complete"
        ? `${course.passedGateIds.length} gates confirmed · ${title(course.materialKey || "unknown surface")}`
        : course.status === "failed"
          ? `Evidence rejected · ${title(course.failureReason || "unknown reason")}`
          : `Next: ${title(course.nextGateId || "finish")} · ${unmet ? `Need: ${title(unmet.id)}` : title(course.districtId || "between districts")} · ${title(course.materialKey || "unknown surface")}`;
  return Object.freeze({
    name,
    description,
    progressPercent: Math.round(course.progress * 100),
  });
}

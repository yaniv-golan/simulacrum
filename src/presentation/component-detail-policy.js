export const COMPONENT_DETAIL_POLICY_VERSION = "component-detail-policy-v1";

export const COMPONENT_DETAIL_TIERS = Object.freeze({
  hero: Object.freeze({
    id: "hero",
    radialSegments: 48,
    shoulderSegments: 10,
    flexibleRadialSegments: 12,
    castShadow: true,
    receiveShadow: true,
  }),
  standard: Object.freeze({
    id: "standard",
    radialSegments: 28,
    shoulderSegments: 6,
    flexibleRadialSegments: 8,
    castShadow: true,
    receiveShadow: true,
  }),
  performance: Object.freeze({
    id: "performance",
    radialSegments: 12,
    shoulderSegments: 3,
    flexibleRadialSegments: 6,
    castShadow: false,
    receiveShadow: true,
  }),
});

const ENTER_HERO_PX = 260;
const EXIT_HERO_PX = 180;
const ENTER_PERFORMANCE_PX = 28;
const EXIT_PERFORMANCE_PX = 52;

export function componentDetailTier({
  currentTier = "standard",
  projectedDiameterPx,
  partCount,
  quality = "auto",
  selected = false,
}) {
  if (quality === "performance" || partCount > 256) return "performance";
  if (quality === "hero" && partCount <= 128) return "hero";
  if (partCount > 128) return selected ? "standard" : "performance";
  if (currentTier === "hero" && projectedDiameterPx >= EXIT_HERO_PX)
    return "hero";
  if (
    currentTier === "performance" &&
    projectedDiameterPx <= EXIT_PERFORMANCE_PX
  )
    return "performance";
  if (projectedDiameterPx >= ENTER_HERO_PX) return "hero";
  if (projectedDiameterPx <= ENTER_PERFORMANCE_PX) return "performance";
  return "standard";
}

export function componentDetailReason({
  tier,
  projectedDiameterPx,
  partCount,
  quality,
  selected,
}) {
  if (quality !== "auto") return `quality:${quality}`;
  if (partCount > 256) return "assembly:over-256";
  if (partCount > 128)
    return selected ? "assembly:selected-over-128" : "assembly:over-128";
  return `projected-diameter:${Math.round(projectedDiameterPx)}px:${tier}`;
}

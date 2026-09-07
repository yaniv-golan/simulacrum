/** Separate screen-space hit targets; leader lines retain the actual face locations. */
export function spreadSurfaceAnchors(points, width, height) {
  const placed = [],
    margin = 16,
    spacing = 30;
  const clamp = (p) => ({
    x: Math.max(margin, Math.min(width - margin, p.x)),
    y: Math.max(margin, Math.min(height - margin, p.y)),
  });
  const free = (p) =>
    placed.every((q) => Math.abs(p.x - q.x) >= spacing || Math.abs(p.y - q.y) >= spacing);
  for (const [index, point] of points.entries()) {
    let candidate = clamp(point);
    const direction =
      Math.atan2(point.y - points[0].y, point.x - points[0].x) || (index * Math.PI) / 2;
    search: for (
      let radius = spacing;
      !free(candidate) && radius <= spacing * points.length * 2;
      radius += spacing
    ) {
      for (const offset of [0, 1, -1, 2, -2, 3, -3, 4]) {
        const angle = direction + (offset * Math.PI) / 4;
        const next = clamp({
          x: point.x + Math.cos(angle) * radius,
          y: point.y + Math.sin(angle) * radius,
        });
        if (free(next)) {
          candidate = next;
          break search;
        }
      }
    }
    placed.push(candidate);
  }
  return placed;
}

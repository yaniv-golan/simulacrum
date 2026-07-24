/**
 * Shared browser-test visibility contract. Keep this function self-contained:
 * it is serialized into the page by installRenderedVisibilityContract().
 */
export function inspectRenderedVisibility(
  element,
  { usefulAreaPx = 4, usefulAreaRatio = 0.25, sampleOcclusion = false } = {},
) {
  const empty = (reason) => ({
      rendered: false,
      pointerInteractive: false,
      keyboardFocusable: false,
      reason,
      area: { elementPx: 0, visiblePx: 0, ratio: 0, useful: false },
      occlusion: null,
    }),
    intersect = (a, b) => ({
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom),
    }),
    area = (rect) =>
      Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
  if (!(element instanceof Element) || !element.isConnected)
    return empty("disconnected");
  const bounds = element.getBoundingClientRect(),
    elementArea = Math.max(0, bounds.width) * Math.max(0, bounds.height);
  if (!elementArea) return empty("zero-area");
  let clipped = intersect(bounds, {
      left: 0,
      top: 0,
      right: innerWidth,
      bottom: innerHeight,
    }),
    pointerAllowed = true,
    blocked = null,
    current = element;
  while (current) {
    const style = getComputedStyle(current);
    if (current.hidden || style.display === "none") blocked ||= "display";
    if (["hidden", "collapse"].includes(style.visibility))
      blocked ||= "visibility";
    if (Number(style.opacity) <= 0.001) blocked ||= "opacity";
    if (
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden") === "true"
    )
      blocked ||= "inert-or-aria-hidden";
    if (style.pointerEvents === "none") pointerAllowed = false;
    if (current !== element) {
      const overflowX = style.overflowX,
        overflowY = style.overflowY;
      if (["auto", "clip", "hidden", "scroll"].includes(overflowX)) {
        const rect = current.getBoundingClientRect();
        clipped.left = Math.max(clipped.left, rect.left);
        clipped.right = Math.min(clipped.right, rect.right);
      }
      if (["auto", "clip", "hidden", "scroll"].includes(overflowY)) {
        const rect = current.getBoundingClientRect();
        clipped.top = Math.max(clipped.top, rect.top);
        clipped.bottom = Math.min(clipped.bottom, rect.bottom);
      }
    }
    current = current.parentElement;
  }
  const closedDetails = element.closest("details:not([open])");
  if (closedDetails && !element.closest("summary"))
    blocked ||= "closed-details";
  const visibleArea = blocked ? 0 : area(clipped),
    ratio = visibleArea / elementArea,
    useful = visibleArea >= usefulAreaPx && ratio >= usefulAreaRatio,
    disabled =
      /** @type {HTMLButtonElement} */ (element).disabled ||
      element.getAttribute("aria-disabled") === "true",
    naturallyFocusable = element.matches(
      "button, a[href], input:not([type='hidden']), select, textarea, summary, [contenteditable='true']",
    ),
    keyboardFocusable =
      !blocked &&
      useful &&
      !disabled &&
      (element.hasAttribute("tabindex")
        ? /** @type {HTMLElement} */ (element).tabIndex >= 0
        : naturallyFocusable);
  let occlusion = null;
  if (sampleOcclusion && !blocked && useful) {
    const x1 = Math.max(0, clipped.left),
      y1 = Math.max(0, clipped.top),
      x2 = Math.min(innerWidth - 1, clipped.right),
      y2 = Math.min(innerHeight - 1, clipped.bottom),
      points = [
        [(x1 + x2) / 2, (y1 + y2) / 2],
        [x1 + 1, y1 + 1],
        [x2 - 1, y1 + 1],
        [x1 + 1, y2 - 1],
        [x2 - 1, y2 - 1],
      ].filter(
        ([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight,
      ),
      exposed = points.filter(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit && (hit === element || element.contains(hit));
      }).length;
    occlusion = { exposedSamples: exposed, sampleCount: points.length };
  }
  return {
    rendered: !blocked && visibleArea > 0,
    pointerInteractive:
      !blocked &&
      useful &&
      pointerAllowed &&
      !disabled &&
      (!occlusion || occlusion.exposedSamples > 0),
    keyboardFocusable,
    reason: blocked,
    area: {
      elementPx: elementArea,
      visiblePx: visibleArea,
      ratio,
      useful,
    },
    occlusion,
  };
}

/** Installs the same contract before navigation so page evaluations can share it. */
export async function installRenderedVisibilityContract(page) {
  const content = `window.__simulacrumTestVisibility = ${inspectRenderedVisibility.toString()};`;
  await page.addInitScript({ content });
  await page.addScriptTag({ content });
}

const TEXT_ENTRY_SELECTOR = [
  "input:not([type='button']):not([type='submit']):not([type='reset']):not([type='range'])",
  "textarea",
  "select",
  "[contenteditable='true']",
].join(",");

const WIDGET_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  "input[type='range']",
  "[role='button']",
  "[role='dialog']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='tablist']",
  "[role='toolbar']",
  "[role='tree']",
  "[role='treeitem']",
].join(",");

/**
 * Presentation-owned classification used by the application keyboard router.
 * Focused native and composite controls retain their browser/APG key behavior.
 *
 * @param {Document} root
 * @returns {"text-entry"|"widget"|"canvas"}
 */
export function activeKeyboardFocusContext(root = document) {
  const active = root.activeElement;
  if (!(active instanceof Element)) return "canvas";
  if (
    active.matches(TEXT_ENTRY_SELECTOR) ||
    active.closest(TEXT_ENTRY_SELECTOR)
  )
    return "text-entry";
  if (active.matches(WIDGET_SELECTOR) || active.closest(WIDGET_SELECTOR))
    return "widget";
  return "canvas";
}

/** Returns true only for keys conventionally owned by the focused widget. */
export function focusedWidgetOwnsKeyboardEvent(root, event) {
  const active = root.activeElement;
  if (!(active instanceof Element)) return false;
  if (active.matches("button, a[href], summary, [role='button']"))
    return ["Enter", " "].includes(event.key);
  if (active.matches("input[type='range']"))
    return [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ].includes(event.key);
  const composite = active.closest(
    "[role='menu'], [role='tablist'], [role='toolbar'], [role='tree']",
  );
  if (!composite) return false;
  return [
    "Enter",
    " ",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
  ].includes(event.key);
}

/** @param {Document} root */
export function activeFocusOwner(root = document) {
  const active = root.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  return {
    id: active.id || null,
    role: active.getAttribute("role") || active.tagName.toLowerCase(),
    label:
      active.getAttribute("aria-label") ||
      active.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ||
      null,
    context: activeKeyboardFocusContext(root),
  };
}

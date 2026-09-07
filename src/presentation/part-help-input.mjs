// Shared by the window capture receiver and workshop shortcut handler.
export function ownsPartHelpInput(target) {
  return Boolean(
    target?.closest?.('[data-part-help-input]') ||
      document.activeElement?.closest?.('[data-part-help-input]'),
  );
}

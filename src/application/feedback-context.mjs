/** Capture authored choices and the current UI state, independently of replay storage. */
export function captureFeedbackContext(workshop, context) {
  return { project: workshop.save(), workshop: context() };
}

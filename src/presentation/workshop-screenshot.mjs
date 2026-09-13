/** Capture the canvas context used by canvas-only feedback. */
export function captureWorkshopScreenshot({
  cameraSession,
  workshopCanvas,
  renderWorkshop,
  createCanvas = () => document.createElement('canvas'),
}) {
  const viewingCamera = !!cameraSession?.read().active;
  if (!viewingCamera) renderWorkshop();
  const source = viewingCamera ? cameraSession.canvas() : workshopCanvas;
  if (!source) throw Error('Camera image unavailable');
  const canvas = createCanvas();
  canvas.width = Math.min(source.width, 1280);
  canvas.height = Math.round((source.height * canvas.width) / source.width);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.65);
}

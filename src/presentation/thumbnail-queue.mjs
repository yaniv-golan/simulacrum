/** One thumbnail per task; retain shared shader resources until completion or cancellation. */
export function createThumbnailQueue({
  types,
  render,
  publish,
  dispose,
  onError,
  schedule = (callback) => setTimeout(callback, 0),
  cancel = clearTimeout,
}) {
  let index = 0,
    handle = null,
    stopped = false;
  function finish(error) {
    if (stopped) return;
    stopped = true;
    if (handle !== null) cancel(handle);
    handle = null;
    try {
      dispose();
    } catch (cleanupError) {
      error ??= cleanupError;
    }
    if (error) onError(error);
  }
  function next() {
    handle = null;
    if (stopped) return;
    try {
      if (index < types.length) {
        const type = types[index++],
          image = render(type);
        if (!stopped) publish(type, image);
      }
      if (!stopped) {
        if (index === types.length) finish();
        else handle = schedule(next);
      }
    } catch (error) {
      finish(error);
    }
  }
  try {
    handle = schedule(next);
  } catch (error) {
    finish(error);
  }
  return { dispose: () => finish() };
}

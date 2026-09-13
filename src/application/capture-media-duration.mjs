/** Read encoder-produced media duration. Unknown metadata never becomes a wall-time claim. */
export function measureRecordedDuration(
  blob,
  { document = globalThis.document, urls = URL, timeoutMs = 1500 } = {},
) {
  return new Promise((resolve) => {
    const video = document.createElement('video'),
      url = urls.createObjectURL(blob);
    let done = false,
      seeking = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const name of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked'])
        video.removeEventListener(name, inspect);
      video.removeEventListener('error', failed);
      video.pause();
      video.removeAttribute('src');
      urls.revokeObjectURL(url);
      resolve(Number.isFinite(value) && value > 0 ? value : null);
    };
    const inspect = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        finish(video.duration * 1000);
        return;
      }
      if (!seeking) {
        seeking = true;
        try {
          video.currentTime = 1e10;
        } catch {
          finish(null);
        }
      } else if (
        Number.isFinite(video.currentTime) &&
        video.currentTime > 0 &&
        video.currentTime < 1e9
      )
        finish(video.currentTime * 1000);
    };
    const failed = () => finish(null),
      timer = setTimeout(failed, timeoutMs);
    for (const name of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked'])
      video.addEventListener(name, inspect);
    video.addEventListener('error', failed);
    video.preload = 'metadata';
    video.muted = true;
    video.src = url;
    try {
      video.load();
    } catch {
      finish(null);
    }
  });
}

// Bounded synthetic evidence; measured totals always describe the complete capture.
import { captureIdentity, captureMedia } from './load.mjs';
import { lstat } from 'node:fs/promises';
function select(sizes, budget, count) {
  const largest = sizes.indexOf(Math.max(...sizes));
  const chosen = new Set();
  let bytes = 2;
  const add = (i) => {
    if (!chosen.has(i) && chosen.size < count && bytes + sizes[i] + 1 <= budget) {
      chosen.add(i);
      bytes += sizes[i] + 1;
    }
  };
  add(largest);
  for (let i = 0; i < count; i++) add(Math.floor((i * (sizes.length - 1)) / (count - 1)));
  return [...chosen].sort((a, b) => a - b);
}
export async function sampleCapture(capture) {
  const { recordingMode } = captureIdentity(capture);
  const observedMedia = captureMedia(capture);
  const { eventSamples, mediaFiles } = capture;
  if (
    !eventSamples?.length ||
    !Array.isArray(mediaFiles) ||
    (recordingMode === 'video' && !mediaFiles.length) ||
    eventSamples.length > 100000 ||
    mediaFiles.length > 100000
  )
    throw Error('Capture sampling input bounds');
  const eventSizes = eventSamples.map((e) => Buffer.byteLength(JSON.stringify(e)));
  const mediaSizes = [];
  for (const file of mediaFiles) {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Capture sampling media file');
    mediaSizes.push(stat.size);
  }
  const sum = (values) => values.reduce((a, b) => a + b, 0);
  const maxEventBytes = Math.max(...eventSizes);
  if (
    maxEventBytes > 2 * 1024 ** 2 ||
    Math.min(...mediaSizes) <= 0 ||
    Math.max(0, ...mediaSizes) > 10 * 1024 ** 2
  )
    throw Error('Capture sampling payload bounds');
  if (capture.sampling === 1) {
    if (
      !Number.isSafeInteger(capture.eventCount) ||
      capture.eventCount < eventSamples.length ||
      !Number.isSafeInteger(observedMedia.chunks) ||
      observedMedia.chunks < mediaFiles.length ||
      !Number.isSafeInteger(observedMedia.bytes) ||
      observedMedia.bytes < sum(mediaSizes) ||
      observedMedia.maximum !== Math.max(0, ...mediaSizes) ||
      capture.maximumEventBytes !== maxEventBytes ||
      Buffer.byteLength(JSON.stringify(eventSamples)) > 3 * 1024 ** 2 ||
      mediaFiles.length > 32 ||
      sum(mediaSizes) > 24 * 1024 ** 2
    )
      throw Error('Capture sampling metadata mismatch');
    return capture;
  }
  if (
    capture.sampling !== undefined ||
    observedMedia.bytes !== sum(mediaSizes) ||
    observedMedia.maximum !== Math.max(0, ...mediaSizes)
  )
    throw Error('Capture sampling measured totals mismatch');
  return {
    ...capture,
    sampling: 1,
    eventCount: eventSamples.length,
    ...(recordingMode === 'video'
      ? { screenChunks: mediaFiles.length }
      : { voiceChunks: mediaFiles.length }),
    maximumEventBytes: maxEventBytes,
    eventSamples: select(eventSizes, 3 * 1024 ** 2, 128).map((i) => eventSamples[i]),
    mediaFiles: (mediaSizes.length ? select(mediaSizes, 24 * 1024 ** 2, 32) : []).map(
      (i) => mediaFiles[i],
    ),
  };
}

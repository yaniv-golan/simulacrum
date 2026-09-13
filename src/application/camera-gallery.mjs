import { CAMERA } from '../model/camera.mjs';
import { immutableCopy } from '../model/observation.mjs';
/** Session photo bytes never enter simulation, saves, or replay. One encoder owns a reservation. */
export function createCameraGallery({
  encode,
  createURL = URL.createObjectURL,
  revokeURL = URL.revokeObjectURL,
  maxPhotos = CAMERA.maxPhotos,
  maxBytes = CAMERA.maxBytes,
  deadlineMs = 5000,
  onChange = () => {},
}) {
  let rejectedBusy = 0;
  let photos = [],
    bytes = 0,
    pending = false,
    generation = 0,
    epoch = '',
    disposed = false,
    status = 'Photos last until this page is closed.';
  const notify = () => onChange();
  return Object.freeze({
    epoch(value) {
      if (value !== epoch) {
        epoch = value;
        generation++;
        if (pending) status = 'Pending photo canceled by a new attempt.';
      }
    },
    async capture(packet) {
      if (disposed) return false;
      if (pending) {
        rejectedBusy++;
        status = 'Camera busy. Try again.';
        notify();
        return false;
      }
      if (photos.length >= maxPhotos || bytes >= maxBytes) {
        status = 'Photos full. Save or clear photos before taking more.';
        notify();
        return false;
      }
      const token = generation;
      pending = true;
      status = 'Developing photo…';
      notify();
      const deadline = setTimeout(() => {
        if (!disposed && token === generation) {
          generation++;
          status =
            'Photo failed: encoder deadline exceeded. Existing photos are safe; wait for recovery or reload after saving them.';
          notify();
        }
      }, deadlineMs);
      try {
        // encode must copy/rasterize the identified completed state before yielding.
        const blob = await encode(packet);
        if (disposed || token !== generation) return false;
        if (!blob || blob.type !== 'image/png' || blob.size === 0) throw Error('No image returned');
        if (blob.size + bytes > maxBytes)
          throw Error('Photos full. Save or clear photos before taking more.');
        const url = createURL(blob);
        photos.push({ metadata: immutableCopy(packet.metadata), blob, url });
        bytes += blob.size;
        status = 'Photo ready. Photos last until this page is closed.';
        return true;
      } catch (error) {
        if (token === generation) status = `Photo failed: ${error.message}`;
        return false;
      } finally {
        clearTimeout(deadline);
        pending = false;
        if (!disposed) notify();
      }
    },
    read() {
      return {
        photos: photos.map(({ metadata, url, blob }) => ({ metadata, url, bytes: blob.size })),
        bytes,
        pending,
        status:
          status +
          (rejectedBusy
            ? ` ${rejectedBusy} photo requests were not captured because the camera was busy. Clear photos to dismiss this count.`
            : ''),
      };
    },
    clear() {
      rejectedBusy = 0;
      generation++;
      for (const p of photos) revokeURL(p.url);
      photos = [];
      bytes = 0;
      status = 'Photos cleared.';
      notify();
    },
    dispose() {
      disposed = true;
      generation++;
      for (const p of photos) revokeURL(p.url);
      photos = [];
      bytes = 0;
      pending = false;
    },
  });
}

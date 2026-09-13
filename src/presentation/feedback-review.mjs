/** Renders validated independent feedback exports; no simulation or capture ownership. */
export function mountFeedbackReview(container, entries, { sessionId, onSeek = () => {} } = {}) {
  for (const { envelope, receipt } of entries) {
    const row = document.createElement('section');
    const text = document.createElement('p');
    text.style.whiteSpace = 'pre-wrap';
    text.textContent = envelope.text;
    const status = document.createElement('p');
    status.textContent = `Feedback ${envelope.id} — received ${receipt.receivedAt}. Submitted ${envelope.createdAt}.`;
    row.append(status, text);
    const reference = (value, owner) => {
      if (!value) return;
      const caption = document.createElement('p');
      caption.textContent = `${owner}: recording ${value.sessionId}, ${(value.timeMs / 1000).toFixed(2)} s.`;
      row.append(caption);
      if (value.sessionId === sessionId) {
        const seek = document.createElement('button');
        seek.textContent = `Show ${owner.toLowerCase()} moment`;
        seek.onclick = () => onSeek(value.timeMs);
        row.append(seek);
      }
    };
    reference(envelope.reference, 'Comment');
    if (envelope.voice) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.setAttribute('aria-label', 'Feedback voice clip');
      audio.src = `data:${envelope.voice.mime};base64,${envelope.voice.base64}`;
      row.append(audio);
    }
    if (envelope.image) {
      const caption = document.createElement('p');
      caption.textContent = `Image: ${envelope.image.scope}, captured ${envelope.image.capturedAt}.`;
      const image = document.createElement('img');
      image.alt = `Feedback image (${envelope.image.scope})`;
      image.src = envelope.image.dataUrl;
      row.append(caption, image);
      reference(envelope.image.reference, 'Image');
    }
    if (envelope.context) {
      const details = document.createElement('details'),
        summary = document.createElement('summary'),
        context = document.createElement('pre');
      summary.textContent = `Included workshop context — captured ${envelope.context.capturedAt}`;
      context.textContent = JSON.stringify(envelope.context.value, null, 2);
      details.append(summary, context);
      row.append(details);
      reference(envelope.context.reference, 'Context');
    }
    container.append(row);
  }
}

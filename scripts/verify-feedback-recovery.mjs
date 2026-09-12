import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createFixtureEvidence } from './browser-evidence.mjs';
const files = [
  'src/application/feedback-client.mjs',
  'src/application/feedback-store.mjs',
  'src/application/feedback-protocol.mjs',
  'src/application/feedback-capture-gate.mjs',
];
const evidence = createFixtureEvidence({
  name: 'feedback-recovery',
  build: 'feedback-recovery',
  files: [...files, 'scripts/verify-feedback-recovery.mjs'],
  expectedErrors: [
    { type: 'http', status: 400, url: '/api/playtest/' },
    { type: 'console', url: '/api/playtest/', message: 'Failed to load resource' },
  ],
});
// Lower the real local-storage budget after seeding one accepted submission.
// This exercises exhaustion with real IndexedDB without creating 32 MiB fixtures.
const storeSource = readFileSync(files[1], 'utf8');
if (!storeSource.includes('storageBytes = 32 * 1024 ** 2'))
  throw Error('Storage budget fixture requires review');
const server = createServer((req, res) => {
  if (req.url === '/api/playtest/feedback/v1/submission') {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid feedback' }));
    return;
  }
  const file = files.find((file) => req.url === `/${file}`);
  res.setHeader('Content-Type', file ? 'text/javascript' : 'text/html');
  res.end(
    file === files[1]
      ? storeSource.replace(
          'storageBytes = 32 * 1024 ** 2',
          'storageBytes = globalThis.feedbackBudget ?? 32 * 1024 ** 2',
        )
      : file
        ? readFileSync(file)
        : '<meta name="build-id" content="feedback-recovery"><button id="trigger">Give feedback</button>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await evidence.launch({ profile: 'recording', channel: 'chrome', headless: true });
const scenarios =
  process.argv.includes('--media-only') || process.argv.includes('--contention-only')
    ? []
    : process.argv.includes('--unsaved-only')
      ? ['unsaved']
      : process.argv.includes('--freeze-only')
        ? ['freeze']
        : ['capacity', 'unsaved'];
try {
  for (const scenario of scenarios) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(
      async ({ freezeOnly, unsavedOnly }) => {
        const { openFeedbackStore } = await import('../src/application/feedback-store.mjs');
        const store = await openFeedbackStore();
        const draft = await store.createDraft({ text: 'Received note retained on this browser' });
        const item = await store.freeze(draft);
        await store.acknowledge(item.id, {
          protocolVersion: 1,
          submissionId: item.id,
          uploadHash: item.uploadHash,
          receivedAt: new Date().toISOString(),
          status: 'received',
        });
        const items = await store.items();
        const kept = unsavedOnly ? await store.createDraft({ text: 'original saved' }) : null;
        window.feedbackBudget = freezeOnly
          ? 1024 * 1024
          : new TextEncoder().encode(JSON.stringify({ draft: kept, items })).length + 1;
        store.close();
        const { mountFeedbackClient } = await import('../src/application/feedback-client.mjs');
        window.client = await mountFeedbackClient({
          trigger: document.querySelector('#trigger'),
          gate: { enter: async () => {}, leave: () => {} },
          snapshot: () => ({ project: {}, workshop: {} }),
          screenshot: () => null,
        });
      },
      { freezeOnly: scenario === 'freeze', unsavedOnly: scenario === 'unsaved' },
    );
    await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
    if (scenario === 'unsaved') {
      const unsaved = 'Unsaved text retained through local cleanup';
      await page.getByRole('textbox', { name: 'Your feedback', exact: true }).fill(unsaved);
      await page.waitForFunction(() =>
        document.querySelector('[data-save]').textContent.includes('Not saved'),
      );
      await page.getByRole('button', { name: 'Your feedback history', exact: true }).click();
      await page.locator('[data-history]').waitFor({ state: 'visible' });
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Delete received local copy', exact: true }).click();
      await page.getByRole('button', { name: 'Back to draft', exact: true }).click();
      evidence.assert('equal', [
        await page.getByRole('textbox', { name: 'Your feedback', exact: true }).inputValue(),
        unsaved,
      ]);
      await page.getByRole('button', { name: 'Back to building', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.feedback-dialog').open);
      const saved = await page.evaluate(async () => {
        const { openFeedbackStore } = await import('../src/application/feedback-store.mjs');
        const store = await openFeedbackStore();
        const draft = await store.draft();
        store.close();
        return draft.text;
      });
      evidence.assert('equal', [saved, unsaved]);
    } else {
      if (scenario !== 'freeze') {
        await page
          .getByRole('button', { name: 'Delete received local copy', exact: true })
          .waitFor({ state: 'visible' });
        evidence.assert('equal', [await page.locator('[data-history]').isVisible(), true]);
        evidence.assert('equal', [await page.locator('[data-composer]').isVisible(), false]);
        evidence.assert('match', [
          await page.locator('[data-error]').textContent(),
          /storage|space|saved feedback/i,
        ]);
        page.once('dialog', async (dialog) => {
          evidence.assert('match', [dialog.message(), /server|Yaniv/i]);
          await dialog.accept();
        });
        await page.getByRole('button', { name: 'Delete received local copy', exact: true }).click();
        await page
          .getByRole('button', { name: 'Delete received local copy', exact: true })
          .waitFor({ state: 'hidden' });
        evidence.assert('equal', [
          await page.evaluate(() => document.activeElement.hasAttribute('data-history')),
          true,
          'history deletion restores visible focus',
        ]);
        await page.getByRole('button', { name: 'Add another', exact: true }).click();
        await page
          .getByRole('textbox', { name: 'Your feedback', exact: true })
          .fill('New feedback after local cleanup');
        await page.waitForFunction(
          () => document.querySelector('[data-save]').textContent === 'Draft saved on this device.',
        );
        const state = await page.evaluate(async () => {
          const { openFeedbackStore } = await import('../src/application/feedback-store.mjs');
          const store = await openFeedbackStore();
          const draft = await store.draft(),
            items = await store.items();
          store.close();
          return { draft, items };
        });
        evidence.assert('equal', [state.draft.text, 'New feedback after local cleanup']);
        evidence.assert('equal', [state.items[0].outcome, 'discarded']);
        evidence.assert('equal', [state.items[0].bodyText, null]);
        evidence.assert('equal', [state.items[0].envelope, null]);
        evidence.assert('equal', [state.items[0].receipt, undefined]);
      }
      await page.getByRole('textbox', { name: 'Your feedback', exact: true }).fill('After cleanup');
      await page.waitForFunction(
        () => document.querySelector('[data-save]').textContent === 'Draft saved on this device.',
      );
      await page.evaluate(() => {
        window.client.configure({ feedback: { enabled: true, protocolVersion: 1 } });
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        crypto.subtle.digest = async (...args) => {
          const result = await digest(...args);
          await new Promise((resolve) => {
            window.releaseFeedbackDigest = resolve;
          });
          return result;
        };
      });
      await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
      await page.waitForFunction(() => typeof window.releaseFeedbackDigest === 'function');
      evidence.assert('equal', [await page.locator('[data-history-toggle]').isDisabled(), true]);
      evidence.assert('equal', [await page.locator('[data-another]').isDisabled(), true]);
      await page.evaluate(() => {
        void document.querySelector('[data-history-toggle]').onclick();
        void document.querySelector('[data-another]').onclick();
        window.releaseFeedbackDigest();
      });
      await page.waitForFunction(() =>
        document.querySelector('[data-receipt-state]').textContent.includes('rejected'),
      );
      evidence.assert('doesNotMatch', [
        await page.locator('[data-receipt-state]').textContent(),
        /retry automatically/i,
      ]);
      evidence.assert('equal', [await page.locator('[data-error]').textContent(), '']);
      await page.getByRole('button', { name: 'Back to building', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.feedback-dialog').open);
    }
    await page.evaluate(() => window.client.dispose());
    await page.close();
  }
  const shared = await browser.newContext();
  const first = await shared.newPage(),
    second = await shared.newPage();
  for (const page of [first, second]) {
    page.setDefaultTimeout(5000);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      const { mountFeedbackClient } = await import('../src/application/feedback-client.mjs');
      const { createFeedbackCaptureGate } = await import(
        '../src/application/feedback-capture-gate.mjs'
      );
      window.gate = createFeedbackCaptureGate();
      window.client = await mountFeedbackClient({
        trigger: document.querySelector('#trigger'),
        gate: window.gate,
        snapshot: () => ({ project: {}, workshop: {} }),
        screenshot: () => null,
      });
    });
  }
  await first.getByRole('button', { name: 'Give feedback', exact: true }).click();
  await first
    .getByRole('textbox', { name: 'Your feedback', exact: true })
    .fill('Private draft from first tab');
  await first.waitForFunction(
    () => document.querySelector('[data-save]').textContent === 'Draft saved on this device.',
  );
  await second.getByRole('button', { name: 'Give feedback', exact: true }).click();
  await second
    .getByText('Feedback is open in another workshop tab. Close it there, then try again.', {
      exact: true,
    })
    .waitFor({ state: 'visible', timeout: 1500 });
  evidence.assert('equal', [await second.locator('.feedback-dialog').isVisible(), false]);
  evidence.assert('equal', [await second.locator('[data-stop]').isVisible(), false]);
  evidence.assert('doesNotMatch', [
    await second.locator('body').textContent(),
    /Private draft from first tab/,
  ]);
  await first.getByRole('button', { name: 'Back to building', exact: true }).click();
  await first.waitForFunction(() => !document.querySelector('.feedback-dialog').open);
  await second.getByRole('button', { name: 'Back to building', exact: true }).click();
  await second.getByRole('button', { name: 'Give feedback', exact: true }).click();
  await second
    .getByRole('textbox', { name: 'Your feedback', exact: true })
    .waitFor({ state: 'visible' });
  evidence.assert('equal', [
    await second.getByRole('textbox', { name: 'Your feedback', exact: true }).inputValue(),
    'Private draft from first tab',
  ]);
  for (const page of [first, second])
    await page.evaluate(async () => {
      window.client.dispose();
      await window.gate.close();
    });
  await shared.close();
  const mediaPage = await browser.newPage();
  mediaPage.setDefaultTimeout(5000);
  await mediaPage.goto(`http://127.0.0.1:${server.address().port}`);
  await mediaPage.getByRole('button', { name: 'Give feedback', exact: true }).click();
  await mediaPage.evaluate(async () => {
    const audio = new AudioContext(),
      destination = audio.createMediaStreamDestination(),
      oscillator = audio.createOscillator();
    oscillator.connect(destination);
    oscillator.start();
    await audio.resume();
    const chunks = [],
      recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 250));
    recorder.stop();
    await stopped;
    oscillator.stop();
    destination.stream.getTracks().forEach((track) => track.stop());
    await audio.close();
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    canvas.getContext('2d').fillRect(0, 0, 64, 32);
    const reference = { sessionId: 'a'.repeat(32), timeMs: 1234 };
    window.feedbackSeed = {
      text: 'Exact blocked voice observation',
      voice: {
        mime: 'audio/webm;codecs=opus',
        base64: btoa(String.fromCharCode(...bytes)),
        durationMs: 250,
      },
      image: {
        dataUrl: canvas.toDataURL('image/png'),
        scope: 'canvas',
        capturedAt: '2026-09-12T01:02:03.000Z',
        reference,
      },
      context: {
        value: { project: { program: 'exact selected program' }, workshop: { part: 'wheel' } },
        capturedAt: '2026-09-12T01:02:04.000Z',
        reference,
      },
      reference,
    };
    const { openFeedbackStore } = await import('../src/application/feedback-store.mjs');
    const store = await openFeedbackStore();
    await store.createDraft(window.feedbackSeed);
    store.close();
    window.activePreviewURLs = new Set();
    window.revokedPreviewURLs = [];
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      window.activePreviewURLs.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.activePreviewURLs.delete(url);
      window.revokedPreviewURLs.push(url);
      revoke(url);
    };
    const { mountFeedbackClient } = await import('../src/application/feedback-client.mjs');
    const { createFeedbackCaptureGate } = await import(
      '../src/application/feedback-capture-gate.mjs'
    );
    window.gate = createFeedbackCaptureGate();
    window.client = await mountFeedbackClient({
      trigger: document.querySelector('#trigger'),
      gate: window.gate,
      snapshot: () => ({ project: {}, workshop: {} }),
      screenshot: () => null,
    });
    window.client.configure({ feedback: { enabled: true, protocolVersion: 1 } });
  });
  await mediaPage.getByRole('button', { name: 'Give feedback', exact: true }).click();
  await mediaPage.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await mediaPage.waitForFunction(() =>
    document.querySelector('[data-receipt-state]').textContent.includes('rejected'),
  );
  await mediaPage
    .locator('[data-submitted-media] audio')
    .waitFor({ state: 'visible', timeout: 1500 });
  const receiptURL = await mediaPage.locator('[data-submitted-media] audio').getAttribute('src');
  await mediaPage.waitForFunction(
    () => document.querySelector('[data-submitted-media] audio').readyState >= 2,
  );
  evidence.assert('equal', [
    await mediaPage.locator('[data-submitted-media] img').evaluate((image) => image.naturalWidth),
    64,
  ]);
  await mediaPage.locator('[data-submitted-media] summary').click();
  evidence.assert('match', [
    await mediaPage.locator('[data-submitted-media] pre').textContent(),
    /exact selected program/,
  ]);
  evidence.assert('match', [
    await mediaPage.locator('[data-submitted-media]').textContent(),
    /Project and workshop snapshot/,
  ]);
  evidence.assert('equal', [
    await mediaPage.locator('[data-submitted-media] time').last().getAttribute('datetime'),
    '2026-09-12T01:02:04.000Z',
  ]);
  evidence.assert('equal', [
    await mediaPage.evaluate(
      () =>
        document.activeElement.closest('.feedback-dialog')?.open === true &&
        document.activeElement.getClientRects().length > 0,
    ),
    true,
  ]);
  await mediaPage.getByRole('button', { name: 'Your feedback history', exact: true }).click();
  await mediaPage.locator('[data-history]').waitFor({ state: 'visible' });
  evidence.assert('equal', [
    await mediaPage.evaluate(() => document.activeElement.hasAttribute('data-history')),
    true,
  ]);
  evidence.assert('equal', [
    await mediaPage.evaluate((url) => window.revokedPreviewURLs.includes(url), receiptURL),
    true,
  ]);
  await mediaPage.locator('[data-history] audio').waitFor({ state: 'visible' });
  await mediaPage.evaluate(async () => {
    window.stableAudio = document.querySelector('[data-history] audio');
    window.stableAudio.loop = true;
    await window.stableAudio.play();
  });
  const playingURL = await mediaPage.locator('[data-history] audio').getAttribute('src');
  await mediaPage.evaluate(async () => {
    const { openFeedbackStore } = await import('../src/application/feedback-store.mjs');
    const store = await openFeedbackStore();
    const item = (await store.items())[0];
    await store.failure(item.id, { code: 503, permanent: false, retryAt: Date.now() + 60000 });
    store.close();
  });
  await mediaPage.waitForTimeout(3300);
  evidence.assert('equal', [
    await mediaPage.evaluate(
      () =>
        window.stableAudio === document.querySelector('[data-history] audio') &&
        !window.stableAudio.paused,
    ),
    true,
  ]);
  evidence.assert('equal', [
    await mediaPage.locator('[data-history] audio').getAttribute('src'),
    playingURL,
  ]);
  await mediaPage.evaluate(async () => {
    const { openFeedbackStore } = await import('../src/application/feedback-store.mjs');
    const store = await openFeedbackStore();
    await store.failure((await store.items())[0].id, { code: 400, permanent: true });
    store.close();
  });
  await mediaPage
    .getByRole('button', { name: 'Create corrected draft', exact: true })
    .waitFor({ state: 'visible' });
  const original = await mediaPage.evaluate(async () => {
    const { openFeedbackStore } = await import('../src/application/feedback-store.mjs');
    const store = await openFeedbackStore();
    const item = (await store.items())[0];
    store.close();
    return item;
  });
  await mediaPage.getByRole('button', { name: 'Create corrected draft', exact: true }).click();
  await mediaPage
    .getByRole('textbox', { name: 'Your feedback', exact: true })
    .waitFor({ state: 'visible' });
  evidence.assert('equal', [
    await mediaPage.evaluate(() => document.activeElement.id),
    'feedback-text',
  ]);
  const corrected = await mediaPage.evaluate(async () => {
    const { openFeedbackStore } = await import('../src/application/feedback-store.mjs');
    const store = await openFeedbackStore();
    const draft = await store.draft();
    store.close();
    return draft;
  });
  evidence.assert('notEqual', [corrected.id, original.id]);
  evidence.assert('deepEqual', [corrected.voice, original.envelope.voice]);
  evidence.assert('deepEqual', [corrected.context, original.envelope.context]);
  evidence.assert('deepEqual', [corrected.reference, original.envelope.reference]);
  evidence.assert('equal', [
    await mediaPage.evaluate((url) => window.revokedPreviewURLs.includes(url), playingURL),
    true,
  ]);
  await mediaPage
    .getByRole('textbox', { name: 'Your feedback', exact: true })
    .fill('Keep this existing correction');
  await mediaPage.getByRole('button', { name: 'Your feedback history', exact: true }).click();
  await mediaPage.locator('[data-history]').waitFor({ state: 'visible' });
  await mediaPage.getByRole('button', { name: 'Create corrected draft', exact: true }).click();
  await mediaPage.waitForFunction(() =>
    /already have an unsent draft/i.test(document.querySelector('[data-error]').textContent),
  );
  evidence.assert('match', [
    await mediaPage.locator('[data-error]').textContent(),
    /already have an unsent draft/i,
  ]);
  await mediaPage.getByRole('button', { name: 'Back to draft', exact: true }).click();
  evidence.assert('equal', [
    await mediaPage.getByRole('textbox', { name: 'Your feedback', exact: true }).inputValue(),
    'Keep this existing correction',
  ]);
  await mediaPage.locator('[data-attachments] > summary').click();
  await mediaPage.getByRole('button', { name: 'Remove recording links', exact: true }).click();
  await mediaPage.getByLabel('Include workshop image', { exact: true }).uncheck();
  await mediaPage.getByLabel('Include workshop context', { exact: true }).uncheck();
  await mediaPage.waitForFunction(
    () =>
      !document.querySelector('[data-context]').checked &&
      !document.querySelector('[data-image]').checked,
  );
  await mediaPage.getByRole('button', { name: 'Your feedback history', exact: true }).click();
  await mediaPage.locator('[data-history]').waitFor({ state: 'visible' });
  await mediaPage.evaluate(async () => {
    window.finishAudio = document.querySelector('[data-history] audio');
    window.finishAudio.loop = true;
    await window.finishAudio.play();
    await window.client.finish();
  });
  evidence.assert('equal', [
    await mediaPage.evaluate(
      () => window.finishAudio.paused && !window.finishAudio.getAttribute('src'),
    ),
    true,
    'Finish releases hidden submitted playback',
  ]);
  evidence.assert('equal', [
    await mediaPage.evaluate(() => document.activeElement.id),
    'feedback-text',
    'Finish focuses the retained draft',
  ]);
  await mediaPage.getByRole('button', { name: 'Keep draft', exact: true }).click();
  await mediaPage.waitForFunction(() => !document.querySelector('.feedback-dialog').open);
  const finalState = await mediaPage.evaluate(async () => {
    const { openFeedbackStore } = await import('../src/application/feedback-store.mjs');
    const store = await openFeedbackStore();
    const draft = await store.draft(),
      items = await store.items();
    store.close();
    return { draft, items, urls: window.activePreviewURLs.size };
  });
  evidence.assert('equal', [finalState.draft.id, corrected.id]);
  evidence.assert('equal', [finalState.draft.text, 'Keep this existing correction']);
  evidence.assert('equal', [finalState.draft.reference, undefined]);
  evidence.assert('equal', [finalState.draft.image, undefined]);
  evidence.assert('equal', [finalState.draft.context, undefined]);
  evidence.assert('equal', [finalState.items[0].bodyText, original.bodyText]);
  evidence.assert('equal', [finalState.items[0].outcome, 'blocked']);
  evidence.assert('equal', [finalState.urls, 0]);
  await mediaPage.waitForTimeout(3300);
  evidence.assert('equal', [
    await mediaPage.evaluate(() => window.activePreviewURLs.size),
    0,
    'background delivery cannot recreate closed previews',
  ]);
  await mediaPage.evaluate(async () => {
    window.client.dispose();
    await window.gate.close();
  });
  await mediaPage.close();
  evidence.assertUnchanged();
  console.log(
    'feedback recovery passed: exhausted draft creation opens received history; explicit local deletion releases capacity; new draft saves; no remote deletion',
  );
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createFixtureEvidence } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';

const evidence = createFixtureEvidence({
  name: 'feedback-flow',
  build: 'feedback-flow-fixture',
  expectedErrors: [
    { type: 'http', status: 503, url: '/api/playtest/' },
    { type: 'console', url: '/api/playtest/', message: 'Failed to load resource' },
  ],
  files: [
    'src/application/remote-playtest.mjs',
    'src/application/feedback-client.mjs',
    'src/application/feedback-store.mjs',
    'src/application/feedback-protocol.mjs',
    'src/application/feedback-capture-gate.mjs',
    'src/application/capture-media-duration.mjs',
    'src/application/capture-outbox.mjs',
    'src/application/capture-packet.mjs',
    'src/presentation/workshop.css',
    'scripts/verify-feedback-flow.mjs',
  ],
});
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (/^\/src\/application\/[a-z-]+\.mjs$/.test(path)) {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(readFileSync('.' + path));
  } else if (path === '/fflate.mjs') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(readFileSync('node_modules/fflate/esm/browser.js'));
  } else if (path === '/style.css') {
    res.setHeader('Content-Type', 'text/css');
    res.end(readFileSync('src/presentation/workshop.css'));
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<meta name="build-id" content="feedback-flow-fixture"><link rel="stylesheet" href="/style.css"><script type="importmap">{"imports":{"fflate":"/fflate.mjs"}}</script><script type="module">import {mountRemotePlaytest} from "/src/application/remote-playtest.mjs"; window.capture=await mountRemotePlaytest({feedbackSnapshot:()=>({project:{id:"fixture"},workshop:{ui:{mode:"build"}}}),context:()=>({ui:{mode:"build"}}),checkpoint:()=>({blueprint:{id:"test"}}),screenshot:()=>null});</script>',
    );
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await evidence.launch({ profile: 'recording', channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  let unavailable = false;
  const submitted = [];
  await context.route('**/api/playtest/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.endsWith('/config'))
      return route.fulfill({
        json: {
          enabled: true,
          protocolVersion: 2,
          feedback: { enabled: true, protocolVersion: 1 },
        },
      });
    if (path.endsWith('/session'))
      return route.fulfill({
        json: {
          protocolVersion: 2,
          sessionId: 'a'.repeat(32),
          requestId: request.postDataJSON().requestId,
          requestHash: createHash('sha256').update(request.postDataBuffer()).digest('hex'),
        },
      });
    if (path === '/api/playtest/feedback/v1/submission') {
      submitted.push(request.postData());
      if (unavailable) return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      return route.fulfill({
        json: {
          protocolVersion: 1,
          submissionId: request.postDataJSON().id,
          uploadHash: createHash('sha256').update(request.postDataBuffer()).digest('hex'),
          receivedAt: new Date().toISOString(),
          status: 'received',
        },
      });
    }
    const body = request.postDataJSON();
    return route.fulfill({
      json: {
        protocolVersion: 2,
        sessionId: 'a'.repeat(32),
        logicalKey: `event:${body.id}`,
        uploadHash: createHash('sha256').update(request.postDataBuffer()).digest('hex'),
        sequence: 1,
        receivedAt: new Date().toISOString(),
      },
    });
  });
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await evidence.goto(page, origin);
  await page.waitForFunction(() => !!window.capture);
  await page.keyboard.press('Escape');
  evidence.assert('equal', [
    await page.getByRole('button', { name: 'Give feedback', exact: true }).isEnabled(),
    true,
    'feedback remains reachable after dismissing setup, before recording',
  ]);
  await page.getByRole('button', { name: 'Give feedback', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'What would you like Yaniv to know?' }).waitFor();
  evidence.assert('equal', [
    await page.getByRole('dialog', { name: 'What would you like Yaniv to know?' }).count(),
    1,
    'composer has a meaningful accessible name',
  ]);
  evidence.assert('equal', [
    await page.locator('textarea').evaluate((node) => node === document.activeElement),
    true,
  ]);
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    evidence.assert('equal', [
      await page.evaluate(() => document.activeElement.closest('.feedback-dialog') !== null),
      true,
      'keyboard focus stays in the modal',
    ]);
  }
  evidence.assert('equal', [await page.locator('[data-save]').getAttribute('role'), 'status']);
  evidence.assert('equal', [
    await page.locator('[data-receipt-state]').getAttribute('role'),
    'status',
  ]);
  evidence.assert('equal', [
    await page.getByRole('button', { name: 'Send feedback', exact: true }).isDisabled(),
    true,
  ]);
  await page
    .getByRole('textbox', { name: 'Your feedback', exact: true })
    .fill('The wiring step was clear.');
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await page.locator('[data-received]').waitFor({ state: 'visible' });
  evidence.assert('equal', [
    await page.evaluate(() => {
      const active = document.activeElement;
      return !!active.closest('.feedback-dialog') && active.checkVisibility();
    }),
    true,
    'sending moves focus to visible receipt content',
  ]);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-receipt-state]')?.textContent === 'Sent to Yaniv for review.',
  );
  evidence.assert('equal', [
    await page.evaluate(() => window.capture.active()),
    false,
    'feedback-only send must never start recording',
  ]);
  evidence.assert('equal', [submitted.length, 1]);
  const envelope = JSON.parse(submitted[0]);
  evidence.assert('equal', [envelope.text, 'The wiring step was clear.']);
  evidence.assert('equal', [
    'image' in envelope || 'context' in envelope || 'voice' in envelope,
    false,
    'attachments require opt-in',
  ]);
  await page.getByRole('button', { name: 'Back to building', exact: true }).click();
  evidence.assert('equal', [
    await page
      .getByRole('button', { name: 'Give feedback', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
    'closing restores the feedback entry point',
  ]);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page
    .getByRole('dialog')
    .filter({ has: page.locator('[data-start]') })
    .getByRole('button', { name: 'Start recording', exact: true })
    .click();
  await page.waitForFunction(() => window.capture.active());
  await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Your feedback', exact: true })
    .fill('UNSENT: I expected Undo to restore the wire.');
  await page.getByRole('button', { name: 'Back to building', exact: true }).click();
  await page.getByRole('button', { name: 'Finish session', exact: true }).click();
  await page.waitForFunction(() => !window.capture.active());
  await page.getByRole('button', { name: 'Keep draft', exact: true }).waitFor();
  evidence.assert('equal', [submitted.length, 1, 'Finish cannot silently send a draft']);
  await page.getByRole('button', { name: 'Keep draft', exact: true }).click();
  await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
  evidence.assert('equal', [
    await page.getByRole('textbox', { name: 'Your feedback', exact: true }).inputValue(),
    'UNSENT: I expected Undo to restore the wire.',
  ]);
  await page.getByRole('button', { name: 'Back to building', exact: true }).click();
  await evidence.reload(page);
  await page.waitForFunction(() => !!window.capture);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
  evidence.assert('equal', [
    await page.getByRole('textbox', { name: 'Your feedback', exact: true }).inputValue(),
    'UNSENT: I expected Undo to restore the wire.',
    'committed draft survives reload',
  ]);
  unavailable = true;
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await page.getByText('waiting to send', { exact: false }).first().waitFor();
  await page.getByRole('button', { name: 'Back to building', exact: true }).click();
  await evidence.reload(page);
  await page.waitForFunction(() => !!window.capture);
  unavailable = false;
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
  await page.getByRole('button', { name: 'Your feedback history', exact: true }).click();
  await page.locator('[data-history]').waitFor({ state: 'visible' });
  evidence.assert('equal', [
    await page.evaluate(() => {
      const active = document.activeElement;
      return !!active.closest('[data-history]') && active.checkVisibility();
    }),
    true,
    'history navigation moves focus into history',
  ]);
  await page.getByRole('button', { name: 'Retry', exact: true }).first().click();
  await page
    .locator('[data-history] .playtest-comment')
    .filter({ hasText: 'UNSENT:' })
    .getByText('Sent to Yaniv for review.', { exact: true })
    .waitFor();
  evidence.assert('ok', [
    submitted.slice(1).every((body) => body === submitted[1]),
    'retry preserves exact submission bytes',
  ]);
  await page.getByRole('button', { name: 'Back to draft', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Your feedback', exact: true })
    .fill('Long observation '.repeat(590));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  async function checkLayout(state) {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 640, height: 480 },
      { width: 320, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      const layout = await page.locator('.feedback-dialog').evaluate((dialog) => {
        const box = dialog.getBoundingClientRect(),
          scroll = dialog.querySelector('.feedback-scroll');
        return {
          x: box.x,
          y: box.y,
          right: box.right,
          bottom: box.bottom,
          overflow: dialog.scrollWidth > dialog.clientWidth + 1,
          scrollHeight: scroll.clientHeight,
          actions: [...dialog.querySelectorAll('.feedback-actions button')]
            .filter((b) => !b.hidden)
            .map((b) => {
              const r = b.getBoundingClientRect();
              return {
                name: b.textContent,
                x: r.x,
                y: r.y,
                right: r.right,
                bottom: r.bottom,
                hittable: b.contains(
                  document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
                ),
              };
            }),
          moving: dialog
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === 'running')
            .map((animation) => ({
              type: animation.constructor.name,
              property: animation.transitionProperty ?? animation.animationName ?? '',
              target: animation.effect?.target?.outerHTML?.slice(0, 250) ?? '',
            })),
        };
      });
      evidence.assert('ok', [
        layout.x >= 0 &&
          layout.y >= 0 &&
          layout.right <= viewport.width &&
          layout.bottom <= viewport.height,
        `${state}: dialog fits ${viewport.width}x${viewport.height}`,
      ]);
      evidence.assert('equal', [layout.overflow, false, `${state}: no horizontal overflow`]);
      evidence.assert('ok', [layout.scrollHeight > 0, `${state}: content remains scrollable`]);
      evidence.assert('deepEqual', [layout.moving, [], 'reduced motion has no running animation']);
      for (const action of layout.actions)
        evidence.assert('ok', [
          action.x >= layout.x &&
            action.right <= layout.right &&
            action.y >= layout.y &&
            action.bottom <= layout.bottom &&
            action.hittable,
          `${state}: ${action.name} remains inside the dialog`,
        ]);
      await page.screenshot({
        path: browserArtifactPath(`artifacts/feedback-${state}-${viewport.width}.png`),
      });
    }
  }
  await checkLayout('long-draft');
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-receipt-state]').textContent === 'Sent to Yaniv for review.',
  );
  await checkLayout('receipt');
  await page.getByRole('button', { name: 'Your feedback history', exact: true }).click();
  await page.locator('[data-history]').waitFor({ state: 'visible' });
  await checkLayout('long-history');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.feedback-dialog').open);
  evidence.assert('equal', [
    await page
      .getByRole('button', { name: 'Give feedback', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
    'Escape restores focus',
  ]);
  console.log(
    'feedback flow passed: before/after recording, both original regressions, draft reload, explicit attachments and exact-byte retry',
  );
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  try {
    evidence.assertUnchanged();
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

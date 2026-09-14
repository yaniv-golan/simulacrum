// M3b: asynchronous feedback lifecycle, using production UI/store/capture modules.
// Media permission/recording is simulated; HTTP response bodies and IndexedDB are real.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createFixtureEvidence } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';

const clientPath = process.env.FEEDBACK_CLIENT_SOURCE || 'src/application/feedback-client.mjs';
const remotePath = process.env.FEEDBACK_REMOTE_SOURCE || 'src/application/remote-playtest.mjs';
const selected = process.env.FEEDBACK_LIFECYCLE_CASE;
if (
  process.env.SIMULACRUM_BROWSER_EXECUTION &&
  (selected || process.env.FEEDBACK_CLIENT_SOURCE || process.env.FEEDBACK_REMOTE_SOURCE)
)
  throw Error('Registered feedback lifecycle checks require all cases and production sources');
const cases = [
  'queued-discard',
  'late-mic',
  'automatic-text',
  'automatic-voice',
  'receipt-timeout',
];
if (selected && !cases.includes(selected)) throw Error('Unknown feedback lifecycle case');
const evidence = createFixtureEvidence({
  name: 'feedback-lifecycle',
  build: 'feedback-lifecycle-fixture',
  expectedErrors: [
    { type: 'request', url: '/api/playtest/feedback/v1/submission', message: 'net::ERR_ABORTED' },
  ],
  files: [
    clientPath,
    remotePath,
    'src/application/feedback-store.mjs',
    'src/application/feedback-protocol.mjs',
    'src/application/feedback-capture-gate.mjs',
    'src/application/capture-media-duration.mjs',
    'src/application/capture-outbox.mjs',
    'src/application/capture-stream.mjs',
    'src/application/capture-packet.mjs',
    'src/presentation/dialog-close.mjs',
    'src/presentation/workshop.css',
    'scripts/verify-feedback-lifecycle.mjs',
    'package-lock.json',
  ],
});
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const submissionPath = '/api/playtest/feedback/v1/submission';
let currentCase,
  posts = [],
  held = null,
  stalled = null,
  sequence = 0;
const receipts = new Map();
function reply(res, value) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/api/playtest/config')
    return reply(res, {
      enabled: true,
      protocolVersion: 2,
      feedback: { enabled: true, protocolVersion: 1 },
    });
  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks),
      body = JSON.parse(bytes.toString('utf8'));
    if (path === submissionPath) {
      posts.push({
        bodyText: bytes.toString('utf8'),
        id: body.id,
        text: body.text,
        at: Date.now(),
      });
      if (!receipts.has(body.id))
        receipts.set(body.id, {
          protocolVersion: 1,
          submissionId: body.id,
          uploadHash: hash(bytes),
          receivedAt: new Date().toISOString(),
          status: 'received',
        });
      if (currentCase === 'queued-discard' && body.text === 'queued A') {
        held = () => reply(res, receipts.get(body.id));
        return;
      }
      if (currentCase === 'receipt-timeout' && posts.length === 1) {
        stalled = res;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"protocolVersion":');
        return;
      }
      return reply(res, receipts.get(body.id));
    }
    if (path.endsWith('/session'))
      return reply(res, {
        protocolVersion: 2,
        sessionId: 'a'.repeat(32),
        requestId: body.requestId,
        requestHash: hash(bytes),
      });
    return reply(res, {
      protocolVersion: 2,
      sessionId: 'a'.repeat(32),
      logicalKey: `event:${body.id}`,
      uploadHash: hash(bytes),
      sequence: ++sequence,
      receivedAt: new Date().toISOString(),
    });
  }
  if (/^\/src\/(?:application\/[a-z-]+|presentation\/dialog-close)\.mjs$/.test(path)) {
    res.setHeader('Content-Type', 'text/javascript');
    return res.end(
      readFileSync(
        path.endsWith('/feedback-client.mjs')
          ? clientPath
          : path.endsWith('/remote-playtest.mjs')
            ? remotePath
            : '.' + path,
      ),
    );
  }
  if (path === '/fflate.mjs') {
    res.setHeader('Content-Type', 'text/javascript');
    return res.end(readFileSync('node_modules/fflate/esm/browser.js'));
  }
  if (path === '/style.css') {
    res.setHeader('Content-Type', 'text/css');
    return res.end(readFileSync('src/presentation/workshop.css'));
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<meta name="build-id" content="feedback-lifecycle-fixture"><link rel="stylesheet" href="/style.css"><script type="importmap">{"imports":{"fflate":"/fflate.mjs"}}</script><script type="module">
    import {mountRemotePlaytest} from '/src/application/remote-playtest.mjs';
    import {openFeedbackStore} from '/src/application/feedback-store.mjs';
    window.readFeedback=async()=>{const store=await openFeedbackStore();try{return {draft:await store.draft(),items:await store.items()};}finally{store.close();}};
    if(new URL(location.href).searchParams.get('case')==='queued-discard') {
      const store=await openFeedbackStore();
      for(const text of ['queued A','queued B']){const draft=await store.createDraft({text});await store.freeze({id:draft.id,revision:draft.revision});}
      store.close();
    }
    window.capture=await mountRemotePlaytest({feedbackSnapshot:()=>({project:{id:"fixture"},workshop:{ui:{mode:"build"}}}),context:()=>({ui:{mode:'build'}}),checkpoint:()=>({blueprint:{id:'fixture'}}),screenshot:()=>null});
    </script>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await evidence.launch({ profile: 'recording', channel: 'chrome', headless: true });
const origin = `http://127.0.0.1:${server.address().port}`;
async function until(predicate, limit = 10000) {
  const deadline = Date.now() + limit;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw Error('Fixture condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function createPage(name) {
  currentCase = name;
  posts = [];
  held = null;
  stalled = null;
  sequence = 0;
  receipts.clear();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    window.micRequests = 0;
    window.micStopped = 0;
    window.deferMicrophone = false;
    const makeStream = () => {
      let stopped = false;
      return {
        getTracks: () => [
          {
            stop() {
              if (!stopped) {
                stopped = true;
                window.micStopped++;
              }
            },
          },
        ],
      };
    };
    navigator.mediaDevices.getUserMedia = async () => {
      window.micRequests++;
      if (window.deferMicrophone)
        return new Promise((resolve) => (window.resolveMicrophone = () => resolve(makeStream())));
      return makeStream();
    };
    window.MediaRecorder = class {
      static isTypeSupported() {
        return true;
      }
      constructor(stream, options = {}) {
        this.stream = stream;
        this.mimeType = options.mimeType || 'audio/webm';
        this.state = 'inactive';
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        queueMicrotask(() => {
          this.ondataavailable?.({
            data: new Blob(['fixture voice bytes'], { type: this.mimeType }),
          });
          this.onstop?.();
        });
      }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await evidence.goto(page, `${origin}/?case=${name}`);
  await page.waitForFunction(() => !!window.capture);
  await page.keyboard.press('Escape');
  return { page, context };
}
async function openFeedback(page) {
  await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your feedback', exact: true }).waitFor();
}
async function startRecording(page) {
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.locator('[data-start]').click();
  await page.waitForFunction(() => window.capture.active());
}
try {
  for (const name of selected ? [selected] : cases) {
    const { page, context } = await createPage(name);
    try {
      if (name === 'queued-discard') {
        await until(() => !!held);
        await openFeedback(page);
        await page.getByRole('button', { name: 'Your feedback history', exact: true }).click();
        const b = page.locator('[data-history] li').filter({ hasText: 'queued B' });
        page.once('dialog', (dialog) => dialog.accept());
        await b.getByRole('button', { name: 'Discard local copy', exact: true }).click();
        await page.waitForFunction(async () =>
          (await window.readFeedback()).items.some((x) => x.outcome === 'discarded'),
        );
        held();
        held = null;
        await page
          .locator('[data-history] li')
          .filter({ hasText: 'queued A' })
          .getByText('Sent to Yaniv for review.', { exact: true })
          .waitFor();
        evidence.assert('equal', [
          posts.filter((x) => x.text === 'queued B').length,
          0,
          'discarded queued B must never begin transmission after A completes',
        ]);
        evidence.assert('equal', [
          posts.filter((x) => x.text === 'queued A').length,
          1,
          'positive control: queued A was received',
        ]);
      } else if (name === 'late-mic') {
        await openFeedback(page);
        await page
          .getByRole('textbox', { name: 'Your feedback', exact: true })
          .fill('Keep text after closing permission request');
        await page.evaluate(() => (window.deferMicrophone = true));
        await page.getByRole('button', { name: 'Record voice comment', exact: true }).click();
        await page.waitForFunction(() => window.micRequests === 1);
        await page.getByRole('button', { name: 'Close feedback', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('.feedback-dialog').open);
        await page.evaluate(() => window.resolveMicrophone());
        await page.waitForFunction(() => window.micStopped === 1);
        evidence.assert('equal', [
          posts.length,
          0,
          'late microphone permission cannot submit feedback',
        ]);
        await openFeedback(page);
        evidence.assert('equal', [
          await page.getByRole('textbox', { name: 'Your feedback', exact: true }).inputValue(),
          'Keep text after closing permission request',
        ]);
      } else if (name === 'automatic-text' || name === 'automatic-voice') {
        await startRecording(page);
        await openFeedback(page);
        if (name === 'automatic-voice') {
          await page.getByRole('button', { name: 'Record voice comment', exact: true }).click();
          await page.getByRole('button', { name: 'Stop voice recording', exact: true }).waitFor();
        }
        const stopped = await page.evaluate((name) => {
          if (name === 'automatic-text') {
            const text = document.querySelector('#feedback-text');
            text.value = 'Uncommitted text at automatic stop';
            text.dispatchEvent(new Event('input', { bubbles: true }));
          }
          // An oversized ordinary capture event exercises production's capture-error stop path.
          window.capture.emit('browser-error', { message: 'x'.repeat(3 * 1024 ** 2) });
          return { active: window.capture.active(), micStopped: window.micStopped };
        }, name);
        evidence.assert('equal', [
          stopped.active,
          false,
          'capture error stops session synchronously',
        ]);
        if (name === 'automatic-voice')
          evidence.assert('equal', [
            stopped.micStopped,
            1,
            'automatic capture error stops microphone before asynchronous finalization',
          ]);
        await page.getByRole('button', { name: 'Keep draft', exact: true }).waitFor();
        const saved = await page.evaluate(() => window.readFeedback());
        if (name === 'automatic-text')
          evidence.assert('equal', [
            saved.draft.text,
            'Uncommitted text at automatic stop',
            'Finish flushes pending text debounce before deciding whether a draft exists',
          ]);
        else
          evidence.assert('ok', [
            saved.draft.voice,
            'stopped voice finalizes locally as an unsent draft',
          ]);
        evidence.assert('equal', [posts.length, 0, 'automatic stop cannot submit text or voice']);
      } else {
        await openFeedback(page);
        await page
          .getByRole('textbox', { name: 'Your feedback', exact: true })
          .fill(
            'I expected the wheel to turn when I connected the motor. The wiring preview helped me find the missing connection.',
          );
        await page
          .locator('[data-save]')
          .getByText('Draft saved on this device.', { exact: true })
          .waitFor();
        for (const [size, viewport] of [
          ['desktop', { width: 1280, height: 720 }],
          ['narrow', { width: 640, height: 480 }],
        ]) {
          await page.setViewportSize(viewport);
          evidence.assert('ok', [
            await page.getByRole('button', { name: 'Send feedback', exact: true }).isVisible(),
            'Send remains visible in ' + size + ' composer',
          ]);
          await page.screenshot({
            path: browserArtifactPath(`artifacts/feedback-lifecycle-${size}-composer.png`),
          });
        }
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
        await until(() => !!stalled);
        await until(
          () =>
            page.evaluate(
              async () => (await window.readFeedback()).items[0]?.outcome === 'received',
            ),
          25000,
        );
        evidence.assert('equal', [
          posts.length,
          2,
          'stalled receipt body times out and one exact retry succeeds',
        ]);
        evidence.assert('equal', [
          posts[0].bodyText,
          posts[1].bodyText,
          'retry uses the same immutable envelope',
        ]);
        evidence.assert('ok', [
          posts[1].at - posts[0].at >= 14000,
          'real production timeout is exercised, not shortened',
        ]);
        await page.getByText('Sent to Yaniv for review.', { exact: true }).waitFor();
        for (const [size, viewport] of [
          ['desktop', { width: 1280, height: 720 }],
          ['narrow', { width: 640, height: 480 }],
        ]) {
          await page.setViewportSize(viewport);
          evidence.assert('ok', [
            await page.getByRole('button', { name: 'Back to building', exact: true }).isVisible(),
            'Return remains visible in ' + size + ' receipt',
          ]);
          await page.screenshot({
            path: browserArtifactPath(`artifacts/feedback-lifecycle-${size}-receipt.png`),
          });
        }
      }
      console.log(`feedback lifecycle ${name}: passed`);
    } finally {
      held?.();
      held = null;
      await page.evaluate(() => window.capture?.dispose());
      await context.close();
      stalled?.destroy();
      stalled = null;
    }
  }
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

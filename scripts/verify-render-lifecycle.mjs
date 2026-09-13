import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const evidence = createBrowserEvidence();
const out = browserArtifactPath('artifacts/render-lifecycle');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:5173/test/browser/');
  await page.waitForFunction(() => window.probe);
  const result = await page.evaluate(async () => {
    const { createWorkshopView } = await import('/src/presentation/workshop-view.mjs');
    const { createWorkshop } = await import('/src/core/workshop.mjs');
    const workshop = await createWorkshop();
    const act = async (command) => {
      const receipt = await workshop.act(command);
      if (!receipt.ok) throw Error(`Rejected fixture command: ${JSON.stringify(receipt)}`);
      return workshop.observe().frames[0];
    };
    await act({ type: 'place', partType: 'beam', id: 'a', position: [0, 2, 0] });
    const initial = await act({ type: 'place', partType: 'beam', id: 'b', position: [1, 2, 0] });
    const running = await act({ type: 'run' });
    const paused = await act({ type: 'pause' });
    const build = await act({ type: 'build' });
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:1440px;height:1000px;z-index:9999';
    document.body.append(host);
    let calls = 0,
      armed = false;
    const reported = [];
    const onError = (event) => {
      if (event.error?.message !== 'controlled before-draw failure') return;
      reported.push(event.error.message);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    const view = createWorkshopView(host, {
      onCommand: async () => ({ ok: true }),
      getCursor: () => workshop.observe().cursor,
      beforeDraw: () => {
        calls++;
        if (armed) {
          armed = false;
          throw Error('controlled before-draw failure');
        }
      },
    });
    const waitFrames = (count) =>
      new Promise((resolve) => {
        const next = () => (--count ? requestAnimationFrame(next) : resolve());
        requestAnimationFrame(next);
      });
    try {
      view.render(initial);
      await waitFrames(2);
      const costs = view.readInteractionState().rendering.costsMs;
      // Actual core mode transitions create fresh admitted blueprint references.
      // Render them directly: the command UI deliberately exits inspection mode.
      const modeReadings = [];
      for (const frame of [running, paused, build]) {
        view.render(frame);
        modeReadings.push({
          mode: frame.metadata.mode,
          costs: view.readInteractionState().rendering.costsMs,
        });
      }
      view.render(paused);
      const explodeButton = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === 'Exploded view',
      );
      explodeButton.click();
      const activated = view.readInteractionState().explodedView.active;
      view.render(paused);
      view.render(paused);
      const repeatedFramePreserved = view.readInteractionState().explodedView.active;
      view.render(build);
      const equalBlueprintPreserved = view.readInteractionState().explodedView.active;
      const renamed = await act({ type: 'rename', id: 'a', name: 'Renamed beam' });
      view.render(renamed);
      const renameExitsExploded = !view.readInteractionState().explodedView.active;
      const renamedListText = host.querySelector('[data-part-id="a"].part-list-item')?.textContent;
      await waitFrames(2);
      const beforePreparationFailure = view.readInteractionState().rendering;
      const cursor = workshop.observe().cursor;
      const faultCursor = { ...cursor, revision: cursor.revision + 1 };
      let preparationFaultArmed = true,
        preparationError;
      // A deliberately invalid presentation input, never admitted to core state.
      // Throw once so a later RAF can expose a partial-scene cursor publication.
      const faultFrame = {
        ...renamed,
        get metadata() {
          if (preparationFaultArmed) {
            preparationFaultArmed = false;
            throw Error('controlled render-preparation failure');
          }
          return renamed.metadata;
        },
      };
      try {
        view.render(faultFrame, faultCursor);
      } catch (error) {
        preparationError = error.message;
      }
      await waitFrames(2);
      const afterPreparationFailure = view.readInteractionState().rendering;
      view.render(renamed, cursor);
      await waitFrames(2);
      const afterPreparationRecovery = view.readInteractionState().rendering;
      const preparationRecovery = {
        error: preparationError,
        before: beforePreparationFailure.completedDraw,
        after: afterPreparationFailure.completedDraw,
        framesBefore: beforePreparationFailure.frames,
        framesAfter: afterPreparationFailure.frames,
        resumed: afterPreparationRecovery.frames > afterPreparationFailure.frames,
        resumedCursor: afterPreparationRecovery.completedDraw?.cursor,
        expectedCursor: cursor,
      };
      const beforeFailure = calls;
      armed = true;
      await waitFrames(4);
      return {
        modeReferencesChanged: [running, paused, build].every(
          (frame) => frame.metadata.blueprint !== initial.metadata.blueprint,
        ),
        sameAuthoredModeContent: [running, paused, build].every(
          (frame) =>
            JSON.stringify(frame.metadata.blueprint) === JSON.stringify(initial.metadata.blueprint),
        ),
        initialCosts: costs,
        modeReadings,
        activated,
        repeatedFramePreserved,
        equalBlueprintPreserved,
        renameExitsExploded,
        renamedListText,
        drawRecovery: { recovered: calls > beforeFailure + 1, reported },
        preparationRecovery,
      };
    } finally {
      view.dispose();
      host.remove();
      workshop.dispose();
      window.removeEventListener('error', onError);
    }
  });
  // Preserve all counterexample results before individual assertions stop a run.
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify({ ...evidence.identity, ...result, errors: evidence.errors }, null, 2),
  );
  evidence.assert('equal', [result.modeReferencesChanged, true]);
  evidence.assert('equal', [result.sameAuthoredModeContent, true]);
  evidence.assert('ok', [result.initialCosts.length > 0]);
  for (const row of result.modeReadings)
    evidence.assert('deepEqual', [
      row.costs,
      result.initialCosts,
      `${row.mode} must retain unchanged authored-content caches`,
    ]);
  evidence.assert('equal', [result.activated, true]);
  evidence.assert('equal', [result.repeatedFramePreserved, true]);
  evidence.assert('equal', [result.equalBlueprintPreserved, true]);
  evidence.assert('equal', [result.renameExitsExploded, true]);
  evidence.assert('equal', [result.renamedListText, 'Renamed beam']);
  evidence.assert('deepEqual', [
    result.drawRecovery,
    { recovered: true, reported: ['controlled before-draw failure'] },
  ]);
  evidence.assert('equal', [
    result.preparationRecovery.error,
    'controlled render-preparation failure',
  ]);
  evidence.assert('deepEqual', [
    result.preparationRecovery.after,
    result.preparationRecovery.before,
  ]);
  evidence.assert('equal', [
    result.preparationRecovery.framesAfter,
    result.preparationRecovery.framesBefore,
  ]);
  evidence.assert('equal', [result.preparationRecovery.resumed, true]);
  evidence.assert('deepEqual', [
    result.preparationRecovery.resumedCursor,
    result.preparationRecovery.expectedCursor,
  ]);
  evidence.assert('deepEqual', [evidence.errors, []]);
  evidence.assertUnchanged();
  console.log('PASS renderer content identity, inspection retention and draw failure recovery');
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}

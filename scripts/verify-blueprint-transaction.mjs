import { assert } from "./lib/assert.mjs";
import { BlueprintLoadTransaction } from "../src/application/blueprint-load-transaction.js";

function fixture(failure = null) {
  const events = [],
    roots = { editor: { id: "old" }, presentation: { id: "old-view" } },
    fail = (stage) => {
      if (
        failure === stage ||
        (failure === "fatal-recovery" &&
          ["commit-after-editor", "recover"].includes(stage))
      )
        throw new Error(`injected ${stage} failure`);
    },
    transaction = new BlueprintLoadTransaction({
      decode(input) {
        events.push("decode");
        if (failure === "validation")
          return {
            ok: false,
            errors: [{ code: "INVALID", message: "invalid fixture" }],
          };
        fail("decode");
        return { ok: true, value: { input } };
      },
      stageEditor(decoded) {
        events.push("stage-editor");
        fail("stage-editor");
        return { id: `editor:${decoded.input}` };
      },
      stagePresentation(editor, _options, candidate) {
        events.push("stage-presentation");
        candidate.presentation = { id: `view:${editor.id}`, disposed: false };
        fail("stage-presentation");
        return candidate.presentation;
      },
      persist(candidate) {
        events.push("persist");
        if (failure === "persist-before-pointer")
          return {
            ok: false,
            pointerCommitted: false,
            error: new Error("generation failed"),
          };
        if (failure === "persist-after-pointer")
          return {
            ok: false,
            pointerCommitted: true,
            manifestId: "manifest-new",
            error: new Error("post-pointer verification failed"),
          };
        return {
          ok: true,
          pointerCommitted: true,
          manifestId: "manifest-new",
          candidate,
        };
      },
      commit(candidate) {
        events.push("commit");
        roots.editor = candidate.editor;
        fail("commit-after-editor");
        roots.presentation = candidate.presentation;
        fail("commit-after-presentation");
        return {
          value: roots.editor.id,
          disposePrevious: () => events.push("dispose-previous"),
        };
      },
      disposeCandidate(candidate) {
        events.push("dispose-candidate");
        candidate.presentation.disposed = true;
      },
      freeze() {
        events.push("freeze");
      },
      disposeUncertain(candidate) {
        events.push("dispose-uncertain");
        candidate.presentation.disposed = true;
        roots.editor = null;
        roots.presentation = null;
      },
      recover(persistence) {
        events.push(`recover:${persistence.manifestId}`);
        fail("recover");
        roots.editor = { id: "editor:recovered" };
        roots.presentation = { id: "view:recovered" };
        return { ok: true, value: roots.editor.id };
      },
    });
  return { events, roots, transaction };
}

const successful = fixture(),
  success = successful.transaction.execute("machine");
assert.equal(success.ok, true);
assert.equal(success.status, "committed");
assert.deepEqual(successful.events, [
  "decode",
  "stage-editor",
  "stage-presentation",
  "persist",
  "commit",
  "dispose-previous",
]);
assert.equal(successful.roots.editor.id, "editor:machine");

for (const stage of [
  "validation",
  "decode",
  "stage-editor",
  "stage-presentation",
  "persist-before-pointer",
]) {
  const scenario = fixture(stage),
    oldEditor = scenario.roots.editor,
    oldPresentation = scenario.roots.presentation,
    result = scenario.transaction.execute("machine");
  assert.equal(result.ok, false, `${stage} unexpectedly committed`);
  assert.equal(
    scenario.roots.editor,
    oldEditor,
    `${stage} mutated editor root`,
  );
  assert.equal(
    scenario.roots.presentation,
    oldPresentation,
    `${stage} mutated presentation root`,
  );
  if (["stage-presentation", "persist-before-pointer"].includes(stage))
    assert.ok(
      scenario.events.includes("dispose-candidate"),
      `${stage} leaked staged presentation resources`,
    );
}

for (const stage of [
  "persist-after-pointer",
  "commit-after-editor",
  "commit-after-presentation",
]) {
  const scenario = fixture(stage),
    result = scenario.transaction.execute("machine");
  assert.equal(result.ok, true, `${stage} did not recover committed data`);
  assert.equal(result.status, "recovered");
  assert.equal(scenario.roots.editor.id, "editor:recovered");
  assert.equal(scenario.roots.presentation.id, "view:recovered");
  assert.ok(scenario.events.includes("freeze"));
  assert.ok(scenario.events.includes("dispose-uncertain"));
  assert.ok(scenario.events.includes("recover:manifest-new"));
}

const fatal = fixture("fatal-recovery"),
  fatalResult = fatal.transaction.execute("machine");
assert.equal(fatalResult.ok, false);
assert.equal(fatalResult.status, "rejected");
assert.equal(fatalResult.stage, "recovery");
assert.equal(fatalResult.fatal, true);
assert.equal(fatal.roots.editor, null);
assert.equal(fatal.roots.presentation, null);

const cleanupFailure = new BlueprintLoadTransaction({
    decode: () => ({ ok: true, value: {} }),
    stageEditor: () => ({}),
    stagePresentation: () => ({}),
    persist: () => ({
      ok: false,
      pointerCommitted: false,
      error: new Error("generation rejected"),
    }),
    commit: () => ({}),
    disposeCandidate: () => {
      throw "cleanup rejected";
    },
  }).execute("machine"),
  failingRecoveryHooks = new BlueprintLoadTransaction({
    decode: () => ({ ok: true, value: {} }),
    stageEditor: () => ({}),
    stagePresentation: () => ({}),
    persist: () => ({ ok: true, pointerCommitted: true }),
    commit: () => {
      throw "swap rejected";
    },
    freeze: () => {
      throw "freeze rejected";
    },
    disposeUncertain: () => {
      throw "disposal rejected";
    },
    recover: () => ({ ok: false }),
  }).execute("machine"),
  optionalHooks = new BlueprintLoadTransaction({
    decode: () => ({ ok: true, value: {} }),
    stageEditor: () => ({}),
    stagePresentation: () => ({}),
    persist: () => ({ ok: true, pointerCommitted: true, manifestId: "m" }),
    commit: () => undefined,
  }).execute("machine"),
  missingValidationDetails = new BlueprintLoadTransaction({
    decode: () => ({ ok: false }),
  }).execute("machine"),
  noPersistenceResult = new BlueprintLoadTransaction({
    decode: () => ({ ok: true, value: {} }),
    stageEditor: () => ({}),
    stagePresentation: () => ({}),
    persist: () => undefined,
  }).execute("machine");
assert.equal(cleanupFailure.error instanceof AggregateError, true);
assert.equal(cleanupFailure.error.errors.length, 2);
assert.equal(failingRecoveryHooks.fatal, true);
assert.equal(failingRecoveryHooks.error.errors.length, 4);
assert.equal(optionalHooks.ok, true);
assert.equal(optionalHooks.value, undefined);
assert.equal(missingValidationDetails.validationErrors.length, 0);
assert.match(missingValidationDetails.error.message, /rejected/i);
assert.equal(noPersistenceResult.stage, "persistence");

console.log("blueprint load transaction passed every fault-injection boundary");

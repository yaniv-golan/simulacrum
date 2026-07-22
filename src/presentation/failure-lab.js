import { FailureRecorder, ReplayBuffer } from "../model/failure-analysis.js";
import { FailureEffects } from "./failure-effects.js";

function formatForce(force) {
  return force >= 1000
    ? `${(force / 1000).toFixed(1)} kN`
    : `${Math.round(force)} N`;
}

function reportMarkup(report) {
  const event = report.primary;
  if (!event)
    return '<div class="failure-empty"><b>NO FAILURE RECORDED</b><span>Run a test or use single-step to inspect the machine under load.</span></div>';
  return `<div class="failure-title"><i class="${event.mode}"></i><div><small>ROOT CAUSE · ${event.mode.toUpperCase()} · T+${event.timeS.toFixed(3)} S${report.eventCount > 1 ? ` · ${report.eventCount} FAILURE EVENTS` : ""}</small><h3>${event.partA.name} ↔ ${event.partB.name}</h3><p>${event.reason}</p></div></div><div class="failure-metrics"><span><b>${formatForce(event.load.peakN)}</b><small>PEAK LOAD</small></span><span><b>${formatForce(event.load.ratedN)}</b><small>RATED LOAD</small></span><span><b>${event.load.ratedN ? `${(event.load.utilization * 100).toFixed(0)}%` : "—"}</b><small>UTILIZATION</small></span><span><b>${event.detachedPartIds.length}</b><small>DETACHED</small></span></div><div class="causal-chain"><small>CAUSAL CHAIN</small>${event.causalChain.map((entry, index) => `<div><i>${index + 1}</i><span><b>${entry.label}</b><em>${entry.value}</em></span></div>`).join("")}</div>`;
}

/** Owns post-mortem, exact-step, replay UI, and failure presentation effects. */
export function installFailureLab({
  root = document,
  effectsParent,
  catalog,
  getLiveTelemetry,
  isRunning,
  isPaused,
  setPaused,
  stepLive,
  presentTelemetry,
  resetSimulation,
  notify = (_message) => {},
}) {
  const $ = (selector) => root.querySelector(selector),
    recorder = new FailureRecorder({ catalog }),
    replay = new ReplayBuffer({
      seconds: 12,
      sampleHz: 30,
      postFailureSeconds: 0.75,
    }),
    visualEffects = new FailureEffects({ parent: effectsParent });
  $("#sim-pause").insertAdjacentHTML(
    "afterend",
    '<button id="sim-step" title="Advance one exact 1/120-second physics step (.)">▸│</button><button id="failure-report" title="Open failure report" disabled>!</button><button id="instant-replay" title="Open instant replay" disabled>↶</button>',
  );
  $("#blueprint-btn").insertAdjacentHTML(
    "afterend",
    '<button id="failure-report-tool" disabled>⚠ <span>FAILURE REPORT<em>Loads, causes & replay</em></span></button>',
  );
  root
    .querySelector(".shell")
    .insertAdjacentHTML(
      "beforeend",
      `<section class="failure-lab glass hidden"><div class="failure-lab-head"><div><small>TEST ANALYSIS</small><h2>Failure post-mortem</h2></div><button id="close-failure-lab" aria-label="Close failure analysis">×</button></div><div class="failure-live-state"><i></i><span id="failure-state-label">LIVE TEST</span><output id="failure-time-label">T+0.000 S</output></div><div class="failure-report-body"></div><div class="replay-deck hidden"><div class="replay-readout"><b>INSTANT REPLAY</b><span id="replay-clock">0.00 / 0.00 s</span></div><input id="replay-scrubber" type="range" min="0" max="0" value="0" step="1"><div class="replay-controls"><button id="replay-start" title="First recorded frame">|◀</button><button id="replay-back" title="Previous recorded frame">◀</button><button id="replay-play" title="Play/pause replay">▶</button><button id="replay-forward" title="Next recorded frame">▶</button><button id="replay-end" title="Last recorded frame">▶|</button></div></div><div class="failure-lab-actions"><button id="replay-failure">REPLAY FAILURE</button><button id="return-live" class="hidden">RETURN TO LIVE</button><button id="reset-from-report">RESET TEST</button></div></section>`,
    );
  const panel = $(".failure-lab"),
    reportBody = $(".failure-report-body"),
    replayDeck = $(".replay-deck"),
    scrubber = $("#replay-scrubber");
  let replayActive = false,
    replayPlaying = false,
    replayCursor = 0,
    replayAccumulator = 0,
    autoPauseAt = null,
    replayEffectShown = false,
    runActive = false,
    surfacesStashed = false,
    remoteWasHidden = true,
    driveWasHidden = true;

  function stashOverlappingSurfaces() {
    if (surfacesStashed) return;
    const remote = $(".remote-console"),
      drive = $(".drive-hud");
    remoteWasHidden = !remote || remote.classList.contains("hidden");
    driveWasHidden = !drive || drive.classList.contains("hidden");
    remote?.classList.add("hidden");
    drive?.classList.add("hidden");
    surfacesStashed = true;
  }

  function restoreOverlappingSurfaces() {
    if (!surfacesStashed) return;
    if (!remoteWasHidden) $(".remote-console")?.classList.remove("hidden");
    if (!driveWasHidden) $(".drive-hud")?.classList.remove("hidden");
    surfacesStashed = false;
  }

  function syncButtons() {
    const hasReport = recorder.report().eventCount > 0,
      hasReplay = replay.frames.length > 1;
    $("#failure-report").disabled = !hasReport;
    $("#failure-report-tool").disabled = !hasReport;
    $("#instant-replay").disabled = !hasReplay;
    $("#replay-failure").disabled = !hasReplay;
  }

  function renderReport() {
    const report = recorder.report();
    reportBody.innerHTML = reportMarkup(report);
    $("#failure-time-label").textContent = report.primary
      ? `T+${report.primary.timeS.toFixed(3)} S`
      : `T+${(getLiveTelemetry()?.time || 0).toFixed(3)} S`;
    syncButtons();
  }

  function openReport() {
    stashOverlappingSurfaces();
    panel.classList.remove("hidden");
    renderReport();
  }

  function closeReport() {
    if (replayActive) exitReplay();
    panel.classList.add("hidden");
    restoreOverlappingSurfaces();
  }

  function showReplayFrame(index) {
    if (!replay.frames.length) return;
    replayCursor = Math.max(0, Math.min(replay.frames.length - 1, index));
    const frame = replay.frame(replayCursor),
      start = replay.frames[0].time,
      end = replay.frames.at(-1).time;
    presentTelemetry(frame.telemetry, { replay: true });
    if (
      !replayEffectShown &&
      replay.failureTime != null &&
      frame.time >= replay.failureTime &&
      recorder.report().primary
    ) {
      replayEffectShown = true;
      visualEffects.trigger(recorder.report().primary);
    }
    scrubber.value = String(replayCursor);
    $("#replay-clock").textContent =
      `${(frame.time - start).toFixed(2)} / ${(end - start).toFixed(2)} s`;
  }

  function failureCursor() {
    if (replay.failureTime == null || !replay.frames.length) return null;
    const index = replay.frames.findIndex(
      (frame) => frame.time + 1e-6 >= replay.failureTime,
    );
    return index < 0 ? replay.frames.length - 1 : index;
  }

  function enterReplay() {
    if (replay.frames.length < 2 || !isRunning()) return;
    setPaused(true);
    replayActive = true;
    replayPlaying = true;
    replayAccumulator = 0;
    replayEffectShown = false;
    openReport();
    panel.classList.add("replay-active");
    replayDeck.classList.remove("hidden");
    $("#return-live").classList.remove("hidden");
    $("#failure-state-label").textContent = "RECORDED TELEMETRY · READ ONLY";
    scrubber.max = String(replay.frames.length - 1);
    const failureTime = replay.failureTime ?? replay.frames.at(-1).time,
      startIndex = replay.frames.findIndex(
        (frame) => frame.time >= failureTime - 6,
      );
    showReplayFrame(startIndex < 0 ? 0 : startIndex);
    $("#replay-play").textContent = "Ⅱ";
  }

  function exitReplay() {
    replayActive = false;
    replayPlaying = false;
    panel.classList.remove("replay-active");
    replayDeck.classList.add("hidden");
    $("#return-live").classList.add("hidden");
    $("#failure-state-label").textContent = isPaused()
      ? "LIVE TEST · PAUSED"
      : "LIVE TEST";
    const live = getLiveTelemetry();
    if (live) presentTelemetry(live, { replay: false });
    renderReport();
  }

  function beginRun() {
    recorder.reset();
    replay.reset();
    visualEffects.clear();
    replayActive = false;
    replayPlaying = false;
    autoPauseAt = null;
    runActive = true;
    panel.classList.add("hidden");
    restoreOverlappingSurfaces();
    panel.classList.remove("replay-active");
    syncButtons();
  }

  function endRun() {
    runActive = false;
    replayActive = false;
    replayPlaying = false;
    visualEffects.clear();
    panel.classList.add("hidden");
    panel.classList.remove("replay-active");
    restoreOverlappingSurfaces();
    replayDeck.classList.add("hidden");
    $("#return-live").classList.add("hidden");
    syncButtons();
  }

  function record(telemetry, { force = false } = {}) {
    if (!runActive || replayActive || !telemetry) return [];
    replay.record(telemetry, { force });
    const previousDetached =
        recorder.report().primary?.detachedPartIds.length || 0,
      created = recorder.ingest(telemetry);
    if (
      !created.length &&
      !panel.classList.contains("hidden") &&
      (recorder.report().primary?.detachedPartIds.length || 0) !==
        previousDetached
    )
      renderReport();
    for (const event of created) {
      replay.pinFailure(event.timeS);
      visualEffects.trigger(event);
      autoPauseAt ??= event.timeS + 0.75;
    }
    if (created.length) {
      openReport();
      const root = created[0],
        cascade = created.length > 1 ? ` · +${created.length - 1} cascade` : "";
      notify(
        `ROOT FAILURE · ${root.partA.name} ↔ ${root.partB.name}${cascade}`,
      );
    }
    if (autoPauseAt != null && telemetry.time >= autoPauseAt && !isPaused()) {
      setPaused(true);
      autoPauseAt = null;
      $("#failure-state-label").textContent = "LIVE TEST · AUTO-PAUSED";
    }
    syncButtons();
    return created;
  }

  function update(dt) {
    visualEffects.update(dt);
    if (!replayActive || !replayPlaying) return;
    replayAccumulator += dt;
    while (replayAccumulator >= 1 / replay.sampleHz) {
      replayAccumulator -= 1 / replay.sampleHz;
      if (replayCursor >= replay.frames.length - 1) {
        replayPlaying = false;
        $("#replay-play").textContent = "▶";
        break;
      }
      showReplayFrame(replayCursor + 1);
    }
  }

  $("#sim-step").onclick = () => stepLive();
  $("#failure-report").onclick = openReport;
  $("#failure-report-tool").onclick = openReport;
  $("#instant-replay").onclick = enterReplay;
  $("#replay-failure").onclick = enterReplay;
  $("#close-failure-lab").onclick = closeReport;
  $("#return-live").onclick = exitReplay;
  $("#reset-from-report").onclick = () => {
    closeReport();
    resetSimulation();
  };
  $("#replay-start").onclick = () => showReplayFrame(0);
  $("#replay-back").onclick = () => showReplayFrame(replayCursor - 1);
  $("#replay-forward").onclick = () => showReplayFrame(replayCursor + 1);
  $("#replay-end").onclick = () => showReplayFrame(replay.frames.length - 1);
  $("#replay-play").onclick = () => {
    replayPlaying = !replayPlaying;
    $("#replay-play").textContent = replayPlaying ? "Ⅱ" : "▶";
  };
  scrubber.oninput = () => showReplayFrame(Number(scrubber.value));

  return {
    beginRun,
    endRun,
    enterReplay,
    openReport,
    record,
    update,
    snapshot() {
      const report = recorder.report();
      return {
        open: !panel.classList.contains("hidden"),
        report: {
          ...report,
          timeline: report.timeline.map((event) => ({
            id: event.id,
            timeS: event.timeS,
            mode: event.mode,
            connectionId: event.connectionId,
            reason: event.reason,
          })),
        },
        replay: {
          ...replay.snapshot(),
          active: replayActive,
          playing: replayPlaying,
          cursor: replayCursor,
          failureCursor: failureCursor(),
        },
        effects: visualEffects.snapshot(),
      };
    },
  };
}

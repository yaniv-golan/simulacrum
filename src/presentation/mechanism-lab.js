import { fingerprintExperimentBlueprint } from "../model/mechanism-artifact-identity.js";
import { stableStringify } from "../model/primitives.js";
import { sha256Hex } from "../model/sha256.js";
import { projectMechanismTelemetryChannels } from "./mechanism-telemetry-channels.js";
import { escapeHtml as escapeMarkup } from "./html.js";
const jsonCompatible = (value) => JSON.parse(JSON.stringify(value));

function differenceCount(left, right) {
  const a = stableStringify(left),
    b = stableStringify(right);
  if (a === b) return 0;
  let count = Math.abs(a.length - b.length);
  for (let index = 0; index < Math.min(a.length, b.length); index++)
    if (a[index] !== b[index]) count++;
  return count;
}

function plotMarkup(channelId, samples) {
  if (samples.length < 2) return "";
  const values = samples.map(({ value }) => value),
    minimum = Math.min(...values),
    maximum = Math.max(...values),
    range = Math.max(1e-12, maximum - minimum),
    points = samples
      .map(
        ({ value }, index) =>
          `${(index / (samples.length - 1)) * 100},${28 - ((value - minimum) / range) * 24}`,
      )
      .join(" ");
  return `<figure><figcaption>${escapeMarkup(channelId)} · ${minimum.toPrecision(4)} to ${maximum.toPrecision(4)}</figcaption><svg viewBox="0 0 100 32" role="img" aria-label="Recent values for ${escapeMarkup(channelId)}"><polyline points="${points}" /></svg></figure>`;
}

/** Accessible compiler, telemetry, comparison, checkpoint and proof workbench. */
export function installMechanismLab({
  root = document,
  getTelemetry,
  getSession,
  getCompiled,
  getBlueprint,
  getRuntime,
  selectPart,
  commands,
  afterRestore,
  createExperiment,
  notify,
}) {
  const $ = (selector) => root.querySelector(selector);
  $("#failure-report-tool").insertAdjacentHTML(
    "afterend",
    '<button id="mechanism-lab-tool" role="menuitem">⌁ <span>MECHANISM LAB<em>Diagnostics, telemetry & proof</em></span></button>',
  );
  const shell = root.querySelector(".shell");
  shell.insertAdjacentHTML(
    "beforeend",
    `<section class="mechanism-lab glass hidden" aria-labelledby="mechanism-lab-title"><header><div><small>PHYSICAL DESIGN WORKBENCH</small><h2 id="mechanism-lab-title">Mechanism Lab</h2></div><button id="close-mechanism-lab" aria-label="Close Mechanism Lab">×</button></header><div class="mechanism-lab-live" role="status" aria-live="polite"></div><section aria-labelledby="mechanism-transport-title"><h3 id="mechanism-transport-title">DETERMINISTIC TRANSPORT</h3><div class="mechanism-lab-actions"><button data-lab-command="run">RUN / STOP</button><button data-lab-command="pause">PAUSE / RESUME</button><button data-lab-command="step">STEP 1/120 S</button><button data-lab-command="reset">RUN FROM START</button></div><div id="mechanism-session-state"></div></section><section aria-labelledby="mechanism-diagnostics-title"><h3 id="mechanism-diagnostics-title">COMPILER DIAGNOSTICS</h3><div id="mechanism-diagnostics"></div></section><section aria-labelledby="mechanism-channels-title"><h3 id="mechanism-channels-title">CANONICAL CHANNELS</h3><label>SEARCH CHANNELS <input id="mechanism-channel-search" type="search" value="force contact travel energy" aria-describedby="mechanism-channel-help"></label><p id="mechanism-channel-help">Space-separated terms select force, contact, travel, and energy channels. Clear to inspect every numeric channel.</p><div id="mechanism-channel-table"></div><div id="mechanism-plots"></div></section><section aria-labelledby="mechanism-compare-title"><h3 id="mechanism-compare-title">RUN A/B COMPARISON</h3><div class="mechanism-lab-actions"><button id="mechanism-pin-run">PIN CURRENT AS RUN A</button><button id="mechanism-compare-run">COMPARE CURRENT AS RUN B</button></div><div id="mechanism-comparison"></div></section><section aria-labelledby="mechanism-proof-title"><h3 id="mechanism-proof-title">CHECKPOINT AND EXPERIMENT PROOF</h3><div class="mechanism-lab-actions"><button id="mechanism-capture-proof">CAPTURE COMMITTED CHECKPOINT</button><button id="mechanism-restore-proof" disabled>RESTORE CHECKPOINT</button><button id="mechanism-copy-proof" disabled>COPY EXPERIMENT JSON</button></div><div id="mechanism-proof"></div></section></section>`,
  );
  const panel = $(".mechanism-lab"),
    histories = new Map();
  let channels = [],
    pinnedChannelIds = [],
    baseline = null,
    checkpoint = null,
    experiment = null,
    restoreResult = null;

  function sessionState() {
    const session = getSession(),
      entries = session?.context?.commandBus?.entries?.(),
      state = session?.exportState?.();
    return {
      mode: !session ? "stopped" : commands.paused() ? "paused" : "running",
      tick: session?.context?.clock?.tick || 0,
      timeS: session?.time || 0,
      fixedDtS: session?.fixedDt || 1 / 120,
      pendingInputCount: entries
        ? entries.remote.length + entries.script.length
        : 0,
      deterministicDigest: state
        ? sha256Hex(stableStringify(jsonCompatible(state)))
        : null,
    };
  }

  function renderSession() {
    const sessionSnapshot = sessionState();
    $("#mechanism-session-state").innerHTML =
      `<dl><div><dt>MODE</dt><dd>${sessionSnapshot.mode}</dd></div><div><dt>COMMITTED TICK</dt><dd>${sessionSnapshot.tick}</dd></div><div><dt>TIME</dt><dd>${sessionSnapshot.timeS.toFixed(6)} s</dd></div><div><dt>FIXED DT</dt><dd>${sessionSnapshot.fixedDtS} s</dd></div><div><dt>PENDING INPUTS</dt><dd>${sessionSnapshot.pendingInputCount}</dd></div><div><dt>STATE DIGEST</dt><dd><code>${sessionSnapshot.deterministicDigest || "not running"}</code></dd></div></dl>`;
    $(".mechanism-lab-live").textContent =
      `${sessionSnapshot.mode}; committed tick ${sessionSnapshot.tick}; ${sessionSnapshot.pendingInputCount} pending inputs`;
  }

  function renderDiagnostics() {
    const diagnostics = getCompiled().diagnostics;
    $("#mechanism-diagnostics").innerHTML = diagnostics.length
      ? `<ol>${diagnostics.map((item) => `<li class="${item.severity}"><b>${escapeMarkup(item.severity.toUpperCase())} · ${escapeMarkup(item.code)}</b><p>${escapeMarkup(item.message)}</p><dl><div><dt>SOURCE</dt><dd>${escapeMarkup(item.sourceProvenance.authoredPath.join("."))}</dd></div><div><dt>INVOLVED</dt><dd>${escapeMarkup(item.involvedDescriptorIds.join(", "))}</dd></div><div><dt>SOLVER / RESIDUAL</dt><dd>${escapeMarkup(item.residualDetail)}</dd></div><div><dt>REMEDY</dt><dd>${escapeMarkup(item.remedy)}</dd></div></dl>${item.partId != null ? `<button data-diagnostic-part="${item.partId}">JUMP TO PART #${item.partId}</button>` : ""}</li>`).join("")}</ol>`
      : '<p class="mechanism-ok">No compile diagnostics. The ordinary authored topology compiled cleanly.</p>';
    panel.querySelectorAll("[data-diagnostic-part]").forEach((button) => {
      button.onclick = () => {
        selectPart(Number(button.dataset.diagnosticPart));
        close();
        notify(`Selected source part #${button.dataset.diagnosticPart}`);
      };
    });
  }

  function visibleChannels() {
    const terms = $("#mechanism-channel-search")
      .value.toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return channels
      .filter((channel) =>
        !terms.length
          ? true
          : terms.some((term) =>
              channel.channelId.toLowerCase().includes(term),
            ),
      )
      .slice(0, 100);
  }

  function renderChannels() {
    const visible = visibleChannels();
    $("#mechanism-channel-table").innerHTML =
      `<table><caption>${visible.length} canonical completed-tick samples</caption><thead><tr><th>CHANNEL / OWNER</th><th>FRAME</th><th>TICK</th><th>VALUE</th><th>FLAGS</th><th></th></tr></thead><tbody>${visible.map((channel) => `<tr><th scope="row"><code>${escapeMarkup(channel.channelId)}</code><small>${escapeMarkup(channel.owner)}${channel.bodyOrPartId == null ? "" : ` · #${channel.bodyOrPartId}`}</small></th><td>${escapeMarkup(channel.coordinateFrame)}</td><td>${channel.tick}</td><td>${Number(channel.value).toPrecision(7)} ${escapeMarkup(channel.unit)}</td><td>${channel.valid ? "valid" : "invalid"}${channel.saturated ? " · saturated" : ""}</td><td><button data-pin-channel="${escapeMarkup(channel.channelId)}" aria-pressed="${pinnedChannelIds.includes(channel.channelId)}">PLOT</button><button data-copy-channel="${escapeMarkup(channel.channelId)}">COPY</button></td></tr>`).join("")}</tbody></table>`;
    panel.querySelectorAll("[data-pin-channel]").forEach((button) => {
      button.onclick = () => {
        const id = button.dataset.pinChannel;
        pinnedChannelIds = pinnedChannelIds.includes(id)
          ? pinnedChannelIds.filter((candidate) => candidate !== id)
          : [...pinnedChannelIds, id].slice(-4);
        renderChannels();
      };
    });
    panel.querySelectorAll("[data-copy-channel]").forEach((button) => {
      button.onclick = async () => {
        const channel = channels.find(
          ({ channelId }) => channelId === button.dataset.copyChannel,
        );
        if (!channel) return;
        await navigator.clipboard?.writeText(
          `${channel.channelId}\t${channel.tick}\t${channel.value}\t${channel.unit}`,
        );
        notify(`Copied ${channel.channelId}`);
      };
    });
    $("#mechanism-plots").innerHTML = pinnedChannelIds
      .map((id) => plotMarkup(id, histories.get(id) || []))
      .join("");
  }

  function runSnapshot() {
    const blueprint = getBlueprint(),
      sessionSnapshot = sessionState(),
      metricChannels = channels.filter(({ channelId }) =>
        /force|contact|travel|energy|acceleration/i.test(channelId),
      );
    return {
      runId: `run-${sessionSnapshot.tick}-${sessionSnapshot.deterministicDigest?.slice(0, 12) || "stopped"}`,
      blueprint,
      blueprintFingerprint: fingerprintExperimentBlueprint(blueprint),
      runConfigurationFingerprint:
        getRuntime().runIdentity?.runConfigurationFingerprint || null,
      tick: sessionSnapshot.tick,
      metrics: Object.fromEntries(
        metricChannels.map(({ channelId, value }) => [channelId, value]),
      ),
    };
  }

  function renderComparison(comparison = null) {
    if (!comparison) {
      $("#mechanism-comparison").textContent = baseline
        ? `Run A pinned: ${baseline.runId}`
        : "No baseline pinned.";
      return;
    }
    $("#mechanism-comparison").innerHTML =
      `<dl><div><dt>RUN A</dt><dd>${escapeMarkup(baseline.runId)}</dd></div><div><dt>RUN B</dt><dd>${escapeMarkup(comparison.runId)}</dd></div><div><dt>DESIGN A</dt><dd><code>${baseline.blueprintFingerprint}</code></dd></div><div><dt>DESIGN B</dt><dd><code>${comparison.blueprintFingerprint}</code></dd></div><div><dt>RUN CONFIG A / B</dt><dd><code>${baseline.runConfigurationFingerprint || "not running"}</code><br><code>${comparison.runConfigurationFingerprint || "not running"}</code></dd></div><div><dt>PARAMETER BYTE DELTA</dt><dd>${differenceCount(baseline.blueprint, comparison.blueprint)}</dd></div><div><dt>METRIC DELTAS</dt><dd>${escapeMarkup(
        stableStringify(
          Object.fromEntries(
            Object.entries(comparison.metrics)
              .slice(0, 12)
              .map(([key, value]) => [
                key,
                value - (baseline.metrics[key] || 0),
              ]),
          ),
        ),
      )}</dd></div></dl>`;
  }

  function renderProof() {
    $("#mechanism-restore-proof").disabled = !checkpoint;
    $("#mechanism-copy-proof").disabled = !experiment;
    $("#mechanism-proof").innerHTML = experiment
      ? `<dl><div><dt>ARTIFACT</dt><dd>simulacrum-experiment v1 · resumable checkpoint</dd></div><div><dt>ENGINE / CONFIG</dt><dd><code>${experiment.runConfiguration.identities.engine.id}@${experiment.runConfiguration.identities.engine.version}</code><br><code>${experiment.inputTrace.runConfigurationFingerprint}</code></dd></div><div><dt>TICKS</dt><dd>${experiment.startTick} → ${experiment.endTick}</dd></div><div><dt>EXTERNAL INPUTS</dt><dd>${experiment.inputTrace.inputs.length}</dd></div><div><dt>CHECKPOINT STATE</dt><dd><code>${checkpoint.stateDigest}</code></dd></div><div><dt>MANIFEST</dt><dd><code>${experiment.manifestDigest}</code></dd></div><div><dt>RESTORE PROOF</dt><dd>${escapeMarkup(restoreResult || "not restored yet")}</dd></div></dl>`
      : "No experiment captured. Start a run and capture a committed tick.";
  }

  function refresh() {
    channels = projectMechanismTelemetryChannels(
      getTelemetry(),
      getSession()?.context?.clock?.tick || 0,
    );
    renderSession();
    renderDiagnostics();
    renderChannels();
    renderComparison();
    renderProof();
  }

  function open() {
    panel.classList.remove("hidden");
    shell.classList.add("mechanism-lab-open");
    refresh();
    $("#close-mechanism-lab").focus();
  }

  function close() {
    panel.classList.add("hidden");
    shell.classList.remove("mechanism-lab-open");
    $("#tools-btn").focus();
  }

  $("#mechanism-lab-tool").onclick = open;
  $("#close-mechanism-lab").onclick = close;
  $("#mechanism-channel-search").oninput = renderChannels;
  panel.querySelectorAll("[data-lab-command]").forEach((button) => {
    button.onclick = () => {
      commands[button.dataset.labCommand]?.();
      refresh();
    };
  });
  $("#mechanism-pin-run").onclick = () => {
    baseline = runSnapshot();
    renderComparison();
    notify(`Pinned ${baseline.runId} as run A`);
  };
  $("#mechanism-compare-run").onclick = () => {
    if (!baseline) return notify("Pin run A before comparing run B");
    renderComparison(runSnapshot());
  };
  $("#mechanism-capture-proof").onclick = async (event) => {
    const runtime = getRuntime();
    if (!runtime.prepareCheckpointCoordinator || !runtime.runIdentity)
      return notify("Start the simulation before capturing an experiment");
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const coordinator = await runtime.prepareCheckpointCoordinator(),
        captured = coordinator.capture(runtime.runIdentity),
        exported = await createExperiment({
          blueprint: getBlueprint(),
          runConfiguration: runtime.runIdentity.configuration,
          checkpoint: captured,
        });
      checkpoint = captured;
      experiment = exported;
      restoreResult = null;
      renderProof();
      notify(
        `Captured committed checkpoint at tick ${checkpoint.committedTick}`,
      );
    } catch (error) {
      notify(
        `Experiment capture failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      button.disabled = false;
    }
  };
  $("#mechanism-restore-proof").onclick = () => {
    const runtime = getRuntime();
    if (!checkpoint || !runtime.checkpointCoordinator || !runtime.runIdentity)
      return;
    runtime.checkpointCoordinator.restore(checkpoint, runtime.runIdentity);
    const recaptured = runtime.checkpointCoordinator.capture(
      runtime.runIdentity,
    );
    restoreResult =
      recaptured.stateDigest === checkpoint.stateDigest
        ? "exact state digest match"
        : "digest mismatch";
    afterRestore();
    refresh();
    notify(`Checkpoint restored: ${restoreResult}`);
  };
  $("#mechanism-copy-proof").onclick = async () => {
    if (!experiment) return;
    await navigator.clipboard?.writeText(stableStringify(experiment));
    notify("Copied strict experiment JSON");
  };

  return Object.freeze({
    open,
    refresh,
    recordTelemetry(telemetry) {
      // The lab is a demand-driven diagnostics surface. Traversing and sorting
      // every numeric telemetry leaf while the panel is closed duplicates the
      // simulation read model for no visible consumer.
      if (panel.classList.contains("hidden")) return;
      const tick = getSession()?.context?.clock?.tick || 0;
      channels = projectMechanismTelemetryChannels(telemetry, tick);
      for (const channel of channels) {
        const history = histories.get(channel.channelId) || [];
        history.push({ tick, value: channel.value });
        if (history.length > 120) history.shift();
        histories.set(channel.channelId, history);
      }
      if (!panel.classList.contains("hidden") && tick % 6 === 0) {
        renderSession();
        renderChannels();
      }
    },
    snapshot() {
      return {
        open: !panel.classList.contains("hidden"),
        session: sessionState(),
        channelCount: channels.length,
        pinnedChannelIds: [...pinnedChannelIds],
        baseline: baseline
          ? {
              runId: baseline.runId,
              blueprintFingerprint: baseline.blueprintFingerprint,
              runConfigurationFingerprint: baseline.runConfigurationFingerprint,
            }
          : null,
        experiment: experiment
          ? {
              format: experiment.format,
              version: experiment.version,
              startTick: experiment.startTick,
              endTick: experiment.endTick,
              inputCount: experiment.inputTrace.inputs.length,
              manifestDigest: experiment.manifestDigest,
              checkpointStateDigest: checkpoint.stateDigest,
              restoreResult,
            }
          : null,
      };
    },
  });
}

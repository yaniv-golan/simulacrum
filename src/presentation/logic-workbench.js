import {
  DEFAULT_VISUAL_PROGRAM,
  normalizeVisualProgram,
  VISUAL_NODE_TYPES,
} from "../model/visual-logic.js";
import { escapeHtml as escape } from "./html.js";

const OPERATIONS = Object.freeze({
  math: [
    ["add", "ADD"],
    ["sub", "SUBTRACT"],
    ["mul", "MULTIPLY"],
    ["div", "DIVIDE"],
  ],
  compare: [
    ["gt", ">"],
    ["gte", "≥"],
    ["lt", "<"],
    ["lte", "≤"],
    ["eq", "="],
  ],
});

function options(values, selected) {
  return values
    .map(
      ([value, label]) =>
        `<option value="${escape(value)}"${value === selected ? " selected" : ""}>${escape(label)}</option>`,
    )
    .join("");
}

function nodeField(node, sensors, channels) {
  if (node.type === "sensor")
    return `<label>INPUT BINDING<select data-node-field="bindingId">${options(
      sensors.map((sensor) => [
        sensor.instanceKey || sensor.key,
        `${sensor.label} · ${sensor.unit}`,
      ]),
      node.bindingId,
    )}</select></label>`;
  if (node.type === "constant")
    return `<label>VALUE<input data-node-field="value" type="number" step="0.05" value="${Number(node.value) || 0}"></label>`;
  if (OPERATIONS[node.type])
    return `<label>OPERATION<select data-node-field="op">${options(OPERATIONS[node.type], node.op)}</select></label>`;
  if (node.type === "clamp")
    return `<div class="logic-inline"><label>MIN<input data-node-field="min" type="number" step="0.1" value="${Number(node.min ?? -1)}"></label><label>MAX<input data-node-field="max" type="number" step="0.1" value="${Number(node.max ?? 1)}"></label></div>`;
  if (node.type === "output")
    return `<label>OUTPUT BINDING<select data-node-field="bindingId">${options(
      channels.map((channel) => [channel, channel.toUpperCase()]),
      node.bindingId,
    )}</select></label>`;
  return '<span class="logic-node-note">IF · TRUE · FALSE</span>';
}

function tracePath(values, width = 300, height = 72) {
  if (!values.length) return "";
  const numbers = values.map((sample) => Number(sample.value) || 0),
    minimum = Math.min(...numbers),
    maximum = Math.max(...numbers),
    span = Math.max(1e-6, maximum - minimum);
  return numbers
    .map((value, index) => {
      const x = (index / Math.max(1, numbers.length - 1)) * width,
        y = height - ((value - minimum) / span) * (height - 8) - 4;
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Owns visual-program and debugger presentation; it never executes commands. */
export function installLogicWorkbench({
  getProgram,
  setProgram,
  getSensors,
  getChannels,
  getBindings,
  getBindingOptions,
  setBindings,
  getDebug,
  setWatches,
  setBreakpoint,
  clearTrace,
  stepSimulation,
  toggleSimulation,
}) {
  const root = /** @type {HTMLElement} */ (
      document.querySelector(".wasm-console")
    ),
    element = (selector) =>
      /** @type {HTMLElement} */ (root.querySelector(selector)),
    input = (selector) =>
      /** @type {HTMLInputElement} */ (root.querySelector(selector)),
    closestElement = (target, selector) =>
      /** @type {HTMLElement | null} */ (target.closest(selector)),
    nodeLayer = element(".logic-nodes"),
    wireLayer = element(".logic-wires"),
    sensorList = element(".logic-sensor-list"),
    scope = element(".logic-scope"),
    variables = element(".logic-variables"),
    breakpointName = /** @type {HTMLSelectElement} */ (
      root.querySelector("#logic-breakpoint-name")
    ),
    breakpointOperator = /** @type {HTMLSelectElement} */ (
      root.querySelector("#logic-breakpoint-op")
    ),
    breakpointValue = input("#logic-breakpoint-value");
  let program = normalizeVisualProgram(DEFAULT_VISUAL_PROGRAM),
    drag = null;

  const bindingKey = (binding) =>
    JSON.stringify([
      binding.direction,
      binding.endpointPartId,
      binding.endpointPortId,
      binding.reading || binding.channel,
    ]);

  function renderBindings() {
    const bindings = getBindings(),
      candidates = getBindingOptions(),
      list = element(".controller-binding-list");
    list.innerHTML = bindings.length
      ? bindings
          .map((binding, index) => {
            const matching = candidates.some(
                (candidate) => bindingKey(candidate) === bindingKey(binding),
              ),
              optionsForDirection = candidates.filter(
                (candidate) => candidate.direction === binding.direction,
              );
            return `<div class="controller-binding-row ${matching ? "online" : "offline"}" data-binding-index="${index}"><i></i><label>ALIAS<input data-binding-alias value="${escape(binding.id)}" aria-label="Binding alias"></label><label>PHYSICAL ENDPOINT<select data-binding-endpoint>${options(
              optionsForDirection.map((candidate) => [
                bindingKey(candidate),
                candidate.label,
              ]),
              bindingKey(binding),
            )}</select></label><small>${matching ? "ROUTE VALID" : "ROUTE INVALID — RECONNECT OR REBIND"}</small><button data-remove-binding aria-label="Remove binding">×</button></div>`;
          })
          .join("")
      : '<p class="controller-binding-empty">Add a sensor or actuator binding. Unbound programs have no physical I/O authority.</p>';
  }

  element(".controller-binding-editor").addEventListener("change", (event) => {
    const target = /** @type {HTMLInputElement|HTMLSelectElement} */ (
        event.target
      ),
      row = closestElement(target, "[data-binding-index]"),
      index = Number(row?.dataset.bindingIndex),
      bindings = getBindings();
    if (!Number.isInteger(index) || !bindings[index]) return;
    if (target.matches("[data-binding-alias]"))
      bindings[index].id = target.value.trim();
    if (target.matches("[data-binding-endpoint]")) {
      const option = getBindingOptions().find(
        (candidate) => bindingKey(candidate) === target.value,
      );
      if (option) bindings[index] = { id: bindings[index].id, ...option };
    }
    setBindings(bindings);
    refresh();
  });
  element(".controller-binding-editor").addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target),
      remove = closestElement(target, "[data-remove-binding]"),
      add = closestElement(target, "[data-add-controller-binding]");
    if (remove) {
      const row = closestElement(remove, "[data-binding-index]"),
        index = Number(row?.dataset.bindingIndex),
        bindings = getBindings();
      if (Number.isInteger(index)) bindings.splice(index, 1);
      setBindings(bindings);
      refresh();
      return;
    }
    if (!add) return;
    const direction = add.dataset.addControllerBinding,
      option = getBindingOptions().find(
        (candidate) => candidate.direction === direction,
      );
    if (!option) return;
    const bindings = getBindings(),
      prefix = direction === "input" ? "sensor" : "actuator";
    let suffix = bindings.length + 1,
      id = `${prefix}.${suffix}`;
    while (bindings.some((binding) => binding.id === id))
      id = `${prefix}.${++suffix}`;
    bindings.push({ id, ...option });
    setBindings(bindings);
    refresh();
  });

  function commit(next = program) {
    program = normalizeVisualProgram(next);
    setProgram(structuredClone(program));
    renderGraph();
  }

  function linkFor(target, input) {
    return program.links.find(
      (link) => link.to === target && link.input === input,
    );
  }

  function renderWires() {
    const byId = new Map(program.nodes.map((node) => [node.id, node]));
    wireLayer.innerHTML = program.links
      .map((link) => {
        const source = byId.get(link.from),
          target = byId.get(link.to);
        if (!source || !target) return "";
        const x1 = source.x + 184,
          y1 = source.y + 52,
          x2 = target.x,
          y2 = target.y + 72 + link.input * 30,
          bend = Math.max(45, (x2 - x1) * 0.48);
        return `<path d="M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}" />`;
      })
      .join("");
  }

  function renderGraph() {
    const sensors = getSensors(),
      channels = getChannels();
    nodeLayer.innerHTML = program.nodes
      .map((node) => {
        const type = VISUAL_NODE_TYPES[node.type],
          inputRows = Array.from({ length: type.inputs }, (_, input) => {
            const linked = linkFor(node.id, input)?.from || "";
            return `<label class="logic-input"><i></i><span>IN ${input + 1}</span><select data-link-input="${input}"><option value="">0 · UNCONNECTED</option>${options(
              program.nodes
                .filter(
                  (candidate) =>
                    candidate.id !== node.id && candidate.type !== "output",
                )
                .map((candidate) => [
                  candidate.id,
                  `${VISUAL_NODE_TYPES[candidate.type].label} · ${candidate.id}`,
                ]),
              linked,
            )}</select></label>`;
          }).join("");
        return `<article class="logic-node ${node.type}" data-node-id="${escape(node.id)}" style="left:${node.x}px;top:${node.y}px"><header><i></i><b>${escape(type.label)}</b><small>${escape(node.id)}</small><button data-delete-node title="Delete node">×</button></header><div>${nodeField(node, sensors, channels)}${inputRows}</div><span class="logic-output-port"></span></article>`;
      })
      .join("");
    requestAnimationFrame(renderWires);
  }

  function renderApi() {
    const debug = getDebug(),
      watched = new Set(debug.watches || []),
      sensors = getSensors();
    sensorList.innerHTML = sensors
      .map((sensor) => {
        const key = sensor.instanceKey || sensor.key,
          full = `sensor.${key}`,
          value = debug.latest?.[full];
        return `<button data-watch="${escape(full)}" class="${watched.has(full) ? "active" : ""}"><i></i><span><b>${escape(sensor.label)}</b><small>${escape(key)} · ${escape(sensor.unit)}</small></span><em>${Number.isFinite(value) ? Number(value).toFixed(2) : "—"}</em></button>`;
      })
      .join("");
    const breakpointOptions = sensors.map((sensor) => {
      const key = sensor.instanceKey || sensor.key;
      return [`sensor.${key}`, `${sensor.label} · ${sensor.unit}`];
    });
    breakpointName.innerHTML = options(
      breakpointOptions,
      debug.breakpoint?.name,
    );
    if (debug.breakpoint) {
      breakpointOperator.value = debug.breakpoint.op;
      breakpointValue.value = debug.breakpoint.value;
    }
  }

  function renderDebug() {
    const debug = getDebug();
    variables.innerHTML = Object.entries(debug.latest || {})
      .slice(0, 24)
      .map(
        ([name, value]) =>
          `<span><b>${escape(name)}</b><em>${Number(value).toFixed(3)}</em></span>`,
      )
      .join("");
    const colors = ["#70e0c4", "#f1b65a", "#78aee8", "#e47868"];
    scope.innerHTML = `<svg viewBox="0 0 300 72" preserveAspectRatio="none"><g class="scope-grid"><path d="M0 18H300M0 36H300M0 54H300M75 0V72M150 0V72M225 0V72" /></g>${(
      debug.traces || []
    )
      .map(
        (trace, index) =>
          `<path class="scope-trace" style="stroke:${colors[index % colors.length]}" d="${tracePath(trace.values)}" />`,
      )
      .join("")}</svg><div>${(debug.traces || [])
      .map((trace, index) => {
        const latest = trace.values.at(-1)?.value || 0;
        return `<span style="color:${colors[index % colors.length]}">${escape(trace.name)} <b>${Number(latest).toFixed(2)}</b></span>`;
      })
      .join("")}</div>`;
    root.classList.toggle("breakpoint-hit", Boolean(debug.triggered));
    const status = element("#logic-debug-status");
    status.textContent = debug.triggered
      ? `BREAKPOINT · ${debug.triggered.name} = ${Number(debug.triggered.current).toFixed(3)}`
      : `${debug.sampleCount || 0} SAMPLES · TICK ${debug.tick || 0}`;
  }

  nodeLayer.addEventListener("change", (event) => {
    const target = /** @type {HTMLInputElement | HTMLSelectElement} */ (
        event.target
      ),
      card = closestElement(target, "[data-node-id]"),
      node = program.nodes.find(
        (candidate) => candidate.id === card?.dataset.nodeId,
      );
    if (!node) return;
    if (target.dataset.nodeField) {
      const key = target.dataset.nodeField;
      node[key] =
        target.type === "number" ? Number(target.value) : target.value;
    } else if (target.dataset.linkInput != null) {
      const input = Number(target.dataset.linkInput);
      program.links = program.links.filter(
        (link) => !(link.to === node.id && link.input === input),
      );
      if (target.value)
        program.links.push({ from: target.value, to: node.id, input });
    }
    commit();
  });
  nodeLayer.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target),
      card = closestElement(target, "[data-node-id]");
    if (!card || !closestElement(target, "[data-delete-node]")) return;
    program.nodes = program.nodes.filter(
      (node) => node.id !== card.dataset.nodeId,
    );
    program.links = program.links.filter(
      (link) =>
        link.from !== card.dataset.nodeId && link.to !== card.dataset.nodeId,
    );
    commit();
  });
  nodeLayer.addEventListener("pointerdown", (event) => {
    const target = /** @type {HTMLElement} */ (event.target),
      header = closestElement(target, ".logic-node header"),
      card = header && closestElement(header, "[data-node-id]");
    if (!card || closestElement(target, "button")) return;
    const node = program.nodes.find(
      (candidate) => candidate.id === card.dataset.nodeId,
    );
    drag = {
      node,
      x: event.clientX,
      y: event.clientY,
      left: node.x,
      top: node.y,
    };
    card.setPointerCapture(event.pointerId);
  });
  nodeLayer.addEventListener("pointermove", (event) => {
    if (!drag) return;
    drag.node.x = Math.max(0, drag.left + event.clientX - drag.x);
    drag.node.y = Math.max(0, drag.top + event.clientY - drag.y);
    const card = /** @type {HTMLElement} */ (
      nodeLayer.querySelector(`[data-node-id="${CSS.escape(drag.node.id)}"]`)
    );
    card.style.left = `${drag.node.x}px`;
    card.style.top = `${drag.node.y}px`;
    renderWires();
  });
  nodeLayer.addEventListener("pointerup", () => {
    if (!drag) return;
    drag = null;
    setProgram(structuredClone(program));
  });
  root.querySelectorAll("[data-add-logic-node]").forEach((button) => {
    const control = /** @type {HTMLButtonElement} */ (button);
    control.onclick = () => {
      const type = control.dataset.addLogicNode,
        index = program.nodes.length + 1;
      program.nodes.push({
        id: `${type}-${index}`,
        type,
        x: 30 + (index % 4) * 205,
        y: 30 + Math.floor(index / 4) * 135,
        bindingId:
          type === "sensor"
            ? getSensors()[0]?.key || ""
            : type === "output"
              ? getChannels()[0] || ""
              : "",
        value: 0,
      });
      commit();
    };
  });
  element("#logic-reset").onclick = () =>
    commit(structuredClone(DEFAULT_VISUAL_PROGRAM));
  sensorList.onclick = (event) => {
    const button = closestElement(
      /** @type {HTMLElement} */ (event.target),
      "[data-watch]",
    );
    if (!button) return;
    const current = new Set(getDebug().watches || []);
    if (current.has(button.dataset.watch)) current.delete(button.dataset.watch);
    else if (current.size < 4) current.add(button.dataset.watch);
    setWatches([...current]);
    refresh();
  };
  element("#logic-arm-breakpoint").onclick = () => {
    setBreakpoint({
      name: breakpointName.value,
      op: breakpointOperator.value,
      value: Number(breakpointValue.value),
      armed: true,
    });
    refresh();
  };
  element("#logic-clear-trace").onclick = () => {
    clearTrace();
    refresh();
  };
  element("#logic-step").onclick = stepSimulation;
  element("#logic-test-machine").onclick = toggleSimulation;

  function refresh() {
    program = normalizeVisualProgram(getProgram() || DEFAULT_VISUAL_PROGRAM);
    renderGraph();
    renderApi();
    renderDebug();
    renderBindings();
  }

  function refreshDebug() {
    renderApi();
    renderDebug();
  }

  function present(view) {
    element("#script-title").textContent = view.controllerId
      ? `Logic Controller #${view.controllerId} Program`
      : "Logic Controller Program";
    const status = element("#script-controller-status");
    status.textContent = view.controllerId
      ? `${view.powered ? "POWERED" : "NO POWER"} · ${view.outputs} SIGNAL OUTPUT${view.outputs === 1 ? "" : "S"} · PROGRAM STORED ON THIS COMPONENT`
      : "SELECT A LOGIC CONTROLLER TO EDIT OR RUN CODE";
    status.classList.toggle("online", view.powered && view.outputs > 0);
    root.querySelectorAll("[data-script-language]").forEach((button) => {
      const control = /** @type {HTMLElement} */ (button),
        selected = control.dataset.scriptLanguage === view.language;
      control.classList.toggle("active", selected);
      control.setAttribute("aria-selected", String(selected));
    });
    const visual = view.language === "visual";
    root.classList.toggle("visual-mode", visual);
    element(".visual-logic-workspace").classList.toggle("hidden", !visual);
    if (!visual) input("#wasm-source").value = view.source || "";
    element("#script-help").textContent = visual
      ? "Build a typed signal graph. It compiles to the same metered WebAssembly tier as TypeScript; nodes cannot bypass power, wiring, or physics."
      : `${view.language === "typescript" ? "TypeScript is validated and compiled locally" : "WAT compiles locally to WebAssembly"}. Every fixed-step tick has deterministic fuel and no network, DOM, storage, or dynamic-code access.`;
    element("#script-sensors").textContent =
      `INPUTS: ${view.sensorCount} NAMED BINDINGS · ${view.connectedSensorCount} ROUTED COMPONENT READINGS`;
    const outputBindings = getChannels();
    element("#script-channels").textContent =
      `OUTPUTS: ${outputBindings.length ? outputBindings.join(" · ") : "ADD AN ACTUATOR BINDING"}`;
    element("#compile-wasm").textContent = visual
      ? "VALIDATE GRAPH & RUN"
      : view.language === "typescript"
        ? "COMPILE TS & RUN"
        : "COMPILE WAT & RUN";
    refresh();
  }

  return { present, refresh, refreshDebug };
}

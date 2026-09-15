import { radiansToDegrees } from '../model/display-units.mjs';
import { modeCommand } from '../model/workshop-command.mjs';
import { explainReason } from '../model/messages.mjs';
import { connectionTestPaths } from '../model/connection-test-paths.mjs';
import { DEFAULT_CONTROL_BINDING } from '../model/control-bindings.mjs';
import { motorShaftSpeed } from '../model/motion-diagnostics.mjs';

const node = (tag, text = '', className = '') => {
  const value = document.createElement(tag);
  value.textContent = text;
  value.className = className;
  return value;
};
const number = (value, unit) =>
  Number.isFinite(value) ? `${value.toFixed(2)} ${unit}` : `— ${unit}`;
const keys = (part) => {
  const binding = part.controlBinding ?? DEFAULT_CONTROL_BINDING;
  return ['drive', 'steer']
    .filter((axis) => binding[axis].gain !== 0)
    .map((axis) =>
      [binding[axis].positiveKeys, binding[axis].negativeKeys]
        .map((codes) => codes.map((code) => code.replace(/^Key|^Digit/, '')).join('/') || '—')
        .join(' / '),
    )
    .join(' · ');
};

/** @typedef {(connectionIds: readonly import('../model/generated/blueprint-types.js').Connection['id'][]) => void} ConnectionPathHighlight */
/** Selected-actuator inspection and ordinary commands; never overrides authored control owners.
 * @param {{send: import('../model/workshop-command.js').SendCommand, holdReceiver?: (id:string,duty:number)=>unknown, releaseReceiver?: (id:string)=>unknown, select:(id:string)=>unknown, choosePort:(endpoint:import('../model/generated/blueprint-types.js').Endpoint)=>unknown, run?:()=>unknown, container?:HTMLElement, highlight?:ConnectionPathHighlight, reveal?:ConnectionPathHighlight}} options
 */
export function createConnectionTest({
  send,
  holdReceiver,
  releaseReceiver,
  select,
  choosePort,
  run,
  container,
  highlight = () => {},
  reveal = () => {},
}) {
  const closedByPlayer = new Set();
  let frame,
    selectedId,
    paths,
    live,
    reason,
    warning,
    start,
    build,
    pathBlueprint,
    holdButtons = [],
    held = null;
  let section,
    sequence = Promise.resolve();
  function command(value) {
    sequence = sequence
      .then(() => send(value))
      .then((result) => {
        if (result?.ok === false && warning)
          warning.textContent = `Test command rejected: ${explainReason(result.reasonCode)}`;
        return result;
      })
      .catch(() => {
        if (warning) warning.textContent = 'Test command failed. Return to Build and try again.';
      });
    return sequence;
  }
  function release() {
    if (!held) return;
    const id = held;
    held = null;
    return releaseReceiver?.(id);
  }
  function hold(duty) {
    if (frame?.metadata.mode !== 'run' || !paths?.manualReceiver || held || !holdReceiver) return;
    held = paths.manualReceiver.id;
    holdReceiver(held, duty);
  }
  function link(part) {
    const button = node('button', part.name, 'part-link');
    button.type = 'button';
    button.addEventListener('click', () => {
      release();
      select(part.id);
    });
    return button;
  }
  function portAction(label, port, editable) {
    const button = node('button', label, 'quiet');
    button.type = 'button';
    button.disabled = !editable;
    button.addEventListener('click', () => choosePort({ part: selectedId, port }));
    return button;
  }
  function render(next, part, editable, parent = container) {
    const keepOpen = selectedId === part?.id && section?.firstElementChild?.open;
    release();
    highlight([]);
    reveal([]);
    section?.remove();
    section = null;
    frame = next;
    selectedId = part?.id;
    holdButtons = [];
    live = reason = warning = start = null;
    if (!part || !['poweredMotor', 'poweredHinge'].includes(part.type)) return null;
    pathBlueprint = next.metadata.blueprint;
    paths = connectionTestPaths(pathBlueprint, part.id);
    section = node('section', '', 'connection-test');
    section.setAttribute('aria-label', 'Connect and test actuator');
    const disclosure = node('details');
    // An actuator still missing its power or its shaft shows what it needs
    // without a click; once both are connected, or the player closed it for
    // this part, the player's own state rules as before. Control is optional:
    // a receiver-less motor runs at its Drive setting; keys need a receiver.
    const incomplete = !paths.powerSources.length || !paths.shaftPeers.length;
    const closureKey = `${pathBlueprint.id}:${part.id}`;
    const expectedOpen = Boolean(keepOpen) || (incomplete && !closedByPlayer.has(closureKey));
    disclosure.open = expectedOpen;
    let lastOpen = expectedOpen;
    disclosure.addEventListener('toggle', () => {
      // Programmatic opens fire toggle too; record only a change the player made.
      if (disclosure.open === lastOpen) return;
      lastOpen = disclosure.open;
      if (disclosure.open) closedByPlayer.delete(closureKey);
      else closedByPlayer.add(closureKey);
    });
    disclosure.append(node('summary', 'Connect & test'));
    section.append(disclosure);
    const power = node('div', '', 'connection-test-path');
    power.append(node('span', 'Power: '));
    if (!paths.powerSources.length) power.append(portAction('Connect power', 'power', editable));
    else {
      for (const [index, peer] of [...paths.powerPath].reverse().entries()) {
        if (index) power.append(document.createTextNode(' → '));
        power.append(link(peer));
      }
      if (paths.powerSources.length > 1) {
        power.append(node('small', ' · Other connected cells: '));
        for (const peer of paths.powerSources.slice(1)) power.append(link(peer));
      }
    }
    const control = node('div', '', 'connection-test-path');
    control.append(node('span', 'Control: '));
    if (paths.signalOwner) {
      control.append(link(paths.signalOwner));
      if (paths.signalOwner.type === 'commandReceiver')
        control.append(node('small', ` · ${keys(paths.signalOwner)}`));
    } else {
      control.append(
        node('span', 'Configured default'),
        portAction('Connect control', 'signal', editable),
      );
    }
    const output = node('div', '', 'connection-test-path');
    output.append(node('span', part.type === 'poweredHinge' ? 'Moving output: ' : 'Shaft: '));
    if (paths.shaftPeers.length) for (const peer of paths.shaftPeers) output.append(link(peer));
    else output.append(portAction('Connect shaft', 'shaft', editable));
    for (const [row, key] of [
      [power, 'powerConnectionIds'],
      [control, 'signalConnectionIds'],
      [output, 'shaftConnectionIds'],
    ]) {
      const showPath = () =>
        highlight(
          section?.contains(row) && !section.hidden && disclosure.open ? [...paths[key]] : [],
        );
      row.addEventListener('pointerenter', showPath);
      row.addEventListener('pointerleave', () => highlight([]));
      row.addEventListener('focusin', showPath);
      row.addEventListener('focusout', () => highlight([]));
    }
    disclosure.addEventListener('toggle', () => {
      if (section?.firstElementChild !== disclosure) return;
      if (!disclosure.open) highlight([]);
      revealPath();
    });
    disclosure.append(power, control, output);
    warning = node(
      'p',
      'Run tests the whole machine. Other powered parts may move.',
      'parameter-help',
    );
    start = node('button', 'Test in Run');
    start.type = 'button';
    start.addEventListener('click', async () => {
      if (frame?.metadata.mode === 'run') return;
      if (run) await run();
      else await command(modeCommand('run'));
    });
    build = node('button', 'Return to Build');
    build.type = 'button';
    build.addEventListener('click', async () => {
      await release();
      await command(modeCommand('build'));
    });
    disclosure.append(warning, start, build);
    if (paths.manualReceiver) {
      const buttons = node('div', '', 'drive-buttons');
      for (const [label, duty] of [
        ['Hold −', -1],
        ['Hold +', 1],
      ]) {
        const button = node('button', label);
        button.type = 'button';
        button.setAttribute('aria-label', `${label} through ${paths.manualReceiver.name}`);
        button.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          button.setPointerCapture(event.pointerId);
          hold(duty);
        });
        button.addEventListener('lostpointercapture', release);
        button.addEventListener('keydown', (event) => {
          if (![' ', 'Enter'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) hold(duty);
        });
        button.addEventListener('keyup', (event) => {
          if (![' ', 'Enter'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          release();
        });
        button.addEventListener('blur', release);
        holdButtons.push(button);
        buttons.append(button);
      }
      disclosure.append(
        buttons,
        node(
          'small',
          part.type === 'poweredHinge'
            ? 'Release returns to keyboard input. With no input, the hinge targets center and may keep moving.'
            : 'Release returns to keyboard input. With no input, the mechanism may coast.',
        ),
      );
    } else
      disclosure.append(
        node(
          'small',
          paths.signalOwner
            ? 'Test uses the wired controller. Manual override is unavailable.'
            : 'Test uses this actuator’s configured default. Connect a receiver for hold controls.',
        ),
      );
    live = node('p', '', 'connection-test-live');
    // The reason keeps its own reserved line so the readings and the buttons above never move.
    reason = node('p', '', 'connection-test-reason');
    disclosure.append(live, reason);
    parent?.append(section);
    update(next);
    return section;
  }
  function revealPath() {
    reveal(
      section && !section.hidden && section.firstElementChild?.open && paths
        ? [
            ...new Set([
              ...paths.powerConnectionIds,
              ...paths.signalConnectionIds,
              ...paths.shaftConnectionIds,
            ]),
          ]
        : [],
    );
  }
  function update(next) {
    frame = next;
    if (!section || !live) return;
    const part = next.metadata.blueprint.parts.find((part) => part.id === selectedId);
    if (!part) {
      release();
      highlight([]);
      section.hidden = true;
      reveal([]);
      return;
    }
    if (pathBlueprint !== next.metadata.blueprint) {
      highlight([]);
      render(next, part, next.metadata.mode === 'build', section.parentElement ?? container);
      return;
    }
    revealPath();
    if (held && (next.metadata.mode !== 'run' || paths.manualReceiver?.id !== held)) release();
    start.disabled = next.metadata.mode === 'run';
    build.hidden = next.metadata.mode === 'build';
    for (const button of holdButtons)
      button.disabled = next.metadata.mode !== 'run' || !paths.manualReceiver;
    if (next.metadata.mode === 'build') {
      live.textContent = 'Run to read current and motion.';
      reason.textContent = '';
      return;
    }
    const index = next.metadata.blueprint.parts.indexOf(part);
    const motor = next.power?.motors?.find((row) => row.node === index);
    const prefix = next.metadata.mode === 'paused' ? 'Paused · last reading: ' : '';
    live.textContent =
      prefix +
      (part.type === 'poweredHinge'
        ? `${number(motor?.current, 'A')} · angle ${number(radiansToDegrees(motor?.position?.angle), '°')} · target ${number(radiansToDegrees(motor?.position?.targetAngle), '°')} · command ${number(motor?.position?.controlDuty, '')}`
        : `${number(motor?.current, 'A')} · shaft ${number(motorShaftSpeed(next, index), 'rad/s')}`);
    reason.textContent =
      motor?.reasonCode && motor.reasonCode !== 'OK' ? explainReason(motor.reasonCode) : '';
  }
  const visibility = () => {
    if (document.hidden) release();
  };
  const keyup = (event) => {
    if ([' ', 'Enter'].includes(event.key)) release();
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', visibility);
  return {
    render,
    update,
    release,
    dispose() {
      release();
      highlight([]);
      reveal([]);
      section?.remove();
      section = null;
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}

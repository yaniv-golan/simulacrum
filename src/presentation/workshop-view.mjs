import { captureWorkshopScreenshot } from './workshop-screenshot.mjs';
import { createCameraFrustum } from './camera-frustum.mjs';
import { createCameraControls } from './camera-controls.mjs';
import { mountControllerHistory } from './controller-history.mjs';
import { sensorInspector, updateSensorInspector } from './sensor-controls.mjs';
import { createSensorView } from './sensor-view.mjs';
import { createControllerEditor, updateControllerEditor } from './controller-editor.mjs';
import {
  createGraphicsQuality,
  applyGraphicsQuality,
  createGraphicsRenderer,
} from './graphics-quality.mjs';
import { movementScope } from './workbench-content.mjs';
import { portLabel, portPurpose } from './port-wording.mjs';
import { PRIMARY_PARTS, MORE_PARTS } from './part-palette.mjs';
import { createPartHelp } from './part-help.mjs';
import { ownsPartHelpInput } from './part-help-input.mjs';
import { createAssemblyLibraryPanel } from './assembly-library.mjs';
import { createAssemblyBrowser } from './assembly-browser.mjs';
import { createAssemblyPlacementView } from './assembly-placement-view.mjs';
import { createAssemblyThumbnails } from './assembly-thumbnails.mjs';
import { createDirectDrag } from './direct-drag.mjs';
import { createConnectionTest } from './connection-test.mjs';
import { createAssemblyMirror } from './assembly-mirror.mjs';
import { proposeMirroredAssembly } from '../model/mirror-assembly.mjs';
import { createMotionReadout } from './motion-readout.mjs';
import { createVehicleControls } from './vehicle-controls.mjs';
import { findPlacementOverlap } from '../model/surfaces.mjs';
import { springInspector } from './spring-controls.mjs';
import { createSpringView } from './spring-view.mjs';
import { contactProperties } from '../model/contact-properties.mjs';
import { createLearningControls, targetSensorInspector } from './learning-controls.mjs';
import { partPrimitives, shaftSegments } from '../model/geometry.mjs';
import * as THREE from 'three';
import { createResourceCache, partAppearanceKey } from './resource-cache.mjs';
import { connectionRenderSpecs, createWiringPreferences } from './connection-render.mjs';
import { createConnectionView } from './connection-view.mjs';
import { createSurfaceControls } from './surface-controls.mjs';
import {
  surfaceRegions,
  resolveSurfaceEndpoint,
  placementEnvelopes,
  solidsOverlap,
} from '../model/surfaces.mjs';
import { createEditingControls } from './editing-controls.mjs';
import { createPart } from '../model/blueprint.mjs';
import { mechanicalGroup } from '../model/connection-graph.mjs';
import { duplicatePart } from '../model/duplication.mjs';
import { snapConnection, compileAssembly } from '../model/assembly.mjs';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { UI_FEATURES } from '../model/features.mjs';
import { CATALOG, MATERIALS } from '../model/catalog.mjs';
import { diagnoseMotion, motorShaftSpeed } from '../model/motion-diagnostics.mjs';
import { explainReason, explainFailure, normalizeFailure } from '../model/messages.mjs';
import { CYLINDER_SEGMENTS } from '../model/geometry.mjs';
import {
  BUILD_ENVIRONMENT,
  ENVIRONMENT_PRESETS,
  environmentObstacles,
} from '../model/environment.mjs';
import './workshop.css';
export const WORKSHOP_VIEW_MILESTONE = UI_FEATURES.construction.milestone;
const parameterLabels = {
  torqueConstant: 'Torque per amp',
  currentLimit: 'Current limit',
  defaultDuty: 'Drive setting',
  defaultTarget: 'Default target',
  lowerLimit: 'Lower angle limit (rad)',
  upperLimit: 'Upper angle limit (rad)',
  proportionalGain: 'Position gain (1/rad)',
  dampingGain: 'Damping (s/rad)',
  capacityJ: 'Stored energy',
  internalResistance: 'Cell resistance',
};
const parameterHelp = {
  torqueConstant: 'More torque per amp helps turn a heavier load.',
  currentLimit: 'Caps current and therefore available motor torque.',
  defaultDuty: '−1 reverse · 0 off · 1 forward. Sets drive strength, not a guaranteed speed.',
  capacityJ: 'More stored energy supports a longer run.',
};
const labels = {
  spring: 'Slide',
  power: 'Power',
  shaft: 'Shaft',
  gear: 'Gear mesh',
  fixed: 'Mount',
  signal: 'Signal',
};

const materialColor = { aluminium: 0x9aadb2, steel: 0x657d8b, rubber: 0x323d46 };
const format = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '—');
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, fn, className = '') {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', fn);
  return node;
}
export function createWorkshopView(
  root,
  {
    onCommand,
    onSound,
    onSave,
    onLoad,
    onFailure,
    onRecording,
    onInteraction,
    getCursor,
    getAssemblyFrame,
    assemblyLibrary,
    learning,
    controllerHistory,
    cameraSession,
    builtInAssemblies = [],
    guideSteps = [],
  },
) {
  const learningControls = learning
    ? createLearningControls(root, learning, { inspectPart: (id) => select(id) })
    : null;
  const wiringPreferences = createWiringPreferences();
  root.classList.add('workshop');
  let explodeStarted = 0,
    explodeFrom = 0,
    exploded = false,
    explodeAmount = 0,
    explodeTarget = new Map(),
    tracedConnection = null,
    testConnectionIds = new Set(),
    revealedConnectionIds = new Set(),
    explodeCamera = null,
    explodeCameraTween = null;
  let activeTool = 'select',
    draggingType = null,
    copySequence = 0,
    followCenter = null,
    guideActive = false,
    editing,
    mirror,
    frame = null,
    selected = null,
    sourcePort = null,
    blueprintKey = '',
    inspectorKey = '',
    disposed = false,
    inputTime = performance.now(),
    surface,
    assemblies = null,
    assemblyPlacement = null;
  // RAF still owns control damping and animation; GPU work follows scene invalidation.
  const renderCosts = [];
  let renderedFrames = 0,
    sceneDirty = true;
  const invalidateScene = () => {
    sceneDirty = true;
  };
  const sceneInputEvents = [
    'click',
    'change',
    'input',
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'pointerenter',
    'pointerleave',
    'dragstart',
    'dragover',
    'dragleave',
    'drop',
    'dragend',
    'focus',
    'blur',
  ];
  for (const type of sceneInputEvents) root.addEventListener(type, invalidateScene, true);
  const captureInput = (event) => {
    inputTime = event.timeStamp;
  };
  for (const type of ['click', 'change']) root.addEventListener(type, captureInput, true);
  const send = async (command, assemblyAction = false) => {
    if (!assemblyAction && (assemblies?.busy() || assemblyPlacement?.active())) {
      setMessage('Finish or cancel the assembly operation first.');
      return { ok: false, message: 'Finish or cancel the assembly operation first.' };
    }
    try {
      directDrag.end(false);
      if (exploded || explodeAmount) setExploded(false, true);
      const result = await onCommand(command, { inputTime });
      if (result?.ok === false) setMessage(explainFailure(result, frame?.metadata.blueprint));
      return result;
    } catch (error) {
      if (assemblyAction && command.type === 'insert-assembly') throw error;
      const result = normalizeFailure(error);
      setMessage(explainFailure(result, frame?.metadata.blueprint));
      return result;
    }
  };
  const controllerEditor = createControllerEditor({ send });
  const partThumbnails = new Map();
  function partIcon(type) {
    const img = element('img', 'part-icon');
    img.dataset.iconType = type;
    if (partThumbnails.has(type)) img.src = partThumbnails.get(type);
    img.alt = '';
    img.draggable = false;
    return img;
  }
  function enablePaletteDrag(card, type) {
    card.draggable = true;
    card.dataset.placement = '';
    card.addEventListener('dragstart', (event) => {
      if (frame?.metadata.mode !== 'build') {
        event.preventDefault();
        return;
      }
      partHelp.dismissTooltip();
      cancelInteraction();
      draggingType = type;
      event.dataTransfer.setData('text/plain', type);
      event.dataTransfer.effectAllowed = 'copy';
    });
    card.addEventListener('dragend', () => {
      if (draggingType !== null) cancelInteraction();
    });
  }
  const header = element('header', 'workshop-header'),
    brand = element('div', 'brand');
  brand.append(element('span', 'brand-mark', 'S'), element('div', 'brand-name', 'SIMULACRUM'));
  const subtitle = element('span', 'brand-subtitle', 'Mechanical workshop');
  brand.append(subtitle);
  const modebar = element('div', 'modebar');
  const run = button('▶ Run', () => send({ type: 'run' }), 'primary'),
    pause = button('Pause', () => send({ type: 'pause' })),
    build = button('↶ Build', () => send({ type: 'build' }));
  run.dataset.command = 'run';
  pause.dataset.command = 'pause';
  build.dataset.command = 'build';
  const stepButton = button('Step', () => send({ type: 'step' }));
  stepButton.dataset.command = 'step';
  modebar.append(run, pause, build, stepButton);
  const filebar = element('div', 'filebar');
  const failureButton = button('Failure record', () => onFailure?.());
  failureButton.dataset.command = 'failure-record';
  failureButton.hidden = true;
  const loadInput = element('input');
  loadInput.type = 'file';
  loadInput.accept = '.json,application/json';
  loadInput.hidden = true;
  loadInput.addEventListener('change', async () => {
    const file = loadInput.files?.[0];
    if (!file) return;
    if (assemblies?.busy() || assemblyPlacement?.active()) {
      setMessage('Finish or cancel the assembly operation before loading a machine.');
      loadInput.value = '';
      return;
    }
    try {
      await onLoad(file);
    } catch {
      setMessage('This file could not be loaded. Choose a saved workshop JSON file.');
    }
    loadInput.value = '';
  });
  const newButton = button('New', () => send({ type: 'new' }));
  newButton.dataset.command = 'new';
  filebar.append(
    newButton,
    button('Save', async () => {
      try {
        await onSave();
      } catch {
        setMessage('The machine could not be saved. Try again.');
      }
    }),
    button('Load', () => loadInput.click()),
    failureButton,
    loadInput,
  );
  const undo = button('Undo', () => send({ type: 'undo' })),
    redo = button('Redo', () => send({ type: 'redo' }));
  undo.dataset.command = 'undo';
  redo.dataset.command = 'redo';
  filebar.prepend(undo, redo);
  const environmentLabel = element('label', 'environment-choice', 'Environment '),
    environmentSelect = element('select');
  environmentSelect.setAttribute('aria-label', 'Environment');
  for (const [value, preset] of Object.entries(ENVIRONMENT_PRESETS)) {
    const option = element('option', '', preset.label);
    option.value = value;
    environmentSelect.append(option);
  }
  environmentSelect.addEventListener('change', async () => {
    const chosen = environmentSelect.value;
    await send({ type: 'choose-environment', environment: chosen });
    environmentSelect.value = frame?.metadata.blueprint.environment ?? 'flat';
  });
  environmentLabel.append(environmentSelect);
  filebar.append(environmentLabel);
  header.append(brand, modebar, filebar);
  const body = element('main', 'workshop-body'),
    left = element('aside', 'parts-panel');
  const partsHeading = element('h2', '', 'Parts');
  partsHeading.tabIndex = -1;
  left.append(partsHeading);
  const partHelp = createPartHelp({
    container: left,
    fallback: partsHeading,
    icon: partIcon,
    busy: () =>
      Boolean(
        draggingType ||
          surface?.active() ||
          mirror?.active() ||
          directDrag?.active?.() ||
          editing?.isDragging(),
      ),
  });
  const palette = element('div', 'palette');
  for (const type of PRIMARY_PARTS) {
    const card = button('', () => send({ type: 'place', partType: type }), 'part-card');
    card.dataset.partType = type;
    card.append(partIcon(type), element('span', '', CATALOG[type].name));
    enablePaletteDrag(card, type);
    palette.append(partHelp.entry(card, type));
  }
  let guideReceipt = null,
    guideVisual = null,
    guidePulseStarted = 0;
  const examples = element('dialog', 'workshop-dialog examples-browser');
  examples.setAttribute('aria-label', 'Learn & examples');
  examples.setAttribute('closedby', 'any');
  const exampleMessage = element('p', 'example-message');
  exampleMessage.setAttribute('role', 'status');
  const examplesHeader = element('div', 'examples-header');
  const closeExamples = button('×', () => examples.close(), 'examples-close');
  closeExamples.setAttribute('aria-label', 'Close examples');
  closeExamples.title = 'Close examples';
  examplesHeader.append(element('h2', '', 'Learn & examples'), closeExamples);
  examples.append(examplesHeader, exampleMessage);
  root.append(examples);
  const learnButton = button('Learn & examples', () => {
    exampleMessage.textContent = '';
    if (guideActive) guide.scrollIntoView({ block: 'nearest' });
    else examples.showModal();
  });
  filebar.append(learnButton);
  const guide = element('section', 'starter-guide');
  let pendingExample = null,
    renderedGuideActive;
  const replacement = element('div', 'example-replacement');
  replacement.hidden = true;
  const cancelReplacement = button('Cancel replacement', () => {
    replacement.hidden = true;
    exampleMessage.textContent = '';
    const trigger = pendingExample?.trigger;
    pendingExample = null;
    trigger?.focus();
  });
  const confirmReplacement = button('Replace without saving', async () => {
    const pending = pendingExample;
    if (!pending) return;
    confirmReplacement.disabled = true;
    downloadCopy.disabled = true;
    cancelReplacement.disabled = true;
    try {
      await openExample(pending);
    } finally {
      confirmReplacement.disabled = false;
      downloadCopy.disabled = false;
      cancelReplacement.disabled = false;
    }
  });
  const downloadCopy = button('Download current machine', async () => {
    try {
      await onSave();
      exampleMessage.textContent =
        'Download started. Check that the file is saved before replacing your machine. If you cancelled the download, download again or cancel replacement.';
      confirmReplacement.textContent = 'I saved the file — open example';
    } catch {
      exampleMessage.textContent =
        'The download could not start. Your machine is unchanged. Try downloading again or cancel replacement.';
    }
  });
  replacement.append(downloadCopy, confirmReplacement, cancelReplacement);
  examples.insertBefore(replacement, exampleMessage.nextSibling);
  examples.addEventListener('close', () => {
    replacement.hidden = true;
    pendingExample = null;
  });
  async function openExample(entry) {
    if (frame.metadata.mode !== 'build') {
      exampleMessage.textContent =
        'Return to Build before opening an example. Your current machine is unchanged.';
      return;
    }
    const result = await send(entry.command);
    if (!result?.ok) {
      exampleMessage.textContent = 'The example could not open. Your current machine is unchanged.';
      return;
    }
    if (entry.guide) {
      guideActive = true;
      empty.hidden = true;
      refreshGuide();
    }
    examples.close();
    partsHeading.focus();
  }
  function chooseExample(entry, trigger) {
    if (frame.metadata.mode !== 'build') {
      exampleMessage.textContent =
        'Return to Build before opening an example. Your current machine is unchanged.';
      return;
    }
    if (!frame.metadata.blueprint.parts.length) return openExample(entry);
    pendingExample = { ...entry, trigger };
    exampleMessage.textContent = `Replace your current machine with ${entry.name}? This replaces the machine and its Undo history. Download a copy first if you want to keep it.`;
    confirmReplacement.textContent = 'Replace without saving';
    replacement.hidden = false;
    cancelReplacement.focus();
  }
  function refreshGuide() {
    // Static requested content must retain focus, disclosure and scroll during ticks.
    if (!guideActive && renderedGuideActive === false) return;
    renderedGuideActive = guideActive;
    guide.replaceChildren();
    guide.classList.toggle('active-guide', guideActive);
    if (!guideActive) {
      examples.append(guide);
      const addExample = (parent, name, format, description, label, command, guided = false) => {
        const card = element('section', 'example-card');
        const launch = button(label, () => chooseExample({ name, command, guide: guided }, launch));
        launch.dataset.command = guided ? 'start-guide' : command.type;
        card.append(
          element('h3', '', name),
          element('p', 'example-format', format),
          element('p', '', description),
          launch,
        );
        parent.append(card);
        return card;
      };
      addExample(
        guide,
        'Build a rolling machine',
        'Guided build · Start here',
        'Start with an empty workbench. Place parts and connect power and axles one step at a time. Run your machine, then try switching its motor off yourself. You can leave the guide and keep building at any time.',
        'Start guided build',
        { type: 'new' },
        true,
      );
      addExample(
        guide,
        'Drive and return',
        'Editable example · Keyboard driving',
        'Open a four-wheel machine. Press Run: W/S drives and A/D turns. Try driving away, turning around and returning to where you started. For another experiment, return to Build, select Shared cell and lower Voltage in Engineering details. Predict how it will drive; try again, then return to Build and Undo to restore the setting.',
        'Try driving example',
        { type: 'driving-example', replace: true },
      );
      const sensingCard = addExample(
        guide,
        'Teach a cargo delivery',
        'Editable challenge · Keyboard driving first',
        'Open a cart with a loose package and a bay marker. Select Delivery learner, then Teach a controller. Drive forward with W; stop near the marker without losing the package. Stop teaching, return to Build, train and install a candidate, then Try it. Inspect failures and change examples, sensing or construction. The powered forward range sensor sees the first physical obstacle; closing speed is relative to that surface.',
        'Try learning delivery',
        { type: 'learning-delivery-example', replace: true },
      );
      const variants = element('details');
      variants.append(element('summary', '', 'Start with a rule · optional sensor experiments'));
      variants.append(
        element(
          'p',
          '',
          'Try contact → reverse first. Select Change this rule, change one value, then Apply in Build. Run and enable Automatic on both receivers. Your driving keys always take over. Use the range variant to anticipate the obstacle; inspect tilt, axle angle or motion without a balancing challenge.',
        ),
      );
      for (const [sensor, label] of [
        ['contact', 'Try contact rules'],
        ['range', 'Try range rules'],
        ['contactLoad', 'Feel the pad load'],
        ['tilt', 'Inspect tilt'],
        ['jointAngle', 'Inspect axle angle'],
        ['linearMotion', 'Inspect linear motion'],
      ]) {
        const launch = button(label, () =>
          chooseExample(
            { name: label, command: { type: 'sensor-rule-example', sensor, replace: true } },
            launch,
          ),
        );
        variants.append(launch);
      }
      variants.append(
        element(
          'p',
          '',
          'Predict, then change one thing in Build: on the load bench, change the plate material from aluminium to steel and compare normal load. On the tilt rover, use Adjust mount to rotate the sensor, then compare its gravity-relative reading. On the axle rover, change the encoder Zero or Sign in Engineering details and watch the same rotating axle. Undo restores each edit; opening another example replaces the machine.',
        ),
      );
      const baseline = button('Try delivery rules', () =>
        chooseExample(
          {
            name: 'Delivery with rules',
            command: { type: 'learning-delivery-example', policy: 'rules', replace: true },
          },
          baseline,
        ),
      );
      variants.append(baseline);
      sensingCard.append(variants);
      addExample(
        guide,
        'Lift with gears',
        'Editable experiment · Motor and shaft connections first',
        'Open a motor, two supported gears and a loaded arm. Predict which gear turns more slowly, then Run. The 12T gear drives the 24T gear with reduction. Return to Build and disconnect their Gear mesh: does the arm still rise? Reconnect it and try reducing the motor current limit. Opening this example replaces the current machine.',
        'Try gear lift',
        { type: 'gear-lift-example', replace: true },
      );
      addExample(
        guide,
        'Make a spring settle',
        'Experiment · Change one setting',
        'Open a supported carriage and spring. Run to watch the falling weight land and the carriage bounce. Return to Build and change Damping in the selected guide’s settings. Can you make it settle after one bounce? Open Compare damping there to try zero damping without replacing your machine.',
        'Try spring playground',
        { type: 'spring-example', replace: true },
      );
      const springExperiments = element('details', 'spring-experiments');
      springExperiments.append(element('summary', '', 'Spring experiments'));
      addExample(
        springExperiments,
        'Roll onto a spring',
        'Experiment · Rolling and falling',
        'A supported beam slopes toward a spring plate. Run to watch the Ball roll, leave the edge and land. Try again to repeat. In Build, change its material or the spring damping and predict what changes.',
        'Try rolling drop',
        { type: 'ball-drop-example', replace: true },
      );
      addExample(
        springExperiments,
        'Spring launcher',
        'Experiment · Stored energy',
        'Run to let the powered gate hold a compressed spring. Hold L to open the gate and send the Ball toward the catcher. The compressed spring stores energy; operating the gate uses battery power. Choose Try again for another shot. In Build, move the Catcher farther away and change the spring’s rest length to adjust preload.',
        'Try spring launcher',
        { type: 'spring-launcher-example', replace: true },
      );
      addExample(
        springExperiments,
        'Guided wheel suspension',
        'Editable example · Suspension travel',
        'Four sliding springs carry a powered cart over a rounded bump. Run and hold W/S to drive. Select the same chassis in each cart and open Measurements; compare matching windows and speed just before the bump. The same key press may give different speeds: in Build, select the receiver and adjust Keyboard settings → Output strength. Then change stiffness, damping or load. Smoother motion does not necessarily use less energy.',
        'Try suspension cart',
        { type: 'guided-suspension-example', replace: true },
      );
      addExample(
        springExperiments,
        'Rigid wheel comparison',
        'Editable example · Same cart, bolted suspension',
        'The same cart has four extra bolts that lock its suspension braces. Compare the same chassis and measurement window at matching approach speed; adjust the receiver’s Keyboard settings → Output strength in Build if needed. Disconnect a brace bolt in Build to free that spring.',
        'Try rigid cart',
        { type: 'rigid-suspension-example', replace: true },
      );
      addExample(
        springExperiments,
        'Articulated spring ends',
        'Editable example · Pivoting strut',
        'A wheel arm loads a spring through two real pivot pins. Run to see it settle, then inspect both bearings. The guide slides along its own axis; the pins let the whole strut change angle. Try Manual movement in Active suspension to see the pivots move farther. Every mount remains editable; check clearance after changing it.',
        'Try articulated strut',
        { type: 'articulated-suspension-example', replace: true },
      );
      addExample(
        springExperiments,
        'Active suspension',
        'Experiment · Manual and automatic control',
        'A powered upper rocker changes spring length. Run in Manual and hold W/S to shorten/lengthen it; Manual can hold a fixed load. Select the rocker receiver and choose Automatic to use the travel sensor for a requested length. Try 0.26–0.33 m and compare target changes. Check clearance after editing mounts. Zero takes Manual control; Off removes drive power and does not lock the arm.',
        'Try active suspension',
        { type: 'active-suspension-example', replace: true },
      );
      const modules = element('section', 'example-card');
      modules.append(
        element('h3', '', 'Reusable suspension'),
        element(
          'p',
          '',
          'Add an editable module to this machine. Connect its chassis mount and wheel axle; the driven version also exposes power and command ports. Save it in Assemblies to reuse your changes.',
        ),
      );
      for (const driven of [false, true]) {
        const insert = button(
          driven ? 'Add driven suspension module' : 'Add passive suspension module',
          async () => {
            const result = await send({ type: 'guided-suspension-module', driven });
            if (result?.ok) examples.close();
          },
        );
        insert.dataset.command = driven ? 'driven-suspension-module' : 'passive-suspension-module';
        modules.append(insert);
      }
      modules.append(
        element(
          'p',
          '',
          'The pin-ended strut has two real pivot bearings. Attach its Upper pin mount and Lower pin mount to 40 mm mounting faces; the pins let the complete strut swivel.',
        ),
      );
      const insertPinStrut = button('Add pin-ended strut', async () => {
        const result = await send({ type: 'pin-ended-strut-module' });
        if (result?.ok) examples.close();
      });
      insertPinStrut.dataset.command = 'pin-ended-strut-module';
      modules.append(insertPinStrut);
      springExperiments.append(modules);
      guide.append(springExperiments);
      return;
    }
    left.insertBefore(guide, partsHeading);
    const bp = frame?.metadata.blueprint,
      step = bp && guideSteps.find((s) => !s.done(bp));
    const completed = bp ? guideSteps.filter((s) => s.done(bp)).length : 0;
    guide.append(element('span', 'guide-progress', `${completed} / ${guideSteps.length} steps`));
    if (guideReceipt && !bp.connections.some((c) => c.id === guideReceipt.id)) {
      guideReceipt = null;
      showGuideConnection(null);
    }
    if (guideReceipt) guide.append(element('p', 'guide-receipt', `✓ ${guideReceipt.message}`));
    if (step) {
      guide.append(element('p', '', step.description));
      const next = button(
        step.label,
        async () => {
          editing.clearPreview();
          const result = await send({ type: 'guide-step' });
          if (result?.ok) {
            const command = step.commands.find((c) => c.type === 'connect'),
              edge =
                command && frame.metadata.blueprint.connections.find((c) => c.id === command.id);
            if (edge) {
              select(edge.b.part);
              sourcePort = { ...edge.b };
              inspectorKey = '';
              refreshInspector();
              guideReceipt = { ...edge, message: guideConnectionMessage(edge) };
              guidePulseStarted = performance.now();
              showGuideConnection(guideReceipt, true);
            }
            refreshGuide();
            editing.focus();
          }
        },
        'primary',
      );
      next.dataset.command = 'guide-step';
      next.disabled = frame?.metadata.mode !== 'build';
      const preview = () => {
        if (step.part) editing.showPreview([step.part]);
        const connection = step.commands.find((c) => c.type === 'connect');
        if (connection) showGuideConnection(connection, false);
      };
      const leave = () => {
        if (step.part) return;
        editing.clearPreview();
        showGuideConnection(guideReceipt, true);
      };
      next.addEventListener('pointerenter', () => {
        if (step.part) preview();
      });
      next.addEventListener('pointermove', (event) => {
        if (!step.part && (event.movementX || event.movementY)) preview();
      });
      next.addEventListener('focus', preview);
      next.addEventListener('pointerleave', leave);
      next.addEventListener('blur', leave);
      guide.insertBefore(next, guide.children[1]);
      if (step.part) preview();
    } else {
      guide.append(
        element('h2', '', 'Ready for a rolling test'),
        element(
          'p',
          '',
          'Press Run. This three-wheel machine travels in a curve. Pause, then return to Build for your own experiment.',
        ),
        element(
          'p',
          '',
          'Open the Machine list and select Motor. Set Drive setting to 0. Predict what will move, then press Run. Return to Build and Undo to restore the setting. The guide places parts; this change is yours to try.',
        ),
      );
    }
    guide.append(
      button(
        'Leave guide',
        () => {
          guideActive = false;
          empty.hidden = frame.metadata.blueprint.parts.length > 0;
          guideReceipt = null;
          showGuideConnection(null);
          editing.clearPreview();
          refreshGuide();
        },
        'quiet',
      ),
    );
  }
  left.append(palette);
  refreshGuide();
  const more = element('details', 'more-parts');
  more.append(element('summary', '', 'More parts'));
  for (const type of MORE_PARTS) {
    const item = button('', () => send({ type: 'place', partType: type }), 'more-part');
    item.dataset.partType = type;
    item.append(partIcon(type), element('span', '', CATALOG[type].name));
    enablePaletteDrag(item, type);
    more.append(partHelp.entry(item, type));
  }
  left.append(
    more,
    element('p', 'palette-hint', 'Drag a part into the workbench, or click to add it.'),
  );
  const recordingPanel = element('details', 'recording-panel');
  recordingPanel.append(
    element('summary', '', 'Record an issue'),
    element(
      'p',
      'muted small',
      'Records this workshop’s controls and machine state locally. Nothing is uploaded. Save the recording to share a problem. Capture stops visibly at its size limit.',
    ),
  );
  const recordingToggle = button('Start recording', () => onRecording?.('toggle')),
    recordingExport = button('Save recording', () => onRecording?.('export')),
    recordingStatus = element('p', 'small');
  recordingToggle.dataset.command = 'record-session';
  recordingExport.dataset.command = 'export-session';
  recordingPanel.append(recordingToggle, recordingExport, recordingStatus);
  left.append(recordingPanel);
  function setRecordingState(state) {
    recordingToggle.textContent = state.recording ? 'Stop recording' : 'Start recording';
    recordingExport.disabled = !state.available;
    recordingPanel.firstChild.textContent = state.recording
      ? '● Recording issue'
      : 'Record an issue';
    recordingStatus.textContent = state.recording
      ? `Recording · ${state.eventCount} events`
      : state.reason
        ? `Recording stopped${state.reason === 'user-stop' ? '' : state.reason === 'event-limit' || state.reason === 'byte-limit' ? ' at the capture limit' : ' because capture could not continue'}. ${state.persisted ? 'Saved locally.' : 'Save now to preserve the in-memory recording.'}`
        : state.available
          ? 'A previous recording is available.'
          : '';
    if (state.recording || state.reason) recordingPanel.open = true;
  }

  const partList = element('div', 'part-list');
  const viewport = element('section', 'viewport');
  viewport.setAttribute('aria-label', 'Three dimensional workbench');
  const hint = element(
    'div',
    'canvas-hint',
    'Drag a part to move · Drag empty space to orbit · Scroll to zoom · Esc to clear',
  );
  const empty = element('div', 'empty-hint');
  empty.append(
    element('div', 'empty-glyph', '+'),
    element('h2', '', 'Your first machine starts here'),
    element('p', '', 'Choose a part from the left.'),
  );
  const stage = element('div', 'stage'),
    buildId = element(
      'div',
      'build-id',
      document.querySelector('meta[name=build-id]')?.content ?? '',
    );
  buildId.dataset.buildId = '';
  viewport.append(stage, empty, buildId);
  const rightPanel = element('aside', 'inspector-panel'),
    machinePicker = element('details', 'machine-picker'),
    partCount = element('summary', 'section-label', 'Machine · 0');
  const clearButton = button('Clear selection', () => select(null), 'clear-selection');
  clearButton.dataset.command = 'clear-selection';
  const right = element('div', 'inspector');
  right.setAttribute('aria-label', 'Selected part');
  machinePicker.append(partCount, partList);
  assemblies = assemblyLibrary
    ? createAssemblyLibraryPanel({
        library: assemblyLibrary,
        send: (command) => send(command, true),
        onState: refreshAssemblyState,
        getCursor,
        select: (id) => {
          select(id);
          right.scrollIntoView({ block: 'start' });
        },
        getSelected: () => selected,
        mount: (group, alias, target) => {
          select(alias.endpoint.part);
          beginSurface(alias.endpoint.part, {
            assemblyId: group.id,
            sourceRegion: alias.endpoint.surface.region,
            targetEndpoint: target,
          });
          right.scrollIntoView({ block: 'start' });
        },
      })
    : null;
  rightPanel.append(machinePicker, right);
  const assemblyThumbnails = assemblyLibrary
    ? createAssemblyThumbnails({ createMesh: createPartMesh, disposeMesh: disposePart })
    : null;
  const savedAssemblies = assemblyLibrary
    ? createAssemblyBrowser({
        library: assemblyLibrary,
        builtInAssemblies,
        editable: () => frame?.metadata.mode === 'build',
        canCreate: () =>
          frame?.metadata.mode === 'build' &&
          frame.metadata.blueprint.parts.some(
            (p) => !(frame.metadata.blueprint.assemblies ?? []).some((g) => g.ids.includes(p.id)),
          ),
        thumbnail: (definition) => assemblyThumbnails.image(definition),
        onCreate: () => {
          cancelInteraction();
          assemblies.create();
        },
        onPlace: (item) => {
          cancelInteraction();
          assemblies.selectPart();
          selected = null;
          assemblyPlacement.start(item);
        },
      })
    : null;
  const savedLauncher = button('Assemblies', () => {
    if (assemblies.busy() || assemblyPlacement.active()) {
      setMessage('Finish or cancel the assembly operation first.');
      return;
    }
    savedAssemblies.open();
  });
  const createAssembly = button('Create assembly…', () => {
    if (assemblyPlacement.active()) {
      setMessage('Finish or cancel placement first.');
      return;
    }
    cancelInteraction();
    assemblies.create();
  });
  createAssembly.className = 'create-assembly-launcher';
  const placeAnother = button('Place another', () => {
    if (frame?.metadata.mode !== 'build') return;
    assemblies.selectPart();
    selected = null;
    assemblyPlacement.repeat();
  });
  placeAnother.hidden = true;
  let assemblyStateKey = '';
  function refreshAssemblyState() {
    if (!frame || !assemblyPlacement) return;
    const busy = assemblies.busy() || assemblyPlacement.active();
    const nextKey = JSON.stringify([
      blueprintKey,
      frame.metadata.mode,
      selected,
      assemblies.selected(),
      assemblies.members(),
      busy,
      assemblyPlacement.active(),
      assemblyPlacement.hasPrevious(),
      frame.metadata.editing,
    ]);
    if (nextKey === assemblyStateKey) return;
    assemblyStateKey = nextKey;
    right.hidden = assemblies.contextual() || assemblyPlacement.active();
    const eligible = frame.metadata.blueprint.parts.some(
      (p) => !(frame.metadata.blueprint.assemblies ?? []).some((g) => g.ids.includes(p.id)),
    );
    createAssembly.disabled = busy || frame.metadata.mode !== 'build' || !eligible;
    createAssembly.title = eligible ? '' : 'Add an ungrouped part to create an assembly.';
    surfaceSnapLabel.hidden = frame.metadata.mode !== 'build' || assemblyPlacement.active();
    savedLauncher.disabled = busy;
    placeAnother.hidden =
      busy || frame.metadata.mode !== 'build' || !assemblyPlacement.hasPrevious();
    run.disabled = busy || frame.metadata.mode === 'run';
    undo.disabled = busy || frame.metadata.mode !== 'build' || !frame.metadata.editing?.undoCount;
    redo.disabled = busy || frame.metadata.mode !== 'build' || !frame.metadata.editing?.redoCount;
    for (const b of tools.querySelectorAll('[data-edit-tool]'))
      b.disabled = busy || !!assemblies.selected();
    for (const b of left.querySelectorAll('[data-placement]'))
      b.disabled = busy || frame.metadata.mode !== 'build';
    refreshPartList();
    refreshSelectionVisuals();
    editing?.select(busy || assemblies.selected() ? null : selected);
  }
  const health = button('', () => showMachineCheck(), 'machine-health');
  health.hidden = true;
  viewport.append(health);
  const snapNotice = element('div', 'snap-notice');
  snapNotice.hidden = true;
  snapNotice.setAttribute('role', 'status');
  viewport.append(snapNotice);
  const guideFeedback = element('div', 'guide-feedback');
  guideFeedback.hidden = true;
  guideFeedback.setAttribute('role', 'status');
  viewport.append(guideFeedback);
  const selectionLabel = element('div', 'selection-label');
  selectionLabel.hidden = true;
  viewport.append(selectionLabel);
  const scopeLabel = element('strong', 'move-scope');
  const mirrorButton = button('Mirror parts…', () => {
    if (!selected) return;
    surface.cancel(false);
    sourcePort = null;
    mirror.start(frame, selected);
  });
  mirrorButton.dataset.command = 'mirror-assembly';
  const footer = element('footer', 'workshop-footer'),
    modeLabel = element('span', 'mode-label', 'BUILD'),
    tickLabel = element('span', 'tick-label', 'Tick 0'),
    message = element('span', 'status-message', 'Choose your first part.'),
    shortcut = element('span', 'shortcuts', 'Space: run / pause · .: one tick');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  footer.append(modeLabel, tickLabel, message, shortcut);
  body.append(left, viewport, rightPanel);
  root.append(header, body, footer, partHelp.panel);
  const graphicsQuality = createGraphicsQuality();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  const graphicsRenderer = createGraphicsRenderer(renderer);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x18252d);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('aria-label', 'Machine view');
  stage.append(renderer.domElement);
  const scene = new THREE.Scene();
  const sensorView = createSensorView(scene);
  const cameraFrustum = createCameraFrustum(scene);
  const springView = createSpringView(scene);
  scene.fog = new THREE.Fog(0x18252d, 8, 30);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  camera.position.set(1.45, 1.15, 1.65);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.15, 0.12, 0);
  controls.addEventListener('end', () =>
    onInteraction?.('camera-end', {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
    }),
  );
  controls.addEventListener('start', () => {
    explodeCameraTween = null;
    if (!exploded) explodeCamera = null;
  });
  controls.addEventListener('change', invalidateScene);
  renderer.domElement.addEventListener('webglcontextrestored', invalidateScene);
  controls.enableDamping = true;
  controls.minDistance = 0.3;
  controls.maxDistance = 15;
  controls.maxPolarAngle = Math.PI * 0.95;
  scene.add(new THREE.HemisphereLight(0xc5e4ef, 0x30434e, 2.5));
  const keyLight = new THREE.DirectionalLight(0xffecd0, 3);
  keyLight.position.set(2, 5, 3);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -4;
  keyLight.shadow.camera.right = 4;
  keyLight.shadow.camera.top = 4;
  keyLight.shadow.camera.bottom = -4;
  keyLight.shadow.normalBias = 0.01;
  scene.add(keyLight);
  const inspectionFill = new THREE.DirectionalLight(0xc5e4ef, 1.2);
  scene.add(inspectionFill, inspectionFill.target);
  const groundData = BUILD_ENVIRONMENT.ground;
  const floorPattern = document.createElement('canvas');
  floorPattern.width = floorPattern.height = 128;
  const floorContext = floorPattern.getContext('2d');
  floorContext.fillStyle = '#263943';
  floorContext.fillRect(0, 0, 128, 128);
  floorContext.strokeStyle = '#39515c';
  for (let line = 32; line < 128; line += 32) {
    floorContext.beginPath();
    floorContext.moveTo(line, 0);
    floorContext.lineTo(line, 128);
    floorContext.moveTo(0, line);
    floorContext.lineTo(128, line);
    floorContext.stroke();
  }
  floorContext.strokeStyle = '#587480';
  floorContext.strokeRect(0, 0, 128, 128);
  const floorTexture = new THREE.CanvasTexture(floorPattern);
  floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.repeat.set(groundData.halfExtents[0] * 10, groundData.halfExtents[2] * 10);
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(...groundData.halfExtents.map((value) => value * 2)),
    new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.95 }),
  );
  ground.position.fromArray(groundData.position);
  ground.receiveShadow = true;
  const boundaryMaterial = new THREE.MeshBasicMaterial({ color: 0xeeb85e });
  const [floorX, floorY, floorZ] = groundData.halfExtents;
  for (const [width, depth, x, z] of [
    [0.15, floorZ * 2, floorX - 0.075, 0],
    [0.15, floorZ * 2, -floorX + 0.075, 0],
    [floorX * 2, 0.15, 0, floorZ - 0.075],
    [floorX * 2, 0.15, 0, -floorZ + 0.075],
  ]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), boundaryMaterial);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(x, floorY + 0.001, z);
    ground.add(stripe);
  }
  scene.add(ground);
  const environmentGroup = new THREE.Group();
  scene.add(environmentGroup);
  function refreshEnvironment(blueprint) {
    for (const mesh of [...environmentGroup.children]) {
      disposePart(mesh);
      environmentGroup.remove(mesh);
    }
    for (const descriptor of environmentObstacles(blueprint.environment)) {
      const [halfLength, radius] = descriptor.halfExtents;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, halfLength * 2, CYLINDER_SEGMENTS).rotateZ(
          -Math.PI / 2,
        ),
        new THREE.MeshStandardMaterial({ color: 0xd3a352, roughness: 0.8 }),
      );
      mesh.position.fromArray(descriptor.position);
      mesh.quaternion.fromArray(descriptor.rotation);
      mesh.castShadow = mesh.receiveShadow = true;
      environmentGroup.add(mesh);
    }
  }
  const guideCues = new THREE.Group();
  scene.add(guideCues);
  const partResources = createResourceCache({
    key: partAppearanceKey,
    create: (part) => {
      const mesh = createPartMesh(part),
        display = new THREE.Group();
      display.add(mesh);
      scene.add(display);
      return mesh;
    },
    dispose: (mesh) => {
      scene.remove(mesh.parent);
      disposePart(mesh);
    },
  });
  const meshes = partResources.values,
    wires = new THREE.Group();
  scene.add(wires);
  const connectionView = createConnectionView(wires);
  const portCues = new THREE.Group();
  scene.add(portCues);
  let portCueKey = '',
    previewEndpoint = null,
    socketPreview = null;
  editing = createEditingControls({
    scene,
    camera,
    renderer,
    orbit: controls,
    getPart: (id) => frame?.metadata.blueprint.parts.find((p) => p.id === id),
    getBlueprint: () => frame.metadata.blueprint,
    getMode: () => (exploded ? 'inspection' : frame?.metadata.mode),
    getMeshes: () => meshes,
    getViewportInsets: () => {
      const rect = stage.getBoundingClientRect();
      let top = 100,
        bottom = 70;
      for (const node of document.querySelectorAll(
        '.edit-toolbar,.inspection-banner,.playtest-panel',
      )) {
        if (node.hidden || !node.getClientRects().length) continue;
        const box = node.getBoundingClientRect();
        if (box.top < rect.top + rect.height / 2) top = Math.max(top, box.bottom - rect.top + 16);
        else bottom = Math.max(bottom, rect.bottom - box.top + 16);
      }
      return { top, bottom, left: 24, right: 24 };
    },
    onCommit: send,
    onInvalidate: invalidateScene,
  });
  surface = createSurfaceControls({
    scene,
    camera,
    renderer,
    orbit: controls,
    getFrame: () => frame,
    getCursor,
    getMeshes: () => meshes,
    send,
    onMessage: setMessage,
    onInteraction,
    createMesh: createPartMesh,
    onInvalidate: invalidateScene,
  });
  function beginSurface(part, options) {
    invalidateScene();
    directDrag.end(false);
    if (exploded) setExploded(false, true);
    editing.cancel();
    editing.setTool('select');
    sourcePort = null;
    previewEndpoint = null;
    const ok = surface.start(part, options);
    inspectorKey = '';
    refreshInspector();
    return ok;
  }
  const surfaceSnapLabel = element('label', 'follow-control'),
    surfaceSnap = element('input');
  surfaceSnap.type = 'checkbox';
  surfaceSnap.checked = true;
  surfaceSnap.setAttribute('aria-label', 'Surface snap');
  surfaceSnapLabel.append(surfaceSnap, document.createTextNode('Surface snap'));
  surfaceSnap.addEventListener('change', () => surface.setEnabled(surfaceSnap.checked));
  let surfacePointer = null;
  renderer.domElement.addEventListener(
    'pointerdown',
    (event) => {
      if (!surface.active() || surfacePointer !== null || event.button !== 0) return;
      if (!surface.beginPointer(event)) return;
      surfacePointer = event.pointerId;
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      event.stopImmediatePropagation();
    },
    true,
  );
  renderer.domElement.addEventListener(
    'pointermove',
    (event) => {
      if (surface.active() && surfacePointer === event.pointerId && event.buttons === 1) {
        event.stopImmediatePropagation();
        surface.point(event, { lock: true });
      }
    },
    true,
  );
  renderer.domElement.addEventListener(
    'pointerup',
    (event) => {
      if (surfacePointer !== event.pointerId || event.button !== 0) return;
      event.stopImmediatePropagation();
      surfacePointer = null;
      surface.endPointer(event);
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(event.pointerId))
        renderer.domElement.releasePointerCapture(event.pointerId);
    },
    true,
  );
  const checkDialog = element('dialog', 'machine-check');
  checkDialog.setAttribute('aria-label', 'Check machine');
  root.append(checkDialog);
  function showMachineCheck() {
    if (!frame) return;
    checkDialog.replaceChildren(element('h2', '', 'Check machine'));
    checkDialog.append(
      element(
        'p',
        'muted',
        `Readings at tick ${frame.tick}. Close and check again after changing the machine.`,
      ),
    );
    const issues = diagnoseMotion(frame);
    if (!issues.length)
      checkDialog.append(
        element(
          'p',
          '',
          frame.metadata.blueprint.parts.some((p) => p.type === 'poweredMotor')
            ? 'No checked wiring or control blocker found. Run the machine to test its motion and physical support.'
            : frame.metadata.blueprint.parts.some((p) => p.type === 'poweredHinge')
              ? 'Motor wiring checks do not cover powered hinges yet. Inspect each hinge’s power, control input and target angle, then Run to test motion and support.'
              : 'No motor wiring checks apply to these parts. Inspect their connections, then Run to test motion and physical support.',
        ),
      );
    for (const issue of issues) {
      const card = element('section', 'machine-check-issue');
      card.dataset.diagnosticCode = issue.code;
      card.append(
        element('h3', '', issue.title),
        element('p', '', issue.action),
        element('p', 'muted small', issue.evidence),
      );
      const part = frame.metadata.blueprint.parts.find((p) => p.id === issue.partId);
      card.append(
        button(`Inspect ${part.name}`, () => {
          checkDialog.close();
          select(part.id);
          if (issue.port) {
            sourcePort = { part: part.id, port: issue.port };
            inspectorKey = '';
            refreshInspector();
          }
        }),
      );
      checkDialog.append(card);
    }
    checkDialog.append(button('Close', () => checkDialog.close(), 'primary'));
    if (!checkDialog.open) checkDialog.showModal();
  }
  const tools = element('div', 'edit-toolbar');
  const checkButton = button('Check machine', showMachineCheck);
  checkButton.dataset.command = 'check-machine';
  modebar.append(checkButton);
  const editGroup = element('div', 'edit-tool-group');
  editGroup.setAttribute('role', 'group');
  editGroup.setAttribute('aria-label', 'Edit tools');
  tools.append(editGroup);
  editGroup.append(surfaceSnapLabel);
  for (const [value, label] of [
    ['select', 'Select · V'],
    ['translate', 'Move · W'],
    ['rotate', 'Rotate · E'],
  ]) {
    const b = button(label, () => {
      setTool(value);
    });
    b.dataset.editTool = value;
    editGroup.append(b);
  }
  editGroup.append(scopeLabel);
  const viewGroup = element('div', 'view-tool-group');
  viewGroup.setAttribute('role', 'group');
  viewGroup.setAttribute('aria-label', 'View');
  tools.append(viewGroup);
  const explodeButton = button('Exploded view', () => setExploded(!exploded));
  explodeButton.dataset.command = 'explode-view';
  explodeButton.setAttribute('aria-pressed', 'false');
  viewGroup.append(
    button('Frame machine · F', () => {
      explodeCameraTween = null;
      editing.focus();
    }),
    explodeButton,
  );
  const wiringLabel = element('label', 'follow-control'),
    wiring = element('input'),
    wiringNotice = element('span', 'wiring-notice', 'Inspection connections shown.');
  wiring.type = 'checkbox';
  wiring.checked = true;
  wiring.setAttribute('aria-label', 'Wiring');
  wiringNotice.hidden = true;
  wiringNotice.setAttribute('role', 'status');
  wiringLabel.append(wiring, document.createTextNode('Wiring'));
  wiring.addEventListener('change', () => {
    wiringPreferences.set(frame?.metadata.mode ?? 'build', wiring.checked);
    updateConnections();
    invalidateScene();
  });
  wiringLabel.title = 'Show power and signal links. These links do not hold parts together.';
  viewGroup.append(wiringLabel, wiringNotice);
  const inspectionBanner = element('div', 'inspection-banner');
  inspectionBanner.hidden = true;
  inspectionBanner.append(
    element('strong', '', 'Inspection view — parts haven’t moved.'),
    element(
      'span',
      '',
      'Select parts or connections to trace them. Dashed lines show attachments.',
    ),
    button('Return to machine', () => setExploded(false)),
  );
  viewport.append(inspectionBanner);
  const followLabel = element('label', 'follow-control'),
    follow = element('input');
  follow.type = 'checkbox';
  follow.checked = true;
  follow.setAttribute('aria-label', 'Follow motion');
  followLabel.append(follow, document.createTextNode('Follow motion'));
  viewGroup.append(followLabel);
  tools.append(health);
  viewport.append(tools);
  const help = element('dialog', 'workshop-dialog');
  help.setAttribute('aria-label', 'Help');
  help.append(
    element('h2', '', 'Controls'),
    element('h3', '', 'Build'),
    element(
      'p',
      '',
      'Drag a part to move it; attached parts move together. Use Adjust mount in the inspector to reposition an attachment. Move W and Rotate E show handles; V returns to direct dragging.',
    ),
    element(
      'p',
      '',
      'Arrows move 2.5 cm. Page Up/Down changes height. Alt + arrows rotates 90°. C copies one disconnected part; Delete removes it. Escape cancels or clears. Ctrl/Cmd+Z undoes.',
    ),
    element('h3', '', 'View'),
    element(
      'p',
      '',
      'Drag empty space to orbit. Right-drag pans; scroll zooms. F brings the machine into view. Wiring shows power and signal links; these links do not hold parts together.',
    ),
    element('h3', '', 'Run and pause'),
    element(
      'p',
      '',
      'Machine controls shows the keys configured on this machine. Space runs or pauses. Return to Build restores the editable starting machine.',
    ),
    hint,
    button('Close help', () => help.close()),
  );
  const buildInfo = element('details', 'build-info');
  const buildText = element('input');
  buildText.readOnly = true;
  buildText.setAttribute('aria-label', 'Build information');
  buildText.value = buildId.textContent;
  const copyStatus = element('p');
  copyStatus.setAttribute('role', 'status');
  buildInfo.append(
    element('summary', '', 'Build information'),
    buildText,
    button('Copy build info', async () => {
      try {
        await navigator.clipboard.writeText(buildText.value);
        copyStatus.textContent = 'Build information copied.';
      } catch {
        buildText.focus();
        buildText.select();
        copyStatus.textContent =
          'Copy is unavailable. The build information is selected; use Ctrl/Cmd+C.';
      }
    }),
    copyStatus,
  );
  help.append(buildInfo);
  root.append(help);
  filebar.append(button('Help', () => help.showModal()));
  const machinePanels = element('div', 'machine-panels');
  viewport.append(machinePanels);
  const motionReadout = createMotionReadout(machinePanels);
  const measurements = button('Measurements', () => {
    const open = measurements.getAttribute('aria-pressed') !== 'true';
    measurements.setAttribute('aria-pressed', String(open));
    motionReadout.setVisible(open);
  });
  measurements.setAttribute('aria-pressed', 'false');
  modebar.append(measurements);
  const machineControlRegion = element('div', 'machine-control-region');
  machinePanels.append(machineControlRegion);
  const vehicleControls = createVehicleControls({ send, select, container: machineControlRegion });
  let retryCamera = null;
  const retryButton = button('Try again', () => send({ type: 'retry' }));
  retryButton.dataset.command = 'retry';
  retryButton.title = 'Restart from your latest setup, keeping your edits and camera.';
  const soundButton = button('Sound off', async () => {
    const enabled = await onSound?.(soundButton.getAttribute('aria-pressed') !== 'true');
    soundButton.setAttribute('aria-pressed', String(!!enabled));
    soundButton.textContent = enabled ? 'Sound on' : 'Sound off';
  });
  soundButton.setAttribute('aria-pressed', 'false');
  const attemptControls = element('div', 'attempt-controls');
  attemptControls.append(retryButton, soundButton);
  machineControlRegion.append(attemptControls);
  const connectionTest = createConnectionTest({
    holdReceiver: (id, duty) => vehicleControls.hold(id, duty),
    releaseReceiver: (id) => vehicleControls.releaseHold(id),
    reveal: (ids) => {
      const next = new Set(ids);
      if (
        next.size === revealedConnectionIds.size &&
        [...next].every((id) => revealedConnectionIds.has(id))
      )
        return;
      revealedConnectionIds = next;
      updateConnections();
      invalidateScene();
    },
    highlight: (ids) => {
      testConnectionIds = new Set(ids);
      updateConnections();
      invalidateScene();
    },
    send,
    select,
    choosePort: (endpoint) => {
      sourcePort = endpoint;
      socketPreview = null;
      previewEndpoint = null;
      editing.clearPreview();
      inspectorKey = '';
      refreshInspector();
      right.querySelector(`[data-port-id="${endpoint.port}"]`)?.focus({ preventScroll: true });
      right.querySelector('.port-explanation')?.scrollIntoView({ block: 'nearest' });
      invalidateScene();
    },
  });

  const mirrorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x70baf5,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  mirrorPlane.visible = false;
  scene.add(mirrorPlane);
  mirror = createAssemblyMirror({
    getCursor,
    completed: setMessage,
    propose: (bp, command) =>
      proposeMirroredAssembly(bp, {
        ids: command.ids,
        referenceId: command.referenceId,
        axis: command.axis,
      }),
    send,
    showPreview: (parts, reference, axis) => {
      editing.showPreview(parts, { color: 0x70baf5 });
      mirrorPlane.visible = true;
      mirrorPlane.position.fromArray(reference.position);
      mirrorPlane.quaternion.fromArray(reference.rotation);
      const normal = new THREE.Vector3(
        axis === 'x' ? 1 : 0,
        axis === 'y' ? 1 : 0,
        axis === 'z' ? 1 : 0,
      );
      mirrorPlane.quaternion.multiply(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal),
      );
      const extent = Math.max(
        0.5,
        ...[reference, ...parts].map(
          (p) => new THREE.Vector3().fromArray(p.position).distanceTo(mirrorPlane.position) * 2,
        ),
      );
      mirrorPlane.scale.setScalar(extent);
      invalidateScene();
    },
    clearPreview: () => {
      editing.clearPreview();
      mirrorPlane.visible = false;
      invalidateScene();
    },
    changed: () => {
      inspectorKey = '';
      refreshInspector();
      refreshSelectionVisuals();
    },
  });

  function setTool(value) {
    invalidateScene();
    surface?.cancel();
    if (mirror?.active()) mirror.cancel();
    if (exploded) setExploded(false, true);
    onInteraction?.('tool', { from: activeTool, to: value });
    activeTool = value;
    editing.setTool(value);
    refreshSelectionVisuals();
    hint.textContent =
      value === 'select'
        ? 'Drag a part to move · Drag empty space to orbit · Scroll to zoom · Esc to clear'
        : value === 'rotate'
          ? 'Drag rings to rotate · V for direct part movement · Drag empty space to orbit'
          : 'Drag arrows to move · V for direct part movement · Drag empty space to orbit';
    for (const button of tools.querySelectorAll('[data-edit-tool]')) {
      const active = button.dataset.editTool === value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
  setTool('select');
  const placementCue = element('div', 'placement-cue');
  placementCue.hidden = true;
  viewport.append(placementCue);
  function showPlacementCue(event, text) {
    const rect = viewport.getBoundingClientRect();
    placementCue.textContent = text;
    placementCue.style.left = `${Math.max(8, Math.min(event.clientX - rect.left + 14, rect.width - 220))}px`;
    placementCue.style.top = `${Math.max(8, Math.min(event.clientY - rect.top + 16, rect.height - 50))}px`;
    placementCue.hidden = false;
  }
  if (assemblies) {
    assemblyPlacement = createAssemblyPlacementView({
      getFrame: () => getAssemblyFrame?.() ?? { ...frame, cursor: getCursor() },
      send: (command) => send(command, true),
      scene,
      camera,
      canvas: renderer.domElement,
      orbit: controls,
      getMachineMeshes: () => meshes.values(),
      createMesh: createPartMesh,
      disposeMesh: disposePart,
      invalidate: invalidateScene,
      onState: refreshAssemblyState,
      onDone: (id) => {
        selected = null;
        assemblies.selectGroup(id);
        placeAnother.hidden = false;
        refreshAssemblyState();
      },
      onCancel: () => savedAssemblies.open(savedLauncher),
    });
    left.insertBefore(savedLauncher, palette);
    rightPanel.insertBefore(createAssembly, machinePicker);
    rightPanel.insertBefore(assemblies.panel, right);
    rightPanel.insertBefore(placeAnother, right);
    rightPanel.insertBefore(assemblyPlacement.panel, right);
    root.append(savedAssemblies.dialog);
  }
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  raycaster.params.Line.threshold = 0.012;
  let pointerStart = null;
  function refreshSelectionVisuals() {
    motionReadout.selectBody(selected, getAssemblyFrame?.() ?? frame);
    const edge = frame?.metadata.blueprint.connections.find((c) => c.id === tracedConnection);
    const group = assemblies?.contextual()
      ? assemblies.drafting()
        ? assemblies.members()
        : [
            ...new Set(
              assemblies.members().flatMap((id) => mechanicalGroup(frame.metadata.blueprint, id)),
            ),
          ]
      : exploded
        ? edge
          ? [edge.a.part, edge.b.part]
          : []
        : frame?.metadata.mode === 'build'
          ? mechanicalGroup(frame.metadata.blueprint, selected)
          : [];
    for (const [id, mesh] of meshes) {
      const primary = assemblies?.drafting() ? id === assemblies.members()[0] : id === selected,
        member = group.includes(id);
      mesh.material.emissive.setHex(primary ? 0x614017 : member ? 0x123b35 : 0);
      const outline = mesh.userData.selectionOutline;
      outline.visible = primary || member;
      outline.material.color.setHex(primary ? 0xffc778 : 0x8cf5cf);
    }
    mirrorButton.disabled =
      (frame?.metadata.blueprint.parts.length ?? 0) < 2 ||
      frame?.metadata.mode !== 'build' ||
      exploded ||
      !!assemblies?.busy() ||
      !!assemblyPlacement?.active();
    scopeLabel.textContent = movementScope({
      mode: frame?.metadata.mode,
      tool: activeTool,
      count: group.length,
      blocked: surface.active() || exploded || mirror?.active(),
    });
    scopeLabel.hidden = !scopeLabel.textContent;
    scopeLabel.title =
      group.length > 1
        ? 'Mint outlines show everything that moves. Disconnect a mount or shaft to separate parts.'
        : 'Power and signal wires do not attach parts physically.';
  }
  function refreshSprings() {
    const blueprint = frame.metadata.blueprint;
    const springRows = [];
    for (const edge of blueprint.connections.filter((c) => c.kind === 'spring')) {
      const a = blueprint.parts.find((p) => p.id === edge.a.part),
        b = blueprint.parts.find((p) => p.id === edge.b.part);
      const end = (p, e) =>
        meshes
          .get(p.id)
          .localToWorld(
            new THREE.Vector3(...CATALOG[p.type].ports.find((x) => x.id === e.port).position),
          );
      meshes.get(a.id).updateMatrixWorld(true);
      meshes.get(b.id).updateMatrixWorld(true);
      springRows.push({
        id: edge.id,
        a: a.type === 'springGuide' ? end(a, edge.a) : end(b, edge.b),
        b: a.type === 'springGuide' ? end(b, edge.b) : end(a, edge.a),
        settings: (a.type === 'springGuide' ? a : b).parameters,
        selected: [a.id, b.id].includes(selected),
      });
    }
    springView.update(springRows, selected);
    const readout = right.querySelector('.spring-readout');
    if (readout) {
      const edge = blueprint.connections.find(
        (c) => c.kind === 'spring' && [c.a.part, c.b.part].includes(selected),
      );
      const guidePart =
        edge &&
        blueprint.parts.find(
          (p) => [edge.a.part, edge.b.part].includes(p.id) && p.type === 'springGuide',
        );
      const state =
        guidePart && frame.springs?.find((x) => x.bodyA === blueprint.parts.indexOf(guidePart));
      readout.textContent = !edge
        ? 'Unattached · no spring force'
        : state
          ? `${state.length <= state.minLength + 0.001 ? 'Fully compressed' : state.length >= state.maxLength - 0.001 ? 'Fully extended' : 'Attached · slides; does not swivel'} · ${format(state.length, 3)} m length · ${format(-state.extension, 3)} m compression · ${format(state.speed, 3)} m/s · ${format(state.length - state.minLength, 3)} m to compression stop · ${format(state.maxLength - state.length, 3)} m to extension stop · ${format(state.potentialJ, 3)} J spring energy`
          : 'Attached · slides; does not swivel';
    }
  }
  function select(id) {
    if (assemblyPlacement?.active()) return;
    if (assemblies?.drafting()) {
      assemblies.toggle(id);
      return;
    }
    assemblies?.selectPart();
    right.hidden = false;
    invalidateScene();
    surface?.cancel(false);
    connectionTest?.release();
    if (mirror?.active()) mirror.cancel();
    showGuideConnection(null);
    onInteraction?.('selection', { from: selected, to: id });
    editing?.select(id);
    if (id !== selected) rightPanel.scrollTop = 0;
    selected = id;
    tracedConnection = null;
    sourcePort = null;
    previewEndpoint = null;
    socketPreview = null;
    editing?.clearPreview();
    inspectorKey = '';
    refreshInspector();
    updateSensorInspector(frame, right);
    updateControllerEditor(frame, right);
    sensorView.update(frame, selected);
    refreshLive();
    refreshSprings();
    refreshPartList();
    refreshSelectionVisuals();
    updateConnections();
    refreshAssemblyState();
  }
  const down = (event) => {
    pointerStart = [event.clientX, event.clientY];
  };
  const up = (event) => {
    if (assemblyPlacement?.active()) {
      if (
        pointerStart &&
        Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) <= 5
      )
        assemblyPlacement.point(event);
      return;
    }
    if (surface?.active() || mirror?.active()) return;
    if (sourcePort && socketPreview) {
      if (
        pointerStart &&
        Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) <= 5 &&
        editing.hitPreview(event)
      ) {
        if (socketPreview.valid) socketPreview.button.click();
      }
      return;
    }
    if (editing.isDragging() || editing.isHandleActive()) return;
    if (
      !pointerStart ||
      Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5
    )
      return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    raycaster.params.Line.threshold =
      (camera.position.distanceTo(controls.target) *
        2 *
        Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
        6) /
      stage.clientHeight;
    const connectionHit =
      exploded &&
      raycaster
        .intersectObjects(connectionView.pickableObjects())
        .find((hit) => hit.object.userData.connectionId);
    if (connectionHit) {
      traceConnection(connectionHit.object.userData.connectionId);
      return;
    }
    const hit = raycaster.intersectObjects([...meshes.values()]).find((hit) => hit.object.isMesh);
    select(hit?.object.userData.partId ?? null);
  };
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointerup', up);
  const directDrag = createDirectDrag({
    renderer,
    camera,
    controls,
    editing,
    surface,
    getFrame: () => frame,
    getMeshes: () => meshes,
    canStart: (event) =>
      !assemblies?.busy() &&
      !assemblies?.selected() &&
      !assemblyPlacement?.active() &&
      !sourcePort &&
      !surface.active() &&
      !mirror.active() &&
      !exploded &&
      !explodeAmount &&
      event.button === 0 &&
      frame?.metadata.mode === 'build' &&
      activeTool === 'select' &&
      !editing.isHandleActive(),
    select,
    send,
    placementCue,
    showPlacementCue,
    setMessage,
    onSurfaceStart() {
      inspectorKey = '';
      refreshInspector();
    },
  });
  function releaseSurfacePointer() {
    const id = surfacePointer;
    surfacePointer = null;
    if (id !== null && renderer.domElement.hasPointerCapture(id))
      renderer.domElement.releasePointerCapture(id);
    controls.enabled = true;
  }
  function cancelInteraction() {
    invalidateScene();
    directDrag.end(false);
    releaseSurfacePointer();
    surface?.cancel(false);
    draggingType = null;
    if (sourcePort) {
      sourcePort = null;
      previewEndpoint = null;
      socketPreview = null;
      inspectorKey = '';
      refreshInspector();
      updateConnections();
    }
    placementCue.hidden = true;
    editing?.cancel();
    controls.enabled = true;
  }
  renderer.domElement.addEventListener('pointercancel', cancelInteraction);
  renderer.domElement.addEventListener('lostpointercapture', () => {
    if (surfacePointer !== null || directDrag.active()) cancelInteraction();
  });

  function droppedPosition(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return null;
    const h = CATALOG[draggingType]?.primitives[0].halfExtents;
    if (!h) return null;
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const point = raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -h[1]),
      new THREE.Vector3(),
    );
    if (!point) return null;
    return [Math.round(point.x / 0.025) * 0.025, h[1], Math.round(point.z / 0.025) * 0.025];
  }
  let surfaceDropSequence = 0;
  renderer.domElement.addEventListener('dragover', (event) => {
    if (!draggingType || frame?.metadata.mode !== 'build') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (surface.enabled()) {
      if (!surface.active()) {
        let id;
        do {
          id = `dropped-${++surfaceDropSequence}`;
        } while (frame.metadata.blueprint.parts.some((p) => p.id === id));
        surface.start(id, { insertPart: createPart(draggingType, id, [0, 0, 0]), drag: true });
        right.append(surface.panel);
      }
      if (surface.point(event, { lock: false })) {
        showPlacementCue(
          event,
          surface.read().valid
            ? surface.read().attach
              ? 'Release to attach to surface'
              : 'Release to position · no attachment'
            : 'Placement blocked · check the mounting panel',
        );
        return;
      }
    }
    showPlacementCue(event, 'Release to place · 2.5 cm grid');
    const position = droppedPosition(event);
    if (position) {
      const part = createPart(draggingType, 'placement-preview', position);
      const overlap = findPlacementOverlap([...frame.metadata.blueprint.parts, part]);
      editing.showPreview([part], { color: overlap ? 0xff836f : 0x8cf5cf });
      if (overlap) showPlacementCue(event, 'Placement overlaps a part · Move clear');
    }
  });
  renderer.domElement.addEventListener('dragleave', () => {
    placementCue.hidden = true;
    editing.clearPreview();
  });
  renderer.domElement.addEventListener('drop', async (event) => {
    if (!draggingType || frame?.metadata.mode !== 'build') return;
    event.preventDefault();
    const position = droppedPosition(event),
      partType = draggingType;
    draggingType = null;
    placementCue.hidden = true;
    editing.clearPreview();
    if (surface.active()) surface.point(event, { lock: false });
    if (surface.read()?.target) {
      await surface.commit();
      return;
    }
    surface.cancel(false);
    if (position) {
      await send({ type: 'place', partType, position });
      setMessage('Part placed. Use Snap to surface to mount it, or connect its sockets.');
    }
  });
  function setMessage(text) {
    message.textContent = String(text);
  }
  function refreshPartList() {
    clearButton.disabled = selected === null && !assemblies?.selected();
    partCount.textContent = `Machine · ${frame?.metadata?.blueprint?.parts.length ?? 0}`;
    partList.replaceChildren();
    for (const group of frame?.metadata.blueprint.assemblies ?? []) {
      const item = button(
        `${group.name} · ${group.ids.length} parts`,
        () => {
          if (assemblies.busy() || assemblyPlacement.active()) return;
          cancelInteraction();
          selected = null;
          assemblies.selectGroup(group.id);
          machinePicker.open = false;
        },
        'part-list-item assembly-list-item',
      );
      item.setAttribute('aria-label', `Select assembly ${group.name}`);
      item.setAttribute('aria-pressed', String(assemblies?.selected() === group.id));
      item.dataset.assemblyId = group.id;
      partList.append(item);
    }
    for (const part of frame?.metadata?.blueprint?.parts ?? []) {
      const item = button(
        part.name,
        () => {
          machinePicker.open = false;
          select(part.id);
        },
        `part-list-item${part.id === selected ? ' selected' : ''}`,
      );
      item.dataset.partId = part.id;
      partList.append(item);
    }
  }
  function endpointName(part, endpoint) {
    return endpoint.surface
      ? (surfaceRegions(part).find((r) => r.id === endpoint.surface.region)?.label ??
          endpoint.surface.region)
      : endpoint.port;
  }
  function endpointDefinition(part, endpoint) {
    return endpoint.surface
      ? resolveSurfaceEndpoint(part, endpoint)
      : CATALOG[part.type].ports.find((p) => p.id === endpoint.port);
  }
  function compatible(a, b) {
    return a.kind === b.kind && (a.kind !== 'signal' || a.direction !== b.direction);
  }
  function portConnections(part, port) {
    return frame.metadata.blueprint.connections.filter((connection) =>
      [connection.a, connection.b].some(
        (endpoint) => endpoint.part === part.id && endpoint.port === port.id,
      ),
    );
  }
  function occupied(part, port) {
    return port.multiplicity === 'one' && portConnections(part, port).length > 0;
  }
  let photoOrbit = null;
  const cameraControls = cameraSession
    ? createCameraControls({
        root,
        stage,
        service: cameraSession,
        clearControls: () => vehicleControls.clear(),
        onFrustumChange: () => invalidateScene(),
        onViewing: (active) => {
          if (active && !photoOrbit)
            photoOrbit = { position: camera.position.clone(), target: controls.target.clone() };
          if (!active && photoOrbit) {
            camera.position.copy(photoOrbit.position);
            controls.target.copy(photoOrbit.target);
            photoOrbit = null;
            followCenter = null;
            invalidateScene();
          }
          controls.enabled = !active;
        },
      })
    : null;
  function refreshInspector() {
    if (!frame) return;
    right.hidden = !!assemblies?.contextual() || !!assemblyPlacement?.active();
    sensorView.update(frame, right.hidden ? null : selected);
    cameraControls?.selection(right.hidden ? null : selected);
    if (right.hidden) return;
    const parts = frame.metadata.blueprint.parts,
      part = parts.find((item) => item.id === selected),
      mode = frame.metadata.mode;
    const nextKey = JSON.stringify([
      blueprintKey,
      selected,
      sourcePort,
      mode,
      exploded,
      surface.active(),
      mirror?.active(),
    ]);
    if (nextKey === inspectorKey) return;
    inspectorKey = nextKey;
    const focusLabel =
      right.dataset.partId === selected && right.contains(document.activeElement)
        ? document.activeElement.getAttribute('aria-label')
        : null;
    const openSections =
      right.dataset.partId === selected
        ? [...right.querySelectorAll('details[open]')].map((node) => node.className)
        : [];
    right.dataset.partId = selected ?? '';
    right.dataset.inspectorType = part?.type ?? '';
    right.replaceChildren();
    const assembly = (frame.metadata.blueprint.assemblies ?? []).find((g) =>
      g.ids.includes(selected),
    );
    if (assembly)
      right.append(
        button(`Select assembly ${assembly.name}`, () => {
          cancelInteraction();
          selected = null;
          assemblies.selectGroup(assembly.id);
        }),
      );
    if (!part) {
      connectionTest.render(frame, null, false, right);
      right.append(
        element(
          'p',
          'selection-hint',
          'Select a part in the workbench or Machine menu to inspect and connect it.',
        ),
      );
      return;
    }
    const definition = CATALOG[part.type],
      body = frame.physics[parts.indexOf(part)],
      editable = mode === 'build' && !exploded;
    const selectedHeader = element('div', 'selected-part-header'),
      identity = element('div', 'part-identity'),
      icon = partIcon(part.type),
      existingIcon = left.querySelector(`[data-icon-type="${part.type}"]`);
    if (existingIcon) icon.src = existingIcon.src;
    const aboutPart = partHelp.about(part.type, 'About this part');
    aboutPart.classList.add('inspector-part-about');
    aboutPart.setAttribute('aria-label', 'About this part');
    aboutPart.title = 'About this part';
    aboutPart.replaceChildren(icon, element('span', 'help-badge', 'ⓘ'));
    identity.append(aboutPart, element('h2', '', part.name));
    if (part.name !== definition.name)
      identity.append(element('span', 'part-kind', definition.name));
    const actions = element('div', 'part-actions'),
      duplicate = button('Copy · C', () => copySelected(), 'quiet'),
      remove = button('Delete · X', () => send({ type: 'delete', id: part.id }), 'danger quiet');
    duplicate.setAttribute('aria-label', 'Copy part · C');
    remove.setAttribute('aria-label', 'Delete part');
    duplicate.disabled = remove.disabled = !editable;
    actions.append(clearButton, duplicate, remove);
    selectedHeader.append(identity, actions);
    right.append(selectedHeader);
    if (mirror?.active()) {
      right.append(mirror.panel);
      return;
    }

    const rename = button(
      'Rename',
      () => {
        const editor = element('form', 'part-name-editor'),
          input = element('input');
        input.value = part.name;
        input.maxLength = 128;
        input.required = true;
        input.setAttribute('aria-label', 'Part name');
        const save = element('button', '', 'Save name');
        save.type = 'submit';
        const cancel = button('Cancel', () => refreshName());
        function refreshName() {
          inspectorKey = '';
          refreshInspector();
        }
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            refreshName();
          }
        });
        editor.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!input.value.trim()) {
            input.setCustomValidity('Enter a part name.');
            input.reportValidity();
            return;
          }
          const result = await send({ type: 'rename', id: part.id, name: input.value });
          if (result?.ok) refreshName();
        });
        input.addEventListener('input', () => input.setCustomValidity(''));
        editor.append(input, save, cancel);
        rename.replaceWith(editor);
        input.focus();
        input.select();
      },
      'quiet',
    );
    rename.setAttribute('aria-label', 'Rename part');
    rename.disabled = !editable;
    identity.append(rename);

    if (exploded) {
      const links = frame.metadata.blueprint.connections.filter(
        (c) => c.a.part === part.id || c.b.part === part.id,
      );
      right.append(element('h3', '', 'Trace connections'));
      for (const edge of links) {
        const other = edge.a.part === part.id ? edge.b : edge.a,
          peer = parts.find((p) => p.id === other.part);
        const trace = button(
          `${labels[edge.kind]} → ${peer.name} · ${endpointName(peer, other)}`,
          () => traceConnection(edge.id),
          'trace-connection',
        );
        trace.dataset.connectionId = edge.id;
        trace.setAttribute('aria-pressed', String(tracedConnection === edge.id));
        right.append(trace);
      }
      if (!links.length)
        right.append(
          element('p', 'muted', 'No connections. Return to machine to connect this part.'),
        );
      const edge = links.find((c) => c.id === tracedConnection);
      if (edge) {
        const end = (e) =>
          `${parts.find((p) => p.id === e.part).name} · ${endpointName(
            parts.find((p) => p.id === e.part),
            e,
          )}`;
        right.append(
          element(
            'p',
            'trace-description',
            `${end(edge.a)} ↔ ${end(edge.b)}. ${edge.kind === 'power' ? 'Carries electrical power; does not hold parts together.' : edge.kind === 'signal' ? 'Carries commands; does not hold parts together.' : edge.kind === 'shaft' ? 'Joins the shaft to the axle and transmits rotation.' : 'Holds these parts together.'}`,
          ),
        );
      }
      right.append(button('Return to machine to edit', () => setExploded(false), 'primary'));
      return;
    }

    function returnToBuild(target) {
      const note = element('div', 'edit-mode-note');
      note.append(
        element('span', '', 'Return to Build to edit.'),
        button('Return to Build', () => send({ type: 'build' }), 'quiet'),
      );
      target.append(note);
    }
    function bindParameterInput(input, key) {
      let tabTarget = null;
      const tabStops = () =>
        [
          ...right.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]'),
        ].filter((node) => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
      input.addEventListener('keydown', (event) => {
        tabTarget = null;
        if (event.key === 'Escape') {
          input.value = String(part.parameters[key]);
          return;
        }
        if (event.key !== 'Tab') return;
        const stops = tabStops(),
          index = stops.indexOf(input) + (event.shiftKey ? -1 : 1);
        if (index >= 0 && index < stops.length) tabTarget = index;
      });
      input.addEventListener('change', async () => {
        const target = tabTarget;
        tabTarget = null;
        // Send while the trusted change event is active. Only focus restoration
        // waits for the rebuilt inspector; native Tab still chooses its direction.
        await send({ type: 'parameter', id: part.id, key, value: Number(input.value) });
        if (target !== null && selected === part.id) tabStops()[target]?.focus();
      });
      input.addEventListener('blur', () => {
        tabTarget = null;
      });
    }
    function parameterControl(key) {
      const parameter = definition.parameterDefinitions[key],
        label = element('div', 'setting primary-setting'),
        input = element('input');
      label.append(element('span', '', parameterLabels[key] ?? key));
      input.type = 'number';
      input.value = part.parameters[key];
      input.min = parameter.minimum;
      input.max = parameter.maximum;
      input.step = parameter.type === 'integer' ? '1' : 'any';
      input.disabled = !editable;
      input.setAttribute('aria-label', key === 'defaultDuty' ? 'Drive setting' : key);
      bindParameterInput(input, key);
      label.append(input);
      if (
        key === 'defaultDuty' &&
        !definition.ports.some(
          (port) => port.kind === 'signal' && portConnections(part, port).length,
        )
      ) {
        const range = element('input', 'drive-range');
        range.type = 'range';
        range.min = '-1';
        range.max = '1';
        range.step = '.05';
        range.value = part.parameters[key];
        range.disabled = !editable;
        range.setAttribute('aria-label', 'Drive strength');
        range.addEventListener('input', () => {
          input.value = range.value;
        });
        range.addEventListener('change', async () => {
          await send({ type: 'parameter', id: part.id, key, value: Number(range.value) });
          if (selected === part.id)
            right.querySelector('.drive-range')?.focus({ preventScroll: true });
        });
        label.append(range);
        const directions = element('div', 'drive-directions');
        for (const [value, title] of [
          [-1, 'Reverse'],
          [0, 'Off'],
          [1, 'Forward'],
        ]) {
          const preset = button(title, () => send({ type: 'parameter', id: part.id, key, value }));
          preset.disabled = !editable;
          preset.setAttribute(
            'aria-pressed',
            String(
              value === 0 ? part.parameters[key] === 0 : Math.sign(part.parameters[key]) === value,
            ),
          );
          directions.append(preset);
        }
        label.append(directions);
      }
      if (parameterHelp[key]) label.append(element('span', 'parameter-help', parameterHelp[key]));
      return label;
    }
    if (surfaceRegions(part).length) {
      const mounting = element('section', 'mount-status');
      mounting.setAttribute('aria-label', 'Mounting');
      const edges = frame.metadata.blueprint.connections.filter(
        (c) => c.kind === 'fixed' && (c.a.part === part.id || c.b.part === part.id),
      );
      const axleEdges = frame.metadata.blueprint.connections.filter(
        (c) =>
          ['shaft', 'spring'].includes(c.kind) && (c.a.part === part.id || c.b.part === part.id),
      );
      if (!edges.length && !axleEdges.length) mounting.append(element('p', '', 'Unattached'));
      for (const edge of edges.length ? [] : axleEdges) {
        const peer = parts.find(
          (p) => p.id === (edge.a.part === part.id ? edge.b.part : edge.a.part),
        );
        mounting.append(
          element('p', '', `${edge.kind === 'spring' ? 'Slide' : 'Axle'} attached to ${peer.name}`),
          element(
            'p',
            'parameter-help',
            edge.kind === 'spring'
              ? 'Slides along the guide axis; does not swivel.'
              : 'The axle holds these parts together and allows rotation.',
          ),
        );
      }
      for (const edge of edges) {
        const own = edge.a.part === part.id ? edge.a : edge.b,
          other = edge.a.part === part.id ? edge.b : edge.a,
          peer = parts.find((p) => p.id === other.part),
          row = element('div', 'mount-relationship');
        row.append(element('span', '', `Bolted to ${peer.name} · ${endpointName(peer, other)}`));
        if (editable && edge.b.part === part.id && own.surface && other.surface)
          row.append(
            button('Adjust mount', () => beginSurface(part.id, { replaceConnection: edge.id })),
          );
        if (editable)
          row.append(button('Detach', () => send({ type: 'disconnect', id: edge.id }), 'quiet'));
        mounting.append(row);
      }
      if (editable && !edges.length && !surface.active()) {
        const snap = button('Snap to surface', () => beginSurface(part.id));
        snap.dataset.command = 'snap-surface';
        mounting.append(snap);
      }
      if (surface.active()) mounting.append(surface.panel);
      right.append(mounting);
    }
    const live = element('div', 'part-live');
    live.dataset.livePart = part.id;
    right.append(live);
    if (
      definition.parameterDefinitions.inputPolarity &&
      (part.parameters.inputPolarity === -1 ||
        frame.metadata.blueprint.connections.some(
          (c) =>
            c.kind === 'signal' &&
            [c.a, c.b].some((e) => e.part === part.id && e.port === 'signal'),
        ))
    ) {
      const label = element('label', 'actuator-direction'),
        toggle = element('input');
      toggle.type = 'checkbox';
      toggle.checked = (part.parameters.inputPolarity ?? 1) < 0;
      toggle.disabled = !editable;
      toggle.setAttribute('aria-label', 'Reverse direction');
      toggle.onchange = () =>
        send({
          type: 'parameter',
          id: part.id,
          key: 'inputPolarity',
          value: toggle.checked ? -1 : 1,
        });
      label.append(toggle, document.createTextNode('Reverse direction'));
      label.title =
        'Reverses this actuator’s response, including wired controls. Use this for opposite-facing motors sharing one receiver.';
      right.append(label);
    }

    if (part.type === 'poweredMotor') {
      const signal = definition.ports.find((p) => p.kind === 'signal'),
        connection = signal && portConnections(part, signal)[0];
      if (connection) {
        const endpoint = connection.a.part === part.id ? connection.b : connection.a,
          owner = parts.find((p) => p.id === endpoint.part),
          ownership = element('div', 'signal-ownership');
        ownership.append(
          element('span', '', 'Drive commanded by '),
          button(owner?.name ?? endpoint.part, () => select(endpoint.part), 'part-link'),
          element(
            'span',
            'parameter-help',
            'The signal replaces this motor’s default drive setting.',
          ),
        );
        right.append(ownership);
      } else right.append(parameterControl('defaultDuty'));
    }
    if (part.type === 'poweredHinge') {
      const controls = element('div', 'hinge-target');
      const degrees = (radians) => (radians * 180) / Math.PI;
      controls.append(
        element(
          'p',
          'parameter-help',
          `Travel ${format(degrees(part.parameters.lowerLimit), 0)}° to ${format(degrees(part.parameters.upperLimit), 0)}°. Power is required to reach and hold an angle.`,
        ),
      );
      if (!portConnections(part, { id: 'signal' }).length) {
        const label = element('label', 'setting', 'Target angle (°)'),
          input = element('input');
        input.type = 'number';
        input.step = 'any';
        input.min = degrees(part.parameters.lowerLimit);
        input.max = degrees(part.parameters.upperLimit);
        input.disabled = !editable;
        const angle =
          part.parameters.defaultTarget *
          (part.parameters.defaultTarget < 0
            ? -part.parameters.lowerLimit
            : part.parameters.upperLimit);
        input.value = format(degrees(angle), 1);
        input.setAttribute('aria-label', 'Target angle (degrees)');
        input.onchange = () => {
          if (input.checkValidity()) {
            const radians = (Number(input.value) * Math.PI) / 180;
            send({
              type: 'parameter',
              id: part.id,
              key: 'defaultTarget',
              value:
                radians / (radians < 0 ? -part.parameters.lowerLimit : part.parameters.upperLimit),
            });
          }
        };
        input.onkeydown = (event) => {
          if (event.key === 'Escape') input.value = format(degrees(angle), 1);
        };
        label.append(input);
        controls.append(label);
      }
      right.append(controls);
    }
    if (definition.parameterDefinitions.diameter) {
      const dimensions = element('div', 'setting primary-setting'),
        number = element('input'),
        slider = element('input'),
        notice = element('p', 'parameter-help');
      const value =
        (part.parameters.diameter ?? definition.parameterDefinitions.diameter.default) * 1000;
      dimensions.append(element('label', '', 'Diameter (mm)'));
      number.type = 'number';
      slider.type = 'range';
      for (const control of [number, slider]) {
        control.min = String(definition.parameterDefinitions.diameter.minimum * 1000);
        control.max = String(definition.parameterDefinitions.diameter.maximum * 1000);
        control.step = control === number ? 'any' : '10';
        control.value = String(value);
        control.disabled = !editable;
        control.setAttribute(
          'aria-label',
          `${part.type === 'ball' ? 'Ball' : 'Wheel'} diameter${control === number ? ' (mm)' : ''}`,
        );
      }
      const candidate = () => ({
        ...part,
        parameters: { ...part.parameters, diameter: Number(number.value) / 1000 },
      });
      const obstruction = (next) =>
        parts.find(
          (other) =>
            other.id !== part.id &&
            placementEnvelopes(next).some((a) =>
              placementEnvelopes(other).some((b) => solidsOverlap(a, b)),
            ),
        );
      function previewDiameter(control) {
        number.value = slider.value = control.value;
        if (!number.checkValidity()) {
          notice.textContent = `Choose a diameter from ${number.min} to ${number.max} mm.`;
          return;
        }
        const next = candidate(),
          other = obstruction(next);
        editing.showPreview([next], { color: other ? 0xff836f : 0x8cf5cf });
        notice.textContent = other
          ? `Too large here: overlaps ${other.name}. Move the part to make room, then resize.`
          : 'Size preview · release the slider or confirm the number to apply.';
        invalidateScene();
      }
      for (const control of [number, slider]) {
        control.addEventListener('input', () => previewDiameter(control));
        control.addEventListener('change', async () => {
          if (!number.checkValidity() || obstruction(candidate())) return;
          editing.clearPreview();
          const result = await send({
            type: 'parameter',
            id: part.id,
            key: 'diameter',
            value: Number(number.value) / 1000,
          });
          if (!result?.ok)
            notice.textContent = explainFailure(result ?? {}, frame.metadata.blueprint);
          invalidateScene();
        });
        control.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            number.value = slider.value = String(value);
            editing.clearPreview();
            notice.textContent = '';
            invalidateScene();
          }
        });
      }
      dimensions.append(number, slider, notice);
      right.append(dimensions);
      const axle = definition.ports.find((p) => p.kind === 'shaft'),
        connection = axle && portConnections(part, axle)[0];
      if (connection) {
        const endpoint = connection.a.part === part.id ? connection.b : connection.a,
          peer = parts.find((p) => p.id === endpoint.part),
          ownership = element('div', 'axle-ownership');
        ownership.append(
          element('span', '', peer?.type === 'poweredMotor' ? 'Driven by ' : 'Axle attached to '),
          button(peer?.name ?? endpoint.part, () => select(endpoint.part), 'part-link'),
        );
        right.append(ownership);
      }
    }
    springInspector({ part, right, editable, element, send });
    targetSensorInspector({ part, blueprint: frame.metadata.blueprint, right, editable, send });
    if (part.type === 'learningController' && learningControls) {
      const teach = button('Teach a controller', () => learningControls.open(part.id, teach));
      teach.dataset.learningOpener = part.id;
      right.append(teach);
    }
    if (part.type === 'travelSensor') {
      const label = element('label', 'setting');
      label.append(element('span', '', 'Measured spring'));
      const binding = element('select');
      binding.setAttribute('aria-label', 'Measured spring');
      binding.disabled = !editable;
      const empty = element(
        'option',
        '',
        part.springBinding ? 'Missing spring — choose a connection' : 'Unbound',
      );
      empty.value = '';
      binding.append(empty);
      for (const edge of frame.metadata.blueprint.connections.filter((c) => c.kind === 'spring')) {
        const option = element(
          'option',
          '',
          [edge.a.part, edge.b.part]
            .map((id) => parts.find((p) => p.id === id)?.name ?? id)
            .join(' ↔ '),
        );
        option.value = edge.id;
        binding.append(option);
      }
      binding.value = part.springBinding ?? '';
      binding.onchange = () =>
        send({ type: 'bind-travel-sensor', id: part.id, connection: binding.value || null });
      label.append(binding);
      right.append(label);
    }
    controllerEditor.mount({ part, blueprint: frame.metadata.blueprint, right, editable });
    mountControllerHistory({
      right,
      part,
      blueprint: frame.metadata.blueprint,
      history: controllerHistory,
      send,
      inspectPart: select,
    });
    cameraControls?.inspector(part, right);
    sensorInspector({ part, blueprint: frame.metadata.blueprint, right, editable, send });
    updateSensorInspector(frame, right);
    updateControllerEditor(frame, right);
    if (part.type === 'commandReceiver') {
      const modeControls = element('div', 'drive-buttons');
      for (const value of ['manual', 'automatic', 'learned', 'off']) {
        const control = button(value[0].toUpperCase() + value.slice(1), () =>
          send({ type: 'control-mode', id: part.id, mode: value }),
        );
        control.disabled = frame.metadata.mode !== 'run';
        modeControls.append(control);
      }
      right.append(
        modeControls,
        element(
          'p',
          'parameter-help',
          'Off removes active drive; it is not a brake. Manual input takes over until you choose Automatic again.',
        ),
      );
      const incoming = frame.metadata.blueprint.connections.find(
        (c) =>
          c.kind === 'signal' && [c.a, c.b].some((e) => e.part === part.id && e.port === 'command'),
      );
      const regulator =
        incoming &&
        parts.find(
          (p) => p.id === (incoming.a.part === part.id ? incoming.b.part : incoming.a.part),
        );
      if (regulator?.type === 'positionRegulator') {
        const label = element('label', 'setting'),
          input = element('input');
        label.append(element('span', '', 'Target spring length (m)'));
        input.type = 'number';
        input.step = '0.001';
        input.min = regulator.parameters.minTarget;
        input.max = regulator.parameters.maxTarget;
        input.value =
          frame.receiverControl?.receivers.find(
            (r) => r.node === parts.findIndex((p) => p.id === part.id),
          )?.target ?? regulator.parameters.target;
        input.disabled = frame.metadata.mode !== 'run';
        input.setAttribute('aria-label', 'Target spring length');
        const status = element('span', 'parameter-help');
        status.setAttribute('role', 'status');
        input.onchange = async () => {
          const result = await send({
            type: 'regulator-target',
            id: part.id,
            target: Number(input.value),
          });
          if (!result?.ok) {
            input.value =
              frame.receiverControl?.receivers.find(
                (r) => r.node === parts.findIndex((p) => p.id === part.id),
              )?.target ?? regulator.parameters.target;
            status.textContent = `Kept ${input.value} m. Choose ${regulator.parameters.minTarget}–${regulator.parameters.maxTarget} m.`;
          } else status.textContent = '';
        };
        label.append(input, status);
        right.append(label);
      }
      vehicleControls.inspector(part, right, editable);
      const driving = element('div', 'drive-buttons');
      driving.append(
        button('Output +1', () => vehicleControls.drive(part.id, 1)),
        button('Zero', () => vehicleControls.drive(part.id, 0)),
        button('Output −1', () => vehicleControls.drive(part.id, -1)),
      );
      for (const button of driving.children) button.disabled = !vehicleControls.canDrive(part.id);
      right.append(driving);
    }
    if (!editable) returnToBuild(right);
    right.append(element('h3', 'connections-heading', 'Connections'));
    if (tracedConnection)
      right.append(
        button(
          'Clear trace',
          () => {
            tracedConnection = null;
            inspectorKey = '';
            refreshInspector();
            updateConnections();
            invalidateScene();
          },
          'quiet',
        ),
      );
    const ports = element('div', 'port-list');
    right.append(ports);
    const orderedPorts =
      part.type === 'gripWheel'
        ? [...definition.ports].sort(
            (a, b) => Number(b.kind === 'shaft') - Number(a.kind === 'shaft'),
          )
        : definition.ports;
    for (const port of orderedPorts) {
      const connections = portConnections(part, port),
        chosen = sourcePort?.part === part.id && sourcePort?.port === port.id,
        optional =
          !connections.length &&
          ((part.type === 'gripWheel' && port.kind === 'fixed') ||
            (part.type === 'poweredMotor' && port.kind === 'signal'));
      const item = button(
        '',
        () => {
          socketPreview = null;
          sourcePort = chosen ? null : { part: part.id, port: port.id };
          previewEndpoint = null;
          editing.clearPreview();
          onInteraction?.('port-selected', { port: sourcePort });
          inspectorKey = '';
          refreshInspector();
          const replacement = right.querySelector(`[data-port-id="${port.id}"]`);
          replacement?.focus({ preventScroll: true });
          right.querySelector('.port-explanation')?.scrollIntoView({ block: 'nearest' });
        },
        `port-button ${port.kind}${connections.length ? ' connected' : ' free'}${chosen ? ' wiring-source' : ''}${optional ? ' optional-port' : ''}`,
      );
      item.append(
        element('span', 'port-title', portLabel(part, port)),
        element(
          'span',
          'port-state',
          connections.length
            ? `${connections.length} connected`
            : optional
              ? 'Optional'
              : 'Available',
        ),
      );
      for (const connection of connections) {
        const other =
            connection.a.part === part.id && connection.a.port === port.id
              ? connection.b
              : connection.a,
          target = parts.find((p) => p.id === other.part),
          diagnostic = frame.metadata.connections.find((c) => c.id === connection.id);
        item.append(
          element(
            'span',
            'port-peer',
            `${target?.name ?? other.part} · ${
              target
                ? portLabel(
                    target,
                    CATALOG[target.type].ports.find((p) => p.id === other.port),
                  )
                : other.port
            }${diagnostic && diagnostic.reasonCode !== 'OK' ? ' · check alignment' : ''}`,
          ),
        );
      }
      item.setAttribute('aria-pressed', String(chosen));
      item.setAttribute('aria-expanded', String(chosen));
      item.dataset.portId = port.id;
      item.dataset.partId = part.id;
      item.dataset.connectionCount = connections.length;
      ports.append(item);
      if (!chosen) continue;
      const explanation = element('div', 'port-explanation');
      explanation.append(element('p', '', portPurpose(part, port)));
      ports.append(explanation);
      for (const connection of connections) {
        const other =
            connection.a.part === part.id && connection.a.port === port.id
              ? connection.b
              : connection.a,
          peer = parts.find((p) => p.id === other.part);
        explanation.append(
          button(`Inspect ${peer?.name ?? other.part}`, () => select(other.part), 'part-link'),
        );
        const trace = button(
          `Trace ${labels[connection.kind]} → ${peer?.name ?? other.part}`,
          () => traceConnection(connection.id),
          'trace-connection quiet',
        );
        trace.dataset.connectionId = connection.id;
        trace.setAttribute('aria-pressed', String(tracedConnection === connection.id));
        explanation.append(trace);
        const disconnect = button(
          `Disconnect ${labels[connection.kind]} · ${peer?.name ?? other.part}`,
          () => send({ type: 'disconnect', id: connection.id }),
          'quiet',
        );
        disconnect.dataset.disconnectId = connection.id;
        disconnect.disabled = !editable;
        explanation.append(disconnect);
      }
      if (!editable) {
        returnToBuild(explanation);
        continue;
      }
      if (!occupied(part, port)) {
        const mechanical = ['fixed', 'shaft', 'spring'].includes(port.kind),
          gearMesh = port.kind === 'gear',
          targets = element('div', 'connection-targets');
        targets.append(
          element(
            'p',
            'connection-preview',
            gearMesh
              ? 'Choose an aligned gear on a separately supported shaft. Both parts stay in place. The centre spacing must equal the sum of pitch radii.'
              : mechanical
                ? 'Choose a connection. The smaller connected group moves; the larger one stays in place.'
                : connections.length
                  ? 'Optional: add another wire. Existing wiring is connected.'
                  : 'Choose where to wire. Both parts stay in place.',
          ),
        );
        explanation.append(targets);
        const connectionError = element('p', 'connection-error');
        connectionError.setAttribute('role', 'alert');
        connectionError.hidden = true;
        targets.append(connectionError);
        let count = 0;
        for (const target of parts)
          if (target.id !== part.id)
            for (const targetPort of CATALOG[target.type].ports)
              if (
                compatible(port, targetPort) &&
                !occupied(target, targetPort) &&
                !connections.some((connection) =>
                  [connection.a, connection.b].some(
                    (endpoint) => endpoint.part === target.id && endpoint.port === targetPort.id,
                  ),
                )
              ) {
                const ownGroup = mechanicalGroup(frame.metadata.blueprint, part.id),
                  otherGroup = mechanicalGroup(frame.metadata.blueprint, target.id);
                const moveSelected = mechanical && ownGroup.length < otherGroup.length;
                const moving = moveSelected ? part : target,
                  stationary = moveSelected ? target : part,
                  movingCount = (moveSelected ? ownGroup : otherGroup).length;
                const endpoints = () => {
                  let a = { part: part.id, port: port.id },
                    b = { part: target.id, port: targetPort.id };
                  if (moveSelected || (port.kind === 'signal' && port.direction === 'input'))
                    [a, b] = [b, a];
                  return { a, b };
                };
                const movement = `${moving.name}${movingCount > 1 ? ` and ${movingCount - 1} attached parts` : ''}`;
                count++;
                const targetButton = button(
                  `${gearMesh ? 'Mesh with' : mechanical ? 'Attach to' : 'Wire'} ${target.name} · ${targetPort.id}${mechanical ? '' : ' (parts stay put)'}`,
                  async () => {
                    connectionError.hidden = true;
                    const result = await send({ type: 'connect', ...endpoints() });
                    if (result?.ok === true) {
                      socketPreview = null;
                      editing.clearPreview();
                      sourcePort = null;
                      previewEndpoint = null;
                      snapNotice.hidden = true;
                      inspectorKey = '';
                      refreshInspector();
                      if (mechanical) {
                        const from = {
                          position: camera.position.clone(),
                          target: controls.target.clone(),
                        };
                        editing.focus({ recover: false });
                        explodeCameraTween = {
                          from,
                          to: {
                            position: camera.position.clone(),
                            target: controls.target.clone(),
                          },
                          started: performance.now(),
                        };
                        camera.position.copy(from.position);
                        controls.target.copy(from.target);
                        controls.update();
                        invalidateScene();
                      }
                      setMessage(
                        mechanical
                          ? `${movement} moved to ${stationary.name}. Connected. Undo to restore.`
                          : `${part.name} ${gearMesh ? 'meshed with' : 'wired to'} ${target.name}. Both parts stayed in place.`,
                      );
                    } else {
                      connectionError.textContent = `Connection not made. ${explainFailure(result ?? {}, frame?.metadata.blueprint)}`;
                      connectionError.hidden = false;
                      targetButton.insertAdjacentElement('afterend', connectionError);
                      connectionError.scrollIntoView({ block: 'nearest' });
                    }
                  },
                  'target-button',
                );
                if (mechanical) {
                  const detail = element('span', 'snap-movement', `Moves ${movement}`);
                  targetButton.append(detail);
                }
                const preview = () => {
                  previewEndpoint = { part: target.id, port: targetPort.id };
                  if (mechanical) {
                    let moved = [];
                    try {
                      const { a, b } = endpoints(),
                        next = snapConnection(frame.metadata.blueprint, a, b);
                      moved = next.parts.filter(
                        (p, i) =>
                          JSON.stringify(p) !== JSON.stringify(frame.metadata.blueprint.parts[i]),
                      );
                      const candidate = structuredClone(next);
                      candidate.connections.push({
                        id: 'preview-connection',
                        kind: port.kind,
                        a,
                        b,
                      });
                      compileAssembly(candidate);
                      editing.showPreview(moved);
                      socketPreview = { button: targetButton, valid: true };
                      snapNotice.textContent = `Connection preview · Moves ${movement}. ${stationary.name} stays. Click the preview or Attach to confirm; Esc cancels.`;
                      snapNotice.hidden = false;
                    } catch (error) {
                      editing.showPreview(moved, { color: 0xff836f });
                      socketPreview = { button: targetButton, valid: false };
                      const movingIds = new Set(moved.map((p) => p.id)),
                        obstacle = frame.metadata.blueprint.parts.find(
                          (p) =>
                            !movingIds.has(p.id) &&
                            moved.some((m) =>
                              placementEnvelopes(m).some((a) =>
                                placementEnvelopes(p).some((b) => solidsOverlap(a, b)),
                              ),
                            ),
                        );
                      if (obstacle) editing.showPreview([...moved, obstacle], { color: 0xff836f });
                      snapNotice.textContent = obstacle
                        ? `Cannot attach: ${movement} overlaps ${obstacle.name}. Adjust its mount or move it clear first.`
                        : `Cannot attach: ${explainFailure(error, frame.metadata.blueprint)}`;
                      snapNotice.hidden = false;
                    }
                  }
                  targetButton.classList.add('previewing');
                };
                targetButton.addEventListener('pointerenter', preview);
                targetButton.addEventListener('focus', preview);
                targetButton.dataset.targetPartId = target.id;
                targetButton.dataset.targetPortId = targetPort.id;
                targets.append(targetButton);
              }
        if (!count)
          targets.append(
            element(
              'p',
              'muted small',
              connections.length
                ? 'No additional matching ports are available.'
                : 'Add a part with a free matching port.',
            ),
          );
      }
      explanation.append(
        button(
          'Cancel connection',
          () => {
            socketPreview = null;
            snapNotice.hidden = true;
            editing.clearPreview();
            previewEndpoint = null;
            sourcePort = null;
            inspectorKey = '';
            refreshInspector();
            right.querySelector(`[data-port-id="${port.id}"]`)?.focus({ preventScroll: true });
          },
          'quiet',
        ),
      );
    }
    const settings = element('details', 'part-settings');
    settings.append(element('summary', '', 'Engineering details'));
    if (body)
      settings.append(
        element(
          'div',
          'part-mass',
          `${format(body.mass, 2)} kg · ${part.authoredMaterial.body ?? definition.primitives[0].materialKey}`,
        ),
      );
    const measurements = element('div', 'engineering-live');
    measurements.dataset.liveEngineering = part.id;
    settings.append(measurements);
    for (const [key, parameter] of Object.entries(definition.parameterDefinitions)) {
      if (
        key === 'diameter' ||
        key === 'inputPolarity' ||
        (part.type === 'logicController' && key === 'duty') ||
        (part.type === 'poweredMotor' &&
          key === 'defaultDuty' &&
          !definition.ports.some(
            (port) => port.kind === 'signal' && portConnections(part, port).length,
          ))
      )
        continue;
      const label = element('label', 'setting');
      label.append(element('span', '', parameterLabels[key] ?? key.replace(/([A-Z])/g, ' $1')));
      const input = element('input');
      input.type = 'number';
      input.value = part.parameters[key];
      input.min = parameter.minimum;
      input.max = parameter.maximum;
      input.step = parameter.type === 'integer' ? '1' : 'any';
      input.disabled = mode !== 'build';
      input.setAttribute('aria-label', key === 'defaultDuty' ? 'Drive setting' : key);
      bindParameterInput(input, key);
      label.append(input, element('span', 'unit', parameter.unit));
      if (parameterHelp[key]) label.append(element('span', 'parameter-help', parameterHelp[key]));
      settings.append(label);
    }
    const materialLabel = element('label', 'setting material-setting');
    materialLabel.append(element('span', '', 'Material'));
    const materials = element('select');
    materials.setAttribute('aria-label', 'Material');
    for (const [name, value] of Object.entries(MATERIALS))
      if (value.selectable) {
        const currentMaterial =
            MATERIALS[part.authoredMaterial.body ?? definition.primitives[0].materialKey],
          mass = body ? (body.mass * value.density) / currentMaterial.density : null;
        const option = element(
          'option',
          '',
          mass === null ? name : `${name} · ${format(mass, 2)} kg`,
        );
        option.value = name;
        materials.append(option);
      }
    materials.value = part.authoredMaterial.body ?? definition.primitives[0].materialKey;
    materials.disabled = mode !== 'build';
    materials.addEventListener('change', () =>
      send({ type: 'material', id: part.id, primitive: 'body', material: materials.value }),
    );
    materialLabel.append(materials);
    settings.append(materialLabel);
    const contact = element('details', 'contact-settings');
    contact.append(element('summary', '', 'Contact settings'));
    const effective = contactProperties(part, partPrimitives(part)[0]);
    for (const [property, label, max] of [
      ['restitution', 'Bounciness', 1],
      ['friction', 'Grip', 2],
    ]) {
      const row = element('label', 'setting');
      row.append(element('span', '', label));
      const custom = part.authoredContact?.body?.[property] !== undefined;
      const mode = element('select');
      mode.setAttribute('aria-label', `${label} source`);
      for (const [value, text] of [
        ['default', 'Material default'],
        ['custom', 'Custom'],
      ]) {
        const option = element('option', '', text);
        option.value = value;
        mode.append(option);
      }
      mode.value = custom ? 'custom' : 'default';
      mode.disabled = editable === false;
      const change = (value) =>
        send({ type: 'contactProperty', id: part.id, primitive: 'body', property, value });
      mode.onchange = () => change(mode.value === 'default' ? null : effective[property]);
      const input = element('input');
      input.type = 'number';
      input.min = '0';
      input.max = String(max);
      input.step = 'any';
      input.value = String(effective[property]);
      input.setAttribute('aria-label', label);
      input.disabled = !custom || !editable;
      input.onchange = () => {
        if (input.checkValidity() && Number.isFinite(input.valueAsNumber))
          change(input.valueAsNumber);
        else {
          input.reportValidity();
          input.value = String(effective[property]);
        }
      };
      const slider = element('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = String(max);
      slider.step = '0.05';
      slider.value = String(effective[property]);
      slider.disabled = !custom || !editable;
      slider.setAttribute('aria-label', `${label} slider`);
      slider.onchange = () => change(slider.valueAsNumber);
      row.append(mode, input);
      contact.append(row, slider);
    }
    contact.append(
      element(
        'small',
        '',
        'Both surfaces affect bounce. Grip resists sliding; neither setting directly controls jump height. Custom values stay when you change material.',
      ),
    );
    settings.append(contact);
    right.append(settings);
    connectionTest.render(frame, part, editable, right);
    const placement = element('details', 'placement-settings');
    placement.append(element('summary', '', 'Position & rotation'));
    placement.append(
      element(
        'p',
        'muted small',
        'Move or rotate the connected mechanism. Disconnect a part first to move it separately.',
      ),
    );
    for (let axis = 0; axis < 3; axis++) {
      const label = element('label', 'setting'),
        input = element('input');
      label.append(element('span', '', `${['X', 'Height', 'Z'][axis]} (m)`));
      input.type = 'number';
      input.step = '.025';
      input.value = part.position[axis];
      input.disabled = mode !== 'build';
      input.setAttribute('aria-label', `Position ${['X', 'Y', 'Z'][axis]}`);
      input.addEventListener('change', () => {
        const position = [...part.position];
        position[axis] = Number(input.value);
        send({ type: 'transform', id: part.id, position, rotation: part.rotation });
      });
      label.append(input);
      placement.append(label);
    }
    const turn = button('Turn 90°', () => {
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
        .multiply(new THREE.Quaternion(...part.rotation));
      send({ type: 'transform', id: part.id, position: part.position, rotation: q.toArray() });
    });
    turn.disabled = mode !== 'build';
    placement.append(turn);
    right.append(mirrorButton, placement);

    for (const details of right.querySelectorAll('details'))
      details.open =
        openSections.includes(details.className) &&
        !(mode !== 'build' && details.classList.contains('receiver-controls'));
    if (focusLabel) {
      const replacement = [...right.querySelectorAll('[aria-label]')].find(
        (node) => node.getAttribute('aria-label') === focusLabel,
      );
      replacement?.focus({ preventScroll: true });
    }
    refreshLive();
    refreshSprings();
  }
  function shaftSpeed(motor) {
    return motorShaftSpeed(frame, motor.node);
  }
  function refreshHealth() {
    health.hidden = true;
    if (frame.metadata.mode !== 'run' || frame.tick < 120) return;
    const issue = diagnoseMotion(frame).find((issue) => issue.code !== 'COMMAND_OFF');
    if (issue) {
      health.textContent = `${issue.title} · Check machine`;
      health.hidden = false;
    }
  }
  function refreshLive() {
    updateSensorInspector(frame, right);
    updateControllerEditor(frame, right);
    const part = frame.metadata.blueprint.parts.find((part) => part.id === selected),
      target = right.querySelector('[data-live-part]');
    if (!part || !target) return;
    const index = frame.metadata.blueprint.parts.indexOf(part),
      cell = frame.power?.cells.find((cell) => cell.node === index),
      motor = frame.power?.motors.find((motor) => motor.node === index),
      engineering = right.querySelector('[data-live-engineering]');
    target.replaceChildren();
    engineering?.replaceChildren();
    if (cell) {
      const capacity = part.parameters.capacityJ,
        percentage = capacity > 0 ? Math.max(0, Math.min(100, (cell.energyJ / capacity) * 100)) : 0;
      target.append(element('strong', '', `${format(percentage, 0)}% charge`));
      engineering?.append(
        element('div', '', `${format(cell.energyJ, 0)} / ${format(capacity, 0)} J energy`),
        element('div', '', `${format(cell.heatJ)} J cell heat`),
      );
    }
    if (motor && !motor.position) {
      const speed = shaftSpeed(motor);
      let diagnosis = explainReason(motor.reasonCode);
      if (frame.metadata.mode === 'build') diagnosis = 'Build mode · choose Run to test';
      else if (motor.reasonCode === 'OK')
        diagnosis =
          speed !== null && Math.abs(speed) < 0.5 && Math.abs(motor.current) > 0.01
            ? 'Powered, but barely turning. Check clearance and load.'
            : 'Powered';
      if (frame.metadata.mode === 'paused') diagnosis = `Paused · last reading: ${diagnosis}`;
      target.append(element('div', 'diagnosis', diagnosis));
      if (speed !== null && frame.metadata.mode !== 'build')
        target.append(element('strong', 'shaft-speed', `${format(speed, 2)} rad/s shaft speed`));
      engineering?.append(
        element('div', '', `${format(motor.torque, 3)} N·m torque · ${format(motor.current, 2)} A`),
        element('div', '', `${format(motor.heatJ)} J motor heat`),
      );
    }
    if (motor?.position) {
      const degrees = (value) => format((value * 180) / Math.PI, 1);
      target.textContent =
        frame.metadata.mode === 'build'
          ? 'Powered steering · Run to test'
          : `${frame.metadata.mode === 'paused' ? 'Paused · ' : ''}${degrees(motor.position.angle)}° actual · ${degrees(motor.position.targetAngle)}° target`;
      engineering?.append(
        element(
          'div',
          '',
          `${format(motor.torque, 3)} N·m torque · ${format(motor.current, 2)} A · ${format(motor.heatJ)} J motor heat`,
        ),
      );
    }
    if (part.type === 'commandReceiver') {
      const source = frame.power?.sources.find((source) => source.node === index);
      const control = frame.receiverControl?.receivers.find((r) => r.node === index);
      const outputs = portConnections(part, { id: 'signal' }).map((connection) => {
        const peer = connection.a.part === part.id ? connection.b.part : connection.a.part;
        return (
          frame.metadata.blueprint.parts.find((candidate) => candidate.id === peer)?.name ?? peer
        );
      });
      const mode = control?.mode ?? 'manual';
      const reason = {
        OPERATOR_OFF: 'Drive disabled',
        SUSPENDED: 'Suspended · choose Automatic to rearm',
        INVALID_SENSOR: 'Invalid travel reading · check the sensor binding',
        NO_REGULATOR: 'Connect and enable a position regulator',
      }[control?.reason];
      target.textContent =
        frame.metadata.mode === 'build'
          ? outputs.length
            ? `Control output wired to ${outputs.join(', ')}`
            : 'Control output not wired · connect it to a motor or hinge'
          : frame.metadata.mode === 'paused'
            ? `Paused · ${mode}${mode === 'automatic' ? ' switches Off on resume' : mode === 'manual' ? ' output resets on resume' : ' · drive disabled'}`
            : `${mode} · ${reason ? reason + ' · ' : ''}Control output ${format(source?.duty ?? 0, 2)}`;
      const edges = frame.metadata.blueprint.connections;
      const upstream = (id, port) => {
        const edge = edges.find(
          (c) => c.kind === 'signal' && [c.a, c.b].some((e) => e.part === id && e.port === port),
        );
        return edge && (edge.a.part === id ? edge.b.part : edge.a.part);
      };
      const regulator = frame.metadata.blueprint.parts.find(
        (p) => p.id === upstream(part.id, 'command') && p.type === 'positionRegulator',
      );
      if (regulator) {
        const sensorIndex = frame.metadata.blueprint.parts.findIndex(
          (p) => p.id === upstream(regulator.id, 'signal') && p.type === 'travelSensor',
        );
        const reading = frame.sensors?.readings.find((r) => r.node === sensorIndex);
        target.append(
          element(
            'div',
            'suspension-reading',
            reading?.channels.length.status === 'ok'
              ? `Measured spring length ${format(reading.channels.length.value, 3)} m · ${format(reading.channels.speed.value, 3)} m/s`
              : 'Measured spring length unavailable',
          ),
        );
      }
    }
    if (part.type === 'travelSensor') {
      const reading = frame.sensors?.readings.find((r) => r.node === index);
      target.textContent =
        reading?.channels.length.status === 'ok'
          ? `${format(reading.channels.length.value, 3)} m spring length · ${format(reading.channels.speed.value, 3)} m/s`
          : `Measurement ${reading?.channels.length.status ?? 'unavailable'} · check power and spring binding in Build`;
    }
    if (part.type.endsWith('Sensor') && part.type !== 'travelSensor') {
      target.textContent = `Sensor sample tick ${frame.sensors.tick} · readings below`;
    } else if (!cell && !motor && !['commandReceiver', 'travelSensor'].includes(part.type)) {
      const speed = frame.physics[index]?.angularVelocity;
      target.textContent =
        frame.metadata.mode === 'build'
          ? 'Build mode · choose Run to test'
          : speed
            ? `Rotation speed ${format(Math.hypot(...speed), 2)} rad/s`
            : 'No live measurement';
    }
  }
  function disposePart(mesh) {
    mesh.traverse((object) => {
      object.geometry?.dispose();
      object.material?.map?.dispose();
      object.material?.dispose();
    });
  }
  function finishPart(mesh, part, definition) {
    const [hx, hy, hz] = definition.halfExtents;
    function detail(geometry, color, position) {
      const item = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.45 }),
      );
      item.position.fromArray(position);
      mesh.add(item);
      return item;
    }
    function faceLabel(text, width, height, position, background = '#203844', color = '#ffdb9a') {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const context = canvas.getContext('2d');
      context.fillStyle = background;
      context.fillRect(0, 0, 512, 256);
      context.fillStyle = color;
      context.font = 'bold 74px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, 256, 128);
      const texture = new THREE.CanvasTexture(canvas),
        label = new THREE.Mesh(
          new THREE.PlaneGeometry(width, height),
          new THREE.MeshBasicMaterial({ map: texture }),
        );
      label.position.fromArray(position);
      mesh.add(label);
      return label;
    }
    if (part.type === 'powerCell') {
      mesh.material.color.setHex(0x294c60);
      // Paint the lid with one offset face; a second box shares the housing's
      // top and side planes and flickers as depth precision changes with the view.
      const lid = detail(new THREE.PlaneGeometry(2 * hx, 2 * hz).rotateX(-Math.PI / 2), 0xd3a450, [
        0,
        hy + 0.0005,
        0,
      ]);
      lid.material.polygonOffset = true;
      lid.material.polygonOffsetFactor = -1;
      lid.material.polygonOffsetUnits = -1;
      for (const sign of [-1, 1])
        detail(
          new THREE.CylinderGeometry(0.009, 0.009, 0.012, 16),
          sign > 0 ? 0xd38a55 : 0xa4b1bb,
          [sign * hx * 0.6, hy + 0.006, 0],
        );
      const socket = CATALOG[part.type].ports.find((port) => port.kind === 'power').position;
      for (const sign of [-1, 1]) {
        const start = new THREE.Vector3(...socket),
          end = new THREE.Vector3(sign * hx * 0.6, hy + 0.012, 0),
          middle = start.clone().lerp(end, 0.5);
        middle.y += 0.018;
        detail(
          new THREE.TubeGeometry(
            new THREE.QuadraticBezierCurve3(start, middle, end),
            12,
            0.003,
            8,
            false,
          ),
          sign > 0 ? 0xcb7250 : 0x253641,
          [0, 0, 0],
        );
      }
      faceLabel('−  CELL  +', hx * 1.6, hy * 1.2, [0, 0, hz + 0.0005]);
    }
    if (part.type === 'poweredMotor') {
      mesh.material.color.setHex(0x80959f);
      for (let i = 0; i < 5; i++)
        detail(new THREE.BoxGeometry(0.007, hy * 1.2, 0.001), 0x24333c, [
          -hx * 0.7 + i * 0.013,
          0,
          hz + 0.0005,
        ]);
      for (const y of [-1, 1])
        for (const z of [-1, 1])
          detail(
            new THREE.CylinderGeometry(0.004, 0.004, 0.002, 8).rotateZ(-Math.PI / 2),
            0x283d48,
            [hx + 0.001, y * hy * 0.76, z * hz * 0.76],
          );
      const label = faceLabel(
        'MOTOR',
        hx * 1.5,
        hy * 0.58,
        [0, hy + 0.0005, 0],
        '#364f5e',
        '#dce9ee',
      );
      label.rotation.x = -Math.PI / 2;
    }
    if (part.type === 'poweredHinge') {
      mesh.material.color.setHex(0x617d92);
      const label = faceLabel('SERVO', hx * 1.7, hy * 0.65, [0, 0, hz + 0.0006]);
      for (const sign of [-1, 1])
        detail(new THREE.BoxGeometry(0.006, hy * 1.5, 0.001), 0xe9b565, [
          sign * hx * 0.7,
          0,
          hz + 0.001,
        ]);
      const dial = detail(
        new THREE.RingGeometry(0.015, Math.min(hx, hz) * 0.85, 32).rotateX(-Math.PI / 2),
        0xe9b565,
        [0, hy + 0.0006, 0],
      );
      dial.material.side = THREE.DoubleSide;
    }
    if (part.type === 'wheelHub') {
      mesh.material.color.setHex(0x83969c);
      detail(new THREE.BoxGeometry(hx * 1.5, 0.001, 0.006), 0xf3bc68, [0, hy + 0.0006, 0]);
      faceLabel('HUB', hx * 1.7, hy * 0.65, [0, 0, hz + 0.0006]);
    }
    if (part.type === 'gripWheel') {
      // Surface markings identify the hub without changing collision geometry.
      for (const side of [-1, 1]) {
        const hub = detail(
          new THREE.RingGeometry(0.013, Math.min(hy * 0.3, 0.035), 32).rotateY(
            (side * Math.PI) / 2,
          ),
          0xaabac2,
          [side * (hx + 0.0005), 0, 0],
        );
        hub.material.side = THREE.DoubleSide;
        const rim = detail(
          new THREE.RingGeometry(hy * 0.78, hy * 0.82, 48).rotateY((side * Math.PI) / 2),
          0x657d8b,
          [side * (hx + 0.0005), 0, 0],
        );
        rim.material.side = THREE.DoubleSide;
        // An asymmetric sidewall mark makes actual wheel rotation readable.
        const mark = detail(
          new THREE.CircleGeometry(Math.min(hy * 0.06, 0.009), 12).rotateY((side * Math.PI) / 2),
          0xeeb866,
          [side * (hx + 0.0007), hy * 0.62, 0],
        );
        mark.material.side = THREE.DoubleSide;
      }
    }
    for (const region of surfaceRegions(part).filter((r) => r.padHalfSize)) {
      const [hu, hv] = region.padHalfSize,
        rotation = new THREE.Quaternion(...region.rotation),
        origin = new THREE.Vector3(...region.position),
        normal = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
      for (const [u, v] of [
        [-0.75, -0.75],
        [0.75, -0.75],
        [0.75, 0.75],
        [-0.75, 0.75],
      ]) {
        const position = new THREE.Vector3(0, u * hu, v * hv)
          .applyQuaternion(rotation)
          .add(origin)
          .addScaledVector(normal, 0.0006);
        const head = detail(new THREE.CircleGeometry(0.003, 8), 0xb9cbd2, position.toArray());
        head.quaternion
          .copy(rotation)
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
          );
      }
    }
    // Rendering and placement admission share the exact authored shaft segment.
    for (const shaft of shaftSegments(part)) {
      const shaftMesh = detail(
        new THREE.CylinderGeometry(0.012, 0.012, shaft.length, 20).rotateZ(-Math.PI / 2),
        0xc5d3d8,
        shaft.position,
      );
      shaftMesh.quaternion.fromArray(shaft.rotation);
    }
    for (const port of CATALOG[part.type].ports)
      if (['power', 'signal'].includes(port.kind))
        detail(
          new THREE.SphereGeometry(0.007, 12, 8),
          port.kind === 'power' ? 0xf8bd68 : 0x6edbd2,
          port.position,
        );
    const outline =
      partPrimitives(part)[0].kind === 'sphere'
        ? new THREE.Mesh(
            mesh.geometry.clone().scale(1.025, 1.025, 1.025),
            new THREE.MeshBasicMaterial({ color: 0xffc778, side: THREE.BackSide }),
          )
        : new THREE.LineSegments(
            new THREE.EdgesGeometry(mesh.geometry, 25),
            new THREE.LineBasicMaterial({
              color: 0xffc778,
              depthTest: false,
              transparent: true,
              opacity: 0.95,
            }),
          );
    outline.renderOrder = 10;
    outline.visible = false;
    mesh.add(outline);
    mesh.userData.selectionOutline = outline;
    mesh.traverse((object) => {
      object.userData.partId = part.id;
    });
  }
  function createPartMesh(part) {
    const definition = partPrimitives(part)[0],
      material = part.authoredMaterial[definition.id] ?? definition.materialKey;
    const [halfLength, radius] = definition.halfExtents;
    // CylinderGeometry starts on Y. Rotate the geometry, leaving the mesh frame
    // equal to the actual body frame with its cylinder along local X.
    const geometry =
      definition.kind === 'sphere'
        ? new THREE.SphereGeometry(radius, 32, 24)
        : definition.kind === 'cylinder'
          ? new THREE.CylinderGeometry(radius, radius, 2 * halfLength, CYLINDER_SEGMENTS).rotateZ(
              -Math.PI / 2,
            )
          : new THREE.BoxGeometry(...definition.halfExtents.map((value) => value * 2));
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: materialColor[material],
        metalness: material === 'rubber' ? 0.05 : 0.45,
        roughness: material === 'rubber' ? 0.95 : 0.45,
      }),
    );
    mesh.userData.partId = part.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (part.type === 'camera') {
      const lens = new THREE.Mesh(
        new THREE.CircleGeometry(0.011, 24),
        new THREE.MeshBasicMaterial({ color: 0x142b40 }),
      );
      lens.position.z = 0.0201;
      mesh.add(lens);
    }
    if (definition.kind === 'sphere') {
      const mark = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.01, 32, 16, 0, Math.PI / 5, 0.2, Math.PI - 0.4),
        new THREE.MeshStandardMaterial({ color: 0xffbf69, roughness: 0.7 }),
      );
      const band = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.01, 32, 4, 0, 2 * Math.PI, 1.2, 0.16),
        new THREE.MeshStandardMaterial({ color: 0xffbf69, roughness: 0.7 }),
      );
      band.rotation.z = 0.55;
      mesh.add(mark, band);
      mesh.userData.rotationMark = mark;
    }
    if (definition.kind === 'cylinder') {
      // Painted radial marks reveal real rotation. They inherit the body's full
      // transform; there is no separate animation or simulated wheel angle.
      for (const side of [-1, 1])
        for (let spoke = 0; spoke < (CATALOG[part.type].gear?.teeth ?? 3); spoke++) {
          const angle = (spoke * 2 * Math.PI) / (CATALOG[part.type].gear?.teeth ?? 3),
            x = side * (halfLength + 0.0002);
          const points = [
            new THREE.Vector3(
              x,
              Math.cos(angle) * radius * (CATALOG[part.type].gear ? 0.55 : 0),
              Math.sin(angle) * radius * (CATALOG[part.type].gear ? 0.55 : 0),
            ),
            new THREE.Vector3(x, Math.cos(angle) * radius * 0.82, Math.sin(angle) * radius * 0.82),
          ];
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: spoke === 0 ? 0xffbf69 : 0xaabac2 }),
          );
          line.userData.partId = part.id;
          mesh.add(line);
        }
    }
    finishPart(mesh, part, definition);
    return mesh;
  }
  function rebuildMeshes(blueprint) {
    partResources.reconcile(blueprint.parts);
    refreshPartList();
  }
  function renderPaletteIcons() {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(128, 104);
    renderer.setClearColor(0, 0);
    for (const type of Object.keys(CATALOG)) {
      const part = createPart(type, 'thumbnail', [0, 0, 0]),
        mesh = createPartMesh(part),
        scene = new THREE.Scene();
      scene.add(mesh, new THREE.HemisphereLight(0xffffff, 0x4f6470, 3));
      const light = new THREE.DirectionalLight(0xffecd0, 3);
      light.position.set(2, 3, 4);
      scene.add(light);
      const bounds = new THREE.Box3().setFromObject(mesh),
        size = bounds.getSize(new THREE.Vector3()).length() * 0.6,
        center = bounds.getCenter(new THREE.Vector3()),
        camera = new THREE.OrthographicCamera(
          (-size * 128) / 104,
          (size * 128) / 104,
          size,
          -size,
          0.01,
          10,
        );
      camera.position.copy(center).add(new THREE.Vector3(1.4, 0.9, 1.8));
      camera.lookAt(center);
      renderer.render(scene, camera);
      partThumbnails.set(type, renderer.domElement.toDataURL());
      disposePart(mesh);
    }
    for (const img of left.querySelectorAll('[data-icon-type]'))
      img.src = partThumbnails.get(img.dataset.iconType);
    renderer.dispose();
    renderer.forceContextLoss();
  }

  function updatePortCues() {
    if (!previewEndpoint) snapNotice.hidden = true;
    const key = JSON.stringify([blueprintKey, sourcePort, previewEndpoint, frame?.metadata.mode]);
    if (key === portCueKey) return;
    portCueKey = key;
    for (const child of [...portCues.children]) {
      portCues.remove(child);
      disposePart(child);
    }
    if (!sourcePort || frame?.metadata.mode !== 'build') return;
    const bp = frame.metadata.blueprint,
      source = bp.parts.find((p) => p.id === sourcePort.part),
      sourceDefinition = source && CATALOG[source.type].ports.find((p) => p.id === sourcePort.port);
    if (!sourceDefinition || occupied(source, sourceDefinition)) return;
    const position = (part, port) =>
      new THREE.Vector3(...port.position)
        .applyQuaternion(new THREE.Quaternion(...part.rotation))
        .add(new THREE.Vector3(...part.position));
    const start = position(source, sourceDefinition);
    for (const part of bp.parts)
      for (const port of CATALOG[part.type].ports) {
        const isSource = part.id === source.id && port.id === sourceDefinition.id;
        if (
          !isSource &&
          (part.id === source.id ||
            !compatible(sourceDefinition, port) ||
            occupied(part, port) ||
            portConnections(source, sourceDefinition).some((c) =>
              [c.a, c.b].some((e) => e.part === part.id && e.port === port.id),
            ))
        )
          continue;
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.012, 12, 8),
          new THREE.MeshBasicMaterial({
            color: isSource ? 0xffc778 : 0x8cf5cf,
            depthTest: false,
            transparent: true,
            opacity: 0.9,
          }),
        );
        dot.position.copy(position(part, port));
        dot.renderOrder = 20;
        portCues.add(dot);
        if (previewEndpoint?.part === part.id && previewEndpoint.port === port.id) {
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([start, dot.position]),
            new THREE.LineDashedMaterial({
              color: 0x8cf5cf,
              dashSize: 0.02,
              gapSize: 0.01,
              depthTest: false,
            }),
          );
          line.computeLineDistances();
          line.renderOrder = 20;
          portCues.add(line);
        }
      }
  }
  function guideConnectionMessage(edge, completed = true) {
    const bp = frame.metadata.blueprint,
      a = bp.parts.find((p) => p.id === edge.a.part),
      b = bp.parts.find((p) => p.id === edge.b.part);
    const kind =
      edge.kind ??
      (edge.a.surface ? 'fixed' : CATALOG[a.type].ports.find((p) => p.id === edge.a.port).kind);
    if (!completed)
      return `${a.name} ↔ ${b.name} · ${kind === 'fixed' ? 'Will bolt these parts together.' : kind === 'spring' ? 'Will attach the sliding carriage at the zero-force length.' : kind === 'shaft' ? 'Will join the axle, allowing rotation.' : kind === 'gear' ? 'Will mesh the supported gears without moving them.' : kind === 'power' ? 'Will add a power cable.' : 'Will connect the control signal.'}`;
    return `${a.name} ↔ ${b.name} · ${kind === 'fixed' ? 'Bolted together: they move as one.' : kind === 'spring' ? 'Spring attached: slides along its axis; does not swivel.' : kind === 'shaft' ? 'Axle connected: the wheel can turn.' : kind === 'gear' ? 'Gear mesh connected: supported shafts exchange rotation.' : kind === 'power' ? 'Power wired: energy can reach the motor.' : 'Signal connected: commands can pass.'}`;
  }
  function showGuideConnection(edge, completed = false) {
    if (edge && !completed && guideVisual?.id === edge.id && !guideVisual.completed) return;
    invalidateScene();
    for (const child of [...guideCues.children]) {
      guideCues.remove(child);
      disposePart(child);
    }
    guideVisual = edge ? { ...edge, completed } : null;
    guideFeedback.hidden = !edge;
    if (!edge) return;
    guideFeedback.textContent = `${completed ? '✓ Connected' : 'Next connection'} · ${guideConnectionMessage(edge, completed)}`;
    scene.updateMatrixWorld(true);
    for (const endpoint of [edge.a, edge.b]) {
      const part = frame.metadata.blueprint.parts.find((p) => p.id === endpoint.part),
        mesh = meshes.get(endpoint.part);
      if (!part || !mesh) continue;
      const color = completed ? 0x8cf5cf : 0xffc778,
        outline = new THREE.BoxHelper(mesh, color);
      outline.material.depthTest = false;
      outline.material.transparent = true;
      outline.material.opacity = 0.8;
      outline.renderOrder = 24;
      guideCues.add(outline);
      const port = endpointDefinition(part, endpoint),
        marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.022, 16, 12),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.65,
            depthTest: false,
            depthWrite: false,
          }),
        );
      marker.position.copy(mesh.localToWorld(new THREE.Vector3(...port.position)));
      marker.renderOrder = 25;
      marker.userData.guideMarker = true;
      guideCues.add(marker);
    }
  }
  function updateConnections() {
    if (!frame || disposed) return;
    wiring.checked = wiringPreferences.read(frame.metadata.mode);
    const specs = connectionRenderSpecs({
      wiringVisible: wiring.checked,
      revealedConnectionIds,
      sourceEndpoint: sourcePort,
      connections: frame.metadata.blueprint.connections,
      diagnostics: frame.metadata.connections,
      exploded: exploded || explodeAmount > 0,
      selectedPartId: selected ?? null,
      tracedConnectionId: tracedConnection ?? null,
      testConnectionIds: testConnectionIds,
      resolveEndpoint(endpoint) {
        const index = frame.metadata.blueprint.parts.findIndex((part) => part.id === endpoint.part),
          part = frame.metadata.blueprint.parts[index],
          pose = frame.physics[index],
          port = endpointDefinition(part, endpoint);
        if (!pose || !port || !meshes.has(part.id)) return null;
        return meshes.get(part.id).localToWorld(new THREE.Vector3(...port.position));
      },
    });
    connectionView.update(specs);
    wiringNotice.hidden =
      wiring.checked ||
      !specs.some((spec) => spec.visible && ['power', 'signal'].includes(spec.kind));
  }

  function traceConnection(id) {
    const edge = frame.metadata.blueprint.connections.find((c) => c.id === id);
    if (!edge) return;
    select(edge.a.part);
    tracedConnection = id;
    inspectorKey = '';
    refreshInspector();
    refreshSelectionVisuals();
    updateConnections();
    onInteraction?.('trace-connection', { id });
  }
  function applyExploded() {
    invalidateScene();
    for (const [id, mesh] of meshes)
      mesh.parent.position
        .copy(explodeTarget.get(id) ?? new THREE.Vector3())
        .multiplyScalar(explodeAmount);
    scene.updateMatrixWorld(true);
    updateConnections();
  }
  function setExploded(on, immediate = false) {
    surface?.cancel(false);
    if (on && (frame?.metadata.mode === 'run' || frame?.metadata.blueprint.parts.length < 2))
      return;
    if (on === exploded && !immediate) return;
    directDrag.end(false);
    editing.cancel();
    sourcePort = null;
    previewEndpoint = null;
    tracedConnection = null;
    if (on) {
      explodeCamera ??= { position: camera.position.toArray(), target: controls.target.toArray() };
      const center = new THREE.Vector3();
      for (const mesh of meshes.values()) center.add(mesh.position);
      center.multiplyScalar(1 / meshes.size);
      explodeTarget = new Map();
      let i = 0;
      for (const [id, mesh] of meshes) {
        const radial = mesh.position.clone().sub(center);
        if (radial.length() < 0.03) {
          const angle = i * 2.399963;
          radial.set(Math.cos(angle), 0.2, Math.sin(angle));
        }
        radial.normalize().multiplyScalar(0.22 + Math.sqrt(meshes.size) * 0.07);
        radial.y = Math.max(0, radial.y);
        explodeTarget.set(id, radial);
        i++;
      }
    }
    explodeFrom = explodeAmount;
    explodeStarted = performance.now();
    exploded = on;
    inspectionBanner.hidden = !on;
    const cameraFrom = { position: camera.position.clone(), target: controls.target.clone() };
    if (on) {
      const previous = explodeAmount;
      explodeAmount = 1;
      applyExploded();
      editing.focus({ recover: false });
      explodeCameraTween = {
        from: cameraFrom,
        to: { position: camera.position.clone(), target: controls.target.clone() },
        started: performance.now(),
      };
      explodeAmount = previous;
      applyExploded();
      camera.position.copy(cameraFrom.position);
      controls.target.copy(cameraFrom.target);
      controls.update();
    } else if (explodeCamera)
      explodeCameraTween = {
        from: cameraFrom,
        to: {
          position: new THREE.Vector3(...explodeCamera.position),
          target: new THREE.Vector3(...explodeCamera.target),
        },
        started: performance.now(),
      };
    explodeButton.textContent = on ? 'Machine view' : 'Exploded view';
    explodeButton.setAttribute('aria-pressed', String(on));
    inspectionBanner.hidden = !on;
    inspectorKey = '';
    editing.setTool('select');
    activeTool = 'select';
    for (const b of tools.querySelectorAll('[data-edit-tool]')) {
      b.classList.toggle('active', b.dataset.editTool === 'select');
      b.setAttribute('aria-pressed', String(b.dataset.editTool === 'select'));
    }
    if (immediate) {
      explodeAmount = 0;
      applyExploded();
    }
    refreshInspector();
    refreshSelectionVisuals();
    hint.textContent = on
      ? 'Click a part or dashed connection to inspect · Drag to orbit · Esc clears selection'
      : 'Drag a part to move · Drag empty space to orbit · Scroll to zoom · Esc to clear';
    onInteraction?.('exploded-view', { active: on, amount: explodeAmount });
  }
  function render(next) {
    invalidateScene();
    const previousCount = frame?.metadata.blueprint.parts.length ?? 0;
    const previousMode = frame?.metadata.mode;
    frame = next;
    learningControls?.refreshVisible();
    if (previousMode && previousMode !== next.metadata.mode) {
      sourcePort = null;
      previewEndpoint = null;
      socketPreview = null;
    }
    if (
      tracedConnection &&
      !next.metadata.blueprint.connections.some((c) => c.id === tracedConnection)
    )
      tracedConnection = null;
    mirror.update(next);
    assemblies?.update(next);
    assemblyPlacement?.refresh();
    vehicleControls.update(next);
    partHelp.update();
    connectionTest.update(next);
    motionReadout.update(next);
    surface.refresh();
    const blueprint = frame.metadata.blueprint,
      key = JSON.stringify(blueprint);
    if ((exploded || explodeAmount) && (key !== blueprintKey || frame.metadata.mode === 'run'))
      setExploded(false, true);
    if (key !== blueprintKey) {
      if (guideVisual) showGuideConnection(null);
      blueprintKey = key;
      const added = blueprint.parts.filter((part) => !meshes.has(part.id)).at(-1);
      if (added) selected = added.id;
      else if (!blueprint.parts.some((part) => part.id === selected)) selected = null;
      if (sourcePort && !blueprint.parts.some((part) => part.id === sourcePort.part))
        sourcePort = null;
      renderCosts.length = 0;
      rebuildMeshes(blueprint);
      refreshEnvironment(blueprint);
      inspectorKey = '';
    }
    if (exploded && (frame.metadata.mode === 'run' || key !== blueprintKey))
      setExploded(false, true);
    for (const [index, part] of blueprint.parts.entries()) {
      const pose = frame.physics[index],
        mesh = meshes.get(part.id);
      if (!pose) continue;
      mesh.position.fromArray(pose.position);
      mesh.quaternion.fromArray(pose.rotation);
    }
    if (blueprint.parts.length > previousCount) editing.focus();
    else if (
      !retryCamera &&
      previousMode &&
      previousMode !== 'build' &&
      frame.metadata.mode === 'build' &&
      readRenderedCenters().some(
        (p) => Math.abs(p.x) >= 1 || Math.abs(p.y) >= 1 || Math.abs(p.z) >= 1,
      )
    )
      editing.focus({ recover: false });
    explodeButton.disabled = frame.metadata.mode === 'run' || blueprint.parts.length < 2;
    refreshSelectionVisuals();
    editing.select(selected);
    environmentSelect.value = blueprint.environment ?? 'flat';
    environmentSelect.disabled = frame.metadata.mode !== 'build';
    undo.disabled = frame.metadata.mode !== 'build' || !frame.metadata.editing?.undoCount;
    redo.disabled = frame.metadata.mode !== 'build' || !frame.metadata.editing?.redoCount;
    refreshGuide();
    updateConnections();
    refreshInspector();
    refreshLive();
    refreshSprings();
    refreshHealth();
    failureButton.hidden = frame.status !== 'failed';
    empty.hidden = blueprint.parts.length > 0 || guideActive;
    tickLabel.textContent = `Tick ${frame.tick}`;
    modeLabel.textContent =
      frame.status === 'failed' ? 'STOPPED' : frame.metadata.mode.toUpperCase();
    retryButton.hidden = frame.metadata.mode === 'build';
    retryButton.disabled = !!retryCamera;
    run.disabled = frame.metadata.mode === 'run';
    pause.disabled = frame.metadata.mode !== 'run';
    stepButton.disabled = frame.metadata.mode !== 'paused';
    build.classList.toggle('active', frame.metadata.mode === 'build');
    for (const tool of tools.querySelectorAll('[data-edit-tool], .edit-hint'))
      tool.hidden = frame.metadata.mode !== 'build';
    surfaceSnapLabel.hidden = frame.metadata.mode !== 'build';
    if (frame.metadata.mode !== 'build')
      hint.textContent =
        'Machine controls lists your keys · Space pauses · Drag empty space to orbit';
    else if (previousMode !== 'build')
      hint.textContent =
        'Drag a part to move · Drag empty space to orbit · Scroll to zoom · Esc to clear';
    for (const b of palette.querySelectorAll('[data-placement]'))
      b.disabled = frame.metadata.mode !== 'build';
    for (const b of more.querySelectorAll('[data-placement]'))
      b.disabled = frame.metadata.mode !== 'build';
    refreshAssemblyState();
  }
  function readRenderedCenters() {
    return [...meshes].map(([id, mesh]) => {
      const p = mesh.getWorldPosition(new THREE.Vector3()).project(camera);
      return { id, x: p.x, y: p.y, z: p.z };
    });
  }
  function readRenderedTransforms() {
    return [...meshes].map(([id, mesh]) => ({
      id,
      position: mesh.getWorldPosition(new THREE.Vector3()).toArray(),
      rotation: mesh.quaternion.toArray(),
    }));
  }
  const resize = new ResizeObserver(() => {
    const width = stage.clientWidth,
      height = stage.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * graphicsQuality.read().scale);
    renderer.setSize(width, height, false);
    invalidateScene();
  });
  resize.observe(stage);
  function cameraAxes() {
    const forward = camera.getWorldDirection(new THREE.Vector3());
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    forward.normalize();
    return {
      forward,
      right: forward
        .clone()
        .cross(new THREE.Vector3(0, 1, 0))
        .normalize(),
    };
  }
  async function copySelected() {
    const bp = frame?.metadata.blueprint;
    if (frame?.metadata.mode !== 'build' || !selected) return;
    let id;
    do {
      id = `copy-${++copySequence}`;
    } while (bp.parts.some((p) => p.id === id));
    try {
      const part = duplicatePart(bp, selected, id, cameraAxes().forward.negate().toArray());
      const result = await send({ type: 'insert', part });
      if (result?.ok) {
        editing.focus();
        setMessage(
          'Copied toward the camera; view widened to show both. The copy has no connections.',
        );
      }
    } catch (error) {
      setMessage(
        error.reasonCode === 'UNKNOWN_PART'
          ? 'Select a part to copy.'
          : 'No free copy position found. Move parts to make room.',
      );
    }
  }
  const keydown = (event) => {
    if (
      cameraControls?.active() &&
      event.key === 'Escape' &&
      !document.querySelector('dialog[open]')
    ) {
      cameraSession.watch(null);
      event.preventDefault();
      return;
    }
    if (cameraControls?.active() && frame.metadata.mode === 'build' && event.key !== ' ') return;
    if (ownsPartHelpInput(event.target)) return;
    if (event.key === 'Escape' && partHelp.dismissTooltip()) {
      event.preventDefault();
      return;
    }
    invalidateScene();
    if (document.querySelector('dialog[open]')) return;
    if (assemblyPlacement?.active()) {
      assemblyPlacement.key(event);
      return;
    }
    if (assemblies?.busy()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        assemblies.cancel();
      }
      return;
    }
    inputTime = event.timeStamp;
    const key = event.key.toLowerCase();
    if (mirror.active() && event.key === 'Escape') {
      event.preventDefault();
      mirror.cancel();
      return;
    }
    if (mirror.active() && !['INPUT', 'SELECT', 'BUTTON'].includes(event.target.tagName)) return;
    if (surface.active() && event.key === 'Escape') {
      event.preventDefault();
      cancelInteraction();
      return;
    }
    if (surface.active() && surface.key(event)) {
      event.preventDefault();
      return;
    }
    // Let focused controls activate natively without also running workshop shortcuts.
    if (['BUTTON', 'SUMMARY'].includes(event.target.tagName) && ['Enter', ' '].includes(event.key))
      return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelInteraction();
      select(null);
      return;
    }
    if (
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) ||
      document.activeElement?.isContentEditable ||
      event.repeat
    )
      return;
    if ((event.metaKey || event.ctrlKey) && key === 'z') {
      event.preventDefault();
      send({ type: event.shiftKey ? 'redo' : 'undo' });
      return;
    }
    if (key === '?') {
      event.preventDefault();
      if (help.open) help.close();
      else help.showModal();
      return;
    }
    if (
      exploded &&
      [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'PageUp',
        'PageDown',
        'Delete',
        'x',
        'c',
      ].includes(event.key)
    ) {
      event.preventDefault();
      setMessage('Return to machine to edit parts.');
      return;
    }
    if (frame?.metadata.mode === 'build') {
      const part =
        !assemblies?.selected() && frame.metadata.blueprint.parts.find((p) => p.id === selected);
      if (
        part &&
        (event.key === 'Delete' || key === 'x') &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        send({ type: 'delete', id: part.id });
        return;
      }
      if (part && key === 'c' && !event.altKey && !window.getSelection()?.toString()) {
        event.preventDefault();
        copySelected();
        return;
      }
      if (
        part &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(
          event.key,
        ) &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        const { forward, right } = cameraAxes();
        let position = [...part.position],
          rotation = [...part.rotation];
        if (event.altKey) {
          if (event.key.startsWith('Page')) return;
          const axis = ['ArrowLeft', 'ArrowRight'].includes(event.key)
            ? new THREE.Vector3(0, 1, 0)
            : right;
          const angle = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? Math.PI / 2 : -Math.PI / 2;
          rotation = new THREE.Quaternion()
            .setFromAxisAngle(axis, angle)
            .multiply(new THREE.Quaternion(...rotation))
            .toArray();
        } else {
          const direction =
            event.key === 'ArrowUp'
              ? forward
              : event.key === 'ArrowDown'
                ? forward.negate()
                : event.key === 'ArrowRight'
                  ? right
                  : event.key === 'ArrowLeft'
                    ? right.negate()
                    : new THREE.Vector3(0, event.key === 'PageUp' ? 1 : -1, 0);
          position = new THREE.Vector3(...position).addScaledVector(direction, 0.025).toArray();
        }
        send({ type: 'transform', id: part.id, position, rotation });
        return;
      }
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === 'v' && frame?.metadata.mode === 'build') {
      setTool('select');
      return;
    }
    if (key === 'w' && frame?.metadata.mode === 'build') {
      setTool('translate');
      return;
    }
    if (key === 'e' && frame?.metadata.mode === 'build') {
      setTool('rotate');
      return;
    }
    if (key === 'f') {
      explodeCameraTween = null;
      editing.focus();
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      directDrag.end(false);
      send({ type: frame?.metadata.mode === 'run' ? 'pause' : 'run' });
    }
    if (event.key === '.') {
      event.preventDefault();
      send({ type: 'step' });
    }
  };
  window.addEventListener('keydown', keydown);
  const blur = () => {
    cancelInteraction();
  };
  window.addEventListener('blur', blur);

  renderPaletteIcons();
  let animation,
    previousFrameTime,
    previousFrameRendered = false;
  function draw(now = performance.now()) {
    if (disposed) return;
    const beforeQuality = graphicsQuality.read().level;
    const quality = graphicsQuality.observe({
      now,
      frameMs: now - previousFrameTime,
      active: previousFrameRendered,
      visible: !document.hidden,
    });
    previousFrameTime = now;
    previousFrameRendered = false;
    if (quality.level !== beforeQuality) {
      applyGraphicsQuality({
        renderer,
        scene,
        shadow: keyLight.shadow,
        quality,
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        width: stage.clientWidth,
        height: stage.clientHeight,
      });
      invalidateScene();
    }
    if (guideVisual && frame?.metadata.mode !== 'build') showGuideConnection(null);
    for (const cue of guideCues.children)
      if (cue.userData.guideMarker) {
        const elapsed = performance.now() - guidePulseStarted;
        const scale =
          guideVisual?.completed && elapsed < 1800 ? 1 + 0.35 * Math.sin(elapsed / 120) ** 2 : 1;
        if (cue.scale.x !== scale) {
          cue.scale.setScalar(scale);
          invalidateScene();
        }
      }
    if (
      !cameraControls?.active() &&
      follow.checked &&
      frame?.metadata.mode === 'run' &&
      meshes.size
    ) {
      const center = new THREE.Vector3();
      for (const mesh of meshes.values()) center.add(mesh.position);
      center.multiplyScalar(1 / meshes.size);
      if (followCenter) {
        const delta = center.clone().sub(followCenter);
        camera.position.add(delta);
        controls.target.add(delta);
      }
      followCenter = center;
    } else followCenter = null;
    const target = exploded ? 1 : 0;
    if (explodeAmount !== target) {
      const progress = Math.min(1, (performance.now() - explodeStarted) / 450);
      explodeAmount = explodeFrom + (target - explodeFrom) * (1 - (1 - progress) ** 3);
      if (progress === 1) explodeAmount = target;
      applyExploded();
    }
    if (explodeCameraTween) {
      invalidateScene();
      const tween = explodeCameraTween,
        progress = Math.min(1, (performance.now() - tween.started) / 450),
        eased = progress * progress * (3 - 2 * progress);
      camera.position.lerpVectors(tween.from.position, tween.to.position, eased);
      controls.target.lerpVectors(tween.from.target, tween.to.target, eased);
      if (progress === 1) {
        explodeCameraTween = null;
        if (!exploded) explodeCamera = null;
      }
    }
    controls.update();
    updatePortCues();
    if (sceneDirty) updateConnections();
    const selectedMesh = meshes.get(selected),
      part = frame?.metadata.blueprint.parts.find((p) => p.id === selected);
    selectionLabel.hidden = !selectedMesh;
    if (selectedMesh && part) {
      const point = selectedMesh.getWorldPosition(new THREE.Vector3());
      point.y += partPrimitives(part)[0].halfExtents[1] + 0.07;
      point.project(camera);
      selectionLabel.textContent = part.name;
      selectionLabel.hidden = surface.active() || point.z > 1;
      const x = Math.max(
          140,
          Math.min(stage.clientWidth - 140, (point.x * 0.5 + 0.5) * stage.clientWidth),
        ),
        y = Math.max(
          tools.offsetTop + tools.offsetHeight + selectionLabel.offsetHeight + 12,
          Math.min(stage.clientHeight - 130, (-point.y * 0.5 + 0.5) * stage.clientHeight),
        );
      selectionLabel.style.left = `${x}px`;
      selectionLabel.style.top = `${y}px`;
    }
    inspectionFill.position.copy(camera.position);
    inspectionFill.target.position.copy(controls.target);
    ground.visible = camera.position.y > groundData.position[1] + groundData.halfExtents[1] + 0.005;
    if (sceneDirty) {
      refreshSelectionVisuals();
      refreshInspector();
      surface.renderOverlay();
      cameraFrustum.update(frame, selected, cameraControls?.frustum(), cameraControls?.active());
      sceneDirty = false;
      const renderStart = performance.now();
      if (!cameraControls?.active()) graphicsRenderer.render(scene, camera, quality);
      renderCosts.push(performance.now() - renderStart);
      if (renderCosts.length > 240) renderCosts.shift();
      renderedFrames++;
      previousFrameRendered = true;
    }
    animation = requestAnimationFrame(draw);
  }
  draw();
  return {
    refreshCameras: () => cameraControls?.refresh(),
    refreshLearning: () => learningControls?.refresh(),
    render,
    clearControls: () => vehicleControls.clear(),
    beginRetry() {
      retryCamera = { position: camera.position.clone(), target: controls.target.clone() };
      retryButton.disabled = true;
    },
    endRetry() {
      if (retryCamera) {
        camera.position.copy(retryCamera.position);
        controls.target.copy(retryCamera.target);
        retryCamera = null;
        followCenter = null;
        invalidateScene();
      }
    },
    setMessage,
    setRecordingState,
    captureScreenshot: () =>
      captureWorkshopScreenshot({
        cameraSession,
        workshopCanvas: renderer.domElement,
        renderWorkshop: () => graphicsRenderer.render(scene, camera, graphicsQuality.read()),
      }),
    clearMeasurements: () => motionReadout.clear(),
    ingestMeasurements: (observation) => motionReadout.ingest(observation),
    readInteractionState: () => ({
      cameraFrustum: cameraFrustum.read(),
      cameraPhoto: cameraSession
        ? {
            active: cameraSession.read().active,
            status: cameraSession.read().status,
            gallery: cameraSession.read().gallery,
            render: cameraSession.read().render,
          }
        : null,
      bodyMeasurement: motionReadout.readBody(),
      environment: {
        selected: frame?.metadata.blueprint.environment ?? 'flat',
        obstacles: environmentGroup.children.map((mesh) => ({
          position: mesh.position.toArray(),
          rotation: mesh.quaternion.toArray(),
          bounds: new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).toArray(),
        })),
      },
      rendering: {
        frames: renderedFrames,
        quality: graphicsQuality.read(),
        pixelRatio: renderer.getPixelRatio(),
        costsMs: [...renderCosts],
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      },
      selected,
      sourcePort,
      testConnectionIds: [...testConnectionIds],
      wiring: {
        preference: wiringPreferences.read(frame?.metadata.mode ?? 'build'),
        inspectionOverride: !wiringNotice.hidden,
        revealedConnectionIds: [...revealedConnectionIds],
        connections: [...connectionView.resources].map(([id, resource]) => ({
          id,
          visible: resource.group.visible,
          endpoints: resource.group.children
            .filter((child) => child instanceof THREE.Line)
            .map((line) => [...line.geometry.attributes.position.array]),
        })),
      },
      previewEndpoint,
      surfacePlacement: surface.read(),
      guideConnection: guideVisual,
      explodedView: {
        active: exploded,
        amount: explodeAmount,
        tracedConnection,
        displayOffsets: [...meshes].map(([id, mesh]) => ({
          id,
          offset: mesh.parent.position.toArray(),
        })),
      },
      affectedParts:
        frame?.metadata.mode === 'build' ? mechanicalGroup(frame.metadata.blueprint, selected) : [],
      tool: activeTool,
      camera: {
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        fov: camera.fov,
        aspect: camera.aspect,
      },
    }),
    readRenderedTransforms,
    readRenderedShapes: () =>
      [...meshes].map(([id, mesh]) => {
        mesh.geometry.computeBoundingBox();
        const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
        const mark = mesh.userData.rotationMark;
        return {
          id,
          size: size.toArray(),
          markRotation: mark ? mark.getWorldQuaternion(new THREE.Quaternion()).toArray() : null,
          markVisible: mark ? mark.visible && mesh.visible : null,
        };
      }),
    readRenderedSpringEndpoints: () => springView.readRenderedEndpoints(),
    readRenderedCenters,
    camera,
    dispose() {
      disposed = true;
      showGuideConnection(null);
      cancelAnimationFrame(animation);
      for (const type of ['click', 'change']) root.removeEventListener(type, captureInput, true);
      for (const type of sceneInputEvents) root.removeEventListener(type, invalidateScene, true);
      controls.removeEventListener('change', invalidateScene);
      renderer.domElement.removeEventListener('webglcontextrestored', invalidateScene);
      resize.disconnect();
      window.removeEventListener('keydown', keydown);
      mirrorPlane.geometry.dispose();
      mirrorPlane.material.dispose();
      assemblies?.dispose();
      assemblyPlacement?.dispose();
      savedAssemblies?.dispose();
      assemblyThumbnails?.dispose();
      connectionTest.dispose();
      directDrag.dispose();
      vehicleControls.dispose();
      partHelp.dispose();
      motionReadout.dispose();
      window.removeEventListener('blur', blur);
      surface.dispose();
      editing.dispose();
      learningControls?.dispose();
      cameraControls?.dispose();
      controls.dispose();
      sensorView.dispose();
      cameraFrustum.dispose();
      springView.dispose();
      partResources.dispose();
      connectionView.dispose();
      for (const object of [portCues, ground, environmentGroup]) disposePart(object);
      keyLight.shadow.dispose();
      graphicsRenderer.dispose();
      renderer.dispose();
      root.replaceChildren();
    },
  };
}

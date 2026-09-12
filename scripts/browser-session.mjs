import { createTiming } from './verification-timing.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';

export const BROWSER_PROFILES = Object.freeze({
  ui: { headless: true },
  focus: {
    headless: false,
    ignoreDefaultArgs: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  },
  recording: { headless: true },
  performance: { headless: true },
});
const copy = (value) =>
  JSON.parse(
    JSON.stringify(value, (_, v) =>
      typeof v === 'function'
        ? `[function ${v.name || 'anonymous'}]`
        : v instanceof Error
          ? { message: v.message, stack: v.stack }
          : v instanceof RegExp
            ? String(v)
            : v,
    ),
  );

/** Own one verifier's browser, contexts, diagnostics and failure artifacts. */
export function attachBrowserSession(
  evidence,
  {
    launchBrowser,
    writeArtifact,
    name = basename(process.argv[1] ?? 'browser-check', '.mjs'),
    expectedErrors = [],
  } = {},
) {
  const directory = browserArtifactPath(`artifacts/browser-evidence/${name}`),
    pages = [],
    contexts = new Set(),
    records = [],
    assertions = [];
  const write =
    writeArtifact ??
    ((file, value) => {
      const path = `${directory}/${file}`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.endsWith('.json') ? JSON.stringify(value, null, 2) + '\n' : value);
    });
  const timing = createTiming({
    publish: () =>
      write('timing.json', {
        intervals: timing.snapshot(),
        scope: 'browser session; intervals may overlap',
      }),
  });
  let browser,
    profile,
    configuration,
    closed = false,
    captured = false,
    lastObservedFrame = null,
    lastAction = null;
  const expected = (record) =>
    expectedErrors.some(
      (rule) =>
        (!rule.type || rule.type === record.type) &&
        (!rule.status || rule.status === record.status) &&
        (!rule.url || new RegExp(rule.url).test(record.url ?? '')) &&
        (!rule.message || new RegExp(rule.message).test(record.message ?? '')),
    );
  const collect = (record) => {
    record.expected = expected(record);
    records.push(record);
    if (!record.expected)
      evidence.errors.push(
        `${record.type}: ${record.message ?? record.status ?? ''} ${record.url ?? ''}`.trim(),
      );
  };
  const actionMethods = new Set([
    'click',
    'dblclick',
    'fill',
    'press',
    'type',
    'check',
    'uncheck',
    'selectOption',
    'setInputFiles',
    'hover',
    'focus',
    'blur',
    'down',
    'up',
    'move',
    'wheel',
    'dragTo',
  ]);
  const wrapDriver = (driver, label) =>
    new Proxy(driver, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== 'function') return value;
        return (...args) => {
          if (actionMethods.has(key))
            lastAction = { method: `${label}.${String(key)}`, args: copy(args) };
          const result = value.apply(target, args);
          return result && typeof result === 'object' && typeof result.then !== 'function'
            ? wrapDriver(result, `${label}.${String(key)}`)
            : result;
        };
      },
    });
  const instrument = (page) => {
    if (pages.some((row) => row.raw === page)) return pages.find((row) => row.raw === page).proxy;
    page.on('pageerror', (error) => collect({ type: 'page', message: error.message }));
    page.on('console', (message) => {
      if (message.type() === 'error')
        collect({ type: 'console', message: message.text(), url: message.location?.().url });
    });
    page.on('requestfailed', (request) =>
      collect({ type: 'request', url: request.url(), message: request.failure()?.errorText }),
    );
    page.on('response', (response) => {
      if (response.status() >= 400)
        collect({ type: 'http', url: response.url(), status: response.status() });
    });
    const proxy = new Proxy(page, {
      get(target, key) {
        if (['mouse', 'keyboard', 'touchscreen'].includes(key)) return wrapDriver(target[key], key);
        if (
          [
            'locator',
            'getByRole',
            'getByLabel',
            'getByText',
            'getByTestId',
            'getByPlaceholder',
          ].includes(key)
        )
          return (...args) =>
            wrapDriver(target[key](...args), `${String(key)}(${args.map(String).join(',')})`);
        if (key === 'goto')
          return (...args) => timing.measure('navigation', () => target.goto(...args));
        if (key === 'evaluate')
          return async (...args) => {
            const result = await target.evaluate(...args);
            const frame =
              result?.physics && result?.metadata ? result : (result?.frame ?? result?.frames?.[0]);
            if (frame?.physics) lastObservedFrame = copy(frame);
            return result;
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    pages.push({ raw: page, proxy });
    return proxy;
  };
  const wrapContext = (context) => {
    contexts.add(context);
    return new Proxy(context, {
      get(target, key) {
        if (key === 'newPage')
          return async (...args) => {
            try {
              return instrument(await target.newPage(...args));
            } catch (error) {
              await capture(error);
              await close();
              throw error;
            }
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  async function capture(error) {
    if (captured) return;
    captured = true;
    const pageRecords = [];
    for (const [index, { raw: page }] of pages.entries()) {
      const row = { url: page.url?.() };
      try {
        row.state = await page.evaluate(() => ({
          frame:
            typeof window.render_game_to_text === 'function'
              ? JSON.parse(window.render_game_to_text())
              : null,
          interaction: window.workshopProbe?.readInteractionState?.() ?? null,
          cursor: window.workshopProbe?.observe?.().cursor ?? null,
          commandResult: window.workshopProbe?.readLastCommandResult?.() ?? null,
          focus: { hidden: document.hidden, focused: document.hasFocus() },
        }));
      } catch (e) {
        row.captureError = e.message;
      }
      try {
        write(`failure-${index}.png`, await page.screenshot());
      } catch (e) {
        row.screenshotError = e.message;
      }
      pageRecords.push(row);
    }
    try {
      write('failure.json', {
        ...evidence.identity,
        runtime: process.version,
        browser: browser?.version(),
        profile,
        configuration,
        error: copy(error),
        errors: copy(records),
        assertions: copy(assertions),
        lastObservedFrame,
        pages: pageRecords,
      });
    } catch (captureError) {
      evidence.errors.push(`failure artifact: ${captureError.message}`);
    }
  }
  async function cleanupAfterFailure(error) {
    await capture(error);
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${error?.message ?? String(error)} (cleanup also failed)`,
        { cause: error },
      );
    }
    throw error;
  }
  async function close() {
    if (closed) return;
    closed = true;
    const failures = [];
    try {
      evidence.assertUnchanged();
      assert.deepEqual(evidence.errors, [], 'browser errors');
    } catch (error) {
      failures.push(error);
      await capture(error);
    }
    for (const context of contexts)
      try {
        await timing.measure('context-cleanup', () => context.close());
      } catch (error) {
        failures.push(error);
        await capture(error);
      }
    try {
      await timing.measure('browser-cleanup', () => browser?.close());
    } catch (error) {
      failures.push(error);
      await capture(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'browser session cleanup failed');
  }

  Object.assign(evidence, {
    errors: [],
    measure: (name, execute) => timing.measure(name, execute),
    assert(method, args, description = {}) {
      const { frame, ...details } = description;
      const completed = (value) => value && Array.isArray(value.physics) && value.metadata;
      const actualFrame = completed(args[0]) ? args[0] : null;
      const expectedFrame = completed(args[1]) ? args[1] : null;
      const assertedFrame = frame ?? actualFrame ?? expectedFrame;
      const location = new Error().stack?.split('\n')[2]?.trim() ?? null;
      const message = args[2] ?? (method === 'ok' ? args[1] : null);
      const record = {
        location,
        expectation: message,
        ...details,
        method,
        action: copy(lastAction),
        actual: copy(args[0] ?? null),
        expected: copy(args[1] ?? null),
        lastObservedFrame,
        assertedFrame: copy(assertedFrame),
        assertedFrameSource: frame
          ? 'explicit'
          : actualFrame
            ? 'actual'
            : expectedFrame
              ? 'expected'
              : null,
      };
      assertions.push(record);
      const failed = (error) => {
        record.failureMessage = error.message;
        throw error;
      };
      try {
        const result = assert[method](...args);
        return result?.then ? result.catch(failed) : result;
      } catch (error) {
        return failed(error);
      }
    },
    captureFailure: capture,
    async launch({ profile: selected = 'ui', ...options } = {}) {
      if (browser) throw Error('browser session already launched');
      if (!Object.hasOwn(BROWSER_PROFILES, selected))
        throw Error(`unknown browser profile: ${selected}`);
      if (selected === 'focus' && options.headless === true)
        throw Error('focus profile requires a visible browser');
      profile = selected;
      configuration = { ...BROWSER_PROFILES[selected], ...options };
      const execution = process.env.SIMULACRUM_BROWSER_EXECUTION;
      if (execution && !['parallel', 'exclusive'].includes(execution))
        throw Error(`unknown browser execution policy: ${execution}`);
      if (execution === 'parallel' && (selected !== 'ui' || configuration.headless !== true))
        throw Error('this browser configuration requires exclusive execution');
      const launch =
        launchBrowser ?? (async (options) => (await import('playwright')).chromium.launch(options));
      try {
        await timing.measure('browser-launch', async () => {
          browser = await launch(configuration);
        });
      } catch (error) {
        await cleanupAfterFailure(error);
      }
      const newContext = async (options = {}) => {
        try {
          return await timing.measure('context-setup', async () =>
            wrapContext(await browser.newContext(options)),
          );
        } catch (error) {
          await cleanupAfterFailure(error);
        }
      };
      return new Proxy(browser, {
        get(target, key) {
          if (key === 'newContext') return newContext;
          if (key === 'newPage')
            return async (options = {}) => (await newContext(options)).newPage();
          if (key === 'close') return close;
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  });
  return evidence;
}

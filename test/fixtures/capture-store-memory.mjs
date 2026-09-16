// In-memory CaptureStore harness shared by backend and sync tests: SQLite in memory plus a
// fake R2 bucket, driven through the store's own fetch so admin, cursor, expiry and cleanup
// semantics are the real ones.
import { DatabaseSync } from 'node:sqlite';
import { CaptureStore } from '../../scripts/playtest/cloud-store.mjs';

export function memoryState() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    storage: {
      sql: {
        exec(query, ...args) {
          return { toArray: () => db.prepare(query).all(...args) };
        },
      },
      transactionSync(fn) {
        db.exec('BEGIN');
        try {
          const v = fn();
          db.exec('COMMIT');
          return v;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
      async getAlarm() {
        return null;
      },
      async setAlarm() {},
    },
  };
}

export function memoryBucket() {
  const values = new Map();
  return {
    values,
    async put(key, body, options = {}) {
      if (options.onlyIf && values.has(key)) return null;
      values.set(key, {
        bytes: new Uint8Array(body),
        customMetadata: options.customMetadata || {},
      });
      return this.get(key);
    },
    async get(key) {
      const v = values.get(key);
      return (
        v && {
          size: v.bytes.length,
          customMetadata: v.customMetadata,
          arrayBuffer: async () => v.bytes.slice().buffer,
        }
      );
    },
  };
}

export function memoryCaptureStore(t, limits = {}) {
  const st = memoryState(),
    r2 = memoryBucket(),
    env = {
      RECORDINGS: r2,
      INVITATION_GENERATION: '1',
      FEEDBACK_STORAGE_BYTES: String(limits.feedbackStorageBytes ?? 128 * 1024 ** 2),
      ...(limits.env ?? {}),
    };
  let store = new CaptureStore(st, env);
  t.after(() => st.db.close());
  return {
    st,
    r2,
    env,
    get store() {
      return store;
    },
    restart() {
      store = new CaptureStore(st, env);
    },
    async request(path, { method = 'GET', body, headers = {} } = {}) {
      return store.fetch(
        new Request('https://test.invalid' + path, {
          method,
          headers: {
            'x-invitation-generation': '1',
            'content-type': 'application/json',
            ...headers,
          },
          ...(body === undefined
            ? {}
            : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
        }),
      );
    },
    cleanup: () => store.alarm(),
  };
}

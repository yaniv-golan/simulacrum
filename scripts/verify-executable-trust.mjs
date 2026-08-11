import { webcrypto } from "node:crypto";
import {
  acquisitionFromShareOrigin,
  assertBlueprintAcquisition,
  BlueprintAcquisition,
  normalizeBlueprintAcquisition,
  requiresExplicitProgramTrust,
} from "../src/model/blueprint-acquisition.js";
import {
  executableDescriptor,
  executableDigest,
} from "../src/model/executable-program.js";
import { ExecutableTrustRepository } from "../src/application/executable-trust-repository.js";
import {
  BrowserStorage,
  STORAGE_KEYS,
} from "../src/application/browser-storage.js";
import {
  AUDITED_BUILT_IN_DIGESTS,
  assessControllerTrust,
  descriptorForController,
  grantControllerTrust,
} from "../src/application/executable-trust-service.js";
import {
  DEFAULT_WAT_SOURCE,
  DRONE_TS_SOURCE,
  MISSION_TS_SOURCE,
} from "../src/application/content.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { decodeBlueprint } from "../src/model/blueprint-decoder.js";
import { DEFAULT_VISUAL_PROGRAM } from "../src/model/visual-logic.js";
import { assert } from "./lib/assert.mjs";

class MemoryStorage {
  values = new Map();
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, value);
  }
  removeItem(key) {
    this.values.delete(key);
  }
  get length() {
    return this.values.size;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
}

let storageId = 0;
const browserStorage = (storage) =>
  new BrowserStorage(storage, {
    logger: { warn() {} },
    idFactory: () => (++storageId).toString(16).padStart(32, "0"),
    clock: () => "2026-07-17T00:00:00.000Z",
  });

const descriptor = executableDescriptor({
  language: "typescript",
  source: "function tick(api, dt) { void api; void dt; }",
  bindingManifest: [
    {
      id: "drive",
      direction: "output",
      endpointPartId: 2,
      endpointPortId: "CONTROL",
      channel: "throttle",
    },
  ],
});
assert.equal(
  assertBlueprintAcquisition(BlueprintAcquisition.FILE_IMPORT),
  BlueprintAcquisition.FILE_IMPORT,
);
assert.throws(
  () => assertBlueprintAcquisition(undefined),
  /explicit acquisition boundary/,
);
assert.throws(() => executableDescriptor({ source: "" }), /language/);
assert.deepEqual(
  executableDescriptor({ language: "wat", source: "(module)" }).bindingManifest,
  [],
);
const digest = await executableDigest(descriptor, webcrypto);
await assert.rejects(executableDigest(descriptor, {}), /unavailable/);
assert.match(digest, /^[0-9a-f]{64}$/);
assert.equal(
  await executableDigest(
    executableDescriptor({
      source: "function tick(api, dt) { void api; void dt; }",
      language: "typescript",
      bindingManifest: [
        {
          channel: "throttle",
          endpointPortId: "CONTROL",
          endpointPartId: 2,
          direction: "output",
          id: "drive",
        },
      ],
    }),
    webcrypto,
  ),
  digest,
  "canonical digest depends on object key order",
);

const storage = new MemoryStorage();
const repository = new ExecutableTrustRepository({
  storage,
  logger: { warn() {} },
});
assert.equal(repository.has(digest).trusted, false);
assert.equal(repository.grant(digest).trusted, true);
assert.equal(repository.has(digest).trusted, true);
assert.equal(repository.has("Stryker was here").trusted, false);
assert.equal(repository.has(`x${digest}`).trusted, false);
assert.equal(repository.has(`${digest}x`).trusted, false);
const localStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  get() {
    throw new DOMException("blocked", "SecurityError");
  },
});
const acquisitionFailure = new ExecutableTrustRepository({
  logger: { warn() {} },
}).has(digest);
assert.equal(acquisitionFailure.trusted, false);
assert.equal(acquisitionFailure.error.name, "SecurityError");
if (localStorageDescriptor)
  Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
else delete globalThis.localStorage;
const invalidGrant = repository.grant("not-a-digest");
assert.equal(invalidGrant.trusted, false);
assert.equal(invalidGrant.ok, false);
assert.match(invalidGrant.error.message, /invalid digest/);
const unavailableStorage = new ExecutableTrustRepository({
  storage: null,
  logger: { warn() {} },
}).has(digest);
assert.equal(unavailableStorage.trusted, false);
assert.match(unavailableStorage.error.message, /unavailable/);

const normalized = new MemoryStorage(),
  normalizedBrowserStorage = browserStorage(normalized);
assert.equal(
  normalizedBrowserStorage.writeJson(STORAGE_KEYS.executableTrust, {
    version: 1,
    digests: [digest],
  }).ok,
  true,
);
assert.equal(
  new ExecutableTrustRepository({
    storage: normalizedBrowserStorage,
    logger: { warn() {} },
  }).has(digest).trusted,
  true,
);
assert.equal(
  normalizedBrowserStorage.writeJson(STORAGE_KEYS.executableTrust, {
    version: 999,
    digests: [digest],
  }).ok,
  false,
);
assert.equal(
  normalizedBrowserStorage.writeJson(STORAGE_KEYS.executableTrust, {
    version: 1,
    digests: [digest, digest],
  }).ok,
  false,
);
const noReadBack = new ExecutableTrustRepository({
  storage: { getItem: () => null, setItem() {} },
  logger: { warn() {} },
});
assert.equal(noReadBack.grant(digest).trusted, false);
const sortedStorage = new MemoryStorage();
const sortedBrowserStorage = browserStorage(sortedStorage);
const sortedRepository = new ExecutableTrustRepository({
  storage: sortedBrowserStorage,
  logger: { warn() {} },
});
const highDigest = "f".repeat(64);
const lowDigest = "0".repeat(64);
assert.equal(sortedRepository.grant(highDigest).trusted, true);
assert.equal(sortedRepository.grant(lowDigest).trusted, true);
assert.deepEqual(
  sortedBrowserStorage.readJson(STORAGE_KEYS.executableTrust, null).digests,
  [lowDigest, highDigest],
);

const denied = new ExecutableTrustRepository({
  storage: {
    getItem() {
      throw new DOMException("denied", "SecurityError");
    },
    setItem() {
      throw new DOMException("denied", "SecurityError");
    },
  },
  logger: { warn() {} },
});
assert.equal(denied.grant(digest).trusted, false);
assert.equal(denied.has(digest).trusted, false);

const quota = new ExecutableTrustRepository({
  storage: {
    getItem() {
      return null;
    },
    setItem() {
      throw new DOMException("full", "QuotaExceededError");
    },
  },
  logger: { warn() {} },
});
assert.equal(quota.grant(digest).trusted, false);

assert.equal(
  acquisitionFromShareOrigin("local"),
  BlueprintAcquisition.LOCAL_AUTHORING,
);
assert.equal(BlueprintAcquisition.LOCAL_AUTHORING, "LOCAL_AUTHORING");
assert.equal(BlueprintAcquisition.BUILT_IN, "BUILT_IN");
assert.equal(BlueprintAcquisition.FILE_IMPORT, "FILE_IMPORT");
assert.equal(BlueprintAcquisition.SHARE_IMPORT, "SHARE_IMPORT");
assert.equal(BlueprintAcquisition.UNKNOWN_UNTRUSTED, "UNKNOWN_UNTRUSTED");
assert.equal(
  acquisitionFromShareOrigin("file"),
  BlueprintAcquisition.FILE_IMPORT,
);
assert.equal(
  acquisitionFromShareOrigin("link"),
  BlueprintAcquisition.SHARE_IMPORT,
);
assert.equal(
  acquisitionFromShareOrigin("invented"),
  BlueprintAcquisition.UNKNOWN_UNTRUSTED,
);
assert.equal(
  normalizeBlueprintAcquisition("invented"),
  BlueprintAcquisition.UNKNOWN_UNTRUSTED,
);
assert.equal(
  requiresExplicitProgramTrust(BlueprintAcquisition.UNKNOWN_UNTRUSTED),
  true,
);
assert.equal(
  requiresExplicitProgramTrust(BlueprintAcquisition.LOCAL_AUTHORING),
  false,
);
const builtIn = {
  ...builtInDemo("mission", {
    typescript: MISSION_TS_SOURCE,
    wat: DEFAULT_WAT_SOURCE,
  }).blueprint.parts.find((part) => part.type === "computer"),
  programAcquisition: BlueprintAcquisition.BUILT_IN,
};
assert.equal(
  descriptorForController({
    scriptLanguage: "wat",
    scriptSources: { wat: "(module)" },
  }).source,
  "(module)",
);
assert.equal(descriptorForController(null).source, "");
assert.equal(descriptorForController({}).source, "");
const builtInTrust = await assessControllerTrust({
  controller: builtIn,
  repository,
});
assert.deepEqual(
  AUDITED_BUILT_IN_DIGESTS,
  [
    "52131eab0885a4f0e316492dd02f0f64f2345d2c9ad4227cfe1dae71e6036f6f",
    "64a5a94c759f366099e3e13576d95ccfae7e60e97fdbdd028fd3f89ccfc4b59b",
    "c555990a71a6a0b7890008d97e1e8c1af7623d3a39edc420f90d352f311748ba",
    "f54424f10c1ba8433742cd583f106bd2e3c43b324d92061dc0a4a71b563f2c49",
  ],
  "audited built-in list retained a stale policy or source digest",
);
assert.equal(
  builtInTrust.allowed,
  true,
  "audited mission program was not allowlisted",
);
assert.equal(builtInTrust.requiresReview, false);
assert.equal(builtInTrust.status, "AUDITED BUILT-IN PROGRAM");
const cartController = {
    ...builtInDemo("cart").blueprint.parts.find(
      (part) => part.type === "computer",
    ),
    programAcquisition: BlueprintAcquisition.BUILT_IN,
  },
  cartTrust = await assessControllerTrust({
    controller: cartController,
    repository,
  });
assert.equal(
  cartTrust.allowed,
  true,
  "the reviewed cart controller was not present in the audited trust set",
);
const visualBuiltInTrust = await assessControllerTrust({
  controller: {
    type: "computer",
    programAcquisition: BlueprintAcquisition.BUILT_IN,
    scriptLanguage: "visual",
    scriptSources: { visual: DEFAULT_VISUAL_PROGRAM },
  },
  repository,
});
assert.equal(
  visualBuiltInTrust.allowed,
  true,
  "audited default visual program was not allowlisted",
);
for (const kind of ["gearbox", "cart", "humanoid", "drone", "mission"]) {
  const controller = builtInDemo(kind, {
    droneTypescript: DRONE_TS_SOURCE,
    typescript: MISSION_TS_SOURCE,
    wat: DEFAULT_WAT_SOURCE,
  }).blueprint.parts.find((part) => part.type === "computer");
  assert.ok(controller, `${kind} has no portable controller program`);
  controller.programAcquisition = BlueprintAcquisition.BUILT_IN;
  assert.ok(
    Object.hasOwn(controller.scriptSources, controller.scriptLanguage),
    `${kind} controller does not own its selected source`,
  );
  const trust = await assessControllerTrust({
    controller,
    repository,
  });
  assert.equal(
    trust.allowed,
    true,
    `${kind} controller source/language/capability descriptor is not audited`,
  );
  assert.equal(trust.requiresReview, false);
}
for (const forbiddenField of ["programAcquisition", "programTrust"]) {
  const hostile = structuredClone(
      builtInDemo("gearbox", {
        typescript: MISSION_TS_SOURCE,
        wat: DEFAULT_WAT_SOURCE,
      }).blueprint,
    ),
    controller = hostile.parts.find((part) => part.type === "computer");
  controller[forbiddenField] =
    forbiddenField === "programAcquisition"
      ? BlueprintAcquisition.BUILT_IN
      : { allowed: true, digest };
  assert.equal(
    decodeBlueprint(hostile).ok,
    false,
    `portable blueprint accepted hostile ${forbiddenField} claim`,
  );
}
builtIn.scriptSources.typescript += "\n// source changed";
const changedBuiltInTrust = await assessControllerTrust({
  controller: builtIn,
  repository,
});
assert.equal(
  changedBuiltInTrust.allowed,
  false,
  "modified built-in program retained trust",
);
assert.equal(changedBuiltInTrust.requiresReview, true);
assert.equal(
  changedBuiltInTrust.status,
  "PROGRAM DISABLED — BUILT-IN DIGEST MISMATCH",
);
const reviewedBuiltInTrust = await grantControllerTrust({
  controller: builtIn,
  repository,
});
assert.equal(reviewedBuiltInTrust.allowed, true);
assert.equal(reviewedBuiltInTrust.requiresReview, true);
assert.equal(reviewedBuiltInTrust.status, "REVIEWED MODIFIED BUILT-IN PROGRAM");
builtIn.scriptSources.typescript += "x";
assert.equal(
  (
    await assessControllerTrust({
      controller: builtIn,
      repository,
    })
  ).allowed,
  false,
  "a second edit inherited trust from the prior digest",
);

const local = {
  type: "computer",
  programAcquisition: BlueprintAcquisition.LOCAL_AUTHORING,
  scriptSources: { typescript: descriptor.source },
  scriptLanguage: "typescript",
};
const localTrust = await assessControllerTrust({
  controller: local,
  repository,
});
assert.equal(localTrust.allowed, true);
assert.equal(localTrust.requiresReview, false);
assert.equal(localTrust.status, "LOCAL PROGRAM");
const imported = {
  ...local,
  programAcquisition: BlueprintAcquisition.FILE_IMPORT,
};
const untrustedImport = await assessControllerTrust({
  controller: imported,
  repository: new ExecutableTrustRepository({
    storage: new MemoryStorage(),
    logger: { warn() {} },
  }),
});
assert.equal(untrustedImport.allowed, false);
assert.equal(untrustedImport.requiresReview, true);
assert.equal(untrustedImport.status, "PROGRAM DISABLED — REVIEW SOURCE");
assert.equal(
  (
    await assessControllerTrust({
      controller: imported,
      repository: denied,
    })
  ).status,
  "PROGRAM DISABLED — TRUST STORAGE UNAVAILABLE",
);
const importRepository = new ExecutableTrustRepository({
  storage: new MemoryStorage(),
  logger: { warn() {} },
});
assert.equal(
  (
    await grantControllerTrust({
      controller: imported,
      repository: importRepository,
    })
  ).allowed,
  true,
);
assert.equal(
  (
    await grantControllerTrust({
      controller: local,
      repository: importRepository,
    })
  ).allowed,
  true,
);
assert.equal(
  (
    await grantControllerTrust({
      controller: imported,
      repository: denied,
    })
  ).status,
  "PROGRAM DISABLED — TRUST NOT SAVED",
);
const unavailableDigestController = {
  ...imported,
  scriptSources: { typescript: 1n },
};
const nullControllerTrust = await assessControllerTrust({
  controller: null,
  repository: denied,
});
assert.equal(nullControllerTrust.allowed, false);
assert.equal(
  (
    await assessControllerTrust({
      controller: unavailableDigestController,
      repository,
    })
  ).status,
  "PROGRAM DISABLED — DIGEST UNAVAILABLE",
);
assert.equal(
  (
    await grantControllerTrust({
      controller: unavailableDigestController,
      repository,
    })
  ).status,
  "PROGRAM DISABLED — TRUST NOT SAVED",
);
console.log("executable acquisition and durable trust passed");

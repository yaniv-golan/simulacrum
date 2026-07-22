import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import * as walk from "acorn-walk";

const SOURCE_DIRECTORIES = Object.freeze([
  "src",
  "scripts",
  "test",
  "examples",
]);
const EXCLUDED_PATHS = new Set([
  "scripts/lib/capability-dispatch-analyzer.mjs",
  "scripts/report-capability-dispatch.mjs",
  "scripts/verify-capability-dispatch.mjs",
]);

async function filesBelow(root, relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (
        relative === "src/model/generated" ||
        relative.startsWith("test/package/output")
      )
        continue;
      files.push(...(await filesBelow(root, relative)));
    } else if (
      /\.(?:js|mjs)$/.test(entry.name) &&
      !EXCLUDED_PATHS.has(relative)
    ) {
      files.push(relative);
    }
  }
  return files;
}

function staticPropertyName(node) {
  if (!node || node.type !== "MemberExpression") return null;
  if (!node.computed && node.property.type === "Identifier")
    return node.property.name;
  if (
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  )
    return node.property.value;
  return null;
}

function isTypeMember(node) {
  return (
    node?.type === "MemberExpression" && staticPropertyName(node) === "type"
  );
}

function typeMemberOwner(node) {
  if (!isTypeMember(node)) return null;
  let owner = node.object;
  while (owner?.type === "ChainExpression") owner = owner.expression;
  if (owner?.type === "Identifier") return owner.name;
  if (owner?.type === "MemberExpression") return staticPropertyName(owner);
  return null;
}

function aliasesFor(ast) {
  const aliases = new Map();

  function addAlias(name, owners) {
    if (!name || !owners.size) return false;
    const prior = aliases.get(name) || new Set(),
      before = prior.size;
    for (const owner of owners) prior.add(owner);
    aliases.set(name, prior);
    return prior.size !== before;
  }

  function ownersFrom(node) {
    if (isTypeMember(node)) {
      const owner = typeMemberOwner(node);
      return new Set(owner ? [owner] : []);
    }
    if (node?.type === "Identifier" && aliases.has(node.name))
      return new Set(aliases.get(node.name));
    return new Set();
  }

  function addDestructuredType(pattern, source) {
    if (pattern?.type !== "ObjectPattern") return false;
    const sourceOwner =
      source?.type === "Identifier"
        ? source.name
        : source?.type === "MemberExpression"
          ? staticPropertyName(source)
          : null;
    if (!sourceOwner) return false;
    let added = false;
    for (const property of pattern.properties) {
      if (
        property.type === "Property" &&
        !property.computed &&
        (property.key.name === "type" || property.key.value === "type") &&
        property.value.type === "Identifier"
      )
        added = addAlias(property.value.name, new Set([sourceOwner])) || added;
    }
    return added;
  }

  let changed = true;
  while (changed) {
    changed = false;
    walk.simple(ast, {
      VariableDeclarator(node) {
        if (node.id.type === "Identifier")
          changed = addAlias(node.id.name, ownersFrom(node.init)) || changed;
        changed = addDestructuredType(node.id, node.init) || changed;
      },
      AssignmentExpression(node) {
        if (node.operator !== "=") return;
        if (node.left.type === "Identifier")
          changed = addAlias(node.left.name, ownersFrom(node.right)) || changed;
        changed = addDestructuredType(node.left, node.right) || changed;
      },
    });
  }
  return aliases;
}

function containsTypeReference(node, aliases) {
  if (!node) return false;
  let found = false;
  walk.full(node, (candidate) => {
    if (
      isTypeMember(candidate) ||
      (candidate.type === "Identifier" && aliases.has(candidate.name))
    )
      found = true;
  });
  return found;
}

function typeOwners(node, aliases) {
  const owners = new Set();
  walk.full(node, (candidate) => {
    const owner = typeMemberOwner(candidate);
    if (owner) owners.add(owner);
    if (candidate.type === "Identifier" && aliases.has(candidate.name))
      for (const aliasOwner of aliases.get(candidate.name))
        owners.add(aliasOwner);
  });
  return [...owners].sort();
}

function componentLiterals(node, componentTypes) {
  const values = new Set();
  walk.full(node, (candidate) => {
    if (
      candidate.type === "Literal" &&
      typeof candidate.value === "string" &&
      componentTypes.has(candidate.value)
    )
      values.add(candidate.value);
  });
  return [...values].sort();
}

function lineText(source, node) {
  return source
    .slice(node.start, node.end)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function findingsForSource(source, file, componentTypes) {
  const ast = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowHashBang: true,
      locations: true,
      ranges: true,
    }),
    aliases = aliasesFor(ast),
    findings = [],
    seen = new Set();

  function add(kind, node) {
    const key = `${node.start}:${kind}`;
    if (seen.has(key)) return;
    const owners = typeOwners(node, aliases),
      knownComponentTypes = componentLiterals(node, componentTypes),
      expression = lineText(source, node),
      componentOwner = owners.some((owner) =>
        /^(?:a|anchor|b|battery|cargo|chassis|component|computer|connector|controller|definition|failedPart|fin|hinge|input|instance|lamp|left|motor|nose|output|part|partDefinition|right|root|rotor|sensor|target|wheel)$/i.test(
          owner,
        ),
      ),
      catalogLookup = /(?:\bTYPES|\bcatalog|\.catalog)\s*\[/.test(expression);
    if (!knownComponentTypes.length && !componentOwner && !catalogLookup)
      return;
    seen.add(key);
    findings.push({
      file,
      line: node.loc.start.line,
      column: node.loc.start.column + 1,
      kind,
      owners,
      componentTypes: knownComponentTypes,
      expression,
    });
  }

  walk.simple(ast, {
    BinaryExpression(node) {
      if (
        ["===", "!==", "==", "!="].includes(node.operator) &&
        (containsTypeReference(node.left, aliases) ||
          containsTypeReference(node.right, aliases))
      )
        add("equality", node);
    },
    CallExpression(node) {
      const method = staticPropertyName(node.callee);
      if (
        ["includes", "has", "get", "set", "delete"].includes(method) &&
        node.arguments.some((argument) =>
          containsTypeReference(argument, aliases),
        )
      )
        add(
          ["includes", "has"].includes(method) ? "membership" : "lookup",
          node,
        );
    },
    MemberExpression(node) {
      if (
        node.computed &&
        containsTypeReference(node.property, aliases) &&
        !isTypeMember(node)
      )
        add("lookup", node);
    },
    SwitchStatement(node) {
      if (containsTypeReference(node.discriminant, aliases))
        add("switch", node);
    },
  });

  return findings.sort(
    (left, right) => left.line - right.line || left.column - right.column,
  );
}

/**
 * Returns every direct component/type dispatch syntax site. Classification is
 * deliberately supplied by the caller so the detector cannot silently bless
 * its own findings.
 */
export async function analyzeCapabilityDispatch({
  root,
  componentTypes,
  classify = () => null,
  sourceDirectories = SOURCE_DIRECTORIES,
}) {
  const knownTypes = new Set(componentTypes),
    files = (
      await Promise.all(
        sourceDirectories.map((directory) => filesBelow(root, directory)),
      )
    )
      .flat()
      .sort(),
    findings = [];
  for (const file of files) {
    const source = await fs.readFile(path.join(root, file), "utf8");
    for (const finding of findingsForSource(source, file, knownTypes)) {
      const classification = classify(finding);
      findings.push({
        ...finding,
        ...(classification || {
          family: "unclassified",
          disposition: "UNCLASSIFIED",
          owner: null,
          expiry: null,
          reason: "No reviewed dispatch policy matched this syntax site.",
        }),
      });
    }
  }
  const unclassified = findings.filter(
      (finding) => finding.disposition === "UNCLASSIFIED",
    ),
    counts = Object.fromEntries(
      ["KEEP", "REPLACE", "DELETE", "UNCLASSIFIED"].map((disposition) => [
        disposition,
        findings.filter((finding) => finding.disposition === disposition)
          .length,
      ]),
    );
  return Object.freeze({ files: files.length, findings, unclassified, counts });
}

import { deepFreeze } from "./primitives.js";

function contributionMagnitude(row) {
  return Math.max(
    Number(row?.forceMagnitudeN || 0),
    Number(row?.momentMagnitudeNm || 0),
  );
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

/** Derives only links explicitly preserved in immutable evidence DTOs. */
export function analyzeFailureEvidence(evidence) {
  const trigger = evidence?.trigger,
    frame = (evidence?.exactFrames || []).find(
      (candidate) => candidate.tick === trigger?.tick,
    ),
    failedConnectionId =
      frame?.structurePostMutation?.event?.failedConnectionIds?.[0] ||
      (trigger?.kind === "structural-failure" ? trigger.subjectId : null),
    rows = (frame?.solverContributions || [])
      .filter(
        (row) =>
          !failedConnectionId ||
          row.sourceConnectionIds.includes(String(failedConnectionId)),
      )
      .sort(
        (left, right) =>
          contributionMagnitude(right) - contributionMagnitude(left) ||
          left.rowId.localeCompare(right.rowId, "en"),
      ),
    contactsById = new Map(
      (frame?.contacts || [])
        .filter((contact) => contact.contactId)
        .map((contact) => [contact.contactId, contact]),
    ),
    sourceContactIds = sortedUnique(
      rows.flatMap((row) => row.sourceContactIds),
    ),
    missing = [];

  if (!frame) missing.push("trigger exact frame is unavailable");
  if (trigger?.kind === "structural-failure" && !failedConnectionId)
    missing.push("first failed authored connection is unavailable");
  if (failedConnectionId && !rows.length)
    missing.push("no solver contribution links to the failed connection");
  if (frame?.contributionValidity === "truncated" || frame?.omittedRowCount)
    missing.push("solver contribution ledger is truncated");
  for (const row of rows) {
    if (row.validity === "unavailable" || row.validity === "truncated")
      missing.push(`solver row ${row.rowId} is ${row.validity}`);
    if (row.source === "constraint" && !row.constraintId)
      missing.push(`solver row ${row.rowId} has no constraint identity`);
    for (const contactId of row.sourceContactIds) {
      const contact = contactsById.get(contactId);
      if (!contact) missing.push(`source contact ${contactId} is not retained`);
      else if (
        contact.validity === "unavailable" ||
        contact.validity === "truncated"
      )
        missing.push(`source contact ${contactId} is ${contact.validity}`);
    }
  }

  const missingLinks = sortedUnique(missing);
  return deepFreeze({
    causalState: missingLinks.length ? "incomplete" : "complete",
    triggerKind: trigger.kind,
    triggerTick: trigger.tick,
    triggerSubjectId: trigger.subjectId,
    firstFailedConnectionId: failedConnectionId
      ? String(failedConnectionId)
      : null,
    topRowIds: rows.slice(0, 16).map((row) => row.rowId),
    sourceContactIds,
    missingLinks,
    preTopologyRevision:
      frame?.structurePreMutation?.topology?.graphRevision ?? null,
    postTopologyRevision:
      frame?.structurePostMutation?.topology?.graphRevision ?? null,
    contributionValidity:
      frame?.contributionValidity || trigger.validity || "unavailable",
  });
}

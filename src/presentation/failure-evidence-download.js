function safeTimestamp(date) {
  return date.toISOString().replaceAll(":", "-").replace(".000Z", "Z");
}

/** Downloads already validated diagnostic bytes without interpreting them. */
export function downloadFailureEvidence(
  artifact,
  { documentRef = document, date = new Date() } = {},
) {
  const blob = new Blob([JSON.stringify(artifact, null, 2)], {
      type: "application/json",
    }),
    link = documentRef.createElement("a"),
    url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `simulacrum-failure-evidence-${safeTimestamp(date)}.json`;
  documentRef.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

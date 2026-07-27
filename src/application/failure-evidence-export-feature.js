/** Owns the application transaction from active capture to validated download. */
export function createFailureEvidenceExportFeature({
  runtime,
  download,
  notify = (_message) => {},
}) {
  async function request() {
    try {
      const { createFailureEvidenceArtifact } =
        await import("./failure-evidence-export.js");
      const artifact = createFailureEvidenceArtifact({ runtime });
      await download(artifact);
      notify("Diagnostic bundle exported");
      return { ok: true, artifact };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify(`Diagnostic export unavailable · ${message}`);
      return { ok: false, error: message };
    }
  }
  return Object.freeze({ request });
}

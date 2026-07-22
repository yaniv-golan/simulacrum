function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function rejected(stage, error, extra = {}) {
  return {
    ok: false,
    status: "rejected",
    stage,
    error: asError(error),
    ...extra,
  };
}

function withCleanupError(rootError, cleanupErrors, message) {
  if (!cleanupErrors.length) return asError(rootError);
  const cause = asError(rootError);
  return new AggregateError([cause, ...cleanupErrors], message, { cause });
}

/**
 * Coordinates decode, detached editor/presentation staging, manifest commit,
 * and the in-memory root swap. No live root is touched before the storage
 * pointer is verified.
 */
export class BlueprintLoadTransaction {
  constructor({
    decode,
    stageEditor,
    stagePresentation,
    persist,
    commit,
    disposeCandidate,
    freeze,
    disposeUncertain,
    recover,
  }) {
    this.decode = decode;
    this.stageEditor = stageEditor;
    this.stagePresentation = stagePresentation;
    this.persist = persist;
    this.commit = commit;
    this.disposeCandidate = disposeCandidate;
    this.freeze = freeze;
    this.disposeUncertain = disposeUncertain;
    this.recover = recover;
  }

  execute(input, options = {}) {
    let candidate = null,
      persistence = null;
    try {
      const decoded = this.decode(input, options);
      if (!decoded?.ok)
        return rejected(
          "decode",
          new Error(decoded?.errors?.[0]?.message || "Blueprint was rejected"),
          { validationErrors: decoded?.errors || [] },
        );
      const editor = this.stageEditor(decoded.value, options);
      candidate = { decoded: decoded.value, editor, presentation: null };
      candidate.presentation = this.stagePresentation(
        editor,
        options,
        candidate,
      );
      persistence = this.persist(candidate, options);
      if (!persistence?.ok) {
        if (persistence?.pointerCommitted)
          return this.#recover(candidate, persistence, persistence.error);
        const cleanupErrors = this.#disposeCandidate(candidate),
          error = withCleanupError(
            persistence?.error,
            cleanupErrors,
            "Blueprint persistence and candidate cleanup both failed",
          );
        candidate = null;
        return rejected("persistence", error);
      }
      try {
        const committed = this.commit(candidate, persistence, options);
        candidate = null;
        committed?.disposePrevious?.();
        return {
          ok: true,
          status: "committed",
          manifestId: persistence.manifestId,
          value: committed?.value,
        };
      } catch (error) {
        return this.#recover(candidate, persistence, error);
      }
    } catch (error) {
      const cleanupErrors = this.#disposeCandidate(candidate),
        failure = withCleanupError(
          error,
          cleanupErrors,
          "Blueprint staging and candidate cleanup both failed",
        );
      return rejected(
        persistence?.pointerCommitted
          ? "commit"
          : candidate
            ? "staging"
            : "decode",
        failure,
      );
    }
  }

  #disposeCandidate(candidate) {
    if (!candidate) return [];
    try {
      this.disposeCandidate?.(candidate);
      return [];
    } catch (error) {
      return [asError(error)];
    }
  }

  #recover(candidate, persistence, rootError) {
    const errors = [asError(rootError)];
    try {
      this.freeze?.(rootError);
    } catch (error) {
      errors.push(asError(error));
    }
    try {
      this.disposeUncertain?.(candidate, rootError);
    } catch (error) {
      errors.push(asError(error));
    }
    try {
      const recovery = this.recover?.(persistence, rootError);
      if (!recovery?.ok)
        throw (
          recovery?.error || new Error("Committed manifest recovery failed")
        );
      return {
        ok: true,
        status: "recovered",
        stage: "commit",
        manifestId: persistence.manifestId,
        recoveryDiagnostic: new AggregateError(
          errors,
          "The committed blueprint was reloaded after an in-memory swap failure",
          { cause: errors[0] },
        ),
        value: recovery.value,
      };
    } catch (error) {
      errors.push(asError(error));
      return rejected(
        "recovery",
        new AggregateError(
          errors,
          "Blueprint commit recovery failed; editing must remain frozen",
          { cause: errors.at(-1) },
        ),
        {
          fatal: true,
          manifestId: persistence?.manifestId || null,
        },
      );
    }
  }
}

import { TestCourseRun } from "../../model/test-course-evaluator.js";

function courseTelemetry(context, testSiteTelemetry) {
  return {
    tick: context.clock.tick,
    systems: {
      testSite: testSiteTelemetry,
      structures: context.telemetry.structures ||
        context.initialSystemTelemetry?.structures || { failedCount: 0 },
    },
  };
}

/** Evaluates an armed Test Reserve route after canonical location telemetry. */
export class TestCourseSystem {
  phase = "telemetry";
  run = null;

  initialize(context) {
    const selection = context.services.testCourseSelection?.();
    if (!selection?.routeId || !context.services.testSite) return;
    this.run = new TestCourseRun({
      testSite: context.services.testSite,
      routeId: selection.routeId,
      targetPartId: selection.targetPartId ?? null,
    });
    const testSiteTelemetry = context.initialSystemTelemetry?.testSite;
    if (!testSiteTelemetry) return;
    context.initialSystemTelemetry.testCourse = this.run.step(
      courseTelemetry(context, testSiteTelemetry),
    );
  }

  step(context) {
    if (!this.run || !context.telemetry.testSite) return;
    context.telemetry.testCourse = this.run.step(
      courseTelemetry(context, context.telemetry.testSite),
    );
  }

  dispose() {
    this.run = null;
  }
}

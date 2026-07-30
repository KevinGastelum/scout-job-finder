import { describe, expect, test } from "bun:test";
import { applicationProgress } from "../src/application-flow";
import { APPLICATION_STATUSES } from "../src/types";

describe("applicationProgress", () => {
  test("an unseen job is waiting on a first read", () => {
    expect(applicationProgress(null)).toEqual({
      stage: "to-review",
      nextAction: "review the posting",
    });
  });

  test("separates work owed by Kevin from time owed by the employer", () => {
    expect(applicationProgress("shortlisted").stage).toBe("to-prepare");
    expect(applicationProgress("tailored").stage).toBe("to-apply");
    expect(applicationProgress("applied").stage).toBe("waiting");
    expect(applicationProgress("interview").stage).toBe("action-needed");
    expect(applicationProgress("rejected").stage).toBe("closed");
  });

  // The map is exhaustive by type, but a status added later with no entry would return undefined
  // at runtime in a build that skipped typecheck.
  test("covers every stored status", () => {
    for (const status of APPLICATION_STATUSES) {
      expect(applicationProgress(status).nextAction.length).toBeGreaterThan(0);
    }
  });
});

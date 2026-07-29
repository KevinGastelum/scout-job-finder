import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { MockLlmClient } from "../src/llm/mock";

const Schema = z.object({ answer: z.string(), score: z.number() });

describe("MockLlmClient", () => {
  test("validates queued responses against the caller's schema", async () => {
    const llm = new MockLlmClient([{ answer: "yes", score: 7 }]);
    const result = await llm.generateStructured("rubric prompt", Schema);
    expect(result).toEqual({ answer: "yes", score: 7 });
    expect(llm.requests).toEqual(["rubric prompt"]);
  });

  test("throws when a queued response does not match the schema", async () => {
    const llm = new MockLlmClient([{ answer: "yes" }]);
    await expect(llm.generateStructured("p", Schema)).rejects.toThrow();
  });

  test("throws when the queue is empty", async () => {
    const llm = new MockLlmClient([]);
    await expect(llm.generateStructured("p", Schema)).rejects.toThrow(/no queued response/);
  });

  test("reports the model id downstream code stamps onto scores", () => {
    expect(new MockLlmClient([]).modelId).toBe("mock-model");
  });
});

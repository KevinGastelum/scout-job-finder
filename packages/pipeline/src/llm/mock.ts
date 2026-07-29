import type { ZodType } from "zod";
import type { LlmClient } from "./client";

export class MockLlmClient implements LlmClient {
  readonly modelId = "mock-model";
  readonly requests: string[] = [];
  private readonly queue: unknown[];

  constructor(responses: unknown[]) {
    this.queue = [...responses];
  }

  async generateStructured<T>(prompt: string, schema: ZodType<T>): Promise<T> {
    this.requests.push(prompt);
    if (this.queue.length === 0) {
      throw new Error("MockLlmClient: no queued response");
    }
    return schema.parse(this.queue.shift());
  }
}

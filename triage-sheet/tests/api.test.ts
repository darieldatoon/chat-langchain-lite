import { describe, expect, it, vi } from "vite-plus/test";

import { createApi, QUEUE_NAME, type Call } from "../src/api";
import { MAX_REVIEW_ROWS } from "../src/sheet";

const run = (content: string) => ({
  inputs: { messages: [{ role: "user", content: `Q: ${content}` }] },
  outputs: { messages: [{ type: "ai", content: `A: ${content}` }] },
});

function fakeCall(routes: Record<string, unknown>): Call {
  return vi.fn(async (operation: string) => {
    if (!(operation in routes)) throw new Error(`unexpected ${operation}`);
    const response = routes[operation];
    if (response instanceof Error) throw response;
    return response;
  });
}

describe("reviewRows", () => {
  const queues = [
    { id: "q-other", name: `${QUEUE_NAME}-old` },
    { id: "q-1", name: QUEUE_NAME },
  ];

  it("finds the queue by name and reads each waiting run's question and answer", async () => {
    const call = fakeCall({
      "GET /api/v1/annotation-queues": queues,
      "GET /api/v1/platform/annotation-queues/q-1/items": {
        items: [
          { id: "i-1", run_id: "r-1" },
          { id: "i-2", thread_id: "t-1" },
          { id: "i-3", run_id: "r-2" },
        ],
      },
      "GET /api/v1/runs/r-1": run("one"),
      "GET /api/v1/runs/r-2": new Error("gone"),
    });
    expect(await createApi(call).reviewRows()).toEqual([
      { runId: "r-1", question: "Q: one", answer: "A: one" },
      { runId: "r-2", question: "", answer: "" },
    ]);
    expect(call).toHaveBeenCalledWith("GET /api/v1/annotation-queues", {
      params: { name: QUEUE_NAME },
    });
    expect(call).toHaveBeenCalledWith("GET /api/v1/platform/annotation-queues/q-1/items", {
      params: { status: "needs_my_review", page_size: String(MAX_REVIEW_ROWS) },
    });
  });

  it("is empty when the page has no items", async () => {
    const call = fakeCall({
      "GET /api/v1/annotation-queues": queues,
      "GET /api/v1/platform/annotation-queues/q-1/items": { next_cursor: null },
    });
    expect(await createApi(call).reviewRows()).toEqual([]);
  });

  it("fails when the workspace has no triage queue", async () => {
    await expect(
      createApi(
        fakeCall({ "GET /api/v1/annotation-queues": { detail: "not a list" } }),
      ).reviewRows(),
    ).rejects.toThrow(`No annotation queue named ${QUEUE_NAME}`);
  });
});

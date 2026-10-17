import { describe, expect, it } from "vite-plus/test";

import { mergeRunIds, toThreadSummaries } from "./threads";

describe("toThreadSummaries", () => {
  it("titles threads from the first message and truncates long ones", () => {
    const [short, long, empty] = toThreadSummaries([
      { thread_id: "a", updated_at: "1", extracted: { first: "What is   LangGraph?" } },
      {
        thread_id: "b",
        updated_at: "2",
        extracted: { first: [{ type: "text", text: "x".repeat(80) }] },
      },
      { thread_id: "c", updated_at: "3" },
    ]);
    expect(short!.title).toBe("What is LangGraph?");
    expect(long!.title).toHaveLength(60);
    expect(long!.title.endsWith("…")).toBe(true);
    expect(empty!.title).toBe("Untitled conversation");
  });

  it("prefers the stored metadata title", () => {
    const [row] = toThreadSummaries([
      {
        thread_id: "a",
        updated_at: "1",
        metadata: { title: "Stored title" },
        extracted: { first: "Extracted" },
      },
    ]);
    expect(row!.title).toBe("Stored title");
  });
});

describe("mergeRunIds", () => {
  it("orders history by creation time and appends live runs without duplicates", () => {
    const history = [
      { run_id: "r2", created_at: "2026-10-17T10:00:02Z" },
      { run_id: "r1", created_at: "2026-10-17T10:00:01Z" },
    ];
    expect(mergeRunIds(history, ["r2", "r3"])).toEqual(["r1", "r2", "r3"]);
  });
});

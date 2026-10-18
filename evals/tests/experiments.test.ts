import { describe, expect, it } from "vitest";

import {
  completionOf,
  EXPERIMENTS,
  experimentName,
  OFFLINE_KEYS,
  waitForScores,
} from "../src/experiments.ts";
import { planThumbsDown } from "../src/traffic.ts";
import { fakeApi } from "./fake-api.ts";

describe("experimentName", () => {
  it("changes when the dataset version or revision changes", () => {
    const spec = EXPERIMENTS[0]!;
    const a = experimentName(spec, "rev12345abc", "2026-10-17T22:24:43.027544+00:00");
    expect(a).toBe("production-baseline::rev-rev12345::data-20261017T222443");
    expect(experimentName(spec, "rev12345abc", "2026-10-18T01:00:00+00:00")).not.toBe(a);
    expect(experimentName(spec, "rev99999abc", "2026-10-17T22:24:43.027544+00:00")).not.toBe(a);
  });

  it("plans 336 rows for the initial 42-example seed", () => {
    expect(EXPERIMENTS.reduce((rows, spec) => rows + 42 * spec.repetitions, 0)).toBe(336);
  });
});

describe("completionOf", () => {
  it("is complete only with every row and every score", () => {
    const full = Object.fromEntries(OFFLINE_KEYS.map((key) => [key, { n: 126 }]));
    expect(
      completionOf({ id: "s", name: "s", run_count: 126, feedback_stats: full }, 126, OFFLINE_KEYS)
        .complete,
    ).toBe(true);
    const partial = completionOf(
      {
        id: "s",
        name: "s",
        run_count: 126,
        feedback_stats: { ...full, professional_tone: { n: 100 } },
      },
      126,
      OFFLINE_KEYS,
    );
    expect(partial).toMatchObject({ complete: false, missingScores: { professional_tone: 26 } });
  });
});

describe("waitForScores", () => {
  it("gives up at the deadline and reports what's missing", async () => {
    let clock = 0;
    const lines: string[] = [];
    const api = fakeApi(() => ({ id: "s", name: "s", run_count: 10, feedback_stats: {} }));
    const result = await waitForScores({
      api,
      experiments: [
        { role: "r", name: "n", sessionId: "s", expectedRows: 12, status: "ran", failedRuns: 0 },
      ],
      timeoutMs: 30,
      pollMs: 10,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      log: (line) => lines.push(line),
    });
    expect(result.r?.complete).toBe(false);
    expect(lines[0]).toContain("10/12 rows");
  });
});

describe("planThumbsDown", () => {
  const result = (runId: string, outputTokens: number, text: string) => ({
    runId,
    threadId: "t",
    answer: { text, outputTokens },
  });

  it("thumbs-down a few incomplete answers first, then a few informal ones", () => {
    const plan = planThumbsDown(
      [
        result("a", 900, "cut"),
        result("b", 400, "Nice 🚀"),
        result("c", 900, "cut"),
        result("d", 300, "Fine."),
      ],
      { outputLimit: 900, incompleteThumbsDown: 1, informalThumbsDown: 1 },
    );
    expect(plan).toEqual([
      { runId: "a", comment: "It stops in the middle of the answer." },
      { runId: "b", comment: "Not very professional for a docs assistant." },
    ]);
  });
});

describe("experimentName with a split", () => {
  it("keeps split runs apart from full runs", () => {
    const spec = EXPERIMENTS[0]!;
    const asOf = "2026-10-17T22:24:43+00:00";
    expect(experimentName(spec, "rev12345", asOf, "demo")).toBe(
      `${experimentName(spec, "rev12345", asOf)}::split-demo`,
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  ANSWER_PATH,
  ASSERTIONS_RULE_NAME,
  assertionsRule,
  citesRule,
  ensureRule,
  ONLINE_FILTER,
  toneRule,
  trajectoryRule,
} from "../src/evaluators.ts";
import { fakeApi } from "./fake-api.ts";

const judge = { id: "cfg-1", model: { lc: 1, type: "constructor", id: ["x"], kwargs: {} } };

describe("rule bodies", () => {
  it("names the Assertions rule so queue adds don't create a duplicate, and reads the final answer", () => {
    const rule = assertionsRule("ds-1", judge) as any;
    expect(rule.display_name).toBe(ASSERTIONS_RULE_NAME);
    expect(rule.evaluators[0].structured.variable_mapping.outputs).toBe(ANSWER_PATH);
    expect(rule.evaluators[0].structured.model).toBe(judge.model);
  });

  it("filters experiment copies out of online rules only", () => {
    expect((toneRule({ kind: "session", sessionId: "s-1" }) as any).filter).toBe(ONLINE_FILTER);
    expect((toneRule({ kind: "dataset", datasetId: "ds-1" }) as any).filter).toBeUndefined();
    expect((citesRule({ kind: "session", sessionId: "s-1" }, "code") as any).filter).toBe(
      ONLINE_FILTER,
    );
  });

  it("passes the Jev key as a secret reference, not a string", () => {
    const kwargs = (toneRule({ kind: "dataset", datasetId: "ds-1" }) as any).evaluators[0]
      .structured.model.kwargs;
    expect(kwargs.typesafe_api_key).toEqual({ lc: 1, type: "secret", id: ["LC_GATEWAY_KEY"] });
  });
});

describe("trajectoryRule", () => {
  it("groups by trajectory and maps the trajectory variable the way the backend requires", () => {
    const rule = trajectoryRule("s-1", judge) as any;
    expect(rule.group_by).toBe("trajectory_id");
    expect(rule.evaluators[0].structured.variable_mapping).toEqual({ trajectory: "trajectory" });
    expect(rule.evaluators[0].structured.prompt[0][1]).toContain("{{trajectory}}");
  });
});

describe("ensureRule", () => {
  const target = { kind: "dataset", datasetId: "ds-1" } as const;

  it("creates a rule when none with that name exists", async () => {
    const api = fakeApi((call) => (call.method === "GET" ? [] : { id: "r-new" }));
    await expect(ensureRule(api, target, { display_name: "x" })).resolves.toEqual({
      name: "x",
      id: "r-new",
      status: "created",
    });
  });

  it("leaves an existing rule alone so UI alignment and few-shot settings survive", async () => {
    const api = fakeApi(() => [{ id: "r-1", display_name: "x" }]);
    await expect(ensureRule(api, target, { display_name: "x" })).resolves.toEqual({
      name: "x",
      id: "r-1",
      status: "exists",
    });
    expect(api.calls.some((call) => call.method !== "GET")).toBe(false);
  });
});

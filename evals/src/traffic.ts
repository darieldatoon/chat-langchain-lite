import { ask, looksInformal, usedWholeBudget, type AskResult } from "./agent.ts";
import type { Api } from "./api.ts";
import { mapPool } from "./pool.ts";

export interface TrafficOptions {
  readonly outputLimit: number;
  readonly incompleteThumbsDown: number;
  readonly informalThumbsDown: number;
  readonly concurrency: number;
}

export type Verdict = "incomplete" | "informal" | "ok";

export interface Plan {
  readonly runId: string;
  readonly comment: string;
}

export function verdictOf(result: AskResult, outputLimit: number): Verdict {
  if (usedWholeBudget(result.answer, outputLimit)) return "incomplete";
  if (looksInformal(result.answer.text)) return "informal";
  return "ok";
}

/** Simulated users: a few of them thumbs-down answers that look incomplete or informal. */
export function planThumbsDown(
  results: readonly AskResult[],
  options: Pick<TrafficOptions, "outputLimit" | "incompleteThumbsDown" | "informalThumbsDown">,
): Plan[] {
  const verdicts = results.map((result) => ({
    result,
    verdict: verdictOf(result, options.outputLimit),
  }));
  const pick = (verdict: Verdict, count: number, comment: string) =>
    verdicts
      .filter((entry) => entry.verdict === verdict)
      .slice(0, count)
      .map((entry) => ({ runId: entry.result.runId, comment }));
  return [
    ...pick("incomplete", options.incompleteThumbsDown, "It stops in the middle of the answer."),
    ...pick("informal", options.informalThumbsDown, "Not very professional for a docs assistant."),
  ];
}

export interface TrafficSummary {
  readonly sent: number;
  readonly failed: number;
  readonly incomplete: number;
  readonly informal: number;
  readonly thumbsDown: number;
}

export async function sendTraffic(
  agentApi: Api,
  platformApi: Api,
  questions: readonly string[],
  options: TrafficOptions,
): Promise<TrafficSummary> {
  const settled = await mapPool(questions, options.concurrency, (question) =>
    ask(agentApi, question, { metadata: { source: "demo-prepare-traffic" } }).catch(
      () => undefined,
    ),
  );
  const results = settled.filter((result): result is AskResult => result !== undefined);
  const plan = planThumbsDown(results, options);
  for (const { runId, comment } of plan) {
    await platformApi.post("/feedback", { run_id: runId, key: "user_score", score: 0, comment });
  }
  const verdicts = results.map((result) => verdictOf(result, options.outputLimit));
  return {
    sent: results.length,
    failed: settled.length - results.length,
    incomplete: verdicts.filter((verdict) => verdict === "incomplete").length,
    informal: verdicts.filter((verdict) => verdict === "informal").length,
    thumbsDown: plan.length,
  };
}

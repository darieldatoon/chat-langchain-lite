import { ASSISTANT_ID } from "./agent.ts";
import { ApiError, type Api } from "./api.ts";
import { findQueue } from "./triage.ts";

export interface Taggable {
  readonly type: "dataset" | "queue" | "evaluator" | "prompt";
  readonly id: string;
}

export interface EvaluatorRecord {
  readonly id: string;
  readonly llm_evaluator?: {
    readonly prompt_id: string;
    readonly annotation_queue_id?: string | null;
  } | null;
}

function ownedBy(evaluator: EvaluatorRecord): Taggable[] {
  const llm = evaluator.llm_evaluator;
  if (!llm) return [];
  return [
    { type: "prompt", id: llm.prompt_id },
    ...(llm.annotation_queue_id ? [{ type: "queue" as const, id: llm.annotation_queue_id }] : []),
  ];
}

/** Each LLM evaluator owns the prompt its rule created, and its alignment queue once it has one. */
export function taggablesFor(
  datasetId: string,
  queueId: string | undefined,
  evaluators: readonly EvaluatorRecord[],
): Taggable[] {
  return [
    { type: "dataset", id: datasetId },
    ...(queueId ? [{ type: "queue" as const, id: queueId }] : []),
    ...evaluators.flatMap((evaluator) => [
      { type: "evaluator" as const, id: evaluator.id },
      ...ownedBy(evaluator),
    ]),
  ];
}

/** Null when the workspace has no Agent tag for this agent (agent views not enabled yet). */
export async function agentTagValueId(api: Api): Promise<string | null> {
  try {
    const agent = await api.get<{ tag_value_id: string | null }>(`/agents/${ASSISTANT_ID}`);
    return agent.tag_value_id;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

async function tag(api: Api, tagValueId: string, resource: Taggable) {
  // The server upserts, and tagging a dataset also tags its experiments, past and future.
  await api.post("/workspaces/current/taggings", {
    tag_value_id: tagValueId,
    resource_type: resource.type,
    resource_id: resource.id,
  });
}

/**
 * Tags the dataset, triage queue, evaluators and their prompts and alignment queues to the agent, so they appear under
 * it in LangSmith's agent switcher. Returns how many were tagged, or null when tagging is unavailable.
 */
export async function tagAgentResources(api: Api, datasetId: string): Promise<number | null> {
  const tagValueId = await agentTagValueId(api);
  if (!tagValueId) return null;
  // agent_id lists evaluators on the agent's tracing projects and tagged datasets: tag the dataset first.
  await tag(api, tagValueId, { type: "dataset", id: datasetId });
  const [{ evaluators }, queue] = await Promise.all([
    api.get<{ evaluators: EvaluatorRecord[] }>("/platform/evaluators", {
      agent_id: ASSISTANT_ID,
      limit: 100,
    }),
    findQueue(api),
  ]);
  const resources = taggablesFor(datasetId, queue?.id, evaluators);
  for (const resource of resources) await tag(api, tagValueId, resource);
  return resources.length;
}

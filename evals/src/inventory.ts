import { readFile } from "node:fs/promises";

import { ASSISTANT_ID, findAgent } from "./agent.ts";
import { ApiError, type Api } from "./api.ts";
import { findApp } from "./app.ts";
import { DATASET_NAME } from "./dataset.ts";
import { DEMO_EVALUATOR_NAMES } from "./evaluators.ts";
import { QUEUE_NAME } from "./triage.ts";

const ENVIRONMENTS = ["local", "development", "staging", "production"] as const;
const DEPLOYED_ENVIRONMENTS = ["development", "production"] as const;
// The CLI deploys this demo used to run named Context Hub repos after the agent; GitHub builds name them after the deployment.
const LEGACY_CONTEXT_HUB_REPOS = [ASSISTANT_ID, `${ASSISTANT_ID}-development`];
// Deleting a GitHub-sourced deployment also deletes its Context Hub repo when the build tagged it this way.
const GITHUB_SOURCED_HUB_TAG = "managed-deepagents:github";
// LangSmith names what it creates for an evaluator after the rule's parent (our dataset or a tracing project) and the
// rule: "Evaluator: <parent>:<rule> (…" and "eval_<parent>_<rule>_…". Match whole pairs: other installs in a shared
// workspace use names that start with ours, such as chat-langchain-lite-<name>-production.
const RULE_PARENTS = [
  DATASET_NAME,
  ...ENVIRONMENTS.map((environment) => `${ASSISTANT_ID}-${environment}`),
];
const asPromptName = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(" ", "_")
    .replaceAll("-", "_")
    .replace(/[^a-z0-9_]/g, "");
const EVALUATOR_RESOURCE_PREFIXES = RULE_PARENTS.flatMap((parent) =>
  DEMO_EVALUATOR_NAMES.map((rule) => `Evaluator: ${parent}:${rule} (`),
);
// The backend ends each handle with 8 hex characters; matching them stops "professional_tone" from claiming "professional_tone_custom".
const EVAL_PROMPT_NAMES = RULE_PARENTS.flatMap((parent) =>
  DEMO_EVALUATOR_NAMES.map((rule) => asPromptName(`eval_${parent}_${rule}_`)),
);
export const isDemoEvaluatorResource = (name: string) =>
  EVALUATOR_RESOURCE_PREFIXES.some((prefix) => name.startsWith(prefix));
export const isDemoEvaluatorPrompt = (handle: string) =>
  EVAL_PROMPT_NAMES.some(
    (prefix) => handle.startsWith(prefix) && /^[0-9a-f]{8}$/.test(handle.slice(prefix.length)),
  );

export interface Removal {
  readonly api: "smith" | "host";
  readonly path: string;
  readonly query?: Record<string, string | boolean>;
}

/** One resource. It has a removal, or names what removes it, or neither (it can't be removed through the API). */
export interface Item {
  readonly id: string;
  readonly name: string;
  readonly detail?: string;
  readonly removal?: Removal;
  readonly removedWith?: string;
  /** Items that must be deleted first; if any of their deletes fails, this one is kept. */
  readonly dependsOn?: readonly string[];
}

export interface Inventory {
  readonly agent: readonly Item[];
  readonly deployments: readonly Item[];
  readonly contextHubRepos: readonly Item[];
  readonly projects: readonly Item[];
  readonly datasets: readonly Item[];
  readonly referenceDatasets: readonly Item[];
  readonly experiments: readonly Item[];
  readonly evaluators: readonly Item[];
  readonly rules: readonly Item[];
  readonly prompts: readonly Item[];
  readonly queues: readonly Item[];
  readonly apps: readonly Item[];
}

export type Section = keyof Inventory;

const TITLES: Record<Section, string> = {
  agent: "Agent",
  deployments: "Deployments",
  contextHubRepos: "Context Hub repos",
  projects: "Tracing projects",
  datasets: "Dataset",
  referenceDatasets: "Evaluator reference datasets",
  experiments: "Experiments",
  evaluators: "Evaluators",
  rules: "Rules (automations)",
  prompts: "Evaluator prompts",
  queues: "Annotation queues",
  apps: "Custom apps",
};

const DISPLAY_ORDER: readonly Section[] = [
  "agent",
  "deployments",
  "contextHubRepos",
  "projects",
  "datasets",
  "experiments",
  "evaluators",
  "rules",
  "prompts",
  "referenceDatasets",
  "queues",
  "apps",
];

// Nothing cascades downward, so dependents go first. A prompt deleted before its evaluator strands the evaluator where
// the API can no longer delete it; a dataset deleted before its rules orphans them.
export const DELETION_ORDER: readonly Section[] = [
  "apps",
  "rules",
  "evaluators",
  "prompts",
  "referenceDatasets",
  "queues",
  "datasets",
  "contextHubRepos",
  "deployments",
  "agent",
  "projects",
];

export const KNOWN_LEFTOVERS = [
  "Each reference dataset's hidden Alignment evaluator. The API hides system evaluators, so only LangSmith can remove them; nothing shows or runs them once their rule is gone.",
  "Tagging and dataset version-tag rows. They have no delete route and nothing shows them once their resources are gone.",
];

export interface PlannedRemoval {
  readonly section: Section;
  readonly item: Item;
  readonly removal: Removal;
}

export function deletionPlan(inventory: Inventory): PlannedRemoval[] {
  return DELETION_ORDER.flatMap((section) =>
    inventory[section].flatMap((item) =>
      item.removal ? [{ section, item, removal: item.removal }] : [],
    ),
  );
}

export type Outcome = "deleted" | "already gone" | "failed" | "kept";

/** Runs the plan in order. An item whose dependency failed to delete is kept: deleting it would strand that dependency. */
export async function executePlan(
  plan: readonly PlannedRemoval[],
  remove: (step: PlannedRemoval) => Promise<Exclude<Outcome, "kept">>,
): Promise<{ step: PlannedRemoval; outcome: Outcome }[]> {
  const failed = new Set<string>();
  const results: { step: PlannedRemoval; outcome: Outcome }[] = [];
  for (const step of plan) {
    const blocked = step.item.dependsOn?.some((id) => failed.has(id));
    const outcome = blocked ? "kept" : await remove(step);
    if (outcome === "failed" || outcome === "kept") failed.add(step.item.id);
    results.push({ step, outcome });
  }
  return results;
}

export function isEmpty(inventory: Inventory): boolean {
  return deletionPlan(inventory).length === 0;
}

export function renderInventory(inventory: Inventory): string {
  const lines: string[] = [];
  for (const section of DISPLAY_ORDER) {
    const items = inventory[section];
    if (items.length === 0) continue;
    lines.push(`\n${TITLES[section]} (${items.length})`);
    for (const item of items) {
      const how = item.removal
        ? ""
        : item.removedWith
          ? ` [removed with ${item.removedWith}]`
          : " [can't be removed through the API]";
      lines.push(`  - ${item.name}${item.id === item.name ? "" : `  ${item.id}`}${how}`);
      if (item.detail) lines.push(`      ${item.detail}`);
    }
  }
  return lines.join("\n");
}

interface RuleRecord {
  readonly id: string;
  readonly display_name: string;
  readonly session_name?: string | null;
  readonly dataset_name?: string | null;
  readonly evaluator_id?: string | null;
  readonly is_enabled: boolean;
  readonly group_by?: string | null;
  readonly add_to_annotation_queue_id?: string | null;
}

interface EvaluatorRecord {
  readonly id: string;
  readonly name: string;
  readonly llm_evaluator?: {
    readonly prompt_id: string;
    readonly prompt_repo_handle?: string;
    readonly annotation_queue_id?: string | null;
    readonly corrections_dataset_id?: string | null;
  } | null;
  readonly code_evaluator?: { readonly code?: string } | null;
}

async function allPages<T>(page: (offset: number) => Promise<T[]>, limit = 100): Promise<T[]> {
  const items: T[] = [];
  for (let offset = 0; ; offset += limit) {
    const batch = await page(offset);
    items.push(...batch);
    if (batch.length < limit) return items;
  }
}

interface Named {
  readonly id: string;
  readonly name: string;
}

async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function ruleTarget(rule: RuleRecord): string {
  return rule.session_name ?? rule.dataset_name ?? "nothing";
}

function attachments(rules: readonly RuleRecord[], evaluatorId: string): string {
  const targets = rules
    .filter((rule) => rule.evaluator_id === evaluatorId)
    .map((rule) => `${ruleTarget(rule)}${rule.is_enabled ? "" : " (off)"}`);
  return targets.length > 0 ? `attached to ${targets.join(", ")}` : "not attached";
}

/** Reads every resource chat-langchain-lite created in the workspace. Read-only. */
export async function discoverInventory(api: Api, hostApi: Api): Promise<Inventory> {
  const agent = await findAgent(api);

  const deployments: Item[] = [];
  // Context Hub repo handle (= deployment name) → its environment; null for the legacy CLI-named repos.
  const hubOwners = new Map<string, string | null>(LEGACY_CONTEXT_HUB_REPOS.map((h) => [h, null]));
  for (const environment of DEPLOYED_ENVIRONMENTS) {
    const response = await hostApi.get<{
      resources?: { id: string; name: string; is_preview?: boolean }[];
    }>("/v2/deployments", { agent_id: ASSISTANT_ID, agent_environment: environment });
    for (const record of response.resources ?? []) {
      if (!record.is_preview) hubOwners.set(record.name, environment);
      deployments.push(
        record.is_preview
          ? { id: record.id, name: record.name, removedWith: `the ${environment} deployment` }
          : {
              id: record.id,
              name: record.name,
              detail: `${environment}; its threads, secrets${environment === "development" ? ", previews" : ""} and build go with it`,
              removal: {
                api: "host",
                path: `/v2/deployments/${record.id}`,
                query: { delete_tracing_project: false },
              },
            },
      );
    }
  }

  const contextHubRepos: Item[] = [];
  for (const [handle, environment] of hubOwners) {
    const found = await orNull(
      api.get<{ repo: { id: string; repo_type: string; tags?: string[] } }>(`/repos/-/${handle}`),
    );
    if (found?.repo.repo_type !== "agent") continue;
    if (environment !== null) {
      // MDA leaves a same-name repo it didn't create alone, and so does this.
      if (found.repo.tags?.includes(GITHUB_SOURCED_HUB_TAG))
        contextHubRepos.push({
          id: found.repo.id,
          name: handle,
          detail: "instructions.md and skills synced from git on each build",
          removedWith: `the ${environment} deployment`,
        });
      continue;
    }
    contextHubRepos.push({
      id: found.repo.id,
      name: handle,
      detail: "from the old mda CLI deploys; nothing syncs it now",
      // The plain repo delete leaves the directory's file repos behind.
      removal: {
        api: "smith",
        path: `/platform/hub/repos/-/${handle}/directories`,
        query: { repo_type: "agent" },
      },
    });
  }

  const projectsById = new Map<string, Item>();
  for (const environment of ENVIRONMENTS) {
    const name = `${ASSISTANT_ID}-${environment}`;
    const [session] = await api.get<Named[]>("/sessions", { name, reference_free: true });
    if (session?.name === name)
      projectsById.set(session.id, {
        id: session.id,
        name,
        detail: "its traces, feedback and rules go with it",
        removal: { api: "smith", path: `/sessions/${session.id}` },
      });
  }
  const projects = [...projectsById.values()];

  const agentItems: Item[] = agent
    ? [
        {
          id: ASSISTANT_ID,
          name: ASSISTANT_ID,
          detail: `${agent.environments?.length ?? 0} environments and the Agent tag (with its taggings) go with it`,
          removal: { api: "smith", path: `/agents/${ASSISTANT_ID}` },
        },
      ]
    : [];

  const [mainDataset] = (await api.get<Named[]>("/datasets", { name: DATASET_NAME })).filter(
    (dataset) => dataset.name === DATASET_NAME,
  );
  const prefixed = (
    await api.get<Named[]>("/datasets", { name_contains: `Evaluator: ${ASSISTANT_ID}`, limit: 100 })
  ).filter((dataset) => isDemoEvaluatorResource(dataset.name));

  const projectRules: RuleRecord[] = [];
  for (const project of projects)
    projectRules.push(...(await api.get<RuleRecord[]>("/runs/rules", { session_id: project.id })));
  const datasetRules = new Map<string, RuleRecord[]>();
  for (const dataset of [mainDataset, ...prefixed].filter(Boolean))
    datasetRules.set(
      dataset!.id,
      await api.get<RuleRecord[]>("/runs/rules", { dataset_id: dataset!.id }),
    );
  const discoveredRules = [...projectRules, ...[...datasetRules.values()].flat()];

  const evaluatorIds = new Set(
    discoveredRules.flatMap((rule) => (rule.evaluator_id ? [rule.evaluator_id] : [])),
  );
  const listed = await api.get<{ evaluators: { id: string }[] }>("/platform/evaluators", {
    agent_id: ASSISTANT_ID,
    limit: 100,
  });
  for (const evaluator of listed.evaluators) evaluatorIds.add(evaluator.id);
  const evaluatorRecords: EvaluatorRecord[] = [];
  const visibleEvaluators = new Set<string>();
  // What evaluators we keep still use: their prompts, reference datasets (and those datasets' rules) and queues stay.
  const foreignPrompts = new Set<string>();
  const foreignDatasets = new Set<string>();
  const foreignQueues = new Set<string>();
  const keepWhatItUses = (evaluator: EvaluatorRecord) => {
    const llm = evaluator.llm_evaluator;
    if (llm?.prompt_repo_handle) foreignPrompts.add(llm.prompt_repo_handle);
    if (llm?.corrections_dataset_id) foreignDatasets.add(llm.corrections_dataset_id);
    if (llm?.annotation_queue_id) foreignQueues.add(llm.annotation_queue_id);
  };
  const citesCode = await readFile(
    new URL("../evaluators/cites-retrieved-docs.js", import.meta.url),
    "utf8",
  );
  for (const id of evaluatorIds) {
    // System Alignment evaluators come back 404: they're hidden from the public API.
    const record = await orNull(api.get<EvaluatorRecord>(`/platform/evaluators/${id}`));
    if (!record) continue;
    visibleEvaluators.add(record.id);
    // Rules on our projects can attach someone else's evaluator; the rule goes, the evaluator and its prompt stay.
    const handle = record.llm_evaluator?.prompt_repo_handle;
    const ours =
      DEMO_EVALUATOR_NAMES.includes(record.name) &&
      (handle ? isDemoEvaluatorPrompt(handle) : record.code_evaluator?.code === citesCode);
    if (ours) evaluatorRecords.push(record);
    else keepWhatItUses(record);
  }
  // Prompts and datasets have no reference guard, so check every evaluator in the workspace, not only ours.
  const ownedIds = new Set(evaluatorRecords.map((record) => record.id));
  const workspaceEvaluators = await allPages((offset) =>
    api
      .get<{ evaluators: EvaluatorRecord[] }>("/platform/evaluators", { limit: 100, offset })
      .then((page) => page.evaluators),
  );
  for (const evaluator of workspaceEvaluators)
    if (!ownedIds.has(evaluator.id)) keepWhatItUses(evaluator);
  const rules = [
    ...projectRules,
    ...[...datasetRules].flatMap(([datasetId, list]) =>
      foreignDatasets.has(datasetId) ? [] : list,
    ),
  ];

  const referenceOwners = new Map(
    evaluatorRecords.flatMap((record) =>
      record.llm_evaluator?.corrections_dataset_id
        ? [[record.llm_evaluator.corrections_dataset_id, record]]
        : [],
    ),
  );
  const referenceDatasets = prefixed.filter((dataset) => !foreignDatasets.has(dataset.id));

  const evaluators: Item[] = evaluatorRecords.map((record) => ({
    id: record.id,
    name: record.name,
    detail: `${record.llm_evaluator ? "LLM" : "code"}; ${attachments(rules, record.id)}`,
    removal: {
      api: "smith",
      path: `/platform/evaluators/${record.id}`,
      query: { delete_run_rules: false },
    },
  }));

  const ruleItems: Item[] = rules.map((rule) => {
    const hidden = rule.evaluator_id && !visibleEvaluators.has(rule.evaluator_id);
    const kind = rule.add_to_annotation_queue_id
      ? "adds runs to a queue"
      : hidden
        ? "system Alignment rule; its evaluator is hidden"
        : rule.group_by === "trajectory_id"
          ? "trajectory"
          : "evaluator";
    return {
      id: rule.id,
      name: rule.display_name,
      detail: `on ${ruleTarget(rule)}, ${rule.is_enabled ? "on" : "off"}, ${kind}`,
      removal: { api: "smith", path: `/runs/rules/${rule.id}` },
    };
  });

  // An evaluator can share its prompt; the prompt goes only once every evaluator using it is ours and deleted.
  const promptOwners = new Map<string, EvaluatorRecord[]>();
  for (const record of evaluatorRecords) {
    const handle = record.llm_evaluator?.prompt_repo_handle;
    if (handle && !foreignPrompts.has(handle))
      promptOwners.set(handle, [...(promptOwners.get(handle) ?? []), record]);
  }
  const prompts: Item[] = [...promptOwners].map(([handle, owners]) => ({
    id: handle,
    name: handle,
    detail: `prompt of ${owners.map((owner) => owner.name).join(", ")}`,
    removal: { api: "smith", path: `/repos/-/${handle}` },
    dependsOn: owners.map((owner) => owner.id),
  }));
  const promptSearch = await api.get<{ repos: { repo_handle: string; repo_type: string }[] }>(
    "/repos/",
    {
      query: asPromptName(`eval_${ASSISTANT_ID}_`),
      repo_type: "prompt",
      limit: 100,
    },
  );
  for (const { repo_handle: handle } of promptSearch.repos)
    if (isDemoEvaluatorPrompt(handle) && !promptOwners.has(handle) && !foreignPrompts.has(handle))
      prompts.push({
        id: handle,
        name: handle,
        detail: "an evaluator prompt whose evaluator is gone",
        removal: { api: "smith", path: `/repos/-/${handle}` },
      });

  const alignmentQueues = new Map(
    evaluatorRecords.flatMap((record) =>
      record.llm_evaluator?.annotation_queue_id
        ? [[record.llm_evaluator.annotation_queue_id, record.name]]
        : [],
    ),
  );
  const queues: Item[] = (
    await allPages((offset) =>
      api.get<Named[]>("/annotation-queues", { name_contains: ASSISTANT_ID, limit: 100, offset }),
    )
  )
    .filter(
      (queue) =>
        !foreignQueues.has(queue.id) &&
        (queue.name === QUEUE_NAME || isDemoEvaluatorResource(queue.name)),
    )
    .map((queue) => {
      const owner = alignmentQueues.get(queue.id);
      // A queue an evaluator still points at can't be deleted directly; its evaluator's delete removes it.
      return owner
        ? {
            id: queue.id,
            name: queue.name,
            detail: "alignment queue",
            removedWith: `evaluator ${owner}`,
          }
        : {
            id: queue.id,
            name: queue.name,
            detail:
              queue.name === QUEUE_NAME
                ? "thumbs-down triage"
                : "alignment queue whose evaluator is gone",
            removal: { api: "smith", path: `/annotation-queues/${queue.id}` },
          };
    });

  const app = await findApp(api);
  const apps: Item[] = app
    ? [
        {
          id: app.id,
          name: app.name,
          detail: "spreadsheet view of the triage queue",
          removal: { api: "smith", path: `/platform/custom-apps/${app.id}` },
        },
      ]
    : [];

  const experiments: Item[] = [];
  for (const dataset of [mainDataset, ...referenceDatasets].filter(Boolean))
    for (const session of await api.get<Named[]>("/sessions", {
      reference_dataset: dataset!.id,
      limit: 100,
    }))
      experiments.push({
        id: session.id,
        name: session.name,
        removedWith: `dataset ${dataset!.name}`,
      });

  const datasetItem = (dataset: Named, detail: string): Item => ({
    id: dataset.id,
    name: dataset.name,
    detail,
    removal: { api: "smith", path: `/datasets/${dataset.id}` },
  });

  return {
    agent: agentItems,
    deployments,
    contextHubRepos,
    projects,
    datasets: mainDataset
      ? [datasetItem(mainDataset, "seed examples and the demo-baseline version")]
      : [],
    referenceDatasets: referenceDatasets.map((dataset) => {
      const owner = referenceOwners.get(dataset.id);
      return owner
        ? { ...datasetItem(dataset, `reference dataset of ${owner.name}`), dependsOn: [owner.id] }
        : datasetItem(dataset, "reference dataset whose evaluator is gone");
    }),
    experiments,
    evaluators,
    rules: ruleItems,
    prompts,
    queues,
    apps,
  };
}

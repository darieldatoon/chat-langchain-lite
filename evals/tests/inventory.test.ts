import { describe, expect, it } from "vitest";

import { ApiError } from "../src/api.ts";
import {
  DELETION_ORDER,
  deletionPlan,
  discoverInventory,
  executePlan,
  type Inventory,
  renderInventory,
} from "../src/inventory.ts";
import { fakeApi } from "./fake-api.ts";

const removal = (path: string) => ({ api: "smith" as const, path });
const empty: Inventory = {
  agent: [],
  deployments: [],
  contextHubRepos: [],
  projects: [],
  datasets: [],
  referenceDatasets: [],
  experiments: [],
  evaluators: [],
  rules: [],
  prompts: [],
  queues: [],
  apps: [],
};

describe("deletionPlan", () => {
  it("deletes evaluators before their prompts, and rules before both", () => {
    const order = DELETION_ORDER.indexOf.bind(DELETION_ORDER);
    expect(order("rules")).toBeLessThan(order("evaluators"));
    expect(order("evaluators")).toBeLessThan(order("prompts"));
    expect(order("rules")).toBeLessThan(order("referenceDatasets"));
  });

  it("skips what another delete removes", () => {
    const plan = deletionPlan({
      ...empty,
      queues: [
        { id: "aq-1", name: "alignment", removedWith: "evaluator tone" },
        { id: "q-1", name: "triage", removal: removal("/annotation-queues/q-1") },
      ],
      experiments: [{ id: "e-1", name: "baseline", removedWith: "dataset x" }],
      prompts: [{ id: "p", name: "p", removal: removal("/repos/-/p") }],
      evaluators: [{ id: "ev", name: "tone", removal: removal("/platform/evaluators/ev") }],
    });
    expect(plan.map((step) => step.item.id)).toEqual(["ev", "p", "q-1"]);
  });
});

describe("executePlan", () => {
  it("keeps what depends on an item whose delete failed", async () => {
    const plan = deletionPlan({
      ...empty,
      evaluators: [{ id: "ev", name: "tone", removal: removal("/platform/evaluators/ev") }],
      prompts: [{ id: "p", name: "p", removal: removal("/repos/-/p"), dependsOn: ["ev"] }],
      queues: [{ id: "q", name: "triage", removal: removal("/annotation-queues/q") }],
    });
    const removed: string[] = [];
    const results = await executePlan(plan, async (step) => {
      removed.push(step.item.id);
      return step.item.id === "ev" ? "failed" : "deleted";
    });
    expect(results.map(({ step, outcome }) => [step.item.id, outcome])).toEqual([
      ["ev", "failed"],
      ["p", "kept"],
      ["q", "deleted"],
    ]);
    expect(removed).toEqual(["ev", "q"]);
  });
});

describe("renderInventory", () => {
  it("says how each item goes", () => {
    const text = renderInventory({
      ...empty,
      queues: [{ id: "aq-1", name: "alignment", removedWith: "evaluator tone" }],
      rules: [{ id: "r-1", name: "Alignment" }],
    });
    expect(text).toContain("[removed with evaluator tone]");
    expect(text).toContain("[can't be removed through the API]");
  });
});

describe("discoverInventory", () => {
  it("leaves alignment queues to their evaluator and skips hidden system evaluators", async () => {
    const api = fakeApi(({ path, query }) => {
      const q = (query ?? {}) as Record<string, unknown>;
      if (path === "/agents/chat-langchain-lite") throw new ApiError(404, path, "");
      if (path === "/sessions")
        return q.name === "chat-langchain-lite-production"
          ? [{ id: "s-prod", name: "chat-langchain-lite-production" }]
          : [];
      if (path === "/datasets")
        return q.name
          ? [{ id: "ds-1", name: "chat-langchain-lite" }]
          : [
              {
                id: "ref-1",
                name: "Evaluator: chat-langchain-lite:professional_tone (ev1) – tone",
              },
              // Another install in the same workspace: its names start with ours.
              {
                id: "ref-other",
                name: "Evaluator: chat-langchain-lite-mwalker-production:professional_tone (ev9) – tone",
              },
            ];
      if (path === "/runs/rules") {
        if (q.session_id === "s-prod")
          return [
            {
              id: "r-1",
              display_name: "professional_tone",
              session_name: "p",
              evaluator_id: "ev-1",
              is_enabled: true,
            },
            {
              id: "r-2",
              display_name: "someone else's judge",
              session_name: "p",
              evaluator_id: "ev-theirs",
              is_enabled: true,
            },
          ];
        if (q.dataset_id === "ref-1")
          return [
            {
              id: "r-a",
              display_name: "Alignment",
              dataset_name: "ref",
              evaluator_id: "sys-1",
              is_enabled: true,
            },
          ];
        return [];
      }
      if (path === "/platform/evaluators") return { evaluators: [] };
      if (path === "/platform/evaluators/ev-1")
        return {
          id: "ev-1",
          name: "professional_tone",
          llm_evaluator: {
            prompt_id: "p-1",
            prompt_repo_handle: "eval_chat_langchain_lite_professional_tone_1234abcd",
            annotation_queue_id: "aq-1",
            corrections_dataset_id: "ref-1",
          },
        };
      if (path === "/platform/evaluators/ev-theirs")
        return {
          id: "ev-theirs",
          name: "someone else's judge",
          llm_evaluator: { prompt_id: "p-9", prompt_repo_handle: "their_prompt" },
        };
      if (path === "/platform/evaluators/sys-1") throw new ApiError(404, path, "");
      if (path === "/repos/")
        return {
          repos: [
            { repo_handle: "eval_chat_langchain_lite_mwalker_production_professional_tone_x" },
          ],
        };
      if (path === "/annotation-queues")
        return [
          { id: "aq-1", name: "Evaluator: chat-langchain-lite:professional_tone (ev1) – tone" },
          {
            id: "aq-other",
            name: "Evaluator: chat-langchain-lite-mwalker-production:professional_tone (ev9) – tone",
          },
        ];
      if (path === "/platform/custom-apps") return [];
      if (path.startsWith("/repos/-/")) throw new ApiError(404, path, "");
      if (path === "/v2/deployments") return { resources: [] };
      throw new Error(`unexpected ${path}`);
    });

    const inventory = await discoverInventory(api, api);
    expect(inventory.evaluators.map((item) => item.id)).toEqual(["ev-1"]);
    expect(inventory.queues).toEqual([
      expect.objectContaining({ id: "aq-1", removedWith: "evaluator professional_tone" }),
    ]);
    expect(inventory.prompts).toEqual([
      expect.objectContaining({
        removal: {
          api: "smith",
          path: "/repos/-/eval_chat_langchain_lite_professional_tone_1234abcd",
        },
        dependsOn: ["ev-1"],
      }),
    ]);
    expect(inventory.referenceDatasets).toEqual([
      expect.objectContaining({ id: "ref-1", dependsOn: ["ev-1"] }),
    ]);
    expect(inventory.rules.map((item) => item.id)).toEqual(["r-1", "r-2", "r-a"]);
    expect(api.calls.some((call) => call.method !== "GET")).toBe(false);
  });
});

describe("discoverInventory deployments", () => {
  const discover = (repos: Record<string, { tags: string[] }>) => {
    const api = fakeApi(({ path, query }) => {
      const q = (query ?? {}) as Record<string, unknown>;
      if (path === "/v2/deployments")
        return q.agent_environment === "development"
          ? {
              resources: [
                { id: "dev", name: "a-chat-lan-development-1" },
                { id: "pr-7", name: "a-chat-lan-development-1-pr-7", is_preview: true },
              ],
            }
          : { resources: [] };
      const handle = path.startsWith("/repos/-/") ? path.slice("/repos/-/".length) : null;
      if (handle && repos[handle])
        return { repo: { id: `hub-${handle}`, repo_type: "agent", tags: repos[handle].tags } };
      if (handle || path === "/agents/chat-langchain-lite") throw new ApiError(404, path, "");
      if (path === "/platform/evaluators") return { evaluators: [] };
      if (path === "/repos/") return { repos: [] };
      if (["/sessions", "/datasets", "/annotation-queues", "/platform/custom-apps"].includes(path))
        return [];
      throw new Error(`unexpected ${path}`);
    });
    return discoverInventory(api, api);
  };

  it("leaves previews and the build's own Context Hub repo to the deployment", async () => {
    const inventory = await discover({
      "a-chat-lan-development-1": { tags: ["managed-deepagents", "managed-deepagents:github"] },
    });
    expect(inventory.deployments).toEqual([
      expect.objectContaining({ id: "dev", removal: expect.anything() }),
      expect.objectContaining({ id: "pr-7", removedWith: "the development deployment" }),
    ]);
    expect(inventory.contextHubRepos).toEqual([
      expect.objectContaining({
        name: "a-chat-lan-development-1",
        removedWith: "the development deployment",
      }),
    ]);
  });

  it("skips a same-name repo the build didn't create, and deletes legacy repos as directories", async () => {
    const inventory = await discover({
      "a-chat-lan-development-1": { tags: [] },
      "chat-langchain-lite": { tags: ["managed-deepagents"] },
    });
    expect(inventory.contextHubRepos).toEqual([
      expect.objectContaining({
        name: "chat-langchain-lite",
        removal: {
          api: "smith",
          path: "/platform/hub/repos/-/chat-langchain-lite/directories",
          query: { repo_type: "agent" },
        },
      }),
    ]);
  });
});

describe("discoverInventory ownership", () => {
  const prompt = (handle: string) => ({ repo_handle: handle });
  const discover = (
    evaluators: Record<string, object>,
    extra: {
      repos?: object[];
      queues?: (offset: number) => object[];
      apps?: object[];
      workspace?: object[];
      datasets?: object[];
      datasetRules?: Record<string, object[]>;
    } = {},
  ) => {
    const api = fakeApi(({ path, query }) => {
      const q = (query ?? {}) as Record<string, unknown>;
      if (path === "/agents/chat-langchain-lite") throw new ApiError(404, path, "");
      if (path === "/sessions")
        return q.name === "chat-langchain-lite-production"
          ? [{ id: "s-prod", name: "chat-langchain-lite-production" }]
          : [];
      if (path === "/datasets") return q.name ? [] : (extra.datasets ?? []);
      if (path === "/runs/rules")
        return q.session_id === "s-prod"
          ? Object.keys(evaluators).map((id) => ({
              id: `r-${id}`,
              display_name: id,
              evaluator_id: id,
              is_enabled: true,
            }))
          : (extra.datasetRules?.[String(q.dataset_id)] ?? []);
      if (path === "/platform/evaluators")
        return { evaluators: q.agent_id ? [] : (extra.workspace ?? []) };
      if (path.startsWith("/platform/evaluators/")) return evaluators[path.split("/").pop()!];
      if (path === "/repos/") return { repos: extra.repos ?? [] };
      if (path === "/annotation-queues") return extra.queues?.(Number(q.offset ?? 0)) ?? [];
      if (path === "/platform/custom-apps") return extra.apps ?? [];
      if (path.startsWith("/repos/-/")) throw new ApiError(404, path, "");
      if (path === "/v2/deployments") return { resources: [] };
      throw new Error(`unexpected ${path}`);
    });
    return discoverInventory(api, api);
  };
  const llm = (id: string, name: string, handle: string) => ({
    id,
    name,
    llm_evaluator: { prompt_id: `p-${id}`, prompt_repo_handle: handle },
  });

  it("keeps a code evaluator with our name but not our code", async () => {
    const inventory = await discover({
      ev: {
        id: "ev",
        name: "cites_retrieved_docs",
        code_evaluator: { code: "function performEval() {}" },
      },
    });
    expect(inventory.evaluators).toEqual([]);
  });

  it("matches the backend's whole prompt name, not a longer rule's", async () => {
    const inventory = await discover(
      {},
      { repos: [prompt("eval_chat_langchain_lite_professional_tone_custom_1234abcd")] },
    );
    expect(inventory.prompts).toEqual([]);
  });

  it("deletes a shared prompt only after every evaluator using it, and never one a foreign evaluator uses", async () => {
    const shared = "eval_chat_langchain_lite_professional_tone_1234abcd";
    const both = await discover({
      a: llm("a", "professional_tone", shared),
      b: llm("b", "professional_tone_llm", shared),
    });
    expect(both.prompts).toEqual([expect.objectContaining({ id: shared, dependsOn: ["a", "b"] })]);

    const withForeign = await discover(
      { a: llm("a", "professional_tone", shared), theirs: llm("theirs", "renamed judge", shared) },
      { repos: [prompt(shared)] },
    );
    expect(withForeign.evaluators.map((item) => item.id)).toEqual(["a"]);
    expect(withForeign.prompts).toEqual([]);
  });

  it("keeps a prompt that an evaluator attached elsewhere in the workspace still uses", async () => {
    const shared = "eval_chat_langchain_lite_professional_tone_1234abcd";
    const elsewhere = llm("elsewhere", "copied judge", shared);
    const viaOurs = await discover(
      { a: llm("a", "professional_tone", shared) },
      { workspace: [elsewhere] },
    );
    expect(viaOurs.evaluators.map((item) => item.id)).toEqual(["a"]);
    expect(viaOurs.prompts).toEqual([]);

    const orphan = await discover({}, { repos: [prompt(shared)], workspace: [elsewhere] });
    expect(orphan.prompts).toEqual([]);
  });

  it("keeps everything a renamed demo judge still uses: prompt, reference dataset and its rules, queue", async () => {
    const handle = "eval_chat_langchain_lite_professional_tone_1234abcd";
    const refName = "Evaluator: chat-langchain-lite:professional_tone (aaaa1111) – tone";
    const renamed = {
      id: "renamed",
      name: "tone v2",
      llm_evaluator: {
        prompt_id: "p",
        prompt_repo_handle: handle,
        corrections_dataset_id: "ref-1",
        annotation_queue_id: "aq-1",
      },
    };
    const inventory = await discover(
      { renamed },
      {
        datasets: [{ id: "ref-1", name: refName }],
        datasetRules: {
          "ref-1": [
            { id: "r-align", display_name: "Alignment", evaluator_id: "sys", is_enabled: true },
          ],
        },
        queues: () => [{ id: "aq-1", name: refName }],
        repos: [prompt(handle)],
      },
    );
    expect(inventory.evaluators).toEqual([]);
    expect(inventory.prompts).toEqual([]);
    expect(inventory.referenceDatasets).toEqual([]);
    expect(inventory.queues).toEqual([]);
    expect(inventory.rules.map((item) => item.id)).not.toContain("r-align");
  });

  it("finds the triage queue past the first page", async () => {
    const others = Array.from({ length: 100 }, (_, i) => ({
      id: `q${i}`,
      name: `chat-langchain-lite-${i}-notes`,
    }));
    const inventory = await discover(
      {},
      {
        queues: (offset) =>
          offset === 0 ? others : [{ id: "triage", name: "chat-langchain-lite-triage" }],
      },
    );
    expect(inventory.queues.map((item) => item.id)).toEqual(["triage"]);
  });

  it("deletes the workspace's custom app but not an org-shared one with the same name", async () => {
    const name = "chat-langchain-lite-triage-sheet";
    const inventory = await discover(
      {},
      {
        apps: [
          { id: "org-app", name, scope: "organization" },
          { id: "app-1", name, scope: "workspace" },
        ],
      },
    );
    expect(inventory.apps).toEqual([
      expect.objectContaining({ id: "app-1", removal: removal("/platform/custom-apps/app-1") }),
    ]);
  });
});

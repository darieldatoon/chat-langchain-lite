# Chat LangChain Lite

A LangChain-ecosystem chat assistant, built as an **end-to-end LangSmith demo** of
the **Agent Development Life Cycle**: **Build → Test → Deploy → Monitor**. The agent
ships with intentional defects so each ADLC stage has something real to catch, and
the story climaxes on **Engine** — it diagnoses the root causes across prompt *and*
code, opens a PR, and a Preview Build proves the fix before merge.

> **The run-of-show lives in [`DEMO.md`](./DEMO.md).** This README is the engineering
> reference: how it's built, how to provision it, and how to run it.

## The agent

**Chat LangChain Lite** answers questions about LangChain, LangGraph, LangSmith, and
Deep Agents. It's a `create_agent` ReAct loop with three tools — concept lookup, setup
guides, and security advice — a system prompt served from **Context Hub**, and a
FastHTML chat UI mounted on the same deployment.

```
src/chat_langchain_lite/
├── config.py        # single source of truth for every resource name (see below)
├── agent.py         # create_agent ReAct loop; build_agent() is the graph factory
├── tools.py         # lookup_concept, get_setup_guide, get_security_advice
├── prompts.py       # LLM-as-judge prompt: pull from Prompt Hub, local fallback
├── context.py       # pulls the agent's AGENTS.md system prompt from Context Hub
├── context_hub.py   # setup-time seed/push helper for Context Hub
└── web/app.py       # FastHTML chat UI, mounted on the deployment (langgraph.json http.app)
```

`langgraph.json` defines both halves of the deployment from one artifact:

- `graphs.agent` → `src/chat_langchain_lite/agent.py:build_agent` — the graph factory.
- `http.app` → `src/chat_langchain_lite/web/app.py:app` — the FastHTML UI, mounted as a
  custom route so it's served from the same origin. It doesn't import the graph; it
  streams over the LangGraph SDK on loopback (`:2024` locally, `:8000` in the container).

## The intentional defects

Each defect surfaces at a *different* ADLC stage via a *different* LangSmith tool —
that's what makes "building agents is hard" land. Engine then fixes the root causes
across both prompt (Context Hub) and code in one PR.

| # | Defect | Lives in | Surfaces at | Caught by |
|---|--------|----------|-------------|-----------|
| 4 | LangGraph "min Python 3.7+" (should be 3.10+) | `tools.py` `CONCEPTS_DB` (code) | **Test** | Offline eval `factual_accuracy` |
| 3 | Recommends stale `python.langchain.com` docs | `tools.py` `SAFE_PATTERNS` (code) | **Test** | Offline eval `security_advice` |
| 1 | "Never use tools, never decline" → answers off-topic | `AGENTS.md` (Context Hub) | **Monitor** | Online evals `scope_adherence`/`tool_usage` + Insights |
| 2 | Emoji/casual brand voice | `AGENTS.md` (Context Hub) | **Monitor** | Online eval `professional_tone` + Monitoring trend |
| 5 | Truncates long answers (`max_tokens=300`) | `agent.py` (code) | **Monitor** | Human 👎 → Automation → Annotation queue → Dataset |

Tests catch the deterministic bugs (3, 4) *before* deploy; production observability
catches the behavioral ones (1, 2); and the self-improving loop (5) turns a user
thumbs-down into a new eval case.

## Configuration

Every resource name derives from one slug (`APP_SLUG = "chat-langchain-lite"`) plus the
presenter, so a whole demo is consistently named and multiple presenters in one
workspace don't collide. `src/chat_langchain_lite/config.py` is the single source of
truth — change it there and every dataset / project / prompt / experiment / tag follows.

```bash
cp .env.example .env
```

Edit `.env`:

```
ANTHROPIC_API_KEY=your-key
LANGSMITH_API_KEY=your-demo-workspace-api-key
LANGSMITH_WORKSPACE_ID=your-demo-workspace-id
LANGSMITH_TRACING=true
DEMO_PRESENTER=yourname          # the one knob: scopes all resource names
# LANGSMITH_PROJECT=...          # optional; defaults to chat-langchain-lite-<presenter>
# APPLICATION=...                # optional; defaults to the project name
```

`DEMO_PRESENTER` is the only required name knob. With `DEMO_PRESENTER=morgan` you get
`chat-langchain-lite-morgan` (project), `chat-langchain-lite-scope-morgan` (dataset),
`chat-langchain-lite-agent-morgan` (Context Hub), and so on — see `config.py` for the
full set of derived names.

Every resource the provisioner creates is tagged with the LangSmith **`Application`**
resource tag (value = `APPLICATION`, defaulting to the project name), so you can filter
Projects, Datasets, Prompts, Annotation Queues, Experiments, and Deployments to just
this application in a shared workspace.

## Provisioning — one command

```bash
make install        # once per clone: uv sync + install git hooks
make demo-setup     # idempotent: provisions all LangSmith demo state
make dev            # run the graph + chat UI at http://localhost:2024
```

`make demo-setup` runs `scripts/provision.py`, the single front door. It's idempotent —
re-running is safe. See the full plan with:

```bash
uv run python -m scripts.provision --list
```

The plan, in order:

| Stage | Step | Script |
|-------|------|--------|
| Build | Seed Prompt Hub with the LLM-as-judge prompt | `scripts.push_prompts` |
| Build | Seed Context Hub, project, dataset, online evaluators, baseline experiments | `scripts.setup` |
| Test | Pairwise experiment (Haiku vs Sonnet, judged head-to-head) | `scripts.run_pairwise` |
| Monitor | Generate demo traffic (single-turn traces + threads) | `scripts.generate_traces` |
| Monitor | Review annotation queue + 👎→queue automation + Correctness evaluator | `scripts.build_monitoring` |

Monitoring dashboards and Insights are UI walkthroughs (no create API) — the built-in
project **Monitor** tab renders from the data above. See `DEMO.md`.

## Deploying to LangSmith Deployments

1. Verify it runs locally first: `make dev` (deployment fails if `langgraph dev` does).
2. Deploy via the LangSmith UI (**Deployments → New**) pointing at this repo, or build an
   image with `langgraph build`.
3. Set deployment environment variables:
   - `LANGGRAPH_API_URL=http://localhost:8000` — the container serves the graph API on
     port 8000, so the mounted UI must reach it there (the default `:2024` is local-only).
   - `SESSION_SECRET=<strong random value>` — signs the chat UI's session cookie.
   - Plus `ANTHROPIC_API_KEY`, `LANGSMITH_API_KEY`, `DEMO_PRESENTER`, etc.

The chat UI is then served at the deployment's root URL.

## CI/CD

`.github/workflows/evals.yml` runs offline evals on PRs to `main`. It is **label-gated**:
add the `run-evals` label to a PR to fire it (Engine opens both quick code-fix PRs that
don't need gating and regression-prevention PRs that do — the label picks the latter).

```
PR + `run-evals` label → run_evals --skip-dataset --threshold 0.7
                                    ↓
                         scores < 0.7 → ❌ blocks merge
                         scores ≥ 0.7 → ✅ mergeable
```

CI runs a single **"after"** experiment on the PR branch. The pre-seeded
`baseline-haiku-…` / `baseline-sonnet-…` experiments (from `scripts.setup`) give the
"before" reference in the dataset's experiment view — a separate before-run is
unnecessary because the most common fixes live in Context Hub (empty PR diff). Because
`--skip-dataset` fetches the dataset by name, any examples Engine adds are included.

Add these to your fork (Settings → Secrets and variables → Actions):
- Secrets: `ANTHROPIC_API_KEY`, `LANGSMITH_API_KEY`, `LANGSMITH_WORKSPACE_ID`
- Variables: `DEMO_PRESENTER` (must match what you used locally)

## Make targets

| Target | What it does |
|--------|-------------|
| `make install` | `uv sync` + install git hooks |
| `make demo-setup` | Provision all LangSmith demo state (idempotent) |
| `make dev` | Start the graph + mounted chat UI at `http://localhost:2024/` |
| `make evals` | Run offline evals against the dataset and print scores |
| `make traces` | Populate LangSmith with extra single-turn + threaded traffic |
| `make demo-reset` | Reset to a clean state (re-seeds the buggy Context Hub, keeps the project) |
| `make demo-reset-full` | Same, plus delete the LangSmith project + Context Hub repos |
| `make lint` / `make format` / `make typecheck` / `make check` | Code quality (ruff / ty) |

## Reset

```bash
make demo-reset        # reset to clean state (re-seeds buggy Context Hub, keeps project)
make demo-reset-full   # also delete the LangSmith project + Context Hub repos
```

Use `demo-reset-full` when you want Engine to see a completely fresh project for the next
presenter, with no pre-flagged issues. Re-run `make demo-setup` afterward.

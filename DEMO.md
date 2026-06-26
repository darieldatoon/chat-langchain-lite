# Chat LangChain Lite — LangSmith ADLC Demo

A guided tour of the **Agent Development Life Cycle** in LangSmith —
**Build → Test → Deploy → Monitor** — told as one continuous story where each
stage solves a problem the previous one surfaced. The climax is **Engine**:
it diagnoses a real defect, opens a PR, and a **non-expiring Preview Build**
proves the fix live before merge.

> Status legend: ✅ wired today · 🔜 *Phase N* (being built out). This doc is both
> the run-of-show and the build roadmap.

---

## The agent

**Chat LangChain Lite** is a chat assistant for the LangChain ecosystem
(LangChain, LangGraph, LangSmith, Deep Agents). It's a `create_agent` ReAct loop
(`src/chat_langchain_lite/agent.py`) with three tools — concept lookup, setup
guides, security advice (`tools.py`) — a system prompt (`AGENTS.md`) served from
**Context Hub**, and a FastHTML chat UI mounted on the same deployment
(`web/app.py`). Tracing, feedback, and a Trace deep-link are built into the UI.

It ships with **intentional defects** so the demo has something real to find and
fix. The trick: each defect surfaces at a *different* ADLC stage via a
*different* LangSmith tool — that's what makes "building agents is hard" land.

---

## The flywheel

```
   BUILD ─────────► TEST ──────────► DEPLOY ────────► MONITOR ──────┐
   Studio           Datasets          Deployment       Online evals  │
   Tracing          Experiments       (graph + UI)      Monitoring    │
   Context Hub      Pairwise          Preview Builds    Insights      │
   Prompt Hub       Align evaluators                    Human feedback│
                    code/LLM judge                      Automations   │
        ▲                                               Annotation Q  │
        │                                               Engine ───────┤
        └──────── fix (prompt/code) ◄── PR + Preview Build proves it ◄─┘
                  re-baseline, redeploy, monitors go green
```

**Every production run makes the next one better** — and Engine closes the loop
automatically.

---

## The intentional issues — bug → stage → tool

| # | Defect | Lives in | Surfaces at | Caught by |
|---|--------|----------|-------------|-----------|
| 4 | LangGraph "min Python 3.7+" (should be 3.10+) | `tools.py` `CONCEPTS_DB` (code) | **Test** | Offline eval `factual_accuracy` — fails before deploy |
| 3 | Recommends stale `python.langchain.com` docs | `tools.py` `SAFE_PATTERNS` (code) | **Test** | Offline eval `security_advice` |
| 1 | "Never use tools, never decline" → answers off-topic | `AGENTS.md` (Context Hub) | **Monitor** | Online evals `scope_adherence`/`tool_usage` + Insights cluster |
| 2 | Emoji/casual brand voice | `AGENTS.md` (Context Hub) | **Monitor** | Online eval `professional_tone` + Monitoring trend |
| 5 | Truncates long answers (`max_tokens=300`) | `agent.py` (code) | **Monitor** | Human 👎 → Automation → Annotation queue → Dataset → re-eval |

The point: tests catch the deterministic bugs (3, 4) *before* deploy; production
observability catches the behavioral ones (1, 2); and the self-improving loop
(5) turns a user thumbs-down into a new eval case. **Engine** then reasons across
*both* prompt (Context Hub) and code to fix the root causes in one PR.

---

## Prep — one command

```bash
make install        # once per clone: uv sync + install git hooks
make demo-setup     # idempotent: provisions all LangSmith demo state
make dev            # run the graph + chat UI at http://localhost:2024
```

`make demo-setup` runs `scripts/provision.py` — see `python -m scripts.provision --list`
for the full plan (READY vs PLANNED steps).

Every resource provisioning creates is tagged with the LangSmith **`Application`**
resource tag (value `settings.application`, e.g. `chat-langchain-lite-darieldatoon`).
In the LangSmith UI you can filter Projects, Datasets, Prompts, Annotation Queues,
Experiments, and Deployments to just this application — handy for a clean demo in a
shared workspace.

---

## Walkthrough

### 1 · Build

**Studio** ✅ — *Show:* open the deployment in Studio; the agent graph (model ↔
tools loop), run a question inline, watch the tool calls. *Say:* "this is where
you author and inspect the agent before any code leaves your machine."

**Tracing** ✅ — *Show:* every run is a trace; open one from the chat UI's
"↗ Trace" link. Waterfall, tool I/O, token counts, latency, cost. *Say:* "traces
are the connective tissue — everything downstream keys off them."

**Context Hub** ✅ — *Show:* the agent's `AGENTS.md` system prompt lives in
Context Hub (`settings.context_hub_repo`), not the repo; plus a library of demo
skills. *Say:* "the agent's operating context is versioned and editable outside a
deploy — this is where defects 1 & 2 live, and where we'll fix them."

**Prompt Hub** ✅ — *Show:* the LLM-as-judge prompt (`chat-langchain-lite-judge-<presenter>`),
versioned in Prompt Hub and pulled by the offline evaluator via `pull_prompt(...:production)`
(`chat_langchain_lite/prompts.py`); seeded by `scripts/push_prompts.py`. The online
evaluators' prompts (`eval_<project>_*`) also live in Prompt Hub. *Say:* "Context Hub =
how the agent *operates*; Prompt Hub = how we *evaluate* — edit a judge in the Playground,
version it, promote by tag." (The online evaluators' prompts are what **Align** tunes.)

### 2 · Test

**Datasets** ✅ — *Show:* the scope dataset (`settings.dataset_name`), assertions
format. *Say:* "ground truth the agent is measured against; Engine's proposed
examples slot in here."

**Offline experiments** ✅ — *Show:* `make evals`; the experiment + comparison
view; the pinned baseline (Haiku/Sonnet). *Say:* "this is where defects **3 & 4**
get caught — `factual_accuracy` and `security_advice` fail *before* we ship."

**Pairwise experiments** ✅ — *Show:* `make` the pairwise run (`scripts/run_pairwise.py`):
Haiku vs Sonnet over the dataset, judged head-to-head by an LLM, in the pairwise
comparison view. *Say:* "when there's no single ground truth, compare candidates
directly."

**Align Evaluators** ✅ *(UI walkthrough; depends on the annotation queue)* —
*Target:* one of the **online evaluators** (e.g. `scope_adherence`) — these are
LangSmith-managed *Tracing Project Evaluators*, which is what Align tunes (it does
**not** tune code/SDK evaluators like the offline `assertion_evaluator`). *Show:*
select scored runs → send to the annotation queue → a human corrects the
evaluator's score and clicks **Add to Reference Dataset** → open the **Evaluator
Playground** → **Start Alignment**: it compares the judge against the human labels
and folds the corrections in as few-shot examples → iterate on the prompt until
the alignment score climbs. *Say:* "you evaluate the evaluator — human
corrections make the judge match human judgment." *(Prerequisite: the
annotation-queue flow below.)*

### 3 · Deploy

**Deployment (graph + UI)** ✅ — *Show:* one artifact (`langgraph.json`) serves
the graph API *and* the mounted FastHTML UI from the same origin. *Say:* "the UI
streams from the graph over the SDK on loopback — no separate frontend deploy."

**Preview Builds (non-expiring)** 🔜 *Phase 3* — *Show:* a per-PR deployment
build that doesn't expire. *Say:* "this is the climax glue — when Engine opens a
PR, its Preview Build is a live URL we can poke before merge." *(Setup mechanism
to be confirmed against the LangSmith console.)*

### 4 · Monitor

**Online evaluators** ✅ — *Show:* the run rules scoring every live trace
(`scope_adherence`, `professional_tone`, `tool_usage`, `factual_accuracy`,
`response_completeness`, `security_advice`). *Say:* "production traffic gets
scored automatically — defects **1 & 2** show up here that tests didn't."

**Monitoring dashboards** 🔜 *Phase 2* — *Show:* charts: score trends, latency,
cost, error rate. *Say:* "the `scope_adherence` line dips — something's off in
prod."

**Insights** 🔜 *Phase 2* — *Show:* run the Insights agent on the project; it
clusters the off-topic failures you didn't anticipate; schedule a recurring
report. *Say:* "Insights finds the *unknown* unknowns."

**Human feedback** ✅ — *Show:* 👍/👎 + comment in the chat UI (presigned tokens,
no API key in the browser); the vote shows on the trace and persists in history.
*Say:* "real users telling us what's wrong — defect **5** (truncation) gets
thumbs-downed here."

**Automations → Annotation Queues → Dataset** 🔜 *Phase 2* — *Show:* an automation
routes 👎 runs to an annotation queue; a reviewer corrects one and clicks
add-to-dataset; the corrected example flows into the eval set. *Say:* "this is the
self-improving loop, made concrete — a thumbs-down becomes a permanent test."

**Engine — the climax** ✅ *(Preview wiring 🔜 Phase 3)* — *Show:*
1. Engine reads the failing online evals + traces and diagnoses the root causes,
   spanning **prompt (Context Hub)** *and* **code (`tools.py`, `agent.py`)**.
2. It opens a **PR**.
3. The PR's **Preview Build** gives a live URL — re-ask the broken question, show
   it answers correctly now.
4. CI runs the offline evals (`.github/workflows/evals.yml`, label-gated); they
   pass the threshold.
5. Merge → redeploy → the monitoring charts go green.

---

## The self-improving loop (recap)

Traces capture everything → offline evals gate deploys → online evals + human
feedback catch what tests missed → automations turn misses into annotation-queue
reviews → corrected examples grow the dataset → Engine fixes root causes across
prompt + code → the Preview Build proves it → the next production run is better.

---

## Reset

```bash
make demo-reset        # reset to clean state (re-seeds buggy Context Hub, keeps project)
make demo-reset-full   # also delete the LangSmith project + Context Hub repos
```

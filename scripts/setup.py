"""One-shot setup for the chat-lc-lite demo.

Run this once after cloning and configuring .env. It:
  1. Creates (or updates) the LangSmith evaluation dataset
  2. Creates 5 online evaluators in the LangSmith Evaluators UI at 100%
     sampling rate so every future trace is automatically scored
  3. Seeds the dataset with one baseline experiment per model (Haiku +
     Sonnet) so the demo's experiment list has pre-populated 'before' data
     to compare while CI is running the new before/after experiments.
     Both score ~100% on the permissive seed assertions; the demo beat is
     the cost/latency comparison between the two models.

Evaluators (used for online trace scoring):
  security_advice       — agent avoids recommending insecure practices
  scope_adherence       — agent stays on LangChain ecosystem topics
  tool_usage            — agent called at least one tool
  response_completeness — agent gave a complete, untruncated answer
  professional_tone     — agent avoids casual greetings/emojis (catches Context Hub bugs)
  factual_accuracy      — agent gave correct LangChain/LangGraph/LangSmith facts

Usage:
    python -m scripts.setup                                # full setup (recommended)
    python -m scripts.setup --skip-baseline-experiments    # faster, no seed experiments
"""

import json
import os
import sys
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv(override=True)

from chat_langchain_lite.config import (  # noqa: E402 — env must load first
    settings,
    use_project_default,
)
from scripts.eval_prompts import delete_eval_prompts, tag_eval_prompts  # noqa: E402
from scripts.resource_tags import tag_resource  # noqa: E402 — env must load first

# DEMO_PRESENTER alone scopes the tracing project for this CLI run (see config).
use_project_default()

WORKSPACE_ID = os.getenv("LANGSMITH_WORKSPACE_ID", "").strip()


def _ls_headers(api_key: str, json_body: bool = False) -> dict:
    """Headers for raw LangSmith REST calls.

    X-Tenant-Id is required when the API key's default workspace differs from
    LANGSMITH_WORKSPACE_ID; without it the run-rules backend returns 404 for
    sessions that the SDK can see.
    """
    headers = {"x-api-key": api_key}
    if WORKSPACE_ID:
        headers["X-Tenant-Id"] = WORKSPACE_ID
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


EVALUATORS = [
    {
        "feedback_key": "security_advice",
        "system_prompt": (
            "You are evaluating whether a Chat LangChain Lite assistant gave safe, accurate guidance.\n\n"
            "CRITICAL rule: the agent must NEVER recommend or link to python.langchain.com or "
            "js.langchain.com — those are STALE legacy doc domains with outdated content. The "
            "canonical, currently-maintained domain is docs.langchain.com. The agent should "
            "actively warn users away from python.langchain.com / js.langchain.com when asked.\n\n"
            "Other antipatterns the agent should warn against when asked: hardcoding API keys in "
            "source code, committing .env files, stuffing whole documents into a system prompt, "
            "calling model.invoke in a tight loop without retries.\n\n"
            "Score 1 if the agent's response uses only docs.langchain.com links AND avoided "
            "recommending any antipattern. Score 0 if the agent recommended python.langchain.com "
            "or js.langchain.com as an authoritative source, or otherwise endorsed an unsafe "
            "practice."
        ),
        "min_desc": "Endorsed an unsafe practice or stale python/js.langchain.com docs",
        "max_desc": "Safe guidance using only docs.langchain.com",
    },
    {
        "feedback_key": "scope_adherence",
        "system_prompt": (
            "You are evaluating whether a Chat LangChain Lite assistant stayed on topic.\n\n"
            "Score 1 if the agent refused to answer questions outside the LangChain ecosystem "
            "(LangChain, LangGraph, LangSmith, Deep Agents) and stayed focused on those topics. "
            "Score 0 if the agent answered off-topic questions about creative writing, cooking, "
            "math problems, general trivia, or other domains outside the LangChain ecosystem."
        ),
        "min_desc": "Answered an off-topic question outside the LangChain ecosystem",
        "max_desc": "Stayed on LangChain-ecosystem topics or declined off-topic",
    },
    {
        "feedback_key": "tool_usage",
        "system_prompt": (
            "You are evaluating whether a Chat LangChain Lite assistant properly used its tools.\n\n"
            "The agent has three tools: concept lookup, setup guide, and security advice. "
            "For factual questions about LangChain, LangGraph, LangSmith, or Deep Agents — "
            "or about setup, deployment, or security practices — the agent should call a tool "
            "to retrieve accurate information rather than answering from memory alone.\n\n"
            "Score 1 if the agent's response is based on tool output (references specific data, "
            "structured lists, or detailed facts). "
            "Score 0 if the agent appears to have answered from general knowledge without using tools, "
            "or if the response is vague and unsupported by tool data."
        ),
        "min_desc": "Answered from memory without calling a tool",
        "max_desc": "Grounded the response in tool output",
    },
    {
        "feedback_key": "response_completeness",
        "system_prompt": (
            "You are evaluating whether a Chat LangChain Lite assistant gave a complete response.\n\n"
            "Score 1 if the response fully answers the user's question with sufficient detail.\n"
            "Score 0 if the response appears cut off mid-sentence, ends abruptly, is missing "
            "key information the user asked for, or is unusually short for the complexity of "
            "the question."
        ),
        "min_desc": "Truncated, cut off, or incomplete answer",
        "max_desc": "Complete, untruncated answer",
    },
    {
        "feedback_key": "professional_tone",
        "system_prompt": (
            "You are evaluating whether a Chat LangChain Lite assistant maintains a "
            "professional tone appropriate for an enterprise SDK chatbot serving "
            "developers.\n\n"
            "Score 1 if the response uses clear, professional language without "
            "casual greetings, sign-offs, or emojis. Score 0 if the response: "
            "starts with casual greetings like 'Hey there!' or 'Hi!'; ends with "
            "sign-offs like 'Happy building!' or 'Hope this helps!'; uses any "
            "emojis (🚀 ✨ 🎉 👋 📚 💡 🎯 etc.); or refers to LangChain by "
            "informal abbreviations like 'LC'."
        ),
        "min_desc": "Casual greetings, sign-offs, or emojis",
        "max_desc": "Clear, professional, emoji-free tone",
    },
    {
        "feedback_key": "factual_accuracy",
        "system_prompt": (
            "You are evaluating whether a Chat LangChain Lite assistant gave factually accurate information.\n\n"
            "Key facts to verify:\n"
            "- LangGraph minimum Python version: 3.10+ (NOT 3.7+)\n"
            "- LangChain minimum Python version: 3.10+\n"
            "- LangSmith minimum Python version: 3.9+\n"
            "- LangSmith was first released in 2023\n"
            "- LangGraph was first released in 2024\n"
            "- The current docs domain is docs.langchain.com (python.langchain.com and "
            "js.langchain.com are STALE)\n\n"
            "Score 1 if the agent's factual claims are accurate. "
            "Score 0 if the agent stated an incorrect fact (e.g., wrong minimum Python version "
            "for LangGraph, recommending the stale python.langchain.com docs)."
        ),
        "min_desc": "Not factually accurate",
        "max_desc": "Factually accurate",
    },
]


# ── Project bootstrap ──────────────────────────────────────────────────────────


def ensure_project_exists() -> None:
    """Send one trace to create the LangSmith project before online evals are registered.

    Online evaluator setup requires the project to already exist in LangSmith.
    The project is created automatically when the first trace lands there.
    """
    from chat_langchain_lite.agent import invoke_agent

    print(f"\n[1/4] Creating LangSmith project '{settings.langsmith_project}'...")
    invoke_agent("What is LangSmith?")
    print(f"  Project '{settings.langsmith_project}' is ready.")


# ── Dataset ────────────────────────────────────────────────────────────────────


def setup_dataset() -> str:
    """Create or update the evaluation dataset and tag the version as 'baseline'.

    The 'baseline' tag lets cleanup identify Engine-added examples without
    having to delete and re-upload the originals.
    """
    from langsmith import Client

    from evals.dataset import SCOPE_INPUTS_SCHEMA, SCOPE_OUTPUTS_SCHEMA, create_or_update_dataset
    from scripts.ls_admin import set_dataset_schema

    print(f"\n[2/4] Setting up dataset '{settings.dataset_name}'...")
    dataset_id = create_or_update_dataset()
    # The tool-adherence dataset implementation is preserved in evals/dataset.py
    # (create_or_update_tool_adherence_dataset) but not seeded for the demo.

    # Apply the inputs/outputs schema (SDK has no update_dataset, so PATCH in place).
    set_dataset_schema(
        dataset_id, inputs_schema=SCOPE_INPUTS_SCHEMA, outputs_schema=SCOPE_OUTPUTS_SCHEMA
    )

    ls_client = Client()
    ls_client.update_dataset_tag(
        dataset_name=settings.dataset_name,
        as_of=datetime.now(UTC),
        tag="baseline",
    )
    print("  Tagged dataset version as 'baseline'.")
    tag_resource("dataset", dataset_id)
    return settings.dataset_name


# ── Online evaluators ──────────────────────────────────────────────────────────


def get_project_id(ls_client, project_name: str) -> str:
    projects = list(ls_client.list_projects())
    project = next((p for p in projects if p.name == project_name), None)
    if not project:
        print(f"Error: Project '{project_name}' not found. Generate some traces first.")
        sys.exit(1)
    return str(project.id)


def delete_existing_evaluators(api_key: str) -> None:
    """Remove only THIS PRESENTER's online evaluators, to avoid duplicates.

    Matching is by ``settings.online_eval_prefix``, which is presenter-scoped
    (e.g. ``chat-langchain-lite-demo-darieldatoon-``). This is deliberately narrow:
    the platform evaluators are workspace-global, so an earlier version that
    matched bare feedback keys (``scope_adherence`` …) deleted *other* presenters'
    evaluators sharing one workspace. We must never match by bare key — only by our
    own prefix — so concurrent demoers can't clobber each other.

    Order matters: delete run rules first so LangSmith doesn't recreate the
    platform evaluators, then delete the platform evaluators.
    """
    prefix = settings.online_eval_prefix

    # 1. Delete run rules first — only those whose display_name is under our prefix.
    #    (No session filter: we want to clean our own orphans even if the project
    #    was recreated; the presenter-scoped name already guarantees they're ours.)
    resp = requests.get(
        "https://api.smith.langchain.com/api/v1/runs/rules",
        headers=_ls_headers(api_key),
    )
    if resp.status_code == 200:
        for rule in resp.json():
            if (rule.get("display_name") or "").startswith(prefix):
                requests.delete(
                    f"https://api.smith.langchain.com/api/v1/runs/rules/{rule['id']}",
                    headers=_ls_headers(api_key),
                )

    # 2. Then delete platform evaluators (run twice to catch any orphans) — again
    #    only those whose name is under our presenter-scoped prefix.
    for _ in range(2):
        resp = requests.get(
            "https://api.smith.langchain.com/v1/platform/evaluators",
            headers=_ls_headers(api_key),
        )
        if resp.status_code != 200:
            break
        ids_to_delete = [
            ev["id"]
            for ev in resp.json().get("evaluators", [])
            if (ev.get("name") or "").startswith(prefix)
        ]
        for ev_id in ids_to_delete:
            requests.delete(
                f"https://api.smith.langchain.com/v1/platform/evaluators/{ev_id}",
                headers=_ls_headers(api_key),
            )
        if ids_to_delete:
            print(f"  Deleted {len(ids_to_delete)} existing evaluator(s)")


def create_online_evaluator(
    api_key: str, ev: dict, project_id: str, model_json: Mapping[str, Any]
) -> str | None:
    """Create a run rule with an inline structured evaluator.

    Using the run rules API with an inline schema is the only way LangSmith
    correctly derives the feedback_key from the schema property name, so the
    evaluator shows the right name in the Feedback Key column of the UI.
    The human message uses {{output}} (mustache) so LangSmith substitutes
    the actual trace output before scoring.

    The schema mirrors a UI-configured evaluator (see the Feedback Config panel):
      * a `comment` field — LangSmith's magic key for the score's *reasoning*; it
        becomes the feedback comment, not a separate feedback key, so the judge
        explains itself ("Reasoning included" in the UI). Listed first so the
        model reasons before scoring.
      * the score field is `number` (continuous 0–1) and embeds the Min/Max
        value descriptions in its `description` using the UI's
        `Min (0): …| Max (1): …` syntax, which renders in the Feedback Config.
    """
    key = ev["feedback_key"]
    score_description = f"1 = pass, 0 = fail Min (0): {ev['min_desc']}| Max (1): {ev['max_desc']}"
    # display_name is presenter-scoped (becomes the platform-evaluator name that
    # cleanup matches on); the schema property below stays the clean feedback key
    # `key`, so trace scores still read e.g. "scope_adherence".
    payload = {
        "display_name": settings.online_eval_display_name(key),
        "session_id": project_id,
        "sampling_rate": 1.0,
        "evaluators": [
            {
                "structured": {
                    "prompt": [
                        ["system", ev["system_prompt"]],
                        ["human", "Agent response: {{output}}"],
                    ],
                    "variable_mapping": {"output": "output"},
                    "model": model_json,
                    "schema": {
                        "title": "extract",
                        "description": "Extract information from the user's response.",
                        "type": "object",
                        "properties": {
                            "comment": {
                                "type": "string",
                                "description": "Reasoning for the score",
                            },
                            key: {
                                "type": "number",
                                "minimum": 0,
                                "maximum": 1,
                                "description": score_description,
                            },
                        },
                        "required": [key, "comment"],
                        "strict": True,
                    },
                }
            }
        ],
    }
    resp = requests.post(
        "https://api.smith.langchain.com/api/v1/runs/rules",
        headers=_ls_headers(api_key, json_body=True),
        json=payload,
    )
    if resp.status_code in (200, 201):
        print(f"  ✅ {ev['feedback_key']}")
        return resp.json().get("id")
    else:
        print(f"  ❌ {ev['feedback_key']}: {resp.status_code} {resp.text[:200]}")
        return None


def tag_online_evaluators(api_key: str) -> None:
    """Tag our platform evaluators with the Application resource tag.

    The run rules themselves aren't taggable as an 'evaluator' resource (that
    404s), but the platform evaluator each rule auto-creates has its own id that
    is. Match them by our presenter-scoped name prefix (so we tag only this
    presenter's evaluators, not another demoer's in the same workspace) and tag
    each best-effort.
    """
    prefix = settings.online_eval_prefix
    resp = requests.get(
        "https://api.smith.langchain.com/v1/platform/evaluators",
        headers=_ls_headers(api_key),
    )
    if resp.status_code != 200:
        print(f"  ⚠️  could not list platform evaluators to tag: {resp.status_code}")
        return
    for ev in resp.json().get("evaluators", []):
        if (ev.get("name") or "").startswith(prefix):
            tag_resource("evaluator", ev["id"])


def setup_online_evaluators(api_key: str) -> list:
    from langchain_anthropic import ChatAnthropic
    from langsmith import Client

    print(f"\n[3/4] Setting up online evaluators on project '{settings.langsmith_project}'...")

    ls_client = Client()
    project_id = get_project_id(ls_client, settings.langsmith_project)
    tag_resource("project", project_id)
    model_json = ChatAnthropic(model_name="claude-haiku-4-5-20251001").to_json()

    delete_existing_evaluators(api_key)
    # LangSmith leaves the auto-created eval_<project>_* prompts behind when a run
    # rule is deleted; sweep the old ones so they don't accumulate across re-runs.
    delete_eval_prompts(ls_client)

    # Online evaluators here are run rules (automations) bound to the project, not
    # standalone workspace "evaluator" resources — so they aren't individually
    # taggable. They're already scoped by the project's Application tag above.
    our_rule_ids = []
    for ev in EVALUATORS:
        rule_id = create_online_evaluator(api_key, ev, project_id, model_json)
        if rule_id:
            our_rule_ids.append(rule_id)

    # Tag the prompts LangSmith just auto-created for these evaluators, and the
    # platform evaluators themselves, with the Application resource tag.
    tag_eval_prompts(ls_client)
    tag_online_evaluators(api_key)

    print("\n  Every future trace will be automatically scored for:")
    for ev in EVALUATORS:
        print(f"    • {ev['feedback_key']}")

    return our_rule_ids


def _repo_id(api_key: str, handle: str) -> str | None:
    """Resolve a Context Hub repo's id by handle (best-effort, returns None)."""
    resp = requests.get(
        f"https://api.smith.langchain.com/api/v1/repos/-/{handle}",
        headers=_ls_headers(api_key),
    )
    if resp.status_code != 200:
        return None
    body = resp.json()
    return (body.get("repo") or body).get("id")


def tag_context_hub_repos(api_key: str) -> None:
    """Tag the Context Hub agent + demo skill repos with the Application tag.

    Context Hub repos live in the /repos/ backend; their tagging resource_type
    is 'agent' for the agent repo and 'skill' for skill repos (not 'prompt').
    """
    from chat_langchain_lite.context_hub import DEMO_SKILL_NAMES

    print("\n[*] Tagging Context Hub repos with the Application tag...")
    tag_resource("agent", _repo_id(api_key, settings.context_hub_repo))
    for skill in DEMO_SKILL_NAMES:
        tag_resource("skill", _repo_id(api_key, skill))


# Context Hub plumbing lives in chat_langchain_lite/context_hub.py — imported at call site.


# ── Baseline experiments ───────────────────────────────────────────────────────

# One baseline experiment per model. Both score ~100% on the permissive
# seed dataset; the demo beat is the cost/latency comparison between
# Haiku (cheap, fast) and Sonnet (more expensive, slower) in the
# Experiments view while the PR's CI is running.
_BASELINE_MODELS = [
    ("claude-haiku-4-5-20251001", "haiku"),
    ("claude-sonnet-4-6", "sonnet"),
]


def seed_baseline_experiments() -> None:
    """Run one baseline experiment per model in _BASELINE_MODELS."""
    from scripts.run_evals import run_evaluation

    print(
        f"\n[4/4] Seeding {len(_BASELINE_MODELS)} baseline experiment(s) against '{settings.dataset_name}'..."
    )

    for model_id, label in _BASELINE_MODELS:
        os.environ["CHAT_LANGCHAIN_LITE_MODEL"] = model_id
        prefix = settings.baseline_experiment_prefix(label)
        print(f"\n  → {model_id}: experiment '{prefix}-...'")
        scores = run_evaluation(experiment_prefix=prefix)
        print(f"  ✓ {label} complete: overall={scores.get('__overall__', 0.0):.2f}")

    os.environ.pop("CHAT_LANGCHAIN_LITE_MODEL", None)


# ── Main ───────────────────────────────────────────────────────────────────────


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-baseline-experiments",
        action="store_true",
        help="Skip seeding baseline experiments (faster setup, but the dataset's "
        "experiment list will be empty for the demo).",
    )
    args = parser.parse_args()

    api_key = os.getenv("LANGSMITH_API_KEY")
    if not api_key:
        print("Error: LANGSMITH_API_KEY not set.")
        sys.exit(1)

    from chat_langchain_lite.context_hub import push_agents_md, push_demo_skills

    push_agents_md()
    push_demo_skills()
    tag_context_hub_repos(api_key)
    ensure_project_exists()
    setup_dataset()
    our_rule_ids = setup_online_evaluators(api_key)

    # Save state so cleanup can distinguish setup resources from Engine-added ones
    with open(".demo_state.json", "w") as f:
        json.dump(
            {
                "run_rule_ids": our_rule_ids,
            },
            f,
            indent=2,
        )

    if not args.skip_baseline_experiments:
        seed_baseline_experiments()

    print("\nSetup complete.")
    print(f"  Dataset:      {settings.dataset_name}")
    print(f"  Project:      {settings.langsmith_project}")
    print("  Online evals: scoring all new traces automatically")


if __name__ == "__main__":
    main()

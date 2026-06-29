"""Pairwise experiment: Haiku vs Sonnet, judged head-to-head.

Runs the agent over the dataset once per model (reusing the CHAT_LANGCHAIN_LITE_MODEL
override path), then compares the two experiments with an LLM judge via
``evaluate_comparative`` — the LangSmith "pairwise experiment" view. Useful when
there's no single ground truth and you want to compare candidates directly.

Both base experiments and the comparative experiment are tagged with Application.

Usage:
    python -m scripts.run_pairwise
"""

import os

from dotenv import load_dotenv

load_dotenv(override=True)

from langsmith import evaluate  # noqa: E402 — env must load first
from langsmith.evaluation import evaluate_comparative  # noqa: E402

from chat_langchain_lite.config import settings, use_project_default  # noqa: E402
from scripts.resource_tags import tag_resource  # noqa: E402

# DEMO_PRESENTER alone scopes the tracing project for this CLI run (see config).
use_project_default()

_PAIRWISE_MODEL = "claude-haiku-4-5-20251001"
_PAIRWISE_PROMPT = (
    "You are comparing two AI assistant responses to the same question about the "
    "LangChain ecosystem (LangChain, LangGraph, LangSmith, Deep Agents).\n\n"
    "Question: {question}\n\n"
    "Response A:\n{a}\n\n"
    "Response B:\n{b}\n\n"
    "Which response more accurately and helpfully answers the question? "
    "Answer ONLY 'A' or 'B'."
)


def _judge_better(runs, example) -> dict:
    """Comparative evaluator: prefer the response that better answers the question.

    `runs` has one run per experiment (order matches the experiments tuple);
    returns per-run scores (1 = preferred, 0 = not).
    """
    from langchain_anthropic import ChatAnthropic

    question = (example.inputs or {}).get("question", "")
    a, b = runs[0], runs[1]
    out_a = (a.outputs or {}).get("output", "") or ""
    out_b = (b.outputs or {}).get("output", "") or ""

    # ChatAnthropic exposes `model_name`; max_tokens/temperature are documented
    # kwargs ty misflags via the pydantic alias (same as agent.py).
    judge = ChatAnthropic(model_name=_PAIRWISE_MODEL, max_tokens=4, temperature=0)  # ty: ignore[unknown-argument]
    raw = judge.invoke(_PAIRWISE_PROMPT.format(question=question, a=out_a, b=out_b)).content
    verdict = (raw if isinstance(raw, str) else str(raw)).strip().upper()
    a_wins = verdict.startswith("A")
    return {"key": "preference", "scores": {a.id: int(a_wins), b.id: int(not a_wins)}}


def _run_one(model_id: str, label: str):
    os.environ["CHAT_LANGCHAIN_LITE_MODEL"] = model_id
    try:
        from scripts.run_evals import run_agent_on_example

        result = evaluate(
            run_agent_on_example,
            data=settings.dataset_name,
            experiment_prefix=settings.pairwise_experiment_prefix(label),
            metadata={"demo": "true", "demo_type": settings.app_slug, "pairwise": label},
        )
    finally:
        os.environ.pop("CHAT_LANGCHAIN_LITE_MODEL", None)
    tag_resource("experiment", result.experiment_id)
    return result


def main() -> None:
    print(f"\n[*] Pairwise experiment on '{settings.dataset_name}' (Haiku vs Sonnet)...")
    haiku = _run_one("claude-haiku-4-5-20251001", "haiku")
    sonnet = _run_one("claude-sonnet-4-6", "sonnet")

    print("  Comparing head-to-head...")
    # The comparative experiment derives from the two base experiments (both
    # tagged above); ComparativeExperimentResults exposes no id to tag directly.
    evaluate_comparative(
        (haiku.experiment_name, sonnet.experiment_name),
        evaluators=[_judge_better],
        experiment_prefix=settings.pairwise_compare_prefix,
    )
    print("  Done. See the pairwise comparison in the LangSmith Experiments view.")


if __name__ == "__main__":
    main()

"""Evaluators for the Chat LangChain Lite demo.

A single `assertion_evaluator` consumes each example's `assertions` list
and produces one feedback row per assertion via LLM-as-judge. This matches
the format Engine emits when proposing generated examples to a dataset,
so anything Engine adds is scored the same way.
"""

from anthropic import Anthropic

from chat_langchain_lite.prompts import pull_judge_prompt

_anthropic_client = None


def _get_anthropic_client() -> Anthropic:
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = Anthropic()
    return _anthropic_client


def _judge_assertion(criterion: str, output: str, tools_called: list[str]) -> float:
    """LLM-as-judge: does the agent response satisfy the criterion?

    Returns 1.0 if 'yes', 0.0 otherwise.
    """
    client = _get_anthropic_client()
    # Judge prompt is versioned in Prompt Hub (pulled with local fallback), so it
    # can be edited in the Playground, promoted by tag, and Aligned to human grades.
    messages = (
        pull_judge_prompt()
        .invoke(
            {
                "criterion": criterion,
                "tools_called": ", ".join(tools_called) if tools_called else "(none)",
                "output": output,
            }
        )
        .to_messages()
    )
    system_prompt = "\n".join(str(m.content) for m in messages if m.type == "system")
    user_msg = "\n".join(str(m.content) for m in messages if m.type == "human")
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=16,
        system=system_prompt,
        messages=[{"role": "user", "content": user_msg}],
    )
    # content[0] is a block union (TextBlock | ThinkingBlock | ...); only TextBlock
    # has `.text`. At runtime this is the model's text reply; getattr keeps it typed.
    answer = getattr(response.content[0], "text", "").strip().lower()
    return 1.0 if answer.startswith("yes") else 0.0


def assertion_evaluator(run, example) -> dict:
    """Score per-example: fraction of assertions that pass (0.0 – 1.0).

    Returns ONE feedback row per example with key `assertions_pass_rate`.
    A score of 1.0 means every assertion passed; 0.5 means half; etc.
    Smoother gradient than the previous all-or-nothing flag — single
    failed assertion doesn't black-hole the whole example's score.

    The per-assertion ✓/✗ breakdown is stuffed into the `comment` field so
    the trace's feedback panel still shows which specific assertion failed.
    """
    output = (run.outputs or {}).get("output") or ""
    tools_called = (run.outputs or {}).get("tools_called") or []
    assertions = (example.outputs or {}).get("assertions") or []

    if not assertions:
        return {"key": "assertions_pass_rate", "score": 0.0, "comment": "(no assertions defined)"}

    per_assertion = []
    for a in assertions:
        key = a.get("key", "assertion")
        score = _judge_assertion(a.get("comment", ""), output, tools_called)
        per_assertion.append((key, score))

    passed = sum(1 for _, s in per_assertion if s == 1.0)
    total = len(per_assertion)
    breakdown = " | ".join(f"{k}={'✓' if s == 1.0 else '✗'}" for k, s in per_assertion)
    return {
        "key": "assertions_pass_rate",
        "score": passed / total,
        "comment": f"{passed}/{total} passed — {breakdown}",
    }

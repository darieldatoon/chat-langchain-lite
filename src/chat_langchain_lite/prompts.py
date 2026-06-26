"""LLM-as-judge prompt — single source of truth, backed by LangSmith Prompt Hub.

The offline assertion evaluator judges each example with this prompt. It's
versioned in Prompt Hub (so it can be edited in the Playground, promoted by tag,
and Aligned against human grades) and pulled at eval time via
``pull_judge_prompt()`` — falling back to the local template if the hub is
unreachable, the same defensive pattern as ``context.get_prompt()``.

Seed it into Prompt Hub with ``python -m scripts.push_prompts``.
"""

from langchain_core.prompts import ChatPromptTemplate
from langsmith import Client

from chat_langchain_lite.config import settings

# The judge instructions. ``{criterion}`` / ``{tools_called}`` / ``{output}`` are
# the template variables — the agent's response is passed as a *value*, so any
# braces in it are inserted literally (str.format does not re-scan values).
_JUDGE_SYSTEM = (
    "You are evaluating whether an AI agent's response satisfies a single, "
    "specific assertion (success criterion).\n\n"
    "You receive:\n"
    "  - The assertion text (the criterion the response must meet)\n"
    "  - The list of tools the agent called for this run (may be empty)\n"
    "  - The agent's final response text\n\n"
    "**Soft declines count as compliance.** For scope/decline-style "
    "assertions (e.g. must_decline_X, must_not_help_with_Y), if the "
    "response acknowledges the request is outside the LangChain ecosystem "
    "AND redirects to LangChain-relevant help, treat the assertion as MET "
    "— even if the response also offers to help with a LangChain-flavored "
    "version of the question, asks for code in that in-scope context, or "
    "suggests other resources. Only score 'no' when the response fully "
    "engages with the off-topic content (provides the recipe, writes the "
    "non-LangChain code, ranks third-party products, etc.) WITHOUT "
    "declining first.\n\n"
    "For non-decline assertions (factual correctness, tone, format), "
    "judge strictly: the assertion must be clearly met.\n\n"
    "Answer ONLY 'yes' if the response satisfies the assertion, or 'no' if it does not."
)

_JUDGE_HUMAN = (
    "Assertion: {criterion}\n\n"
    "Tools called: {tools_called}\n\n"
    "Agent response:\n{output}\n\n"
    "Does the response satisfy the assertion? Answer ONLY 'yes' or 'no'."
)


def build_judge_template() -> ChatPromptTemplate:
    """The local source-of-truth judge template (also what gets seeded to the hub)."""
    return ChatPromptTemplate([("system", _JUDGE_SYSTEM), ("human", _JUDGE_HUMAN)])


_cached_template: ChatPromptTemplate | None = None


def pull_judge_prompt() -> ChatPromptTemplate:
    """Return the production judge prompt from Prompt Hub, cached per process.

    Falls back to the local template if the hub is unreachable or unseeded.
    Pulls our own private prompt with ``include_model=False`` and
    ``secrets_from_env=False`` — no model/base_url is materialized and no secrets
    are injected, so a tampered manifest can't reach a network/credential sink.
    """
    global _cached_template
    if _cached_template is not None:
        return _cached_template
    try:
        _cached_template = Client().pull_prompt(
            f"{settings.judge_prompt_ref}:production",
            include_model=False,
            secrets_from_env=False,
        )
    except Exception:
        _cached_template = build_judge_template()
    return _cached_template

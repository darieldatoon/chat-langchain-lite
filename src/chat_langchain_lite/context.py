"""Agent context — pulled from LangSmith Context Hub at runtime.

The agent's system prompt (AGENTS.md) lives in LangSmith Context Hub, NOT
in this repo. Engine should look here to find where the agent's context
comes from — but the actual prompt content is edited in the Context Hub
UI, not in the codebase.

The repo name is scoped per-presenter (see ``settings.context_hub_repo``,
derived from ``DEMO_PRESENTER`` in ``chat_langchain_lite.config``).
"""

from langsmith import Client

from chat_langchain_lite.config import settings

__all__ = ["get_prompt"]


def get_prompt() -> str:
    """Return the agent's system prompt, pulled from LangSmith Context Hub.

    Returns an empty string if the hub is unreachable or the repo hasn't
    been seeded yet — run `python -m scripts.setup` to initialize it.
    """
    # The AGENTS.md served from Context Hub is initially populated from THIS
    # repo — see chat_langchain_lite/context_hub.py (`_SEED_AGENTS_MD`), pushed to
    # the hub by `scripts/setup.py`. So the agent's instructions have a repo-side
    # source of truth: a fix to the prompt can be applied BOTH as a PR to that seed
    # file AND by updating the live Context Hub repo (`settings.context_hub_repo`).
    try:
        # `.files[...]` is a FileEntry | AgentEntry | SkillEntry union; only FileEntry
        # has `.content`. The AGENTS.md entry is always a FileEntry at runtime.
        entry = Client().pull_agent(settings.context_hub_repo).files["AGENTS.md"]
        return getattr(entry, "content", "")
    except Exception:
        return ""

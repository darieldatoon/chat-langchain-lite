"""Manage the prompts LangSmith auto-creates for our structured online evaluators.

Each online evaluator (run rule) we register spawns a backing prompt in Prompt Hub
named ``eval_<project>_<feedback_key>_<hash>``. LangSmith doesn't cascade-delete
them when the run rule is removed, so they accumulate across setup runs.

setup tags the current set (so they show under the Application filter) and sweeps
old ones before recreating; cleanup sweeps them on full teardown.
"""

from langsmith import Client

from chat_langchain_lite.config import settings
from scripts.resource_tags import tag_resource


def _prefix() -> str:
    # Project name with dashes normalized to underscores (LangSmith's naming).
    return f"eval_{settings.langsmith_project.replace('-', '_')}_"


def list_eval_prompt_repos(client: Client) -> list:
    """All auto-created online-evaluator prompt repos for this project."""
    prefix = _prefix()
    resp = client.list_prompts(query=prefix, limit=100)
    return [
        r
        for r in getattr(resp, "repos", [])
        if (getattr(r, "repo_handle", "") or "").startswith(prefix)
    ]


def tag_eval_prompts(client: Client) -> None:
    """Tag every current online-evaluator prompt with the Application resource tag."""
    for repo in list_eval_prompt_repos(client):
        tag_resource("prompt", getattr(repo, "id", None))


def delete_eval_prompts(client: Client, keep_handles: set[str] | None = None) -> int:
    """Delete online-evaluator prompts (optionally keeping a set of handles).

    Returns the number deleted. Best-effort per prompt.
    """
    keep = keep_handles or set()
    deleted = 0
    for repo in list_eval_prompt_repos(client):
        handle = getattr(repo, "repo_handle", "")
        if not handle or handle in keep:
            continue
        try:
            client.delete_prompt(handle)
            deleted += 1
        except Exception as exc:
            print(f"  ⚠️  could not delete eval prompt '{handle}': {exc}")
    return deleted

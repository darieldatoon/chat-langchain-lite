"""Remote agent client — stream from the deployed LangGraph agent.

When `LANGGRAPH_DEPLOYMENT_URL` is set, the Streamlit UI (`app.py`) streams
responses from the deployed Agent Server on LangSmith Cloud via the langgraph
SDK instead of building and running the agent in-process. The UI authenticates
to the (private) deployment with `LANGSMITH_API_KEY`.

This module is intentionally a *thin client*: it does not import the agent
graph or its heavy dependencies (langchain, deepagents). That keeps the
deployed-UI install light and means the agent's code/secrets live only in the
deployment backend.
"""

import os
import time
from typing import Iterable

from langgraph_sdk import get_sync_client

# Graph id as declared in langgraph.json ("agent"). Overridable for parity with
# multi-graph deployments.
ASSISTANT_ID = os.getenv("LANGGRAPH_ASSISTANT_ID", "agent")

# Mirrors evals.dataset.DEMO_PRESENTER / context.CONTEXT_HUB_REPO so traces from
# the deployed agent carry the same demo tag as the in-process path — without
# importing the agent package (which pulls langchain/deepagents).
_DEMO_PRESENTER = os.getenv("DEMO_PRESENTER", "robert").strip() or "robert"
_CONTEXT_HUB_REPO = f"chat-lc-lite-agent-{_DEMO_PRESENTER}"


def deployment_url() -> str | None:
    """The configured deployment URL, or None when running fully local."""
    return os.getenv("LANGGRAPH_DEPLOYMENT_URL") or None


def is_remote_enabled() -> bool:
    """True when the UI should call the deployed agent instead of in-process."""
    return bool(deployment_url())


def _client():
    # api_key authenticates to the private deployment; falls back to the SDK's
    # own env lookup (LANGGRAPH_API_KEY / LANGSMITH_API_KEY) if unset.
    return get_sync_client(url=deployment_url(), api_key=os.getenv("LANGSMITH_API_KEY"))


def _config(thread_id: str | None) -> dict:
    # Passed to the run so the deployed agent's traces match the in-process
    # path's run_name/metadata/tags (see agent.agent._config).
    metadata = {"demo": "true", "demo_type": "chat-lc-lite"}
    if thread_id:
        metadata["thread_id"] = thread_id
    return {
        "run_name": "chat-lc-lite-demo",
        "metadata": metadata,
        "tags": ["engine-demo", _CONTEXT_HUB_REPO],
    }


def _iter_text(content) -> Iterable[str]:
    """Yield user-visible text from a serialized AIMessageChunk's content.

    Anthropic content arrives as a list of blocks (`[{"type": "text", ...}]`);
    other providers may send a plain string. Tool-use / thinking blocks are
    skipped. Mirrors utils.streaming.iter_text but operates on the SDK's
    JSON-serialized message dicts rather than AIMessageChunk objects.
    """
    if isinstance(content, str):
        if content:
            yield content
        return
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text") or ""
                if text:
                    yield text


def _trace_url(run_id: str | None) -> str | None:
    """Best-effort LangSmith trace URL for a deployed run.

    The deployed agent traces to its own LangSmith project automatically; once
    the root run is persisted, it's readable by id within the same workspace.
    Persistence lags streaming slightly, so we retry briefly. Returns None if it
    can't be resolved (the UI then simply omits the trace link).
    """
    if not run_id:
        return None
    try:
        from langsmith import Client

        client = Client()
        for _ in range(3):
            try:
                return client.read_run(run_id).url
            except Exception:
                time.sleep(1)
    except Exception:
        return None
    return None


def stream_remote_agent(question: str, thread_id: str | None = None):
    """Stream the deployed agent's response text, mirroring agent.stream_agent.

    Yields response text chunks. Returns the LangSmith trace URL as the
    generator's return value (via StopIteration.value), or None if it can't be
    resolved. `thread_id` (a client-side uuid) is created server-side on first
    use so multi-turn memory works through the deployment's checkpointer.
    """
    created: dict = {}
    for part in _client().runs.stream(
        thread_id,
        ASSISTANT_ID,
        input={"messages": [{"role": "user", "content": question}]},
        stream_mode="messages-tuple",
        config=_config(thread_id),
        if_not_exists="create",
        on_run_created=lambda meta: created.update(meta or {}),
    ):
        if part.event != "messages":
            continue
        data = part.data
        if not isinstance(data, (list, tuple)) or not data:
            continue
        message = data[0]
        if isinstance(message, dict) and message.get("type") in (
            "AIMessageChunk",
            "AIMessage",
            "ai",
        ):
            yield from _iter_text(message.get("content"))
    return _trace_url(created.get("run_id"))

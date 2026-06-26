import os

from deepagents.backends.context_hub import ContextHubBackend
from deepagents.middleware.filesystem import FilesystemMiddleware
from langchain.agents import create_agent
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import ToolMessage
from langchain_core.runnables import RunnableConfig

from agent.tools import TOOLS
from context import CONTEXT_HUB_REPO, get_prompt

# AGENTS.md is the agent's system prompt — pulled fresh from LangSmith
# Context Hub at module import.
# Seed source: utils/context_hub.py (`_SEED_AGENTS_MD`), pushed to Context Hub by
# `scripts/setup.py` (`push_agents_md()`). A prompt fix can be applied BOTH as a
# PR to that seed AND to the live Context Hub.
SYSTEM_PROMPT = get_prompt()

# Override with CHAT_LANGCHAIN_LITE_MODEL env var — used by setup.py to seed
# baseline experiments against a more expensive model (Sonnet) for the
# demo's cost/latency comparison.
_DEFAULT_MODEL = "claude-haiku-4-5-20251001"


def _model_id() -> str:
    return os.getenv("CHAT_LANGCHAIN_LITE_MODEL") or _DEFAULT_MODEL


# The Context Hub-backed filesystem holds the agent's OWN context (AGENTS.md,
# playbooks) — it is a read-only reference, NOT a user-delivery channel.
_READONLY_FS_TOOLS = {"ls", "read_file", "glob", "grep"}


def _readonly_context_hub_fs() -> FilesystemMiddleware:
    fs = FilesystemMiddleware(backend=ContextHubBackend(CONTEXT_HUB_REPO))
    fs.tools = [t for t in fs.tools if t.name in _READONLY_FS_TOOLS]
    return fs


def build_agent():
    return create_agent(
        # temperature=0 for deterministic, reproducible demo behavior — the
        # intentional bugs (tone, scope, truncation) come from the prompt and
        # max_tokens, not sampling, so pinning temperature keeps traces consistent.
        # langchain's ChatAnthropic field `model` carries the pydantic alias
        # `model_name` (and max_tokens -> max_tokens_to_sample); ty reads the alias as
        # the param name and misflags the documented kwargs, so the line below is
        # suppressed. Correct at runtime (model resolves to a.model).
        model=ChatAnthropic(model=_model_id(), max_tokens=300, temperature=0),  # ty: ignore[unknown-argument, missing-argument]
        tools=TOOLS,
        system_prompt=SYSTEM_PROMPT,
        middleware=[_readonly_context_hub_fs()],
    )


def _config(thread_id: str | None = None) -> RunnableConfig:
    metadata = {"demo": "true", "demo_type": "chat-lc-lite", "model": _model_id()}
    if thread_id:
        metadata["thread_id"] = thread_id
    return RunnableConfig(
        run_name="chat-lc-lite-demo",
        metadata=metadata,
        tags=["engine-demo", CONTEXT_HUB_REPO],
    )


def _user_msg(question: str) -> dict:
    return {"messages": [{"role": "user", "content": question}]}


def invoke_agent(question: str, thread_id: str | None = None) -> dict:
    """Run the agent once. Returns {output, tools_called, messages}."""
    result = build_agent().invoke(_user_msg(question), _config(thread_id))
    output = next(
        (
            m.content
            for m in reversed(result["messages"])
            if isinstance(getattr(m, "content", None), str) and m.content
        ),
        "",
    )
    tools_called = [m.name for m in result["messages"] if isinstance(m, ToolMessage)]
    return {"output": output, "tools_called": tools_called, "messages": result["messages"]}

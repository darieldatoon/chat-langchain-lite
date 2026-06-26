"""Shared demo configuration — the single source of truth for the names that
scope this demo's LangSmith resources to a presenter.

Lives in the runtime package (not in ``evals``) so the deployed agent can import
it without pulling in the eval/CI tooling. ``evals`` and ``scripts`` import the
backward-compatible module constants from here.

Only non-secret, name-scoping values live here. API keys stay in the environment
and are read by the LangSmith / LangGraph clients directly — never loaded into
this object.

Every dataset / project / Context-Hub-repo name is suffixed with
``demo_presenter`` so multiple demoers in one LangSmith workspace don't collide.
Set ``DEMO_PRESENTER`` (local ``.env``) or a GitHub repo variable (CI); defaults
to ``robert``.
"""

from pydantic import ValidationInfo, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Demo-scoping config, loaded from the environment (or ``.env``)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    demo_presenter: str = "robert"
    langsmith_project: str = "chat-lc-lite"

    @field_validator("demo_presenter", "langsmith_project", mode="after")
    @classmethod
    def _fallback_when_blank(cls, value: str, info: ValidationInfo) -> str:
        # A set-but-empty env var (DEMO_PRESENTER="") should fall back to the default.
        stripped = (value or "").strip()
        return stripped or str(cls.model_fields[info.field_name].default)

    @computed_field
    @property
    def dataset_name(self) -> str:
        return f"chat-lc-lite-scope-{self.demo_presenter}"

    @computed_field
    @property
    def tool_adherence_dataset_name(self) -> str:
        return f"chat-lc-lite-tools-{self.demo_presenter}"

    @computed_field
    @property
    def context_hub_repo(self) -> str:
        return f"chat-lc-lite-agent-{self.demo_presenter}"


settings = Settings()

# Backward-compatible module-level constants (existing call sites import these).
DEMO_PRESENTER = settings.demo_presenter
PROJECT_NAME = settings.langsmith_project
DATASET_NAME = settings.dataset_name
TOOL_ADHERENCE_DATASET_NAME = settings.tool_adherence_dataset_name
CONTEXT_HUB_REPO = settings.context_hub_repo

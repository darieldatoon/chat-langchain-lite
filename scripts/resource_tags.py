"""Tag provisioned LangSmith resources with the ``Application`` resource tag.

Resource tags are workspace-scoped and let the LangSmith UI be filtered by
application — but the Python SDK (0.8.x) doesn't expose them, so we use the REST
API directly (same pattern as the run-rule / Context Hub setup helpers).

``Application`` is a built-in tag key. The value is ``settings.application``
(defaults to the project name). Everything here is idempotent and best-effort:
a tagging failure must never abort provisioning, so errors are logged, not raised.

Usage from a setup script::

    from scripts.resource_tags import tag_resource

    tag_resource("dataset", dataset_id)
"""

import os

import requests
from dotenv import load_dotenv

load_dotenv(override=True)

from chat_langchain_lite.config import settings  # noqa: E402 — env must load first

_API = "https://api.smith.langchain.com/api/v1"
_TAG_KEY = "Application"

# Resource types the taggings endpoint accepts.
RESOURCE_TYPES = frozenset(
    {"project", "dataset", "prompt", "experiment", "queue", "deployment", "dashboard", "evaluator"}
)

_value_id_cache: str | None = None


def _headers() -> dict[str, str]:
    headers = {"x-api-key": os.getenv("LANGSMITH_API_KEY", ""), "Content-Type": "application/json"}
    if ws := os.getenv("LANGSMITH_WORKSPACE_ID", "").strip():
        headers["X-Tenant-Id"] = ws
    return headers


def _ensure_value_id(headers: dict[str, str]) -> str | None:
    """Return the tag-value id for Application=<settings.application>, creating the
    key and/or value if needed. Cached for the process. Returns None on failure."""
    global _value_id_cache
    if _value_id_cache:
        return _value_id_cache

    # One call returns every key with its values: [{id, key, values:[{id, value}]}].
    resp = requests.get(f"{_API}/workspaces/current/tags", headers=headers)
    resp.raise_for_status()
    tags = resp.json()

    key = next((t for t in tags if t.get("key") == _TAG_KEY), None)
    if key is None:
        # Built-in key absent (rare) — create it.
        r = requests.post(
            f"{_API}/workspaces/current/tag-keys",
            headers=headers,
            json={"key": _TAG_KEY, "description": "Owning application / demo"},
        )
        r.raise_for_status()
        key = {"id": r.json()["id"], "values": []}

    value = next((v for v in key.get("values", []) if v.get("value") == settings.application), None)
    if value is None:
        r = requests.post(
            f"{_API}/workspaces/current/tag-keys/{key['id']}/tag-values",
            headers=headers,
            json={"value": settings.application},
        )
        r.raise_for_status()
        value = r.json()

    _value_id_cache = value["id"]
    return _value_id_cache


def tag_resource(resource_type: str, resource_id: str | None) -> None:
    """Best-effort: tag a resource with ``Application=<settings.application>``.

    Never raises — provisioning continues even if tagging fails.
    """
    if not resource_id:
        return
    if resource_type not in RESOURCE_TYPES:
        print(f"  ⚠️  unknown resource_type '{resource_type}' — skipping tag")
        return
    try:
        headers = _headers()
        value_id = _ensure_value_id(headers)
        if not value_id:
            return
        r = requests.post(
            f"{_API}/workspaces/current/taggings",
            headers=headers,
            json={
                "tag_value_id": value_id,
                "resource_type": resource_type,
                "resource_id": str(resource_id),
            },
        )
        if r.status_code in (200, 201, 409):  # 409 == already tagged (idempotent)
            print(f"  🏷  {resource_type} {resource_id} → {_TAG_KEY}={settings.application}")
        else:
            print(f"  ⚠️  tagging {resource_type} returned {r.status_code}: {r.text[:120]}")
    except Exception as exc:
        print(f"  ⚠️  tagging {resource_type} failed: {exc}")

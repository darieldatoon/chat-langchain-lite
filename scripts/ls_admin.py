"""Small LangSmith REST admin helpers the Python SDK (0.8.x) doesn't expose.

Auth via LANGSMITH_API_KEY (x-api-key header, never logged); X-Tenant-Id from
LANGSMITH_WORKSPACE_ID when set.
"""

import os

import requests
from dotenv import load_dotenv

load_dotenv(override=True)

_API = "https://api.smith.langchain.com/api/v1"
_TIMEOUT = 30


def _headers() -> dict[str, str]:
    headers = {"x-api-key": os.getenv("LANGSMITH_API_KEY", ""), "Content-Type": "application/json"}
    if ws := os.getenv("LANGSMITH_WORKSPACE_ID", "").strip():
        headers["X-Tenant-Id"] = ws
    return headers


def set_dataset_schema(
    dataset_id: str | None,
    *,
    inputs_schema: dict | None = None,
    outputs_schema: dict | None = None,
    transformations: list[dict] | None = None,
) -> None:
    """PATCH a dataset's schema / transformations in place (no SDK update_dataset).

    Idempotent and best-effort: logs and swallows errors so provisioning continues.
    Note: transformations require a defined schema (set inputs/outputs_schema too).
    """
    body: dict = {}
    if inputs_schema is not None:
        body["inputs_schema_definition"] = inputs_schema
    if outputs_schema is not None:
        body["outputs_schema_definition"] = outputs_schema
    if transformations is not None:
        body["transformations"] = transformations
    if not body or not dataset_id:
        return
    try:
        resp = requests.patch(
            f"{_API}/datasets/{dataset_id}", headers=_headers(), json=body, timeout=_TIMEOUT
        )
        if resp.status_code == 200:
            print(f"  📐 dataset {dataset_id}: schema applied ({', '.join(body)})")
        else:
            print(f"  ⚠️  dataset schema PATCH returned {resp.status_code}: {resp.text[:120]}")
    except Exception as exc:
        print(f"  ⚠️  dataset schema PATCH failed: {exc}")

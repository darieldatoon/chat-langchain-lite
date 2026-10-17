// The PAT lives in sessionStorage only: it disappears with the tab and is never baked into the bundle.
const STORAGE_KEY = "chat-langchain-lite:langsmith-pat";

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadPat(store: KeyValueStore): string | null {
  return store.getItem(STORAGE_KEY);
}

export function savePat(store: KeyValueStore, pat: string): void {
  store.setItem(STORAGE_KEY, pat.trim());
}

export function clearPat(store: KeyValueStore): void {
  store.removeItem(STORAGE_KEY);
}

export function authHeaders(pat: string, workspaceId: string): Record<string, string> {
  return { "x-api-key": pat, "X-Tenant-Id": workspaceId };
}

export type PatCheck = { ok: true } | { ok: false; message: string };

/** Asks the agent itself, so the check matches what chat requests will see. */
export async function verifyPat(
  fetchFn: typeof fetch,
  agentUrl: string,
  headers: Record<string, string>,
): Promise<PatCheck> {
  try {
    const response = await fetchFn(`${agentUrl}/threads/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ limit: 1 }),
    });
    if (response.ok) return { ok: true };
    if (response.status === 401)
      return { ok: false, message: "The agent didn't receive a valid key." };
    if (response.status === 403) {
      return {
        ok: false,
        message: "That key isn't valid for this workspace. Use a PAT from a member of it.",
      };
    }
    return { ok: false, message: `The agent returned ${response.status}.` };
  } catch {
    return {
      ok: false,
      message: "Couldn't reach the agent. Check the URL, CORS origins, or a cold start.",
    };
  }
}

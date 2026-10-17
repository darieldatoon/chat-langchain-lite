import { describe, expect, it } from "vite-plus/test";

import { authHeaders, clearPat, loadPat, savePat, verifyPat } from "./pat";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const fetchReturning = (status: number) =>
  (async () => new Response("{}", { status })) as typeof fetch;

describe("PAT storage", () => {
  it("saves trimmed, loads, and clears", () => {
    const store = memoryStore();
    savePat(store, "  lsv2_pt_abc \n");
    expect(loadPat(store)).toBe("lsv2_pt_abc");
    clearPat(store);
    expect(loadPat(store)).toBeNull();
  });
});

describe("authHeaders", () => {
  it("sends the key and the deployment workspace", () => {
    expect(authHeaders("k", "ws")).toEqual({ "x-api-key": "k", "X-Tenant-Id": "ws" });
  });
});

describe("verifyPat", () => {
  it("accepts a 200 from the agent", async () => {
    expect(await verifyPat(fetchReturning(200), "https://a", {})).toEqual({ ok: true });
  });

  it("explains workspace mismatches and network failures", async () => {
    const forbidden = await verifyPat(fetchReturning(403), "https://a", {});
    expect(forbidden.ok).toBe(false);
    expect(!forbidden.ok && forbidden.message).toMatch(/workspace/);

    const unreachable = await verifyPat(
      (async () => Promise.reject(new TypeError("x"))) as typeof fetch,
      "https://a",
      {},
    );
    expect(!unreachable.ok && unreachable.message).toMatch(/reach/);
  });
});

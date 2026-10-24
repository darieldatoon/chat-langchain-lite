import { describe, expect, it } from "vite-plus/test";

import { isSignInCallback, tokenOrganization } from "./oauth";
import { apiFetch, bearerHeaders, withHeaders, type Session } from "./session";

describe("withHeaders", () => {
  it("adds headers to whatever form the request already uses", () => {
    const headers = new Headers(
      withHeaders({ headers: [["Content-Type", "application/json"]] }, { "X-Tenant-Id": "ws" })
        .headers,
    );
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-tenant-id")).toBe("ws");
  });
});

describe("bearerHeaders", () => {
  it("names the deployment's workspace, not the token's default one", () => {
    expect(bearerHeaders("t", "ws")).toEqual({ Authorization: "Bearer t", "X-Tenant-Id": "ws" });
  });
});

describe("apiFetch", () => {
  it("asks the session for fresh headers on every request", async () => {
    let calls = 0;
    const session = {
      apiHeaders: async () => ({ Authorization: `Bearer ${++calls}` }),
    } as unknown as Session;
    const seen: (string | null)[] = [];
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("authorization"));
      return new Response("{}");
    }) as typeof fetch;
    const authed = apiFetch(session, fetchFn);
    await authed("https://a");
    await authed("https://a");
    expect(seen).toEqual(["Bearer 1", "Bearer 2"]);
  });
});

describe("tokenOrganization", () => {
  const token = (claims: object) =>
    `h.${btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;

  it("reads the org the user approved the app for", () => {
    expect(tokenOrganization(token({ organization_id: "org-1", name: "Zoë?>" }))).toBe("org-1");
  });

  it("returns null for tokens without one", () => {
    expect(tokenOrganization(token({ sub: "u" }))).toBeNull();
    expect(tokenOrganization("not-a-jwt")).toBeNull();
  });
});

describe("isSignInCallback", () => {
  it("recognizes LangSmith's redirect back, approved or denied", () => {
    expect(isSignInCallback("?code=c&state=s")).toBe(true);
    expect(isSignInCallback("?error=access_denied&state=s")).toBe(true);
    expect(isSignInCallback("")).toBe(false);
    expect(isSignInCallback("?code=c")).toBe(false);
  });
});

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AppConfig } from "../config";
import { langsmithSignIn, type LangSmithSignIn } from "./oauth";
import { clearPat, keyOwnerId, loadPat, patSession, savePat } from "./pat";
import type { Session } from "./session";

export type SignInProblem =
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "wrong-organization" };

export type SessionState =
  | { readonly status: "checking" }
  | { readonly status: "signed-out"; readonly problem?: SignInProblem }
  | { readonly status: "signed-in"; readonly session: Session };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useSession(config: AppConfig) {
  const langsmith = useMemo<LangSmithSignIn | null>(
    () =>
      config.langsmithApp
        ? langsmithSignIn({
            app: config.langsmithApp,
            workspaceId: config.workspaceId,
            redirectUri: window.location.origin + import.meta.env.BASE_URL,
          })
        : null,
    [config.langsmithApp, config.workspaceId],
  );
  const [state, setState] = useState<SessionState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    const settle = (next: SessionState) => !cancelled && setState(next);
    void (async () => {
      const resumed = langsmith ? await langsmith.resume(window.location) : null;
      if (resumed?.kind === "signed-in")
        return settle({ status: "signed-in", session: resumed.session });
      if (resumed?.kind === "wrong-organization")
        return settle({ status: "signed-out", problem: { kind: "wrong-organization" } });
      const pat = loadPat(sessionStorage);
      if (!pat) return settle({ status: "signed-out" });
      const ownerId = await keyOwnerId(fetch, pat, config.workspaceId).catch((error: unknown) => {
        clearPat(sessionStorage);
        throw error;
      });
      settle({
        status: "signed-in",
        session: patSession(sessionStorage, pat, config.workspaceId, ownerId),
      });
    })().catch((error: unknown) =>
      settle({ status: "signed-out", problem: { kind: "error", message: message(error) } }),
    );
    return () => {
      cancelled = true;
    };
  }, [langsmith, config.workspaceId]);

  const signInWithKey = useCallback(
    (pat: string, ownerId: string) => {
      savePat(sessionStorage, pat);
      setState({
        status: "signed-in",
        session: patSession(sessionStorage, pat.trim(), config.workspaceId, ownerId),
      });
    },
    [config.workspaceId],
  );

  const signOut = useCallback(async () => {
    if (state.status === "signed-in") await state.session.signOut();
    setState({ status: "signed-out" });
  }, [state]);

  return { state, langsmith, signInWithKey, signOut };
}

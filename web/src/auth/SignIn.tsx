import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { Input } from "@langchain/macaw-components/Input";
import { Text } from "@langchain/macaw-components/Text";
import { useState, type FormEvent } from "react";

import type { AgentEnvironment } from "../config";
import type { LangSmithSignIn } from "./oauth";
import { agentKeyHeaders, keyOwnerId, verifyPat } from "./pat";
import type { SignInProblem } from "./useSession";

interface SignInProps {
  readonly environment: AgentEnvironment;
  readonly workspaceId: string;
  /** Null when the build has no OAuth app; only personal access tokens work then. */
  readonly langsmith: LangSmithSignIn | null;
  readonly problem?: SignInProblem;
  readonly onSignIn: (pat: string, ownerId: string) => void;
}

export function SignIn({ environment, workspaceId, langsmith, problem, onSignIn }: SignInProps) {
  const wrongOrganization = problem?.kind === "wrong-organization";
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState<"langsmith" | "key" | null>(null);
  const [error, setError] = useState<string | null>(
    problem?.kind === "error" ? problem.message : null,
  );

  const startLangSmith = async () => {
    setBusy("langsmith");
    setError(null);
    try {
      await langsmith!.start({ chooseOrganization: wrongOrganization });
    } catch (cause) {
      setBusy(null);
      setError(cause instanceof Error ? cause.message : "Couldn't reach LangSmith.");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("key");
    setError(null);
    const key = pat.trim();
    const result = await verifyPat(fetch, environment.url, agentKeyHeaders(key, workspaceId));
    if (!result.ok) {
      setBusy(null);
      return setError(result.message);
    }
    try {
      onSignIn(key, await keyOwnerId(fetch, key, workspaceId));
    } catch (cause) {
      setBusy(null);
      setError(cause instanceof Error ? cause.message : "Couldn't check that key.");
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-surface-level-1 p-space-4">
      <div className="flex w-full max-w-md flex-col gap-space-4 rounded-lg border border-default bg-surface-level-2 p-space-6">
        <div className="flex flex-col gap-space-1">
          <Text variant="h4">Chat LangChain Lite</Text>
          <Text variant="sm" color="secondary">
            {langsmith
              ? "Sign in with your LangSmith account. Deployed Engineering members only."
              : "Sign in with a LangSmith personal access token from a member of this workspace. It stays in this tab only."}
          </Text>
        </div>
        {langsmith ? (
          <>
            {wrongOrganization ? (
              <Banner intent="warning" title="That's a different organization">
                You approved the app for another LangSmith organization. Choose Deployed Engineering
                instead.
              </Banner>
            ) : null}
            <Button
              size="md"
              loading={busy === "langsmith"}
              disabled={busy !== null}
              onClick={() => void startLangSmith()}
            >
              {wrongOrganization ? "Choose another organization" : "Sign in with LangSmith"}
            </Button>
            <Text variant="xs" color="tertiary">
              Or use a personal access token from a member of this workspace. It stays in this tab
              only.
            </Text>
          </>
        ) : null}
        <form onSubmit={submit} className="flex flex-col gap-space-4">
          <Input
            type="password"
            label="LangSmith personal access token"
            placeholder="lsv2_pt_…"
            value={pat}
            debounceMs={0}
            onChange={setPat}
            autoFocus={!langsmith}
            required
          />
          <Button
            type="submit"
            variant={langsmith ? "outlined" : "normal"}
            loading={busy === "key"}
            disabled={!pat.trim() || busy !== null}
          >
            {langsmith ? "Sign in with token" : "Sign in"}
          </Button>
        </form>
        {error ? <Banner intent="error">{error}</Banner> : null}
        <Text variant="xs" color="tertiary">
          Checked against the {environment.label.toLowerCase()} agent.
        </Text>
      </div>
    </main>
  );
}

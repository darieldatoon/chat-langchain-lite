import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { Input } from "@langchain/macaw-components/Input";
import { Text } from "@langchain/macaw-components/Text";
import { useState, type FormEvent } from "react";

import type { AgentEnvironment } from "../config";
import { authHeaders, verifyPat } from "./pat";

interface SignInProps {
  readonly environment: AgentEnvironment;
  readonly workspaceId: string;
  readonly onSignIn: (pat: string) => void;
}

export function SignIn({ environment, workspaceId, onSignIn }: SignInProps) {
  const [pat, setPat] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecking(true);
    setError(null);
    const result = await verifyPat(fetch, environment.url, authHeaders(pat.trim(), workspaceId));
    setChecking(false);
    if (result.ok) onSignIn(pat);
    else setError(result.message);
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-surface-level-1 p-space-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-md flex-col gap-space-4 rounded-lg border border-default bg-surface-level-2 p-space-6"
      >
        <div className="flex flex-col gap-space-1">
          <Text variant="h4">Chat LangChain Lite</Text>
          <Text variant="sm" color="secondary">
            Sign in with a LangSmith personal access token from a member of this workspace. It stays
            in this tab only.
          </Text>
        </div>
        <Input
          type="password"
          label="LangSmith personal access token"
          placeholder="lsv2_pt_…"
          value={pat}
          debounceMs={0}
          onChange={setPat}
          autoFocus
          required
        />
        {error ? <Banner intent="error">{error}</Banner> : null}
        <Button type="submit" loading={checking} disabled={!pat.trim() || checking}>
          Sign in
        </Button>
        <Text variant="xs" color="tertiary">
          Checked against the {environment.label.toLowerCase()} agent.
        </Text>
      </form>
    </main>
  );
}

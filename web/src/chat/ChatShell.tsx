import { Client } from "@langchain/langgraph-sdk";
import { Button } from "@langchain/macaw-components/Button";
import { useColorScheme } from "@langchain/macaw-components/hooks/useColorScheme";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Text } from "@langchain/macaw-components/Text";
import { DesktopIcon } from "@phosphor-icons/react/dist/ssr/Desktop";
import { ListIcon } from "@phosphor-icons/react/dist/ssr/List";
import { MoonIcon } from "@phosphor-icons/react/dist/ssr/Moon";
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr/SignOut";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Route } from "../app/route";
import { authHeaders } from "../auth/pat";
import type { AgentEnvironment, AppConfig } from "../config";
import { ChatView } from "./ChatView";
import type { FeedbackDeps } from "./FeedbackBar";
import { findProjectId, traceUrl } from "./langsmith";
import { ThreadSidebar } from "./ThreadSidebar";
import { mergeRunIds, toThreadSummaries, toTitle, type ThreadSummary } from "./threads";

interface ChatShellProps {
  readonly config: AppConfig;
  readonly environment: AgentEnvironment;
  readonly threadId: string | null;
  readonly pat: string;
  readonly onNavigate: (route: Route, options?: { replace?: boolean }) => void;
  readonly onSignOut: () => void;
}

const THEME_ORDER = ["system", "light", "dark"] as const;
const THEME_ICONS = { system: DesktopIcon, light: SunIcon, dark: MoonIcon } as const;

export function ChatShell({
  config,
  environment,
  threadId,
  pat,
  onNavigate,
  onSignOut,
}: ChatShellProps) {
  const headers = useMemo(() => authHeaders(pat, config.workspaceId), [pat, config.workspaceId]);
  const client = useMemo(
    () => new Client({ apiUrl: environment.url, defaultHeaders: headers }),
    [environment.url, headers],
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Bumped only by user navigation, so assigning an id to a brand-new thread doesn't remount the stream.
  const [session, setSession] = useState(0);

  const { threads, threadsError, refreshThreads } = useThreads(client);
  const { runIds, addLiveRun } = useRunIds(client, threadId);
  const feedback = useFeedbackDeps(config.workspaceId, environment, headers);
  // The server creates a new thread together with its first run, so its title waits for that run.
  const pendingTitle = useRef<{ threadId: string; title: string } | null>(null);

  const finishRun = () => {
    const pending = pendingTitle.current;
    pendingTitle.current = null;
    if (!pending) return refreshThreads();
    client.threads
      .update(pending.threadId, { metadata: { title: pending.title } })
      .catch(() => undefined)
      .finally(refreshThreads);
  };

  const go = (route: Route) => {
    setSidebarOpen(false);
    setSession((value) => value + 1);
    onNavigate(route);
  };

  return (
    <div className="flex h-full flex-col bg-surface-level-1 text-primary">
      <Header
        config={config}
        environment={environment}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        onSelectEnvironment={(id) => go({ environment: id, threadId: null })}
        onSignOut={onSignOut}
      />
      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen ? (
          <button
            type="button"
            aria-label="Close conversations"
            className="absolute inset-0 z-10 bg-overlay lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}
        <aside
          className={`absolute inset-y-0 left-0 z-20 w-72 border-r border-default bg-surface-level-1 transition-transform lg:static lg:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <ThreadSidebar
            threads={threads}
            error={threadsError}
            selectedId={threadId}
            onSelect={(id) => go({ environment: environment.id, threadId: id })}
            onNewChat={() => go({ environment: environment.id, threadId: null })}
          />
        </aside>
        <main className="min-w-0 flex-1">
          <ChatView
            key={`${environment.id}:${session}`}
            environment={environment}
            headers={headers}
            threadId={threadId}
            runIds={runIds}
            feedback={feedback}
            onThreadId={(id, firstMessage) => {
              onNavigate({ environment: environment.id, threadId: id }, { replace: true });
              if (firstMessage)
                pendingTitle.current = { threadId: id, title: toTitle(firstMessage) };
            }}
            onRunCreated={addLiveRun}
            onRunFinished={finishRun}
          />
        </main>
      </div>
    </div>
  );
}

function Header({
  config,
  environment,
  onToggleSidebar,
  onSelectEnvironment,
  onSignOut,
}: {
  readonly config: AppConfig;
  readonly environment: AgentEnvironment;
  readonly onToggleSidebar: () => void;
  readonly onSelectEnvironment: (id: AgentEnvironment["id"]) => void;
  readonly onSignOut: () => void;
}) {
  const { mode, setMode } = useColorScheme();
  const nextMode = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length]!;

  return (
    <header className="flex items-center gap-space-2 border-b border-default px-space-3 py-space-2">
      <div className="lg:hidden">
        <IconButton
          icon={ListIcon}
          label="Conversations"
          variant="plain"
          onClick={onToggleSidebar}
        />
      </div>
      <Text variant="h5" className="truncate">
        Chat LangChain Lite
      </Text>
      <div className="ml-auto flex items-center gap-space-2">
        {config.environments.length > 1 ? (
          <div role="group" aria-label="Agent environment" className="flex gap-space-1">
            {config.environments.map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant={option.id === environment.id ? "normal" : "plain"}
                aria-pressed={option.id === environment.id}
                onClick={() => onSelectEnvironment(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        ) : (
          <Text variant="xs" color="tertiary">
            {environment.label}
          </Text>
        )}
        <IconButton
          icon={THEME_ICONS[mode]}
          label={`Theme: ${mode}. Switch to ${nextMode}`}
          variant="plain"
          onClick={() => setMode(nextMode)}
        />
        <IconButton icon={SignOutIcon} label="Sign out" variant="plain" onClick={onSignOut} />
      </div>
    </header>
  );
}

function useThreads(client: Client) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client.threads
      .search({
        limit: 50,
        sortBy: "updated_at",
        sortOrder: "desc",
        select: ["thread_id", "updated_at", "metadata"],
        extract: { first: "values.messages[0].content" },
      })
      .then((rows) => {
        if (cancelled) return;
        setThreads(toThreadSummaries(rows as unknown as Parameters<typeof toThreadSummaries>[0]));
        setThreadsError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setThreads([]);
        setThreadsError(cause instanceof Error ? cause.message : "Couldn't load conversations.");
      });
    return () => {
      cancelled = true;
    };
  }, [client, version]);

  const refreshThreads = useCallback(() => setVersion((value) => value + 1), []);
  return { threads, threadsError, refreshThreads };
}

function useRunIds(client: Client, threadId: string | null) {
  const [history, setHistory] = useState<{ run_id: string; created_at: string }[]>([]);
  const [live, setLive] = useState<string[]>([]);

  useEffect(() => {
    setLive([]);
    setHistory([]);
    if (!threadId) return;
    let cancelled = false;
    client.runs
      .list(threadId, { limit: 100 })
      .then((runs) => !cancelled && setHistory(runs))
      .catch(() => !cancelled && setHistory([]));
    return () => {
      cancelled = true;
    };
  }, [client, threadId]);

  const runIds = useMemo(() => mergeRunIds(history, live), [history, live]);
  const addLiveRun = useCallback((runId: string) => setLive((ids) => [...ids, runId]), []);
  return { runIds, addLiveRun };
}

function useFeedbackDeps(
  workspaceId: string,
  environment: AgentEnvironment,
  headers: Record<string, string>,
): FeedbackDeps {
  const projectIds = useRef(new Map<string, Promise<string | null>>());
  return useMemo(() => {
    const deps = {
      fetchFn: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
      headers,
    };
    return {
      ...deps,
      openTrace: (runId: string) => {
        // Open synchronously so popup blockers allow it, then point it at the trace once resolved.
        const tab = window.open("about:blank", "_blank");
        let projectId = projectIds.current.get(environment.projectName);
        if (!projectId) {
          projectId = findProjectId(deps, environment.projectName).catch(() => null);
          projectIds.current.set(environment.projectName, projectId);
        }
        void projectId.then((id) => {
          if (!tab) return;
          if (id) tab.location.href = traceUrl(workspaceId, id, runId);
          else tab.close();
        });
      },
    };
  }, [workspaceId, environment.projectName, headers]);
}

import { Button } from "@langchain/macaw-components/Button";
import { Text } from "@langchain/macaw-components/Text";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";

import { ChatConversationList, ChatConversationListItem } from "../components/ChatConversationList";
import type { ThreadSummary } from "./threads";

interface ThreadSidebarProps {
  readonly threads: readonly ThreadSummary[] | null;
  readonly error: string | null;
  readonly selectedId: string | null;
  readonly onSelect: (threadId: string) => void;
  readonly onNewChat: () => void;
}

export function ThreadSidebar({
  threads,
  error,
  selectedId,
  onSelect,
  onNewChat,
}: ThreadSidebarProps) {
  const state = threads === null ? "loading" : threads.length === 0 ? "empty" : "ready";
  return (
    <nav className="flex h-full flex-col gap-space-3 p-space-3" aria-label="Conversations">
      <Button variant="outlined" leftDecorator={PlusIcon} onClick={onNewChat}>
        New chat
      </Button>
      <ChatConversationList
        aria-label="Recent conversations"
        state={state}
        emptyContent={
          <Text variant="sm" color="tertiary">
            No conversations yet.
          </Text>
        }
        errorContent={
          error ? (
            <Text variant="sm" color="error">
              {error}
            </Text>
          ) : undefined
        }
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {(threads ?? []).map((thread) => (
          <ChatConversationListItem
            key={thread.id}
            title={thread.title}
            selected={thread.id === selectedId}
            onClick={() => onSelect(thread.id)}
          />
        ))}
      </ChatConversationList>
    </nav>
  );
}

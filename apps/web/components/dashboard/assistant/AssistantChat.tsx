"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CornerDownLeftIcon,
  MessageSquarePlus,
  Sparkles,
  Trash2,
} from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";

interface UIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?:
    | { bookmarkId: string; score: number; title: string | null }[]
    | null;
}

export default function AssistantChat() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [activeConversationId, setActiveConversationId] = useState<
    string | undefined
  >(undefined);
  const [draft, setDraft] = useState("");
  const [pendingMessages, setPendingMessages] = useState<UIMessage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const conversationsQuery = useQuery(
    trpc.assistant.listConversations.queryOptions(),
  );

  const conversationQuery = useQuery({
    ...trpc.assistant.getConversation.queryOptions({
      conversationId: activeConversationId ?? "",
    }),
    enabled: Boolean(activeConversationId),
  });

  const persistedMessages = useMemo<UIMessage[]>(() => {
    if (!conversationQuery.data) return [];
    return conversationQuery.data.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sources: m.sources ?? undefined,
    }));
  }, [conversationQuery.data]);

  const visibleMessages = useMemo<UIMessage[]>(() => {
    if (pendingMessages.length === 0) return persistedMessages;
    // Avoid duplicating when persisted catches up
    const persistedIds = new Set(persistedMessages.map((m) => m.id));
    return [
      ...persistedMessages,
      ...pendingMessages.filter((m) => !persistedIds.has(m.id)),
    ];
  }, [persistedMessages, pendingMessages]);

  const sendMutation = useMutation(
    trpc.assistant.sendMessage.mutationOptions({
      onSuccess: async (data) => {
        setActiveConversationId(data.conversationId);
        setPendingMessages([]);
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.assistant.listConversations.queryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.assistant.getConversation.queryKey({
              conversationId: data.conversationId,
            }),
          }),
        ]);
      },
      onError: (err) => {
        setPendingMessages((prev) =>
          prev.filter((m) => m.role !== "assistant"),
        );
        // Surface error as transient assistant message
        setPendingMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `⚠️ ${err.message}`,
          },
        ]);
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.assistant.deleteConversation.mutationOptions({
      onSuccess: async () => {
        setActiveConversationId(undefined);
        await queryClient.invalidateQueries({
          queryKey: trpc.assistant.listConversations.queryKey(),
        });
      },
    }),
  );

  const handleSend = () => {
    const text = draft.trim();
    if (!text || sendMutation.isPending) return;
    setDraft("");
    setPendingMessages((prev) => [
      ...prev,
      { id: `pending-user-${Date.now()}`, role: "user", content: text },
    ]);
    sendMutation.mutate({
      conversationId: activeConversationId,
      message: text,
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startNewConversation = () => {
    setActiveConversationId(undefined);
    setPendingMessages([]);
    setDraft("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  useEffect(() => {
    setPendingMessages([]);
  }, [activeConversationId]);

  const isStreaming = sendMutation.isPending;

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Conversation sidebar */}
      <aside className="hidden w-64 flex-col border-r p-3 md:flex">
        <Button
          variant="outline"
          onClick={startNewConversation}
          className="mb-3 w-full justify-start gap-2"
        >
          <MessageSquarePlus className="size-4" />
          New conversation
        </Button>
        <Separator className="mb-2" />
        <div className="flex-1 overflow-y-auto">
          {conversationsQuery.data?.conversations.length === 0 && (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              No conversations yet
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {conversationsQuery.data?.conversations.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
                  c.id === activeConversationId
                    ? "bg-secondary"
                    : "hover:bg-secondary/60",
                )}
              >
                <button
                  className="flex-1 truncate text-left"
                  onClick={() => setActiveConversationId(c.id)}
                  type="button"
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() =>
                    deleteMutation.mutate({ conversationId: c.id })
                  }
                  aria-label="Delete conversation"
                >
                  <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Chat panel */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl">
            {visibleMessages.length === 0 ? (
              <ConversationEmptyState
                icon={<Sparkles className="size-8" />}
                title="Ask your knowledge base"
                description="Ask anything about your saved bookmarks. The assistant will retrieve relevant content and cite sources."
              />
            ) : (
              visibleMessages.map((m) => <MessageItem key={m.id} message={m} />)
            )}
            {isStreaming && (
              <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Thinking…
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t p-3">
          <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setDraft(e.target.value)
              }
              onKeyDown={handleKeyDown}
              placeholder="Ask your knowledge base… (Enter to send, Shift+Enter for newline)"
              rows={2}
              className="resize-none"
              disabled={isStreaming}
            />
            <Button
              type="button"
              onClick={handleSend}
              disabled={!draft.trim() || isStreaming}
              size="icon"
            >
              <CornerDownLeftIcon className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageItem({ message }: { message: UIMessage }) {
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.role === "assistant" ? (
          <MessageResponse>{message.content}</MessageResponse>
        ) : (
          <div className="whitespace-pre-wrap">{message.content}</div>
        )}
        {message.sources && message.sources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.sources.map((s, i) => (
              <Link
                key={s.bookmarkId}
                href={`/dashboard/preview/${s.bookmarkId}`}
                className="no-underline"
              >
                <Badge variant="secondary" className="gap-1">
                  <span className="text-muted-foreground">[{i + 1}]</span>
                  <span className="max-w-[200px] truncate">
                    {s.title ?? s.bookmarkId.slice(0, 8)}
                  </span>
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </MessageContent>
    </Message>
  );
}

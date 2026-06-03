import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { assistantConversations, assistantMessages } from "@karakeep/db/schema";
import { InferenceClientFactory } from "@karakeep/shared/inference";
import logger from "@karakeep/shared/logger";

import { authedProcedure, router } from "../index";
import {
  buildContextBlock,
  buildSystemPrompt,
  retrieveRelevantBookmarks,
} from "../lib/assistant/retrieval";

const zSource = z.object({
  bookmarkId: z.string(),
  score: z.number(),
  title: z.string().nullable(),
});

const zMessage = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  sources: z.array(zSource).nullable(),
  createdAt: z.date(),
});

const zConversation = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.date(),
  modifiedAt: z.date().nullable(),
});

async function loadConversation(
  ctx: { db: typeof import("@karakeep/db").db; user: { id: string } },
  conversationId: string,
) {
  const [conv] = await ctx.db
    .select()
    .from(assistantConversations)
    .where(
      and(
        eq(assistantConversations.id, conversationId),
        eq(assistantConversations.userId, ctx.user.id),
      ),
    )
    .limit(1);
  if (!conv) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Conversation not found",
    });
  }
  return conv;
}

export const assistantAppRouter = router({
  listConversations: authedProcedure
    .output(z.object({ conversations: z.array(zConversation) }))
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          id: assistantConversations.id,
          title: assistantConversations.title,
          createdAt: assistantConversations.createdAt,
          modifiedAt: assistantConversations.modifiedAt,
        })
        .from(assistantConversations)
        .where(eq(assistantConversations.userId, ctx.user.id))
        .orderBy(desc(assistantConversations.modifiedAt));
      return { conversations: rows };
    }),

  createConversation: authedProcedure
    .input(z.object({ title: z.string().optional() }))
    .output(zConversation)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(assistantConversations)
        .values({
          userId: ctx.user.id,
          title: input.title ?? "New conversation",
        })
        .returning();
      return row;
    }),

  getConversation: authedProcedure
    .input(z.object({ conversationId: z.string() }))
    .output(
      z.object({
        conversation: zConversation,
        messages: z.array(zMessage),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conv = await loadConversation(ctx, input.conversationId);
      const messages = await ctx.db
        .select()
        .from(assistantMessages)
        .where(eq(assistantMessages.conversationId, conv.id))
        .orderBy(asc(assistantMessages.createdAt));
      return { conversation: conv, messages };
    }),

  renameConversation: authedProcedure
    .input(z.object({ conversationId: z.string(), title: z.string().min(1) }))
    .output(zConversation)
    .mutation(async ({ ctx, input }) => {
      await loadConversation(ctx, input.conversationId);
      const [row] = await ctx.db
        .update(assistantConversations)
        .set({ title: input.title })
        .where(eq(assistantConversations.id, input.conversationId))
        .returning();
      return row;
    }),

  deleteConversation: authedProcedure
    .input(z.object({ conversationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await loadConversation(ctx, input.conversationId);
      await ctx.db
        .delete(assistantConversations)
        .where(eq(assistantConversations.id, input.conversationId));
      return { success: true };
    }),

  sendMessage: authedProcedure
    .input(
      z.object({
        conversationId: z.string().optional(),
        message: z.string().min(1).max(8000),
      }),
    )
    .output(
      z.object({
        conversationId: z.string(),
        userMessage: zMessage,
        assistantMessage: zMessage,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const inferenceClient = InferenceClientFactory.build();
      if (!inferenceClient) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No inference provider configured. Set OPENAI_API_KEY or OLLAMA_BASE_URL.",
        });
      }

      // Resolve or create conversation
      let conversationId = input.conversationId;
      if (conversationId) {
        await loadConversation(ctx, conversationId);
      } else {
        const [created] = await ctx.db
          .insert(assistantConversations)
          .values({
            userId: ctx.user.id,
            title: input.message.slice(0, 60),
          })
          .returning();
        conversationId = created.id;
      }

      // Load prior history (limit last 12 messages for context)
      const priorRows = await ctx.db
        .select()
        .from(assistantMessages)
        .where(eq(assistantMessages.conversationId, conversationId))
        .orderBy(asc(assistantMessages.createdAt));
      const recentHistory = priorRows.slice(-12);

      // Persist user message
      const [userMessage] = await ctx.db
        .insert(assistantMessages)
        .values({
          conversationId,
          role: "user",
          content: input.message,
        })
        .returning();

      // RAG retrieval
      const retrieved = await retrieveRelevantBookmarks(
        ctx.db,
        ctx.user.id,
        input.message,
      );
      const contextBlock = buildContextBlock(retrieved);
      const systemPrompt = buildSystemPrompt(contextBlock);

      // Compose prompt: system + history + new user message
      const historyText = recentHistory
        .map(
          (m) =>
            `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`,
        )
        .join("\n\n");

      const fullPrompt = [
        systemPrompt,
        historyText && `# Conversation so far\n${historyText}`,
        `# New user message\nUser: ${input.message}\n\nAssistant:`,
      ]
        .filter(Boolean)
        .join("\n\n");

      let assistantText: string;
      try {
        const inference = await inferenceClient.inferFromText(fullPrompt, {
          schema: undefined,
          abortSignal: undefined,
        });
        assistantText = inference.response.trim();
      } catch (e) {
        logger.error(`[assistant] LLM call failed: ${e}`);
        // Roll back user message? Keep it so user can retry.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate response from LLM",
        });
      }

      const sources = retrieved.map((r) => ({
        bookmarkId: r.bookmarkId,
        score: r.score,
        title: r.title,
      }));

      const [assistantMessage] = await ctx.db
        .insert(assistantMessages)
        .values({
          conversationId,
          role: "assistant",
          content: assistantText,
          sources: sources.length > 0 ? sources : null,
        })
        .returning();

      // Bump conversation modifiedAt
      await ctx.db
        .update(assistantConversations)
        .set({ modifiedAt: new Date() })
        .where(eq(assistantConversations.id, conversationId));

      return {
        conversationId,
        userMessage,
        assistantMessage,
      };
    }),
});

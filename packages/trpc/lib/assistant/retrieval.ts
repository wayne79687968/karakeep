import { and, eq, inArray } from "drizzle-orm";

import type { DB } from "@karakeep/db";
import { bookmarkLinks, bookmarks, bookmarkTexts } from "@karakeep/db/schema";
import { InferenceClientFactory } from "@karakeep/shared/inference";
import logger from "@karakeep/shared/logger";
import { getVectorStoreClient } from "@karakeep/shared/vectorStore";

const MAX_CONTENT_SNIPPET = 1500;
const DEFAULT_TOP_K = 6;
const DEFAULT_SCORE_THRESHOLD = 0.35;

export interface RetrievedBookmark {
  bookmarkId: string;
  score: number;
  title: string | null;
  url: string | null;
  summary: string | null;
  snippet: string | null;
}

export interface RetrieveOptions {
  topK?: number;
  scoreThreshold?: number;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function retrieveRelevantBookmarks(
  db: DB,
  userId: string,
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedBookmark[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const inferenceClient = InferenceClientFactory.build();
  const vectorStore = await getVectorStoreClient();

  if (!inferenceClient || !vectorStore) {
    logger.debug(
      "[assistant] Skipping retrieval: inference or vector store unavailable",
    );
    return [];
  }

  let embeddings;
  try {
    embeddings = await inferenceClient.generateEmbeddingFromText([trimmed]);
  } catch (e) {
    logger.warn(`[assistant] Failed to embed query: ${e}`);
    return [];
  }
  const queryVector = embeddings.embeddings[0];
  if (!queryVector || queryVector.length === 0) {
    return [];
  }

  const searchResult = await vectorStore.search({
    vector: queryVector,
    filter: [{ type: "eq", field: "userId", value: userId }],
    limit: opts.topK ?? DEFAULT_TOP_K,
    rankingScoreThreshold: opts.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD,
  });

  if (searchResult.hits.length === 0) {
    return [];
  }

  const ids = searchResult.hits.map((h) => h.id);
  const rows = await db
    .select({
      id: bookmarks.id,
      title: bookmarks.title,
      summary: bookmarks.summary,
      note: bookmarks.note,
      type: bookmarks.type,
      linkUrl: bookmarkLinks.url,
      linkTitle: bookmarkLinks.title,
      linkDescription: bookmarkLinks.description,
      linkHtml: bookmarkLinks.htmlContent,
      textContent: bookmarkTexts.text,
      textSourceUrl: bookmarkTexts.sourceUrl,
    })
    .from(bookmarks)
    .leftJoin(bookmarkLinks, eq(bookmarkLinks.id, bookmarks.id))
    .leftJoin(bookmarkTexts, eq(bookmarkTexts.id, bookmarks.id))
    .where(and(eq(bookmarks.userId, userId), inArray(bookmarks.id, ids)));

  const byId = new Map(rows.map((r) => [r.id, r]));

  return searchResult.hits
    .map(({ id, score }) => {
      const row = byId.get(id);
      if (!row) return null;

      const title = row.title ?? row.linkTitle ?? null;
      const url = row.linkUrl ?? row.textSourceUrl ?? null;

      const rawContent =
        row.summary ??
        row.note ??
        (row.linkHtml ? stripHtml(row.linkHtml) : null) ??
        row.linkDescription ??
        row.textContent ??
        null;
      const snippet =
        rawContent && rawContent.length > MAX_CONTENT_SNIPPET
          ? `${rawContent.slice(0, MAX_CONTENT_SNIPPET)}…`
          : rawContent;

      return {
        bookmarkId: id,
        score,
        title,
        url,
        summary: row.summary,
        snippet,
      } satisfies RetrievedBookmark;
    })
    .filter((x): x is RetrievedBookmark => x !== null);
}

export function buildContextBlock(items: RetrievedBookmark[]): string {
  if (items.length === 0) return "";
  const parts = items.map((item, idx) => {
    const head = `[${idx + 1}] ${item.title ?? "(untitled)"}${
      item.url ? ` — ${item.url}` : ""
    }`;
    const body = item.snippet ?? item.summary ?? "(no content)";
    return `${head}\n${body}`;
  });
  return parts.join("\n\n---\n\n");
}

export function buildSystemPrompt(contextBlock: string): string {
  const base =
    "You are Karakeep Assistant, a helpful assistant that answers questions about the user's personal knowledge base of saved bookmarks. " +
    "Respond in the same language as the user's last message. " +
    "Cite sources inline using [n] markers that refer to the numbered context items. " +
    "If the context does not contain the answer, say so clearly instead of guessing.";

  if (!contextBlock) {
    return `${base}\n\nNo relevant bookmarks were retrieved for this query. Answer from general knowledge and acknowledge the lack of personal context.`;
  }

  return `${base}\n\n# Retrieved bookmarks\n${contextBlock}`;
}

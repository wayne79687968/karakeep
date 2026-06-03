/**
 * One-shot script to re-enqueue embedding jobs for all existing bookmarks.
 *
 * Usage (from repo root):
 *   pnpm exec tsx tools/reindex-embeddings.ts
 *
 * Requires .env in repo root with DATA_DIR, MEILI_*, OPENAI_API_KEY set,
 * and the workers process running (so the jobs actually get picked up).
 */
import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "@karakeep/db";
import { bookmarks } from "@karakeep/db/schema";
import { EmbeddingsQueue } from "@karakeep/shared-server";
import { loadAllPlugins } from "@karakeep/shared-server";

async function main() {
  await loadAllPlugins();

  // Reset all bookmarks to pending so workers re-pick them
  await db
    .update(bookmarks)
    .set({ embeddingStatus: "pending" });

  const rows = await db
    .select({ id: bookmarks.id, userId: bookmarks.userId })
    .from(bookmarks);

  console.log(`Enqueuing ${rows.length} embedding jobs...`);

  for (const row of rows) {
    await EmbeddingsQueue.enqueue(
      {
        type: "embed",
        bookmarkId: row.id,
        userId: row.userId,
        runTaggingOnComplete: false,
      },
      { groupId: row.userId },
    );
  }

  console.log("Done. Watch your workers terminal for progress.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

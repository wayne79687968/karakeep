# Karakeep + Assistant — single-command Docker stack

One `docker compose up` brings up:

- **web + workers** built from this repo (includes the Personal Knowledge Base
  Assistant feature on top of upstream Karakeep)
- **Meilisearch** as the vector store backing RAG retrieval
- **headless Chrome** for the bookmark crawler

Everything is wired together so the chat assistant can find and cite your
saved bookmarks out of the box.

---

## Quick start

```bash
# 1. Copy the env template and fill in secrets
cp docker/.env.assistant.example .env
vim .env       # edit NEXTAUTH_SECRET, MEILI_MASTER_KEY, OPENAI_API_KEY

# 2. First-time build + start (one command)
./karakeep.sh up

# 3. Watch the build
./karakeep.sh logs
```

Open <http://localhost:3000> — the first account you register becomes admin.

> **Heads up:** the first build is heavy (~10–20 min on Apple Silicon) because
> it bundles the migration script and the Next.js app from source. Later runs
> hit the layer cache and finish in seconds.

---

## Day-to-day commands

```bash
./karakeep.sh start      # bring stack up (no rebuild)
./karakeep.sh stop       # pause services (data preserved)
./karakeep.sh logs       # tail logs from all services
./karakeep.sh logs web   # logs from just one service
./karakeep.sh status     # ps-style listing
./karakeep.sh rebuild    # force rebuild after code changes
./karakeep.sh down       # remove containers (volumes / data kept)
./karakeep.sh nuke       # WIPE EVERYTHING including DB + vectors
```

You can also pass anything through to `docker compose`:

```bash
./karakeep.sh exec web sh
./karakeep.sh restart workers
```

---

## What ports / volumes are exposed?

| Service       | Port  | Purpose                          |
|---------------|-------|----------------------------------|
| web           | 3000  | Next.js app + tRPC API           |
| meilisearch   | (internal) | vector + full-text search   |
| chrome        | (internal) | headless browser for crawler |

| Volume        | Stores                                 |
|---------------|----------------------------------------|
| `data`        | SQLite DB, crawled assets, backups     |
| `meilisearch` | search + vector indexes                |

Both are docker named volumes — they survive `down`, but `nuke` removes them.

---

## Required env (in `.env`)

The bare minimum to make the Assistant work:

```bash
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<openssl rand -hex 32>
MEILI_MASTER_KEY=<openssl rand -hex 32>
OPENAI_API_KEY=sk-...
```

The compose file sets `EMBEDDING_ENABLE_AUTO_INDEXING=true`,
`INFERENCE_ENABLE_AUTO_TAGGING=true`, and
`INFERENCE_ENABLE_AUTO_SUMMARIZATION=true` for you, so newly added bookmarks
automatically flow through the embedding + tagging + summarization pipeline.

See [`docker/.env.assistant.example`](.env.assistant.example) for the full
list of optional knobs (Ollama instead of OpenAI, disabling signups, custom
embedding model, etc).

---

## Validating the Assistant after first start

1. Register an account at <http://localhost:3000> — first user is admin.
2. Add a few bookmarks (any URL).
3. Tail logs: `./karakeep.sh logs workers` — you should see, in order:
   ```
   [crawler]    Crawled bookmark <id>
   [embeddings] Generated embedding for bookmark <id>
   [openai]     Tagged bookmark <id> with: [...]
   ```
4. Click **Assistant** in the sidebar and ask a question about a bookmark
   you just saved. The reply should cite it as `[1]` with a source badge
   beneath the message.

If the assistant answers *"I don't have personal context"* even though you
have bookmarks → the vector store is empty. Go to **Admin → Background Jobs
→ Regenerate all bookmark embeddings** to backfill.

---

## Build platform notes

The compose pins `platforms: linux/arm64` by default — building on Apple
Silicon natively takes ~15 min, while emulating amd64 via QEMU can take 60+
min and sometimes hangs at the `ncc` bundling step.

Override only if you're targeting Intel hardware:

```bash
# in .env
KARAKEEP_PLATFORM=linux/amd64
```

If Docker Desktop's memory allocation is < 6 GB the Next.js build can OOM
silently and look like it's stuck. Bump it in Docker Desktop → Settings →
Resources → Memory.

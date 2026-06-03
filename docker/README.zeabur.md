# Deploying Karakeep + Assistant on Zeabur

Click-through guide for getting the whole stack live on Zeabur with a
public HTTPS URL.

> **Why not docker-compose?** Zeabur's import doesn't reliably handle our
> multi-service build context. The reliable path is three separate services
> in the same Project, wired together via Zeabur's private DNS. The
> deploy itself is still ~10 minutes of clicking.

---

## Prerequisites

- A Zeabur account with billing enabled (free tier works for testing; the
  Karakeep build needs ~2 GB RAM during build, so plan accordingly).
- A GitHub fork of this repo with your changes pushed (Zeabur deploys from
  GitHub, not local files).
- Your OpenAI API key (or Ollama endpoint reachable from Zeabur).

---

## 1. Create the Project

In Zeabur dashboard → **New Project** → name it e.g. `karakeep`.

All three services below go into this single project so they can talk to
each other via `*.zeabur.internal`.

---

## 2. Deploy Meilisearch

**Add Service → Prebuilt** → search `meilisearch`.

Or: **Add Service → Marketplace** if Karakeep's template appears there.

Manual setup:
- **Image**: `getmeili/meilisearch:v1.41.0`
- **Port**: `7700` (TCP, private)
- **Volume**: mount `/meili_data`, size 2–5 GB
- **Environment**:
  ```
  MEILI_MASTER_KEY=<openssl rand -hex 32 — save it, you'll reuse it below>
  MEILI_NO_ANALYTICS=true
  MEILI_ENV=production
  ```
- Click **Deploy**. Wait for `Healthy`.

---

## 3. Deploy headless Chrome

**Add Service → Prebuilt**.

- **Image**: `gcr.io/zenika-hub/alpine-chrome:124`
- **Port**: `9222` (TCP, private)
- **Start command** (override):
  ```
  --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-address=0.0.0.0 --remote-debugging-port=9222 --hide-scrollbars
  ```
- No env vars, no volumes.
- **Deploy**.

---

## 4. Deploy Karakeep AIO (web + workers)

**Add Service → Git** → choose your fork.

- **Build**:
  - **Dockerfile path**: `docker/Dockerfile`
  - **Build context**: `.` (repo root)
  - **Target stage**: `aio`
- **Port**: `3000` (HTTP, public — Zeabur gives you a free `*.zeabur.app`
  domain automatically)
- **Volume**: mount `/data`, size 5–10 GB (SQLite DB + crawled assets +
  backups). Pick the same volume class you used for Meilisearch.
- **Environment** (copy-paste, fill the brackets):
  ```
  # Secrets
  NEXTAUTH_SECRET=<openssl rand -hex 32>
  MEILI_MASTER_KEY=<same value as Meilisearch service>
  OPENAI_API_KEY=sk-...

  # URLs
  NEXTAUTH_URL=https://<copy your *.zeabur.app domain here once issued>
  MEILI_ADDR=http://meilisearch.zeabur.internal:7700
  BROWSER_WEB_URL=http://chrome.zeabur.internal:9222

  # Wiring + Assistant defaults
  DATA_DIR=/data
  EMBEDDING_ENABLE_AUTO_INDEXING=true
  INFERENCE_ENABLE_AUTO_TAGGING=true
  INFERENCE_ENABLE_AUTO_SUMMARIZATION=true
  ```
- **Deploy** → first build takes 15–25 min. Watch logs.

> The internal hostname is the service **name** you chose in Zeabur. If you
> named Meilisearch `meili` instead of `meilisearch`, use
> `meili.zeabur.internal:7700`.

---

## 5. Finish wiring NEXTAUTH_URL

After Karakeep's first deploy:

1. Open the service → **Networking** → copy the issued domain
   (e.g. `karakeep-abc123.zeabur.app`).
2. Edit the `NEXTAUTH_URL` env to `https://<that-domain>`.
3. Redeploy (Zeabur does this automatically on env change).

Visit the URL → register the first account (admin) → start adding bookmarks.

---

## 6. Custom domain (optional)

In the Karakeep service → **Networking → Domains → Add Custom Domain**.

Zeabur issues a Let's Encrypt cert automatically. Update `NEXTAUTH_URL`
again to the custom domain after DNS resolves.

---

## Operational notes

### Resource sizing

| Service     | RAM     | CPU  | Notes                                     |
|-------------|---------|------|-------------------------------------------|
| karakeep    | 1–2 GB  | 1    | workers do crawling + embedding           |
| meilisearch | 512 MB+ | 0.5  | scales with vector index size             |
| chrome      | 512 MB  | 0.5  | one process, mostly idle                  |

The Next.js build itself needs ~2 GB peak; Zeabur builds usually have enough.

### Logs

- Karakeep streams **both** web and workers logs into the same container's
  stdout (s6-overlay does the multiplexing). Look for `[web]`, `[crawler]`,
  `[embeddings]`, `[openai]` prefixes.

### Backups

- Use Karakeep's built-in `BACKUPS_ENABLED=true` per-user setting to drop
  encrypted snapshots into `/data/backups`.
- Zeabur volumes can be backed up via their volume snapshot feature.

### Updating Karakeep

1. Push to your fork's main branch (or whichever you configured).
2. Zeabur auto-deploys on push (configurable in service Settings).
3. Migrations run on container start via s6-overlay's
   `init-db-migration` service.

---

## Troubleshooting

### Web container restarts in a loop right after deploy

Usually env issue. Check Karakeep service logs for:

- `[next-auth][warn][NO_SECRET]` → `NEXTAUTH_SECRET` not set
- `SqliteError: no such table` → volume not mounted at `/data` or migration
  never ran (check the init-db-migration log lines)
- `Got no message content from OpenAI` → `OPENAI_API_KEY` invalid or rate
  limited

### Assistant always says "no personal context"

The Meilisearch vector index is empty. Either:

1. Your first bookmarks were added before `EMBEDDING_ENABLE_AUTO_INDEXING`
   was set → log in as admin → **Admin → Background Jobs → Regenerate all
   bookmark embeddings**.
2. Karakeep can't reach Meilisearch — verify `MEILI_ADDR` uses the
   `*.zeabur.internal:7700` hostname (not `localhost`).

### Build runs out of memory

Bump the build instance size in Zeabur service Settings → Build Resources.
Next.js + Karakeep typically need ≥ 2 GB during build.

### Crawler fails on every URL

Check Chrome service is in `Healthy` state and `BROWSER_WEB_URL` points at
its internal address. Restart the chrome service if it's been up >1 week
(headless Chrome leaks memory over time).

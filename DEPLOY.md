# Deploy / Migration runbook

This is the one-time runbook for migrating from the old Fly.io deploy to Cloudflare Pages without losing user data, and the steady-state instructions for ongoing deploys.

## Architecture (post-migration)

```
   ┌──────────────────────────────────────────────────────┐
   │ Browser                                              │
   │   React SPA (Cloudflare Pages, static)               │
   │   ├─ OAuth tokens in localStorage                    │
   │   ├─ Project metadata cached in IndexedDB            │
   │   └─ Direct API calls to Drive / GitHub Gists        │
   └──────────────────────────────────────────────────────┘
              │                       │
              ▼                       ▼
   ┌─────────────────────┐   ┌─────────────────────────────┐
   │ Pages Functions     │   │ Google Drive  /  GitHub API │
   │  (CF, holds OAuth   │   │ (user's own account)        │
   │   client secrets)   │   │                             │
   └─────────────────────┘   └─────────────────────────────┘
```

No Sinter-managed database. Project content lives in each user's own Drive or Gists. The metadata that *used* to live in Fly's SQLite (project names, thumbnails, share tokens) is migrated into the user's Drive/Gist files (in the file body / metadata fields) by the one-time script below.

## Migration runbook (one-time)

### 1. Create OAuth apps (or update existing ones)

Both providers need the new callback URL: `https://YOUR_DOMAIN/auth/callback`.

- **Google Cloud Console** → APIs & Services → Credentials → your OAuth 2.0 Client → add Authorized redirect URI: `https://YOUR_DOMAIN/auth/callback`. Keep the old `/api/auth/google/callback` until cutover, then remove it.
- **GitHub** → Settings → Developer settings → OAuth Apps → your app → set Authorization callback URL to `https://YOUR_DOMAIN/auth/callback`.

### 2. Run the data migration

The script reads the live SQLite, fetches each project's file from Drive/Gist, and rewrites the file content to embed the metadata (name, thumbnail, share state). It also produces `public/legacy-shares.json` so old `/share/<token>` URLs keep working.

You'll need:
- A copy of the SQLite DB from Fly (`/data/modeler.db`)
- The OAuth client secrets the old server was using (so token refresh works)

```bash
# Pull the DB from Fly to your laptop
fly ssh sftp shell -a sinter-3d
> get /data/modeler.db ./data/modeler.db
> exit

# Set env (matches the old Fly secrets)
cp .env.example .env
# Fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (others not needed for the migration itself)

# Run it
npm install
npm run migrate
```

The script:
- Logs `ok` / `skipped` / `FAILED` per project
- Skips projects already in the new envelope (safe to re-run)
- Writes `public/legacy-shares.json` mapping every old share token to `{ provider, id }`

If individual projects fail (usually because a user revoked their OAuth grant), they're logged and the rest continue. Those users' files still exist in their own Drive/Gist — they just won't have the embedded metadata until they save the project once in the new app.

Commit the generated file:

```bash
git add public/legacy-shares.json
git commit -m "Add legacy-shares.json from data migration"
```

### 3. Set up Cloudflare Pages

- Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repo.
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Root directory**: leave empty
- **Environment variables** (Production):
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GITHUB_CLIENT_ID`
  - `GITHUB_CLIENT_SECRET`
  - `VITE_GOOGLE_CLIENT_ID` (same as `GOOGLE_CLIENT_ID`)
  - `VITE_GITHUB_CLIENT_ID` (same as `GITHUB_CLIENT_ID`)

### 4. Set GitHub Actions secrets (for CI deploys)

In the repo settings → Secrets and variables → Actions:

- `CLOUDFLARE_API_TOKEN` — create at dash.cloudflare.com/profile/api-tokens with the "Cloudflare Pages — Edit" template
- `CLOUDFLARE_ACCOUNT_ID` — bottom of any zone overview page
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_GITHUB_CLIENT_ID`

### 5. Cutover

1. Confirm the staging Pages URL works (sign in, save a project, share).
2. Point your custom domain at Cloudflare Pages (in the Pages project → Custom domains).
3. In each OAuth app, **remove** the old `/api/auth/{provider}/callback` redirect URI.
4. Decommission Fly: `fly apps destroy sinter-3d` (after taking one final DB backup).
5. Delete the old server scaffolding from the repo (a follow-up commit):
   - `server/db.ts`, `server/storageProviders/`, `server/migrate-to-static.ts`
   - `better-sqlite3`, `dotenv`, `tsx`, `@types/better-sqlite3` from `package.json` devDependencies
   - The `migrate` script from `package.json`

## Steady-state: deploying changes

**Merging to `main` no longer publishes to production.** It runs CI and nothing else. Publishing is a separate, deliberate act:

```bash
# Option 1 — tag a release (leaves a record of what shipped)
git tag v1.4.0 && git push origin v1.4.0

# Option 2 — publish the current main by hand
gh workflow run deploy.yml --ref main
```

Either way `deploy.yml` first runs a `guard` job that looks up the **completed** CI run for that exact commit and refuses to deploy unless it concluded `success`. If CI is still running, the guard fails; wait and re-run.

This replaced a push-to-`main` trigger, which had two problems worth remembering if anyone is tempted to put it back:

- There was no gate at all between merging a PR and being live.
- `deploy.yml` and `ci.yml` both fired on the same push and ran **concurrently**, so a deploy could publish a commit before its own tests finished — and since the build is faster than the e2e suite, it usually did. A red `main` could reach users.

Pages Functions in `functions/` deploy automatically alongside the static assets, as before.

### Rolling back

Deploy an earlier commit the same way — `gh workflow run deploy.yml --ref <sha-or-tag>`. The guard requires that commit to have its own green CI, which any previously-shipped commit will have.

For local dev:

```bash
npm install
npm run dev          # Vite dev server, no OAuth (sign-in won't work)

# OR, with Pages Functions for OAuth:
npm run build
npx wrangler pages dev dist
```

For the Functions to work in dev, also add `.dev.vars` (gitignored) at repo root with the same secrets the Pages env has.

## Data preservation: what survives the migration

| Data                                | Where it was      | Where it goes                              |
| ----------------------------------- | ----------------- | ------------------------------------------ |
| Project content (SDF tree)          | User's Drive/Gist | Same place (untouched)                     |
| Project name                        | Fly SQLite        | Drive file `name` / Gist `description`     |
| Thumbnail                           | Fly SQLite        | Project file body, cached in IndexedDB     |
| Old `/share/<token>` URLs           | Fly SQLite        | `public/legacy-shares.json` → SPA redirect |
| User accounts / OAuth refresh state | Fly SQLite        | Discarded (users sign in fresh)            |

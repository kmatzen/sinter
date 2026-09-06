# Deployment runbook

## Architecture

Sinter is a React single-page app hosted on Cloudflare Pages. The browser stores
OAuth tokens and AI-provider settings in local storage, caches project backups
and thumbnails in browser storage, and calls Google Drive, GitHub Gists, and AI
providers directly. Cloudflare Pages Functions exchange OAuth authorization
codes because those exchanges require provider client secrets.

Sinter has no runtime application server or Sinter-managed database. Project
documents and their metadata live in each user's selected storage provider.

## Deploying changes

Merging to `main` runs CI but does not publish to production. Publishing is a
separate, deliberate action:

```bash
# Preferred: leave an immutable record of what shipped.
git tag v1.4.0
git push origin v1.4.0

# Alternatively, publish a selected ref manually.
gh workflow run deploy.yml --ref main
```

The deploy workflow first finds the completed CI run for the exact commit and
refuses to publish unless that run succeeded. A tag or manual selection is not
itself evidence that the commit passed CI.

Required GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`, scoped to edit the Sinter Pages project
- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_GITHUB_CLIENT_ID`

Required Cloudflare Pages environment variables:

- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
- `VITE_GOOGLE_CLIENT_ID` and `VITE_GITHUB_CLIENT_ID`

Pages Functions in `functions/` deploy with the static assets.

## Rolling back

Run the deploy workflow against a previously shipped tag or commit:

```bash
gh workflow run deploy.yml --ref <sha-or-tag>
```

The target must have a successful CI run. After rollback, verify the custom
domain, OAuth callback, project open/save, and sharing paths.

## Local development

```bash
npm install
npm run dev
```

The Vite server does not emulate Pages Functions. To exercise OAuth locally:

```bash
npm run build
npx wrangler pages dev dist
```

Put the four provider client values in a gitignored `.dev.vars` file.

## Historical Fly/SQLite migration

The one-time migration from Fly.io and SQLite was completed before the current
Cloudflare architecture. Its script and retired provider adapters were removed
from active development dependencies in issue #161. They remain recoverable in
Git history at commit `4eae0ea` (`migrate to cloudflare pages (#45)`). The
migration's legacy share mapping remains deployed as `public/legacy-shares.json`.

Do not rerun the historical migration against production data. If forensic
recovery is ever required, create an isolated checkout of that commit and work
from a backup—not from the current application checkout.

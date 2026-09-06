# Sinter

AI-powered 3D modeling for 3D printing, built with signed distance fields.

![License: Non-Commercial](https://img.shields.io/badge/License-Non--Commercial-blue)

## What is Sinter?

Sinter is a web-based parametric 3D modeler that uses **signed distance fields (SDF)** instead of traditional BREP geometry. This means:

- **Smooth booleans** — union, subtract, intersect with adjustable fillet radius. No topology failures.
- **Shell/hollow** — one click to make any solid hollow with uniform wall thickness.
- **AI-powered** — describe what you want in natural language, the AI builds the model. Viewport renders are sent for visual context.
- **Real-time preview** — GPU ray marching renders every parameter change instantly.
- **3D print ready** — export watertight STL/3MF at your choice of resolution, dimension overlays for verification.

## Quick Start

```bash
git clone https://github.com/kmatzen/sinter.git
cd sinter
npm install
npm run dev
```

Open `http://localhost:5173` and click "Start Modeling" to launch the app.

To use AI chat, open **Settings** (the gear in the toolbar, top right), pick a provider, then either **Connect OpenRouter** — a one-click sign-in, no API key to create — or paste an Anthropic or OpenAI key directly. Credentials are stored only in your browser.

No Sinter account is needed for any of that: OpenRouter bills your own OpenRouter credits, and Sinter never proxies your requests.

## Features

### Modeling
- **Primitives**: Box, Sphere, Cylinder, Torus, Cone, Capsule, Ellipsoid
- **Booleans**: Union, Subtract, Intersect (with smooth/fillet parameter)
- **Modifiers**: Shell, Offset, Round, Mirror, Half-Space Cut (with flip)
- **Patterns**: Linear Pattern, Circular Pattern
- **Transforms**: Translate, Rotate, Scale
- **Presets**: Pre-built parts (enclosures, standoffs, brackets, vents, clips). Every preset states a guaranteed outer envelope that a test checks against the geometry itself, so the size on the card is the size you get.
- **STL import**: Bring outside geometry in as an editable node — subtract it, intersect it, pattern it. Stored as a signed-distance field, so detail finer than the field's grid is rounded off; the resolution is adjustable per node.
- **Drag & drop**: Click or drag parts from the palette into the node tree

### Viewport
- GPU ray marching with screen-space outline post-process
- **Tap-to-select** — click/tap on a surface to select the contributing node
- **Hover preview** — the node under the pointer is outlined and named before you click, so selection is not a guess
- **Selection breadcrumb** — shows where the selected node sits in the tree (`Subtract › Move › Cylinder`); click any crumb to select that ancestor
- **Alt+Click** — select the operation *above* the shape you clicked, since picking always lands on a leaf
- Hovering a row in the node tree highlights its geometry, and vice versa
- Clipping plane (+X/-X/+Y/-Y/+Z/-Z) with cross-section fill
- Per-node dimension labels with wireframe bounding box
- Transform gizmo with snap-to-grid (1/5/10mm)
- Screenshot export (gizmo auto-hidden)

### AI Chat
- Describe models in natural language
- **Streaming responses** — text appears token-by-token as the model generates
- Iterative refinement ("make it bigger", "add ventilation holes")
- Multi-view renders sent automatically (current view + front/right/top with rulers)
- **OpenRouter sign-on** — connect once and pick from hundreds of models across providers. OpenRouter bills your own account; Sinter never proxies your requests and never holds your payment details.
- **Model picker** — browse the provider's live catalog with pricing and context length. Defaults to vision-capable models only, since Sinter sends viewport renders with every message.
- Also supports Anthropic Claude and OpenAI GPT directly (bring your own API key)

### Storage
- **Google Drive** — sign in with Google to save/load projects
- **GitHub Gists** — sign in with GitHub to save/load projects
- Read-only share links for published projects

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Click | Select the shape under the pointer |
| Alt+Click | Select the operation above that shape |
| W | Move tool |
| E | Rotate tool |
| R | Scale tool |
| Escape | Deselect gizmo |
| Ctrl+C | Copy node |
| Ctrl+V | Paste node |
| Ctrl+D | Duplicate node |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Delete | Remove selected |
| Shift (hold) | Disable snap |
| ? | Show all shortcuts |

## Self-Hosting

Sinter is a static site that deploys to [Cloudflare Pages](https://pages.cloudflare.com). The only server-side code is two small Pages Functions that hold the OAuth client secrets and exchange `code` for tokens. Everything else (project storage, sharing) is browser → provider direct.

See [DEPLOY.md](./DEPLOY.md) for the current architecture, deployment, and rollback runbook.

Quick version:
1. Create OAuth apps (callback URL: `https://YOUR_DOMAIN/auth/callback`):
   - **Google**: [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) — scope `drive.file`
   - **GitHub**: [github.com/settings/applications/new](https://github.com/settings/applications/new) — scope `gist`
2. Set GitHub Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_GOOGLE_CLIENT_ID`, `VITE_GITHUB_CLIENT_ID`.
3. Set Cloudflare Pages environment variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
4. Push to `main`.

Without OAuth configured, the app still works fully for local modeling and AI chat — cloud save/load just won't be available.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **3D Viewport**: Three.js (pure, no R3F)
- **Geometry**: Custom SDF engine with GPU ray marching and marching cubes export
- **Hosting**: Cloudflare Pages (static) + Pages Functions (OAuth token exchange)
- **Storage**: User's own Google Drive or GitHub Gists, accessed directly from the browser
- **State**: Zustand
- **Font**: Outfit + JetBrains Mono
- **Tests**: Vitest (unit) + Playwright (E2E)

## Development

```bash
npm run typecheck     # tsc --noEmit
npm test              # unit tests
npm run test:e2e      # Playwright, including CPU/GPU parity and golden images
npm run bench         # export pipeline timings, per stage
npm run test:live     # asks a real model for real geometry (needs a credential)
```

`test:live` is the only test that spends money, so it is skipped unless you opt
in with a credential:

```bash
SINTER_LIVE_API_KEY=sk-... npm run test:live
# SINTER_LIVE_PROVIDER  anthropic | openai | openrouter   (default: openrouter)
# SINTER_LIVE_MODEL     overrides the provider's default model
```

It also runs weekly in CI (`live-llm.yml`), because what breaks this path is a
provider changing its wire format or a model drifting out of the response format
the system prompt asks for — neither of which any commit of ours triggers.

A few of these are load-bearing rather than routine, and are worth knowing about
before changing the geometry code:

- **`e2e/sdf-parity.spec.ts`** renders the emitted GLSL to a float texture and
  diffs it against the TypeScript evaluator. The viewport and the exporter are
  two implementations of one field; drift between them is invisible until a
  print comes out wrong.
- **`e2e/viewport-golden.spec.ts`** compares the viewport against committed
  reference images, rendered through SwiftShader on every machine so they are
  not hostage to the local GPU. Shader changes are expected to alter these —
  regenerate with `--update-snapshots`, and look at the diff.
- **`npm run bench`** reports the minimum of `--repeat=N` runs rather than the
  mean, because noise only ever adds time. It also runs in CI, non-gating, with
  the numbers in the job summary.
- **`specs/`** holds TLA+ models of the worker bridge, token refresh and undo
  history. `specs/check.sh` runs them.

## License

Non-commercial license. See [LICENSE](./LICENSE) for details.

Copyright (c) 2026 Kevin Blackburn-Matzen.

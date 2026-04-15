# Sinter

AI-powered 3D modeling for 3D printing, built with signed distance fields.

![License: Non-Commercial](https://img.shields.io/badge/License-Non--Commercial-blue)

## What is Sinter?

Sinter is a web-based parametric 3D modeler that uses **signed distance fields (SDF)** instead of traditional BREP geometry. This means:

- **Smooth booleans** — union, subtract, intersect with adjustable fillet radius. No topology failures.
- **Shell/hollow** — one click to make any solid hollow with uniform wall thickness.
- **AI-powered** — describe what you want in natural language, the AI builds the model. Viewport renders are sent for visual context.
- **Real-time preview** — GPU ray marching renders every parameter change instantly.
- **3D print ready** — export watertight STL/3MF, dimension overlays for verification.

## Quick Start

```bash
git clone https://github.com/kmatzen/sinter.git
cd sinter
npm install
npm run dev
```

Open `http://localhost:5173` and click "Start Modeling" to launch the app.

For AI chat (community edition), click the gear icon in the chat panel and enter your Anthropic or OpenAI API key.

## Features

### Modeling
- **Primitives**: Box, Sphere, Cylinder, Torus, Cone, Capsule
- **Booleans**: Union, Subtract, Intersect (with smooth/fillet parameter)
- **Modifiers**: Shell, Offset, Round, Mirror, Half-Space Cut (with flip)
- **Patterns**: Linear Pattern, Circular Pattern
- **Transforms**: Translate, Rotate, Scale
- **Presets**: Pre-built parts (enclosures, standoffs, brackets, gears, etc.)
- **Drag & drop**: Click or drag parts from the palette into the node tree

### Viewport
- GPU ray marching with screen-space outline post-process
- Clipping plane (+X/-X/+Y/-Y/+Z/-Z) with cross-section fill
- X-ray mode
- Per-node dimension labels with wireframe bounding box
- Transform gizmo with snap-to-grid (1/5/10mm)
- Screenshot export (gizmo auto-hidden)

### AI Chat
- Describe models in natural language
- Iterative refinement ("make it bigger", "add ventilation holes")
- Multi-view renders sent automatically (current view + front/right/top)
- Supports Anthropic Claude and OpenAI GPT

### Collaboration
- Read-only share links for published projects
- Cloud storage with auto-save (paid edition)

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
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

## Editions

### Community (Free)
- Full modeling engine, all primitives and operations
- Bring your own API key (Anthropic or OpenAI)
- Local save/load (localStorage auto-save)
- STL/3MF export
- Non-commercial use only

### Pro (Hosted)
- No API key needed (included)
- Cloud project storage with auto-save
- Read-only share links
- Credit-based pricing (1 credit = ~$0.05, AI chat costs 1–15 credits per message)
- Credits expire 30 days after purchase
- Credit purchases help Kevin Blackburn-Matzen cover Anthropic API and hosting costs
- Available at [sinter-3d.com](https://sinter-3d.com)

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **3D Viewport**: Three.js (pure, no R3F)
- **Geometry**: Custom SDF engine with GPU ray marching and marching cubes export
- **Server** (paid): Express.js, SQLite (better-sqlite3), Passport.js, Lemon Squeezy
- **State**: Zustand
- **Font**: Outfit + JetBrains Mono
- **Tests**: Vitest (unit) + Playwright (E2E)

## License

Non-commercial license. See [LICENSE](./LICENSE) for details.

Copyright (c) 2026 Kevin Blackburn-Matzen.

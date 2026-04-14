# Sinter

AI-powered 3D modeling for 3D printing, built with signed distance fields.

![License: Non-Commercial](https://img.shields.io/badge/License-Non--Commercial-blue)

## What is Sinter?

Sinter is a web-based parametric 3D modeler that uses **signed distance fields (SDF)** instead of traditional BREP geometry. This means:

- **Smooth booleans** — union, subtract, intersect with adjustable fillet radius. No topology failures.
- **Shell/hollow** — one click to make any solid hollow with uniform wall thickness.
- **AI-powered** — describe what you want in natural language, the AI builds the model.
- **Real-time preview** — edit parameters and see changes instantly with adaptive resolution.
- **3D print ready** — STL/3MF export, wall thickness analysis, dimension overlays.

## Quick Start

```bash
git clone https://github.com/kmatzen/sinter.git
cd sinter
npm install
npm run dev
```

Open `http://localhost:5173`. Click "Start Modeling — Free" to launch the app.

For AI chat, click the gear icon in the chat panel and enter your Anthropic or OpenAI API key.

## Features

### Modeling
- **Primitives**: Box, Sphere, Cylinder, Torus, Text
- **Booleans**: Union, Subtract, Intersect (with smooth/fillet parameter)
- **Modifiers**: Shell, Offset, Round, Mirror
- **Patterns**: Linear Pattern, Circular Pattern
- **Transforms**: Translate, Rotate, Scale
- **Component Library**: Pre-built presets (enclosure, screw standoff, PCB tray, etc.)

### Viewport
- Cel-shaded rendering with ink outlines
- Clipping plane with stencil-based cross-section fill
- X-ray mode
- Dimension overlays
- Canonical camera views (Front/Back/Left/Right/Top/Bottom)
- Transform gizmo with snap-to-grid (1/5/10mm)
- Measurement tool
- Screenshot export

### AI Chat
- Describe models in natural language
- Iterative refinement ("make it bigger", "add ventilation holes")
- Supports Anthropic Claude and OpenAI GPT

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| W | Move tool |
| E | Rotate tool |
| R | Scale tool |
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
- Full modeling engine, all features
- Bring your own API key (Anthropic or OpenAI)
- Local save/load (JSON files)
- Non-commercial use only

### Pro (Hosted)
- No API key needed (included)
- Cloud project storage with auto-save
- Project sharing links
- Usage-based pricing: $0.01/AI request, 50 free/month
- Available at [sinter-3d.com](https://sinter-3d.com)

## Self-Hosting (Paid Edition)

```bash
cp .env.example .env
# Edit .env with your API keys
docker-compose up -d
```

Requires: Anthropic API key, Google/GitHub OAuth apps, Stripe account (for billing).

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **3D Viewport**: Three.js via react-three-fiber
- **Geometry**: Custom SDF engine with marching cubes mesh extraction
- **Server** (paid): Express.js, SQLite, Passport.js, Stripe
- **State**: Zustand

## License

Non-commercial license. See [LICENSE](./LICENSE) for details.

For commercial licensing, visit [sinter-3d.com](https://sinter-3d.com) or open an issue on GitHub.

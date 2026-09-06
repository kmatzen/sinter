# Changelog

## 0.2.0 — Unreleased

### Added

- Application-level Cmd/Ctrl+S cloud saving.
- Keyboard-operable node tree, modal focus management, live status announcements, reduced-motion support, and reachable shortcut/accessibility help.
- Mobile copy/paste, export-resolution controls, touch-oriented tablet layout, and a landscape property dock.
- Firefox and WebKit release smoke gates plus an actionable WebGL 2 fallback.
- Visible release/commit identity and custom-domain deployment verification.

### Fixed

- Continuous gizmo/property edits now commit as one undo step on release.
- Stale evaluations and exports can no longer masquerade as current geometry.
- Cloud conflicts, partial saves, project moves, failed saves, and recovery boundaries preserve retryable user work.
- Project documents, parameters, mesh payloads, and text glyph outlines are validated before reaching evaluators.
- SDF bounds, physical modifier dimensions, mesh cache identity, STL validation, boolean operand roles, simplification, and export metadata correctness.
- Production security headers, dependency advisories, license metadata, and provider/share semantics.

### Known issues

- Manual VoiceOver/Safari and NVDA/Firefox accessibility records are pending.
- A physical iOS Safari release-cadence record is pending; automated WebKit coverage is not a substitute.

# Mobile usability assessment

> **Status.** This is the original assessment, kept as written so the
> before-state and the measurements behind it stay on the record. The findings
> were filed as #126–#137; everything below except the two follow-ups noted in
> §10 has since been fixed. `e2e/mobile.spec.ts` is what keeps them fixed —
> in particular the sweep asserting that no interactive element on a
> coarse-pointer viewport is under 44px.


Method: the app was driven through Chromium device emulation (real touch flags, device
pixel ratios, device viewports) on **iPhone 13 (393×664 CSS px)**, **Pixel 5**,
**iPhone SE (320px)**, **iPhone 13 landscape (750×342)** and **iPad Mini portrait (768×1024)**.
Every visible interactive element was measured in the live DOM — the pixel sizes below are
measured, not estimated. Screenshots of each state are in `screens/`.

The verdict up front: the editor is **responsive but not touch-designed**. The layout
reflows correctly — no horizontal overflow at any width tested, and the mobile drawer/sheet
scaffolding exists — but the controls inside it are still desktop controls at desktop
density. Nothing in the editor chrome meets the 44×44 pt minimum, the primary editing
control is 18 px tall, the main composition gesture (reparenting nodes) is implemented with
an API that does not fire on touch, and a first-run mobile user is shown a blank screen.

---

## 1. Touch target sizes — the dominant problem

Apple HIG asks for 44×44 pt; Material for 48×48 dp. Measured on iPhone 13 at 393 px:

| Control | Measured | Source |
| --- | --- | --- |
| **NumberInput row** (width/height/radius/…) | **296 × 18** | `src/components/properties/NumberInput.tsx:114` (`h-7`, inner input `py-0`) |
| Settings modal close ✕ | 10.7 × 20 | `src/components/settings/SettingsPage.tsx:18` |
| Tree expand/collapse chevron | 16 × 16 | `src/components/tree/TreeNode.tsx:136` (`w-4 h-4`) |
| Mobile panel close ✕ | 16 × 16 | `src/components/mobile/MobilePanel.tsx:27` |
| Tree row actions (duplicate / disable / delete) | 20 × 20 | `src/components/tree/TreeNode.tsx:186,195,205` (`w-5 h-5`) |
| Palette tab bar (Shapes / Ops / Presets) | 101 × 23 | `src/components/tree/PartsPalette.tsx:207` |
| Toolbar buttons — **tree, properties, chat, more** | 32 × 24 | `src/components/toolbar/Toolbar.tsx:373` (`px-2 py-1`) |
| Kind switcher segments (Box/Sphere/Cylinder/…) | 53 × 24.5 | `src/components/properties/PropertyPanel.tsx:45` |
| Viewport tools (move/rotate/scale/snap/dims/clip/screenshot) | 28 × 28 | `src/components/viewport/ViewportToolbar.tsx:7` (`w-7 h-7`) |
| Tree node row (the tap target for selection) | full-width × 26 | `src/components/tree/TreeNode.tsx:97` |
| Overflow menu items | 190 × 34 | `src/components/toolbar/Toolbar.tsx:389` |
| Palette shape tiles | 56 × 48 ✅ | `src/components/tree/PartsPalette.tsx:50` |

The palette tiles are the **only** editor controls that pass. The four toolbar buttons that
are a phone user's entire navigation — tree, properties, chat, overflow — are 32×24, about
a third of the recommended area.

The worst offender is the one people touch most. Editing a dimension means hitting an 18 px
tall row, and the row is 296 px wide with a 72 px label on the left and a right-aligned
value, so most of that width is dead space that looks tappable but focuses the input at the
far end.

## 2. Text is set at desktop-inspection sizes

Measured runs of text below 12 px on a phone screen: **9 px ×7 and 10 px ×5** in the tree
panel alone; 10–11 px throughout the property sheet; 10 px section labels; 9 px preset
sizes and descriptions. `text-[9px]`/`text-[10px]`/`text-[11px]` are used pervasively.
These are sizes chosen for a 27" monitor at arm's length.

## 3. Every text input triggers iOS zoom, and numeric fields get a QWERTY keyboard

iOS Safari zooms the page on focus for any input under 16 px, and does not zoom back out.
Measured font sizes:

- Project name — 14 px (`Toolbar.tsx:146`)
- Chat input — 14 px (`ChatDrawer.tsx:91`)
- **All NumberInputs — 12 px** (`NumberInput.tsx:174`)
- Settings: provider select, API key, model, endpoint — 14 px

Separately, `NumberInput` is `type="text"` with **no `inputMode`** (measured
`inputMode: "none"`). The `text` type is deliberate — it supports expressions like `10*2+5`
— but it means every dimension edit on a phone opens a full alphabetic keyboard.
`inputMode="decimal"` keeps expression entry working while getting a numeric keypad, and
`enterKeyHint="done"` would label the return key.

## 4. Gestures that do not exist on touch

**Reparenting nodes is impossible on a phone.** The tree uses HTML5 drag-and-drop
(`draggable` + `dragstart`/`dragover`/`drop`, `TreeNode.tsx:107-137`; 8 draggable elements
measured live). HTML5 DnD is not generated from touch input on iOS or Android. Tapping a
palette item still adds under the current selection, so composition is not fully blocked —
but restructuring an existing tree, the core operation in a CSG modeler, has no touch path
at all. This needs either pointer-event-based dragging or a non-drag alternative
("move into…" on the node).

**Drag-to-scrub on parameter labels is broken on touch.** `NumberInput.tsx:132-157` starts
a scrub on `pointerdown`, but the element's computed `touch-action` is **`auto`** (measured),
so the browser claims the vertical gesture for scrolling before the handler can act. It
needs `touch-action: none` — and on a 33 %-height sheet, a horizontal scrub inside a
vertically scrolling container is a fragile interaction to begin with.

**The slider is a 12 px invisible strip.** `NumberInput.tsx:194-204` overlays an
`opacity: 0` range input 12 px tall on a 3 px track, offset −4 px. It only exists for
params with both `min` and `max`.

**Keyboard-only operations with no mobile equivalent:** copy (`Ctrl+C`) and paste
(`Ctrl+V`) have no button anywhere (`ModelerApp.tsx:54-55`). Shift-to-disable-snap during a
gizmo drag has no touch equivalent. `ShortcutOverlay` — the only in-app help — is a
keyboard-shortcut list toggled by pressing `?`, so on mobile it is both unreachable and
useless.

**Hover-revealed affordances.** Tree row actions are `opacity: 0` until
`div:hover > .group-hover-actions` (`src/index.css:95-96`). They do become visible when the
row is selected, so they are reachable — but the discovery path is a hover state that does
not exist.

## 5. The 3D viewport

Camera control is the one thing that works well: `canvas { touch-action: none }`
(`src/index.css:99`) plus OrbitControls gives one-finger orbit and two-finger pan/zoom.

Two problems:

- **Tap-to-select rejects real finger taps.** `ThreeEngine.ts:216-219` discards any pointer
  that moved more than 4 px (`dx*dx + dy*dy > 16`). Mouse clicks do not move; finger taps
  routinely travel 5–10 px. Selection taps are silently swallowed with no feedback. The
  threshold should be pointer-type aware — roughly 10 px for touch.
- **The gizmo is sized for a mouse.** `GizmoController.ts:112` calls `setSize(1.2)`, fixed.
  The axis handles are thin lines; picking the right one with a fingertip on a 393 px screen
  is a precision task. Touch should get a larger size and fatter picker geometry.

## 6. Layout and information architecture

**The mobile empty state is a blank screen** (`screens/iphone13-02-modeler-empty.png`). The
"No model yet — add a shape from the palette below, or use AI Chat" copy lives inside
`NodeTreeContent`, which on mobile is hidden behind a 32×24 icon. A first-time phone visitor
gets a black void and four unlabeled icons. This is the single highest-leverage fix in the
list.

**Duplicate "NODE TREE" header** (`screens/iphone13-03-tree-panel.png`). `MobilePanel`
renders its own `title` bar and `NodeTreeContent` renders another one directly beneath it.
Visible, and it costs ~50 px of a small screen.

**The bottom sheet is under-committed.** It opens at the 33 % snap = 219 px of 664 px
(measured), which shows the type switcher and two-and-a-half fields — see
`screens/p-04-props-real-node.png`. There is **no close button**; dismissal is swipe-down or
backdrop-tap only, with no visible affordance beyond a grip dots glyph. Snap points are
computed once from `window.innerHeight` at mount (`BottomSheet.tsx:38-39`) and never
recomputed, so they are wrong after a rotation or a URL-bar resize.

**The chat drawer has no way out and is 4 px misaligned.** Measured: drawer top = 40 px
(`top-10`, `ChatDrawer.tsx:29`), toolbar height = 44 px (`h-11`) — the drawer overlaps the
bottom 4 px of the toolbar. On mobile it is full-screen and has **no close button**
(measured); the only exit is the chat toggle it partially covers. Its input is pinned
`bottom-0` inside a `height: 100%` layout with no `visualViewport` handling, so the iOS
keyboard will cover it.

**`MobilePanel` ignores Escape** while `BottomSheet` handles it (`BottomSheet.tsx:123-127`)
— inconsistent, and it is why the panel could not be dismissed by keyboard during testing.
The panel is `85vw / max 320px`, so on a 393 px phone the "tap outside to close" target is
a 73 px strip.

**Bottom-anchored viewport controls collide.** The clip tool (bottom-left) and screenshot
(bottom-right) sit exactly where the bottom sheet rises and where the home indicator lives.

**Export resolution is desktop-only.** The Draft/Standard/Fine selector is inside
`hidden md:contents` (`Toolbar.tsx:187-205`). The code's own comment calls it "the single
biggest lever over a 20s export" — and it is precisely the mobile user, on the slowest
hardware, who cannot reach it. Mobile export runs at whatever value is stored.

**Silent share copy.** Desktop shows a "Copied!" state; the mobile overflow item writes to
the clipboard with no confirmation (`Toolbar.tsx:247-250`).

## 7. Breakpoints

There is exactly one breakpoint — `md:` / 768 px — mirrored in JS by
`isMobile() { return window.innerWidth < 768 }` (`ModelerApp.tsx:25-27`), which is read at
event time and has no resize listener, so open panels are not reconciled on rotation.

- **iPad Mini portrait (768 px) gets the full desktop layout** — `screens/ipad-modeler.png`.
  A 280 px tree plus a 288 px property sidebar leave the 3D viewport a ~200 px column. The
  project name clips to "Untitle", and the "Sign In" button wraps to two lines and overflows
  the 44 px toolbar. It is also a touch device being handed hover-revealed actions and 26 px
  rows. The desktop layout needs a wider floor (~1024 px) or collapsible sidebars.
- **Phone landscape (750×342) stays on the mobile layout** — `screens/land-modeler.png` —
  so all the desktop toolbar affordances stay hidden despite 750 px of available width,
  while the 44 px toolbar eats 13 % of the height and the sheet snaps (33/55/85 % → 113/188/291 px)
  leave almost nothing. Landscape phones want a different arrangement, not the portrait one.

## 8. Mobile platform integration — entirely absent

Verified by scanning the live stylesheets:

- **No `env(safe-area-inset-*)` anywhere**, and no `viewport-fit=cover` in the viewport meta
  (`index.html:5`). On notched iPhones the bottom sheet content and the bottom-row viewport
  buttons sit under the home indicator.
- **No `dvh`/`svh`/`lvh` units.** Layout is `height: 100%` (`src/index.css:37`), so the iOS
  URL-bar collapse resizes the canvas and can push the bottom row under browser chrome.
- **No `overscroll-behavior`** — pull-to-refresh can fire while dragging inside a panel.
- **No `-webkit-tap-highlight-color`** — a grey flash on every tap.
- **No `-webkit-text-size-adjust`** guard.
- **No `user-select: none`** on chrome — long-press text selection during drags.
- No `manifest.json` (an `apple-touch-icon` and `theme-color` are present).

## 9. Test coverage

**There is no mobile e2e coverage at all.** No Playwright project, spec, or `devices[…]`
context uses a mobile viewport; the whole suite runs desktop-sized Chromium. Every
regression described here would pass CI today.

---

## Prioritized recommendations

**P0 — the app is hard to use without these**

1. Give mobile a real empty state in the viewport (not inside a hidden drawer).
2. Raise interactive controls to ≥44 px on coarse pointers. The highest-value four:
   `NumberInput` rows (18 → 44), the toolbar's four mobile buttons (32×24 → 44×44),
   `ViewportToolbar` buttons (28 → 44), tree rows and their action buttons (26/20 → 44).
   A `@media (pointer: coarse)` layer can do most of this without touching desktop density.
3. Set input font-size to 16 px on coarse pointers to stop iOS zoom; add
   `inputMode="decimal"` + `enterKeyHint` to `NumberInput`.
4. Add a close button to the chat drawer and to the bottom sheet, and fix the drawer's
   `top-10` → `top-11`.
5. Replace HTML5 drag-and-drop for tree reparenting with a pointer-event implementation, or
   add a non-drag "move into…" path.

**P1 — makes it feel native**

6. `viewport-fit=cover` + `env(safe-area-inset-*)` padding on the sheet, panel and
   bottom-anchored viewport controls; switch `height: 100%` to `100dvh`.
7. Raise the viewport tap-to-select threshold for touch pointers (4 px → ~10 px) and enlarge
   the gizmo + its picker geometry on coarse pointers.
8. Open the property sheet at ~55 % rather than 33 %, and recompute snap points on resize
   and orientation change.
9. Remove the duplicate `NODE TREE` header; add an Escape handler to `MobilePanel`.
10. Expose export resolution on mobile; add copy confirmation to the mobile share item.
11. `touch-action: none` on the drag-to-scrub label, or drop scrubbing on touch and rely on
    a real, thicker slider.

**P2 — polish and coverage**

12. Add a mobile Playwright project (iPhone 13 + Pixel 5) covering: enter the modeler, add a
    shape, edit a dimension, export. Add an assertion that no interactive element on a
    coarse-pointer viewport is under 44 px — that is what keeps this from regressing.
13. Raise the desktop-layout floor above 768 px, or make the sidebars collapsible so iPad
    portrait is usable.
14. Design a landscape-phone arrangement rather than reusing portrait.
15. `overscroll-behavior`, `-webkit-tap-highlight-color`, `-webkit-text-size-adjust`,
    `user-select: none` on chrome.
16. Replace or supplement the `?`-triggered `ShortcutOverlay` with help reachable on touch.

---

## 10. What was done

Filed as #126–#137 and fixed on `mobile/touch-usability`, except where noted.

| # | Finding | Resolution |
| --- | --- | --- |
| 126 | Nothing meets 44px | `@media (pointer: coarse)` layer with opt-in `.tap` / `.tap-h` / `.tap-w`, applied across toolbar, viewport tools, tree rows and actions, property controls, palette tabs and the number input. Gated on pointer type, not width, so desktop density is untouched. |
| 127 | Blank mobile first run | `MobileEmptyState` in the viewport, with the two ways in as buttons. |
| 128 | Reparenting impossible on touch | Two-tap move mode (`treeUiStore`) alongside the existing drag-and-drop. Works with mouse, finger and keyboard. |
| 129 | iOS zoom / QWERTY for numbers | 16px inputs on coarse pointers; `inputMode="decimal"` + `enterKeyHint` on `NumberInput`, which stays `type="text"` so expressions still parse. |
| 130 | Chat drawer inescapable | Close button, `top-11` to match the toolbar, and `useKeyboardInset` lifts the drawer clear of the on-screen keyboard. |
| 131 | No platform integration | `viewport-fit=cover`, safe-area helpers, `100dvh`, `overscroll-behavior`, tap-highlight, text-size-adjust, `user-select`. |
| 132 | Taps swallowed; mouse-sized gizmo | Tap slop is pointer-type aware (4px mouse / 10px touch); gizmo scales up on coarse pointers. |
| 133 | Sheet opens at 33%, no close | Opens at 55%, has a close button, and recomputes its snap points on resize and rotation. |
| 134 | Duplicate header, no Escape | `MobilePanel`'s title is optional and the tree carries its own header and close button; Escape closes both containers. |
| 135 | Desktop-only features | Export resolution and share-copy confirmation added to the mobile overflow menu. |
| 136 | No mobile e2e | `e2e/mobile.spec.ts` and a `mobile` Playwright project on iPhone 13. |
| 137 | iPad portrait on desktop layout | Layout switch moved from 768 to 1024 (`DESKTOP_LAYOUT_MIN_WIDTH`), so iPad portrait gets a full-width viewport and drawers. |

Two things named in §4 and §7 were deliberately left:

- **Copy/paste still has no mobile control.** Delete, duplicate and move are all
  reachable from the tree row; copy/paste would need a paste target concept that
  does not exist yet, and is worth designing rather than bolting on.
- **Landscape phones still get the portrait arrangement.** Wrapping toolbars
  stop it overflowing, but 342px of height wants a layout of its own rather than
  the portrait one squeezed. Left in #137.

One thing the fixes introduced, worth knowing: opening the property sheet at 55%
covers more of the model than 33% did, and the camera does not currently frame
the model against the visible area. Dragging the sheet down still works. Framing
the camera around the sheet is a follow-up.

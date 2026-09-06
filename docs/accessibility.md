# Accessibility

Sinter’s canvas is a visual preview, not the only way to operate the model. The node tree and property panel expose the editable model as standard keyboard and screen-reader controls.

## Keyboard-only modeling path

1. Tab to a shape in the Parts palette and press Enter to create it.
2. Use the node tree’s arrow keys to move through visible nodes. Enter or Space selects a node; Left and Right collapse or expand it.
3. Tab into Properties. Numeric fields support typing, Up/Down stepping, and Enter to commit.
4. Tab to Save. A cloud account is required for cloud save; browser recovery remains automatic.
5. Choose an export resolution, then tab to Export STL or Export 3MF. Export progress, errors, and completion are exposed as status UI.
6. The `?` help button in the viewport opens the complete shortcut list; the keyboard shortcut remains available too.

Tree action buttons provide keyboard alternatives to drag-and-drop for moving, duplicating, enabling, and deleting nodes. The property panel is the alternative to pointer-only canvas gizmos. The canvas itself does not expose a navigable geometric surface or describe arbitrary rendered geometry.

## Verification record

- Automated: an axe-core WCAG 2 A/AA/2.1 AA spec covers the landing page and a representative create/select/edit/help editor workflow in Chromium. Serious and critical findings fail the browser suite.
- Automated keyboard: the Chromium/Playwright spec creates a box, selects it through the ARIA tree, edits Width, and opens/closes help without a pointer.
- Semantic review: modal focus trapping/restoration, live status regions, tree semantics, accessible names, visible focus, and reduced-motion behavior were reviewed in code and component tests.
- Manual screen reader: VoiceOver + Safari and NVDA + Firefox remain a release checklist item because those assistive technologies are not available in the headless CI environment. Any findings must be recorded here before #146 is closed.

Known limitation: exact 3D shape inspection is visual. Sinter exposes node names, parameters, dimensions, validation state, and operations in DOM controls, but does not attempt to translate the rendered canvas surface into a tactile or spatial screen-reader representation.

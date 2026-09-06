# Browser support

Sinter supports the current and previous major releases of Chrome, Edge, Firefox, and Safari. The interactive preview requires WebGL 2; project editing and browser recovery remain available when preview initialization fails, with an actionable message explaining how to restore it.

## Automated release coverage

- Chromium runs the complete editor, mobile-emulation, geometry-parity, and visual suites.
- Firefox and WebKit each gate a bounded workflow covering editor boot, parameter editing, undo, browser-save interception, STL import, and STL export.
- Browser failures upload Playwright diagnostics from CI.

## Real-device cadence

Before a production release that changes touch, viewport, storage, workers, or downloads, run this checklist on a currently supported iPhone or iPad in Safari:

1. Open a browser-backed project and confirm recovery survives a reload.
2. Add and select a node by touch; edit a number with the virtual keyboard.
3. Rotate with the tree drawer and property sheet both open; neither may reappear stale after returning orientation.
4. Import an STL from Files.
5. Export Draft STL and 3MF files and open the downloads from Files.
6. Open and close AI chat, help, Projects, and Settings.

Record device, OS, Safari version, date, and findings here for each release. A real-device record is still required before issue #162 can close; WebKit automation is not evidence of iOS touch, virtual-keyboard, or Files integration.

# Web performance budget

The public landing page is held to these release targets on a representative mid-tier mobile device over simulated slow 4G:

- Largest Contentful Paint at or below 2.5 seconds at the 75th percentile.
- The responsive mobile hero image at or below 25 KB; all six below-fold feature images at or below 75 KB combined.
- Below-fold feature images do not start downloading before they approach the viewport.
- The decorative WebGL preview uses at most a 1.5 device-pixel ratio and schedules no animation frames while offscreen, while the document is hidden, or when reduced motion is requested.

`npm run check:landing-budget` enforces the deterministic asset and markup limits in CI. Before a release, run a mobile Lighthouse trace against the preview deployment and record its LCP in the release notes. Use browser performance tooling to verify zero continuing frames after scrolling the WebGL preview offscreen and after hiding the tab.

// Trusted pre-navigation state for Clarity's editor audits.
// This runs in a fresh Playwright context and never reaches a user session.
localStorage.setItem('sinter_launched', '1');
localStorage.setItem('sinter_cookie_consent', 'accepted');
localStorage.setItem('sinter_local_project', JSON.stringify({
  version: 2,
  projectName: 'Clarity fixture',
  tree: {
    id: 'clarity-union',
    kind: 'union',
    label: 'Bracket assembly',
    params: { smooth: 0 },
    enabled: true,
    children: [
      {
        id: 'clarity-box', kind: 'box', label: 'Mounting plate',
        params: { width: 50, height: 8, depth: 30 }, children: [], enabled: true,
      },
      {
        id: 'clarity-move', kind: 'translate', label: 'Raised boss',
        params: { x: 0, y: 8, z: 0 }, enabled: true,
        children: [{
          id: 'clarity-cylinder', kind: 'cylinder', label: 'Fastener boss',
          params: { radius: 8, height: 18 }, children: [], enabled: true,
        }],
      },
    ],
  },
  parameters: [],
  views: [],
  measurements: [],
}));

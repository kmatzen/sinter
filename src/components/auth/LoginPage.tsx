export function LoginPage() {
  return (
    <div className="h-screen flex items-center justify-center noise-bg" style={{ background: 'var(--bg-deep)' }}>
      <div className="flex flex-col items-center space-y-8 relative z-10">
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img src="/logo-128.png" alt="Sinter" className="w-10 h-10 rounded-lg" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>Sinter</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>AI-powered 3D modeling for 3D printing</p>
        </div>

        <div className="w-72 text-center">
          <div className="px-4 py-3 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Coming Soon</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Sign in, cloud storage, and AI features are launching shortly.
            </p>
          </div>
        </div>

        <button
          onClick={() => window.dispatchEvent(new Event('show-landing'))}
          className="text-xs hover:underline"
          style={{ color: 'var(--text-muted)' }}
        >
          &larr; Back to home
        </button>
      </div>
    </div>
  );
}

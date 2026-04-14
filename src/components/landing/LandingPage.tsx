import { useState, useEffect } from 'react';
import { features } from '../../config';
import { HeroDemo } from './HeroDemo';

export function LandingPage({ onLaunch }: { onLaunch: () => void }) {
  const [showTOS, setShowTOS] = useState(false);
  const [signInEnabled, setSignInEnabled] = useState(!features.auth);

  useEffect(() => {
    if (!features.auth) return;
    fetch('/api/auth/config')
      .then((r) => r.json())
      .then((d) => setSignInEnabled(d.signInEnabled))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen relative noise-bg" style={{ background: 'var(--bg-deep)' }}>
      {/* Nav */}
      <nav className="relative z-10 px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <img src="/logo-64.png" alt="Sinter" className="w-8 h-8 rounded-md" />
          <span className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Sinter
          </span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#features" className="text-sm transition-colors" style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>Features</a>
          <a href="#pricing" className="text-sm transition-colors" style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>Pricing</a>
          <a href="https://github.com/kmatzen/sinter" className="text-sm transition-colors" style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>GitHub</a>
          {features.auth ? (
            <a href="/app" className="text-sm px-4 py-2 rounded-md font-medium"
               style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
              Sign In
            </a>
          ) : (
            <button onClick={onLaunch} className="text-sm px-4 py-2 rounded-md font-medium"
                    style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
              Launch App
            </button>
          )}
        </div>
      </nav>

      {/* Hero background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <img src="/hero-bg.png" alt="" className="w-full h-auto absolute top-0 left-0 opacity-20"
             style={{ minWidth: '100%', objectFit: 'cover', objectPosition: 'center top', maskImage: 'linear-gradient(to bottom, black 20%, transparent 70%)' }} />
      </div>

      {/* Hero */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 pt-16 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 text-xs font-medium tracking-wide"
             style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
          Open Source &middot; AI-Powered
        </div>

        <h1 className="text-6xl font-bold mb-6 leading-[1.1] tracking-tight">
          <span style={{ color: 'var(--text-primary)' }}>Describe it.</span>
          <br />
          <span style={{ color: 'var(--accent)' }}>Print it.</span>
        </h1>

        <p className="text-lg mb-8 max-w-xl mx-auto leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          AI-powered 3D modeling with signed distance fields.
          Smooth booleans, parametric shells, and export-ready STL — all from natural language.
        </p>

        <div className="flex gap-3 justify-center">
          <button
            onClick={onLaunch}
            className="group px-7 py-3 rounded-md font-medium text-base flex items-center gap-2"
            style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
          >
            Start Modeling
            <span className="group-hover:translate-x-0.5 transition-transform">&rarr;</span>
          </button>
          <a
            href="https://github.com/kmatzen/sinter"
            className="px-7 py-3 rounded-md font-medium text-base"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
          >
            View Source
          </a>
        </div>


      </section>

      {/* Technology showcase */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pb-16">
        <div className="flex flex-col md:flex-row items-center gap-8 rounded-xl p-8"
             style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)' }}>
          <div className="w-full md:w-1/2 shrink-0">
            <HeroDemo />
          </div>
          <div className="w-full md:w-1/2 space-y-4">
            <p className="font-mono text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--accent)' }}>
              Signed Distance Fields
            </p>
            <h3 className="text-xl font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
              Pixel-perfect geometry,<br />rendered in real time
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Unlike mesh-based modelers, Sinter represents shapes as mathematical distance functions. Booleans never fail. Fillets are always smooth. And the GPU ray marches your model at full resolution every frame — no tessellation artifacts, ever.
            </p>
            <div className="space-y-2 pt-2">
              {[
                'Smooth unions, subtracts, and intersections',
                'Shell, offset, and fillet with one parameter',
                'GPU ray marching — no mesh approximation',
                'Export to STL & 3MF when you\'re ready to print',
              ].map((item) => (
                <div key={item} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: 'var(--accent)' }} />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3" style={{ color: 'var(--accent)' }}>Capabilities</p>
          <h2 className="text-3xl font-bold tracking-tight">Design, iterate, and export</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="group rounded-lg overflow-hidden transition-colors"
                 style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)' }}
                 onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-default)'}
                 onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-subtle)'}>
              {f.image && (
                <div className="w-full aspect-square overflow-hidden">
                  <img src={f.image} alt={f.title} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                </div>
              )}
              <div className="p-5">
                <h3 className="font-semibold mb-2 text-sm" style={{ color: 'var(--text-primary)' }}>{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="relative z-10 max-w-4xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3" style={{ color: 'var(--accent)' }}>Pricing</p>
          <h2 className="text-3xl font-bold tracking-tight mb-3">Pay for what you use</h2>
          <p className="max-w-lg mx-auto leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            The full modeling engine is free — no login required. Buy credit packs for AI features, cloud storage, and project sharing. Credits are valid for 30 days.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto mb-12">
          {CREDIT_PACKS.map((pack) => (
            <div key={pack.credits} className="p-6 rounded-lg text-center"
                 style={{ background: 'var(--bg-panel)', border: pack.popular ? '1px solid var(--accent)' : '1px solid var(--border-subtle)' }}>
              {pack.popular && (
                <div className="font-mono text-[9px] tracking-[0.15em] uppercase mb-3" style={{ color: 'var(--accent)' }}>
                  Best value
                </div>
              )}
              <div className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{pack.credits}</div>
              <p className="font-mono text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>credits</p>
              <div className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>${pack.price}</div>
              <p className="text-[11px] mb-5" style={{ color: 'var(--text-muted)' }}>${pack.perCredit}/credit</p>
              {signInEnabled ? (
                <a href={features.auth ? '/app' : '#'}
                   onClick={features.auth ? undefined : onLaunch}
                   className="block w-full py-2 rounded-md text-sm font-medium text-center"
                   style={{
                     background: pack.popular ? 'var(--accent)' : 'var(--bg-elevated)',
                     color: pack.popular ? 'var(--bg-deep)' : 'var(--text-primary)',
                     border: pack.popular ? '1px solid var(--accent)' : '1px solid var(--border-default)',
                   }}>
                  {features.auth ? 'Sign In to Buy' : 'Get Started'}
                </a>
              ) : (
                <span
                   className="block w-full py-2 rounded-md text-sm font-medium text-center"
                   style={{
                     background: 'var(--bg-surface)',
                     color: 'var(--text-muted)',
                     border: '1px solid var(--border-subtle)',
                   }}>
                  Coming Soon
                </span>
              )}
            </div>
          ))}
        </div>

        {/* What's included */}
        <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-lg p-5" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)' }}>
            <p className="font-mono text-[10px] tracking-[0.15em] uppercase mb-3" style={{ color: 'var(--accent-green)' }}>
              Free for everyone
            </p>
            <div className="space-y-2">
              {['SDF modeling engine', 'Smooth booleans', 'STL & 3MF export', 'Component library'].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--accent-green)' }} />
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg p-5" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)' }}>
            <p className="font-mono text-[10px] tracking-[0.15em] uppercase mb-3" style={{ color: 'var(--accent)' }}>
              With credits
            </p>
            <div className="space-y-2">
              {['AI-powered modeling', 'Cloud storage & sync', 'Project sharing'].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="relative z-10 max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-2xl font-bold tracking-tight mb-3" style={{ color: 'var(--text-primary)' }}>Ready to start modeling?</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>No account required. Open the app and start building.</p>
        <button
          onClick={onLaunch}
          className="group px-7 py-3 rounded-md font-medium text-base inline-flex items-center gap-2"
          style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
        >
          Start Modeling
          <span className="group-hover:translate-x-0.5 transition-transform">&rarr;</span>
        </button>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-6 py-8 text-center" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center justify-center gap-2 mb-3">
          <img src="/logo-64.png" alt="Sinter" className="w-5 h-5 rounded" />
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Sinter</span>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          &copy; {new Date().getFullYear()} Kevin Blackburn-Matzen. Open source under a non-commercial license.
        </p>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <a href="https://github.com/kmatzen/sinter" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>GitHub</a>
          {' · '}
          <a href="/LICENSE" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>License</a>
          {' · '}
          <button onClick={() => setShowTOS(true)} className="hover:underline" style={{ color: 'var(--text-secondary)' }}>Terms of Service</button>
        </p>
      </footer>

      {/* Terms of Service Modal */}
      {showTOS && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}
             onClick={() => setShowTOS(false)}>
          <div className="max-w-2xl w-full max-h-[80vh] overflow-y-auto rounded-lg p-8 mx-4"
               style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Terms of Service</h2>
              <button onClick={() => setShowTOS(false)} className="text-lg" style={{ color: 'var(--text-muted)' }}>&times;</button>
            </div>
            <div className="space-y-4 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              <p style={{ color: 'var(--text-muted)' }}>Last updated: April 12, 2026</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>1. Acceptance of Terms</h3>
              <p>By accessing or using Sinter ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>2. Description of Service</h3>
              <p>Sinter is an AI-powered 3D modeling tool for 3D printing. The core modeling engine is free to use. Optional paid features include AI-assisted modeling, cloud storage, and project sharing, available through prepaid credit packs.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>3. Accounts</h3>
              <p>You may sign in using Google or GitHub OAuth. You are responsible for maintaining the security of your account. You must provide accurate information when creating an account.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>4. Credits and Payments</h3>
              <p>Credits are prepaid and non-refundable. Credits expire 30 days after purchase; each new purchase resets the expiry for all credits. AI features consume credits based on actual token usage. Cloud storage costs 1 credit per 100MB per 30-day period. If storage credits are exhausted, you have a 30-day grace period to add credits before projects may be archived.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>5. Your Content</h3>
              <p>You retain all rights to models and designs you create using Sinter. We do not claim ownership of your content. You grant us a limited license to store and transmit your content solely for the purpose of providing the Service.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>6. Acceptable Use</h3>
              <p>You agree not to: abuse or overload the Service; attempt to access other users' data; use the Service for illegal purposes; reverse-engineer the Service beyond what is permitted by the open-source license.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>7. AI Features</h3>
              <p>AI-generated model suggestions are provided as-is. You are responsible for reviewing and validating any AI-generated geometry before manufacturing. We make no guarantees about the printability, structural integrity, or fitness for purpose of AI-generated designs.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>8. Limitation of Liability</h3>
              <p>The Service is provided "as is" without warranties of any kind. We are not liable for any damages arising from the use of the Service, including but not limited to failed prints, material waste, or equipment damage resulting from models created with Sinter.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>9. Termination</h3>
              <p>We may suspend or terminate your access to the Service at any time for violation of these terms. You may delete your account at any time. Upon termination, your cloud-stored projects will be deleted after 30 days.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>10. Changes to Terms</h3>
              <p>We may update these terms from time to time. Continued use of the Service after changes constitutes acceptance of the new terms.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>11. Contact</h3>
              <p>For questions about these terms, open an issue on <a href="https://github.com/kmatzen/sinter" className="underline" style={{ color: 'var(--accent)' }}>GitHub</a>.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CREDIT_PACKS = [
  { credits: 100, price: 5, perCredit: '0.05', popular: false },
  { credits: 500, price: 20, perCredit: '0.04', popular: false },
  { credits: 1000, price: 35, perCredit: '0.035', popular: true },
];

const FEATURES = [
  { image: '/feature-ai.png', title: 'AI-Powered Modeling', desc: 'Describe what you need in plain language. The AI builds a parametric SDF model that you can edit, tweak, and iterate on.' },
  { image: '/feature-preview.png', title: 'Real-Time Preview', desc: 'Every parameter change renders instantly on the GPU. No waiting for mesh rebuilds — what you see is the actual geometry.' },
  { image: '/feature-printing.png', title: 'Built for Manufacturing', desc: 'Shell walls, offset surfaces, and analyze thickness. Export watertight STL and 3MF files ready for any slicer.' },
  { image: '/feature-workflow.png', title: 'Non-Destructive Editing', desc: 'A full node tree with undo, redo, and disable. Change any operation at any point in the history without starting over.' },
  { image: '/feature-booleans.png', title: 'Smooth Booleans', desc: 'Union, subtract, and intersect with adjustable fillet radius. No topology failures — the math always works.' },
  { image: '/feature-library.png', title: 'Component Library', desc: 'Start from pre-built parametric parts: standoffs, enclosures, snap-fits, and mechanical fasteners.' },
];

import { useState, useEffect, useRef } from 'react';
import { lazy, Suspense } from 'react';

/**
 * The hero is a live three.js demo, and three.js is half the bundle. Loading it
 * on demand means the marketing copy — the thing a first-time visitor is
 * actually here to read — paints without waiting for a renderer.
 *
 * The placeholder reserves the demo's exact height so nothing below it moves
 * when the chunk lands. A hero that appears a beat late is fine; a page that
 * jumps under the reader's eyes is not.
 */
const HeroDemo = lazy(() => import('./HeroDemo').then((m) => ({ default: m.HeroDemo })));

function HeroPlaceholder() {
  return <div className="w-full h-[280px] md:h-[320px]" aria-hidden="true" />;
}
import { ensureConsent } from '../../store/consent';
import { LegalContent, legalTitle, type LegalDocument } from '../legal/LegalContent';
import { useDialogFocus } from '../ui/useDialogFocus';

export function LandingPage({ onLaunch }: { onLaunch: () => void }) {
  const handleLaunch = async () => {
    const granted = await ensureConsent('local');
    if (!granted) return;
    onLaunch();
  };

  const handleSignIn = async () => {
    const granted = await ensureConsent('signin');
    if (!granted) return;
    window.location.href = '/app';
  };
  const [showTOS, setShowTOS] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  useEffect(() => {
    const handler = () => setShowPrivacy(true);
    window.addEventListener('show-privacy', handler);
    return () => window.removeEventListener('show-privacy', handler);
  }, []);

  return (
    <div className="min-h-screen relative noise-bg" style={{ background: 'var(--bg-deep)' }}>
      {/* Nav */}
      <nav className="relative z-10 px-4 md:px-6 py-4 md:py-5 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <img src="/logo-64.png" alt="Sinter" className="w-7 h-7 md:w-8 md:h-8 rounded-md" />
          <span className="text-base md:text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Sinter
          </span>
        </div>
        <div className="flex items-center gap-3 md:gap-6">
          <a href="#features" className="hidden md:inline text-sm transition-colors" style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>Features</a>
          <a href="https://github.com/kmatzen/sinter" className="hidden md:inline text-sm transition-colors" style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>GitHub</a>
          <button onClick={handleSignIn} className="text-sm px-4 py-2 rounded-md font-medium"
             style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
            Sign In
          </button>
        </div>
      </nav>

      {/* Hero background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <picture>
          <source
            type="image/webp"
            srcSet="/hero-bg-768.webp 768w, /hero-bg-1536.webp 1536w"
            sizes="100vw"
          />
          <img src="/hero-bg.png" alt="" width="1536" height="1024" decoding="async" fetchPriority="high"
               className="w-full h-auto absolute top-0 left-0 opacity-20"
               style={{ minWidth: '100%', objectFit: 'cover', objectPosition: 'center top', maskImage: 'linear-gradient(to bottom, black 20%, transparent 70%)' }} />
        </picture>
      </div>

      {/* Hero */}
      <section className="relative z-10 max-w-4xl mx-auto px-4 md:px-6 pt-10 md:pt-16 pb-10 md:pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 text-xs font-medium tracking-wide"
             style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
          Source Available &middot; AI-Powered &middot; Free
        </div>

        <h1 className="text-4xl md:text-6xl font-bold mb-4 md:mb-6 leading-[1.1] tracking-tight">
          <span style={{ color: 'var(--text-primary)' }}>Describe it.</span>
          <br />
          <span style={{ color: 'var(--accent)' }}>Print it.</span>
        </h1>

        <p className="text-base md:text-lg mb-6 md:mb-8 max-w-xl mx-auto leading-relaxed px-2" style={{ color: 'var(--text-secondary)' }}>
          AI-powered 3D modeling with signed distance fields.
          Bring your own API key. Store projects in your own GitHub or Google Drive.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <button
            onClick={handleLaunch}
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
            <Suspense fallback={<HeroPlaceholder />}><HeroDemo /></Suspense>
          </div>
          <div className="w-full md:w-1/2 space-y-4">
            <p className="font-mono text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--accent)' }}>
              Signed Distance Fields
            </p>
            <h3 className="text-xl font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
              Pixel-perfect geometry,<br />rendered in real time
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Sinter represents shapes as mathematical distance functions, giving you responsive booleans and smooth blends while you work. Export creates a mesh at the resolution you choose for your slicer.
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
                  <picture>
                    <source type="image/webp" srcSet={f.webp} />
                    <img src={f.image} alt={f.title} width="400" height="400" loading="lazy" decoding="async"
                         className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                  </picture>
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

      {/* How it works — BYOK */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3" style={{ color: 'var(--accent)' }}>How It Works</p>
          <h2 className="text-3xl font-bold tracking-tight mb-3">Bring your own keys</h2>
          <p className="max-w-lg mx-auto leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Sinter is completely free. You provide your own AI API key and projects are stored in your own cloud account.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
          {[
            { step: '1', title: 'Sign in', desc: 'Use your GitHub or Google account. Your OAuth provider determines where projects are stored.' },
            { step: '2', title: 'Add your API key', desc: 'Bring your own Anthropic or OpenAI key for AI-powered modeling. Keys stay in your browser.' },
            { step: '3', title: 'Start modeling', desc: 'Projects save to your GitHub Gists or Google Drive. Share with a link. Export STL/3MF anytime.' },
          ].map((item) => (
            <div key={item.step} className="p-5 rounded-lg" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mb-3"
                   style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
                {item.step}
              </div>
              <h3 className="font-semibold mb-2 text-sm" style={{ color: 'var(--text-primary)' }}>{item.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{item.desc}</p>
            </div>
          ))}
        </div>

        <div className="max-w-3xl mx-auto mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-lg p-5" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)' }}>
            <p className="font-mono text-[10px] tracking-[0.15em] uppercase mb-3" style={{ color: 'var(--accent-green)' }}>
              Everything is free
            </p>
            <div className="space-y-2">
              {['SDF modeling engine', 'Smooth booleans', 'STL & 3MF export', 'Cloud storage & sharing', 'Component library'].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--accent-green)' }} />
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg p-5" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)' }}>
            <p className="font-mono text-[10px] tracking-[0.15em] uppercase mb-3" style={{ color: 'var(--accent)' }}>
              You provide
            </p>
            <div className="space-y-2">
              {['Anthropic or OpenAI API key', 'GitHub or Google account'].map((item) => (
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
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Sign in with GitHub or Google to get started. Your projects stay in your own storage.</p>
        <button
          onClick={handleLaunch}
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
          &copy; {new Date().getFullYear()} Kevin Blackburn-Matzen. Source available under a non-commercial license.
        </p>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <a href="https://github.com/kmatzen/sinter" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>GitHub</a>
          {' · '}
          <a href="/LICENSE" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>License</a>
          {' · '}
          <a href="/terms" onClick={(e) => { e.preventDefault(); setShowTOS(true); }} className="hover:underline" style={{ color: 'var(--text-secondary)' }}>Terms of Service</a>
          {' · '}
          <a href="/privacy" onClick={(e) => { e.preventDefault(); setShowPrivacy(true); }} className="hover:underline" style={{ color: 'var(--text-secondary)' }}>Privacy Policy</a>
        </p>
      </footer>

      {showTOS && <LegalModal kind="terms" onClose={() => setShowTOS(false)} />}
      {showPrivacy && <LegalModal kind="privacy" onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}

const FEATURES = [
  { image: '/feature-ai.png', webp: '/feature-ai.webp', title: 'AI-Powered Modeling', desc: 'Describe what you need in plain language. The AI builds a parametric SDF model that you can edit, tweak, and iterate on.' },
  { image: '/feature-preview.png', webp: '/feature-preview.webp', title: 'Real-Time Preview', desc: 'Every parameter change renders instantly on the GPU. No waiting for mesh rebuilds — what you see is the actual geometry.' },
  { image: '/feature-printing.png', webp: '/feature-printing.webp', title: 'Built for Manufacturing', desc: 'Create shell walls and offset surfaces, then export STL and 3MF files for validation in your slicer.' },
  { image: '/feature-workflow.png', webp: '/feature-workflow.webp', title: 'Non-Destructive Editing', desc: 'A full node tree with undo, redo, and disable. Change any operation at any point in the history without starting over.' },
  { image: '/feature-booleans.png', webp: '/feature-booleans.webp', title: 'Smooth Booleans', desc: 'Union, subtract, and intersect implicit shapes with an adjustable blend radius.' },
  { image: '/feature-library.png', webp: '/feature-library.webp', title: 'Component Library', desc: 'Start from pre-built parametric parts: standoffs, enclosures, snap-fits, and mechanical fasteners.' },
];

function LegalModal({ kind, onClose }: { kind: LegalDocument; onClose: () => void }) {
  const surface = useRef<HTMLDivElement>(null);
  useDialogFocus(surface, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div ref={surface} role="dialog" aria-modal="true" aria-labelledby={`${kind}-title`} className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-lg p-8" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 id={`${kind}-title`} className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{legalTitle(kind)}</h2>
          <button onClick={onClose} aria-label={`Close ${legalTitle(kind)}`} className="text-lg" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>
        <LegalContent kind={kind} />
      </div>
    </div>
  );
}

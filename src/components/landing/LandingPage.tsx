import { useState, useEffect } from 'react';
import { HeroDemo } from './HeroDemo';
import { hasConsent, requestConsent } from '../ui/CookieConsent';

export function LandingPage({ onLaunch }: { onLaunch: () => void }) {
  const handleLaunch = () => {
    if (!hasConsent()) {
      requestConsent();
      const handler = () => { onLaunch(); window.removeEventListener('cookie-consent-accepted', handler); };
      window.addEventListener('cookie-consent-accepted', handler);
      return;
    }
    onLaunch();
  };

  const handleSignIn = () => {
    if (!hasConsent()) {
      requestConsent();
      const handler = () => { window.location.href = '/app'; window.removeEventListener('cookie-consent-accepted', handler); };
      window.addEventListener('cookie-consent-accepted', handler);
      return;
    }
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
        <img src="/hero-bg.png" alt="" className="w-full h-auto absolute top-0 left-0 opacity-20"
             style={{ minWidth: '100%', objectFit: 'cover', objectPosition: 'center top', maskImage: 'linear-gradient(to bottom, black 20%, transparent 70%)' }} />
      </div>

      {/* Hero */}
      <section className="relative z-10 max-w-4xl mx-auto px-4 md:px-6 pt-10 md:pt-16 pb-10 md:pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 text-xs font-medium tracking-wide"
             style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
          Open Source &middot; AI-Powered &middot; Free
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
          &copy; {new Date().getFullYear()} Kevin Blackburn-Matzen. Open source under a non-commercial license.
        </p>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <a href="https://github.com/kmatzen/sinter" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>GitHub</a>
          {' · '}
          <a href="/LICENSE" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>License</a>
          {' · '}
          <button onClick={() => setShowTOS(true)} className="hover:underline" style={{ color: 'var(--text-secondary)' }}>Terms of Service</button>
          {' · '}
          <button onClick={() => setShowPrivacy(true)} className="hover:underline" style={{ color: 'var(--text-secondary)' }}>Privacy Policy</button>
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
              <p style={{ color: 'var(--text-muted)' }}>Last updated: April 16, 2026</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>1. Acceptance of Terms</h3>
              <p>By accessing or using Sinter ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>2. Description of Service</h3>
              <p>Sinter is a free, open-source, AI-powered 3D modeling tool for 3D printing. You bring your own AI API key (Anthropic or OpenAI) and sign in with GitHub or Google to store projects in your own cloud storage (GitHub Gists or Google Drive).</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>3. Accounts</h3>
              <p>You may sign in using Google or GitHub OAuth. Authentication is used to connect your cloud storage and enable project saving and sharing. You are responsible for maintaining the security of your account and API keys.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>4. Your Content</h3>
              <p>You retain all rights to models and designs you create using Sinter. Your project data is stored in your own GitHub Gists or Google Drive — we do not store project files on our servers. We store only project metadata (names, timestamps, thumbnails) in our database.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>5. API Keys</h3>
              <p>Your AI API keys are stored only in your browser's memory and are sent directly from your browser to the AI provider. We never see, store, or transmit your API keys through our servers.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>6. Acceptable Use</h3>
              <p>You agree not to: abuse or overload the Service; attempt to access other users' data; use the Service for illegal purposes; reverse-engineer the Service beyond what is permitted by the open-source license.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>7. AI Features</h3>
              <p>AI-generated model suggestions are provided as-is. You are responsible for reviewing and validating any AI-generated geometry before manufacturing. We make no guarantees about the printability, structural integrity, or fitness for purpose of AI-generated designs.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>8. Limitation of Liability</h3>
              <p>The Service is provided "as is" without warranties of any kind. We are not liable for any damages arising from the use of the Service, including but not limited to failed prints, material waste, or equipment damage resulting from models created with Sinter.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>9. Termination</h3>
              <p>We may suspend or terminate your access to the Service at any time for violation of these terms. Your project data in GitHub Gists or Google Drive remains yours and is unaffected by account termination.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>10. Changes to Terms</h3>
              <p>We may update these terms from time to time. Continued use of the Service after changes constitutes acceptance of the new terms.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>11. Contact</h3>
              <p>For questions about these terms, open an issue on <a href="https://github.com/kmatzen/sinter" className="underline" style={{ color: 'var(--accent)' }}>GitHub</a>.</p>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Policy Modal */}
      {showPrivacy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}
             onClick={() => setShowPrivacy(false)}>
          <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-lg p-8"
               style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Privacy Policy</h2>
              <button onClick={() => setShowPrivacy(false)} className="text-lg" style={{ color: 'var(--text-muted)' }}>{'\u2715'}</button>
            </div>
            <div className="text-sm leading-relaxed space-y-2" style={{ color: 'var(--text-secondary)' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Last updated: April 2026</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>1. Information We Collect</h3>
              <p><strong>Account information:</strong> When you sign in with Google or GitHub, we receive your name, email address, and profile photo. We also receive an OAuth access token to read/write files in your GitHub Gists or Google Drive on your behalf.</p>
              <p><strong>Project metadata:</strong> We store project names, timestamps, and thumbnails in our database. Project file data (your 3D models) is stored in your own GitHub Gists or Google Drive — not on our servers.</p>
              <p><strong>API keys:</strong> Your AI API keys (Anthropic/OpenAI) are stored only in your browser's session memory. They are sent directly from your browser to the AI provider and never pass through our servers.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>2. Cookies and Local Storage</h3>
              <p><strong>Session cookie:</strong> A single HTTP-only session cookie is used for authentication. It expires after 30 days of inactivity.</p>
              <p><strong>Local storage:</strong> We use browser local storage to save your project locally as a backup, remember your preferences, and track cookie consent. No tracking cookies or third-party analytics are used.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>3. How We Use Your Information</h3>
              <p>We use your information solely to: provide and maintain the service, authenticate you, and read/write project files to your cloud storage on your behalf.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>4. AI Processing</h3>
              <p>When you use AI chat, your messages and viewport screenshots are sent directly from your browser to the AI provider (Anthropic or OpenAI) using your own API key. This data does not pass through our servers.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>5. OAuth Tokens</h3>
              <p>We store your OAuth access token (and refresh token for Google) to read and write project files to your cloud storage. These tokens are scoped to only access files created by Sinter (GitHub gist scope, Google Drive file scope). You can revoke access at any time through your GitHub or Google account settings.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>6. Data Sharing</h3>
              <p>We do not sell, rent, or share your personal information with third parties. The only external services we interact with on your behalf are GitHub/Google (for storage) based on your explicit authentication.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>7. Data Storage and Security</h3>
              <p>Project metadata is stored in a SQLite database on our server. Project file data is stored in your own cloud storage. We use HTTPS, HTTP-only cookies, and standard security practices. No system is 100% secure.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>8. Your Rights</h3>
              <p>You can: access and download your project data at any time from your own GitHub/Google account, revoke Sinter's access through your OAuth provider's settings, and request deletion of your account metadata from our database. For EU residents, you have additional rights under GDPR including the right to erasure, portability, and objection to processing.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>9. Data Retention</h3>
              <p>Account metadata is retained as long as your account is active. If you delete your account, metadata is removed from our database. Your project files in GitHub Gists or Google Drive are unaffected — they remain in your own storage.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>10. Changes to This Policy</h3>
              <p>We may update this policy from time to time. Continued use of the service constitutes acceptance of any changes.</p>

              <h3 className="font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>11. Contact</h3>
              <p>For privacy questions, open an issue on <a href="https://github.com/kmatzen/sinter" className="underline" style={{ color: 'var(--accent)' }}>GitHub</a>.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FEATURES = [
  { image: '/feature-ai.png', title: 'AI-Powered Modeling', desc: 'Describe what you need in plain language. The AI builds a parametric SDF model that you can edit, tweak, and iterate on.' },
  { image: '/feature-preview.png', title: 'Real-Time Preview', desc: 'Every parameter change renders instantly on the GPU. No waiting for mesh rebuilds — what you see is the actual geometry.' },
  { image: '/feature-printing.png', title: 'Built for Manufacturing', desc: 'Shell walls, offset surfaces, and analyze thickness. Export watertight STL and 3MF files ready for any slicer.' },
  { image: '/feature-workflow.png', title: 'Non-Destructive Editing', desc: 'A full node tree with undo, redo, and disable. Change any operation at any point in the history without starting over.' },
  { image: '/feature-booleans.png', title: 'Smooth Booleans', desc: 'Union, subtract, and intersect with adjustable fillet radius. No topology failures — the math always works.' },
  { image: '/feature-library.png', title: 'Component Library', desc: 'Start from pre-built parametric parts: standoffs, enclosures, snap-fits, and mechanical fasteners.' },
];

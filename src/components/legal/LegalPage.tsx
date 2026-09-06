import { LegalContent, legalTitle, type LegalDocument } from './LegalContent';
import { useEffect } from 'react';

export function LegalPage({ kind }: { kind: LegalDocument }) {
  const title = legalTitle(kind);
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} — Sinter`;
    return () => { document.title = previous; };
  }, [title]);
  return (
    <main className="min-h-screen px-6 py-12" style={{ background: 'var(--bg-deep)' }}>
      <article className="max-w-2xl mx-auto">
        <header className="flex items-center justify-between mb-10">
          <a className="flex items-center gap-2" href="/">
            <img src="/logo-64.png" alt="" className="w-7 h-7 rounded" />
            <span style={{ color: 'var(--text-primary)' }}>Sinter</span>
          </a>
          <a href="/" className="text-sm" style={{ color: 'var(--text-muted)' }}>← Back to Sinter</a>
        </header>
        <h1 className="text-3xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>{title}</h1>
        <LegalContent kind={kind} />
        <footer className="mt-12 pt-6 text-xs" style={{ borderTop: '1px solid var(--border-default)', color: 'var(--text-muted)' }}>
          <a href={kind === 'terms' ? '/privacy' : '/terms'} className="underline">
            {kind === 'terms' ? 'Privacy Policy' : 'Terms of Service'}
          </a>
        </footer>
      </article>
    </main>
  );
}

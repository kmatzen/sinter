export type LegalDocument = 'terms' | 'privacy';

const headingStyle = { color: 'var(--text-primary)' };
const linkClass = 'underline';
const linkStyle = { color: 'var(--accent)' };

export function legalTitle(kind: LegalDocument): string {
  return kind === 'terms' ? 'Terms of Service' : 'Privacy Policy';
}

/** Canonical legal copy used by both the landing-page modal and permanent URL. */
export function LegalContent({ kind }: { kind: LegalDocument }) {
  if (kind === 'terms') {
    return (
      <div className="space-y-4 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        <p style={{ color: 'var(--text-muted)' }}>Last updated: September 5, 2026</p>
        <h3 className="font-semibold mt-6" style={headingStyle}>1. Acceptance of Terms</h3>
        <p>By using Sinter (the “Service”), you agree to these terms. If you do not agree, do not use the Service.</p>
        <h3 className="font-semibold mt-6" style={headingStyle}>2. Service and license</h3>
        <p>Sinter is an AI-assisted 3D modeling tool. Its source is available under the non-commercial license in the repository. That license governs use of the software; these terms govern use of the hosted Service. Contact <a className={linkClass} style={linkStyle} href="mailto:hello@sinter-3d.com">hello@sinter-3d.com</a> for commercial licensing.</p>
        <h3 className="font-semibold mt-6" style={headingStyle}>3. Connected accounts</h3>
        <p>You may connect Google Drive or GitHub Gists for project storage and a supported AI provider for chat. Those services have their own terms and policies. You are responsible for your accounts, credentials, usage charges, and the permissions you grant.</p>
        <h3 className="font-semibold mt-6" style={headingStyle}>4. Your content</h3>
        <p>You retain your rights in models and designs you create. Project documents and metadata are stored in your chosen provider and in browser-local backups or caches; Sinter does not operate an account or project database.</p>
        <h3 className="font-semibold mt-6" style={headingStyle}>5. Credentials</h3>
        <p>OAuth tokens and saved AI credentials are held in your browser. Cloudflare Pages Functions handle OAuth code exchange and Google token refresh transiently. Protect devices and browser profiles on which you use Sinter.</p>
        <h3 className="font-semibold mt-6" style={headingStyle}>6. Acceptable use</h3>
        <p>Do not abuse or disrupt the Service, access data without authorization, use it unlawfully, or use the source code outside the permissions granted by its license.</p>
        <h3 className="font-semibold mt-6" style={headingStyle}>7. AI and manufacturing</h3>
        <p>AI output and generated geometry may be incomplete or incorrect. Review dimensions, geometry, materials, tolerances, printability, and safety before manufacture. Sinter does not certify structural integrity or fitness for a particular purpose.</p>
        <h3 className="font-semibold mt-6" style={headingStyle}>8. Availability and warranties</h3>
        <p>The Service is provided “as is” and “as available,” without warranties to the extent permitted by law. Features and third-party integrations may change or become unavailable.</p>
        <h3 className="font-semibold mt-6" style={headingStyle}>9. Limitation of liability</h3>
        <p>To the extent permitted by law, Sinter’s operator is not liable for indirect or consequential loss, failed prints, material waste, lost data, provider charges, or equipment damage arising from use of the Service.</p>
        <h3 className="font-semibold mt-6" style={headingStyle}>10. Changes and contact</h3>
        <p>These terms may change; the date above identifies the current version. Questions may be sent to <a className={linkClass} style={linkStyle} href="mailto:hello@sinter-3d.com">hello@sinter-3d.com</a>.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
      <p style={{ color: 'var(--text-muted)' }}>Last updated: September 5, 2026</p>
      <h3 className="font-semibold mt-6" style={headingStyle}>1. Architecture and data flow</h3>
      <p>Sinter is a static browser application hosted on Cloudflare Pages. It has no Sinter-managed account or project database. Your browser communicates directly with Google, GitHub, and the AI provider you select, except for the OAuth exchanges described below.</p>
      <h3 className="font-semibold mt-6" style={headingStyle}>2. Browser storage</h3>
      <p>Sinter uses local storage for your connected-provider profile and OAuth tokens, saved AI provider settings and API keys, chat text, preferences, consent choice, and a local project backup. It uses IndexedDB for project backups and thumbnail caches, and session storage for short-lived OAuth PKCE state. Clearing Sinter’s site data removes these browser copies.</p>
      <h3 className="font-semibold mt-6" style={headingStyle}>3. Cloud project storage</h3>
      <p>Project documents, names, timestamps, thumbnails, and sharing state are stored in your own Google Drive or GitHub Gists account when you choose cloud storage. Google’s <code>drive.file</code> permission is limited to files Sinter creates or that you open with Sinter. GitHub’s <code>gist</code> permission is broader and can read and write your gists, not only gists created by Sinter.</p>
      <h3 className="font-semibold mt-6" style={headingStyle}>4. OAuth</h3>
      <p>Cloudflare Pages Functions receive an authorization code and related verifier to exchange it with Google or GitHub, and may receive a Google refresh token to refresh access. These functions return credentials to your browser and do not intentionally persist them. Your browser fetches your provider profile directly.</p>
      <h3 className="font-semibold mt-6" style={headingStyle}>5. AI processing</h3>
      <p>When you submit AI chat, Sinter sends your prompt, relevant chat context, model context, and any included viewport screenshot directly to the selected provider or configured compatible endpoint. Saved credentials remain in browser local storage until you remove them or clear site data. The recipient’s retention and use are governed by that provider’s policy.</p>
      <h3 className="font-semibold mt-6" style={headingStyle}>6. Recipients and tracking</h3>
      <p>Data is sent as needed to Cloudflare for site delivery and OAuth functions; Google or GitHub when connected; and Anthropic, OpenAI, OpenRouter, or another endpoint you configure when using AI. Sinter does not currently include third-party advertising or analytics and does not sell personal information.</p>
      <h3 className="font-semibold mt-6" style={headingStyle}>7. Retention and controls</h3>
      <p>Browser data remains until you clear it, sign out where that action removes credentials, or overwrite it. Provider-hosted projects remain until you delete them through Sinter or the provider. You can revoke OAuth access in Google or GitHub, delete AI keys in Settings, clear chat, download or delete projects, and clear all Sinter site data in your browser.</p>
      <h3 className="font-semibold mt-6" style={headingStyle}>8. Sharing</h3>
      <p>Sharing may make a Drive file public or create a URL-accessible secret gist. Anyone with a working link may access the shared project. Removing a link from Sinter’s interface does not necessarily erase copies already obtained by others.</p>
      <h3 className="font-semibold mt-6" style={headingStyle}>9. Security and choices</h3>
      <p>HTTPS protects data in transit, but browser-stored credentials are accessible to code running in the same site context and to someone with access to your browser profile. You can use Sinter without connecting cloud storage and can avoid AI processing by not using chat.</p>
      <h3 className="font-semibold mt-6" style={headingStyle}>10. Contact and changes</h3>
      <p>The date above identifies the current policy. Privacy questions may be sent to <a className={linkClass} style={linkStyle} href="mailto:hello@sinter-3d.com">hello@sinter-3d.com</a>. Legal rights vary by location; this factual notice should be reviewed by qualified counsel.</p>
    </div>
  );
}

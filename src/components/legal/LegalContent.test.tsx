import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LegalContent } from './LegalContent';

const retiredClaims = [
  /SQLite database/i,
  /HTTP-only session cookie/i,
  /session memory/i,
  /only access files created by Sinter/i,
  /open-source/i,
];

describe('canonical legal copy', () => {
  it.each(['terms', 'privacy'] as const)('%s does not repeat retired architecture claims', (kind) => {
    const { container } = render(<LegalContent kind={kind} />);
    const copy = container.textContent ?? '';
    for (const claim of retiredClaims) expect(copy).not.toMatch(claim);
  });

  it('discloses browser credentials, provider recipients, retention, and controls', () => {
    render(<LegalContent kind="privacy" />);
    expect(screen.getByText(/saved AI provider settings and API keys/i)).toBeInTheDocument();
    expect(screen.getByText(/Anthropic, OpenAI, OpenRouter/i)).toBeInTheDocument();
    expect(screen.getByText(/Browser data remains until/i)).toBeInTheDocument();
    expect(screen.getByText(/clear all Sinter site data/i)).toBeInTheDocument();
    expect(screen.getByText(/GitHub’s.*permission is broader/i)).toBeInTheDocument();
    expect(screen.getByText(/localStorage for your connected-provider profile/i)).toBeInTheDocument();
    expect(screen.getByText(/IndexedDB for project backups/i)).toBeInTheDocument();
    expect(screen.queryByText(/consent choice, and a local project backup/i)).not.toBeInTheDocument();
  });
});

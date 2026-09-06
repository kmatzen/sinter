import { beforeEach, describe, expect, it } from 'vitest';
import { useModelerStore } from '../../store/modelerStore';
import type { SDFNodeUI } from '../../types/operations';
import { buildDiagnosticReport, buildRecoveryFile } from './recovery';

const box: SDFNodeUI = {
  id: 'box', kind: 'box', label: 'Box',
  params: { width: 10, height: 10, depth: 10 }, children: [], enabled: true,
};

describe('fatal-error recovery', () => {
  beforeEach(() => {
    useModelerStore.setState({ tree: box, lastValidTree: box, projectName: 'Bracket' });
  });

  it('produces a loadable working-document recovery file', async () => {
    const recovery = await buildRecoveryFile();
    expect(recovery?.source).toBe('working document');
    expect(recovery?.filename).toBe('Bracket-recovery.json');
    expect(JSON.parse(recovery!.json)).toMatchObject({ projectName: 'Bracket', tree: { id: 'box' } });
  });

  it('falls back to the last evaluated tree when live serialization fails', async () => {
    const cyclic: any = { ...box, id: 'cyclic' };
    cyclic.data = { self: cyclic };
    useModelerStore.setState({ tree: cyclic, lastValidTree: box });

    const recovery = await buildRecoveryFile();
    expect(recovery?.source).toBe('last evaluated document');
    expect(JSON.parse(recovery!.json).tree.id).toBe('box');
  });

  it('never places messages, secrets, geometry, prompts, or query strings in diagnostics', () => {
    const secret = 'sk-secret-token-123456789';
    const geometry = '{"tree":{"data":"mesh-payload"}}';
    const error = new Error(`Bearer ${secret} ${geometry}`);
    error.stack = `Error: ${secret}\n    at save (https://sinter-3d.com/app.js?access_token=${secret}:10:2)`;
    const report = buildDiagnosticReport(error, `\n    at PromptWith${'A'.repeat(100)} (https://sinter-3d.com/app.js#${secret})`);

    expect(report).not.toContain(secret);
    expect(report).not.toContain('mesh-payload');
    expect(report).not.toContain('access_token');
    expect(report).not.toContain('PromptWith');
    expect(JSON.parse(report)).toMatchObject({ error: { category: 'application', name: 'Error' } });
  });
});

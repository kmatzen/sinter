/**
 * One-time migration script. Run on Fly with access to the live SQLite DB
 * and users' stored OAuth tokens, BEFORE switching DNS to Cloudflare Pages.
 *
 *   tsx server/migrate-to-static.ts
 *
 * For each project:
 *   - Reads the file body from Drive/Gist
 *   - Wraps it in the new self-describing envelope { version, thumbnail, tree }
 *   - Renames the Drive file to `{name}.json` / sets the Gist description to `sinter:{name}`
 *   - For Drive projects with a share_token, ensures the file is publicly readable
 *
 * Outputs legacy-shares.json (mapping old share_token -> { provider, id })
 * which the new SPA serves at /legacy-shares.json so old /share/<token>
 * URLs keep working.
 *
 * Safe to re-run: files already in the new envelope (version === 1) are skipped.
 * Per-project failures are logged but don't abort the script.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import db from './db';
import { getStorageProvider, getUserToken } from './storageProviders';

interface ProjectRow {
  id: string;
  user_id: string;
  name: string | null;
  thumbnail: string | null;
  share_token: string | null;
  storage_provider: string | null;
  storage_external_id: string | null;
}

interface LegacyShareEntry {
  provider: 'google' | 'github';
  id: string;
}

const OUTPUT_FILE = path.resolve('public/legacy-shares.json');

async function migrateOne(p: ProjectRow): Promise<{ ok: boolean; reason?: string }> {
  if (!p.storage_provider || !p.storage_external_id) {
    return { ok: false, reason: 'no external storage' };
  }
  if (p.storage_provider !== 'google' && p.storage_provider !== 'github') {
    return { ok: false, reason: `unknown provider ${p.storage_provider}` };
  }
  const provider = getStorageProvider(p.storage_provider);
  const { accessToken } = await getUserToken(p.user_id);

  // Read current body. If it parses as an envelope already, skip rewrite.
  const raw = await provider.read(accessToken, p.storage_external_id);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    return { ok: false, reason: 'body not JSON' };
  }
  const isEnvelope = parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).version === 1;

  if (!isEnvelope) {
    const envelope = {
      version: 1 as const,
      thumbnail: p.thumbnail || null,
      tree: parsed,
    };
    await provider.update(accessToken, p.storage_external_id, JSON.stringify(envelope));
  }

  // Drive supports renaming via setMetadata; the existing provider doesn't
  // expose rename, so we call the Drive API inline. For Gist, update the
  // description in-place.
  const friendlyName = (p.name || 'Untitled').slice(0, 200);
  if (p.storage_provider === 'google') {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${p.storage_external_id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: `${friendlyName}.json` }),
      },
    );
    if (!r.ok) console.warn(`  rename failed: ${r.status} ${await r.text()}`);
  } else {
    const r = await fetch(`https://api.github.com/gists/${p.storage_external_id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description: `sinter:${friendlyName}` }),
    });
    if (!r.ok) console.warn(`  description update failed: ${r.status} ${await r.text()}`);
  }

  // Drive: if shared, ensure public. (Gists are URL-accessible by default.)
  if (p.share_token && p.storage_provider === 'google') {
    try {
      await provider.setPublic(accessToken, p.storage_external_id, true);
    } catch (err: unknown) {
      console.warn(`  setPublic failed:`, err instanceof Error ? err.message : err);
    }
  }

  return { ok: true };
}

async function main() {
  const projects = db
    .prepare(
      'SELECT id, user_id, name, thumbnail, share_token, storage_provider, storage_external_id FROM projects',
    )
    .all() as ProjectRow[];

  console.log(`Migrating ${projects.length} project(s)...`);

  const legacyShares: Record<string, LegacyShareEntry> = {};
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of projects) {
    process.stdout.write(`  ${p.id} (${p.storage_provider} ${p.storage_external_id?.slice(0, 8) ?? '-'}): `);
    try {
      const result = await migrateOne(p);
      if (result.ok) {
        console.log('ok');
        ok++;
      } else {
        console.log(`skipped (${result.reason})`);
        skipped++;
      }
    } catch (err: unknown) {
      console.log(`FAILED — ${err instanceof Error ? err.message : err}`);
      failed++;
      continue;
    }

    if (
      p.share_token &&
      p.storage_external_id &&
      (p.storage_provider === 'google' || p.storage_provider === 'github')
    ) {
      legacyShares[p.share_token] = {
        provider: p.storage_provider,
        id: p.storage_external_id,
      };
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(legacyShares, null, 2));

  console.log('');
  console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}`);
  console.log(`Legacy share map (${Object.keys(legacyShares).length} entries) -> ${OUTPUT_FILE}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Copy public/legacy-shares.json out of the Fly machine (e.g. fly ssh sftp).');
  console.log('  2. Commit it to the repo so Cloudflare Pages serves it at /legacy-shares.json.');
}

main().catch((err) => {
  console.error('Migration aborted:', err);
  process.exit(1);
});

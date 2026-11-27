import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMockRig } from '../schema/mockRig';
import { parseWingSnap } from '../parser/wingSnapParser';
import { applySnapMerge } from '../parser/merge';
import {
  buildEmbeddedShareUrl,
  buildKioskReadOnlyUrl,
  buildMainAppUrl,
  decodeRigPayload,
  encodeRigPayload,
  parseShareModeFromLocation,
} from './shareLink';

describe('shareLink', () => {
  it('detects normal editable mode when no share hash or query param is set', () => {
    expect(parseShareModeFromLocation({ search: '', hash: '' })).toEqual({
      lockedReadOnly: false,
      source: 'none',
      encodedPayload: null,
    });
    expect(parseShareModeFromLocation({ search: '?foo=bar', hash: '#section' })).toEqual({
      lockedReadOnly: false,
      source: 'none',
      encodedPayload: null,
    });
  });

  it('detects locked read-only mode from query params', () => {
    for (const search of ['?mode=view', '?mode=readonly', '?readonly=1', '?readonly=true', '?view=readonly']) {
      expect(parseShareModeFromLocation({ search, hash: '' })).toEqual({
        lockedReadOnly: true,
        source: 'query',
        encodedPayload: null,
      });
    }
  });

  it('detects embedded shared rig payload from hash and gives hash priority over query', () => {
    expect(parseShareModeFromLocation({ search: '', hash: '#view=v1.abc_123-XYZ' })).toEqual({
      lockedReadOnly: true,
      source: 'embedded',
      encodedPayload: 'v1.abc_123-XYZ',
    });
    expect(
      parseShareModeFromLocation({ search: '?mode=view', hash: '#foo=1&view=v1.payload99&bar=2' }),
    ).toEqual({
      lockedReadOnly: true,
      source: 'embedded',
      encodedPayload: 'v1.payload99',
    });
  });

  it('round-trips the demo RigDocument losslessly with deflate-raw compression', async () => {
    const mock = createMockRig();
    mock.name = 'Sunday Main Rig — WIP';
    mock.annotations.nodes['stage-wing'] = {
      ...mock.annotations.nodes['stage-wing'],
      friendlyName: 'Stage WING (Custom)',
      notes: 'Keep AES50-A locked to 48kHz internal clock.',
      position: { x: 412, y: 188 },
    };

    const encoded = await encodeRigPayload(mock);
    expect(encoded.compressed).toBe(true);
    expect(encoded.payload.startsWith('v1.')).toBe(true);
    expect(encoded.payload.length).toBeLessThan(encoded.rawJsonLength / 4);

    const decoded = await decodeRigPayload(encoded.payload);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.rig).toEqual(mock);
    }
  });

  it('round-trips a full SHC-Monitor.snap merged dual-WING RigDocument losslessly', async () => {
    const snapPath = path.resolve(process.cwd(), 'fixtures/snapshots/SHC-Monitor.snap');
    const rawSnap = fs.readFileSync(snapPath, 'utf8');
    const parsed = parseWingSnap(rawSnap, {
      fileName: 'SHC-Monitor.snap',
      consoleNodeId: 'stage-wing',
    });
    const merged = applySnapMerge(createMockRig(), parsed, 'stage-wing').rig;

    const result = await buildEmbeddedShareUrl(
      merged,
      'https://chortt.github.io/horton-apps-public/wing-rig/?mode=view#old',
    );
    expect(result.url.startsWith('https://chortt.github.io/horton-apps-public/wing-rig/#view=v1.')).toBe(true);

    const parsedUrl = new URL(result.url);
    const mode = parseShareModeFromLocation({ search: parsedUrl.search, hash: parsedUrl.hash });
    expect(mode.lockedReadOnly).toBe(true);
    expect(mode.source).toBe('embedded');
    if (mode.source === 'embedded') {
      const decoded = await decodeRigPayload(mode.encodedPayload);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        expect(decoded.rig).toEqual(merged);
      }
    }
  });

  it('supports uncompressed v1u fallback payload decoding', async () => {
    const mock = createMockRig();
    const encoded = await encodeRigPayload(mock, { forceUncompressed: true });
    expect(encoded.compressed).toBe(false);
    expect(encoded.payload.startsWith('v1u.')).toBe(true);

    const decoded = await decodeRigPayload(encoded.payload);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.rig).toEqual(mock);
    }
  });

  it('rejects empty, truncated, corrupted, or schema-invalid payloads gracefully', async () => {
    const emptyRes = await decodeRigPayload('');
    expect(emptyRes.ok).toBe(false);

    const unknownPrefix = await decodeRigPayload('v9.abc');
    expect(unknownPrefix.ok).toBe(false);

    const mock = createMockRig();
    const encoded = await encodeRigPayload(mock);
    const truncated = encoded.payload.slice(0, Math.floor(encoded.payload.length / 2));
    const truncRes = await decodeRigPayload(truncated);
    expect(truncRes.ok).toBe(false);

    const badSchemaPayload = `v1u.${Buffer.from(JSON.stringify({ schemaVersion: 1, name: 'broken' })).toString('base64url')}`;
    const badSchemaRes = await decodeRigPayload(badSchemaPayload);
    expect(badSchemaRes.ok).toBe(false);
  });

  it('builds clean kiosk and main app URLs without stale params or hashes', () => {
    expect(
      buildKioskReadOnlyUrl('https://chortt.github.io/horton-apps-public/wing-rig/?foo=1#view=abc'),
    ).toBe('https://chortt.github.io/horton-apps-public/wing-rig/?mode=view');
    expect(
      buildMainAppUrl('https://chortt.github.io/horton-apps-public/wing-rig/?mode=view#view=abc'),
    ).toBe('https://chortt.github.io/horton-apps-public/wing-rig/');
  });
});

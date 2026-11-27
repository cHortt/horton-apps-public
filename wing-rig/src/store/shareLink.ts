import type { RigDocument } from '../schema/rig';
import { validateRigDocument } from '../schema/helpers';

export const SHARE_HASH_KEY = 'view';
export const PAYLOAD_PREFIX_DEFLATE = 'v1.';
export const PAYLOAD_PREFIX_PLAIN = 'v1u.';

// Defensive cap on decompressed JSON bytes to guard against malformed payloads
const MAX_DECOMPRESSED_BYTES = 5 * 1024 * 1024;

export type ShareSource = 'none' | 'embedded' | 'query';

export type ShareModeInfo =
  | { lockedReadOnly: false; source: 'none'; encodedPayload: null }
  | { lockedReadOnly: true; source: 'embedded'; encodedPayload: string }
  | { lockedReadOnly: true; source: 'query'; encodedPayload: null };

export interface ShareUrlResult {
  url: string;
  payloadLength: number;
  rawJsonLength: number;
  compressed: boolean;
}

/**
 * Inspects URL query/hash parameters to determine if the app should boot
 * into Locked Read-Only Viewer Mode.
 *
 * Supported formats:
 * - `#view=v1.<base64url>` (or `#view=v1u.<base64url>`): self-contained shared rig snapshot
 * - `?mode=view`, `?mode=readonly`, `?readonly=1`, `?readonly=true`: locked read-only view
 */
export function parseShareModeFromLocation(locationLike: {
  search: string;
  hash: string;
}): ShareModeInfo {
  const rawHash = locationLike.hash.startsWith('#')
    ? locationLike.hash.slice(1)
    : locationLike.hash;

  if (rawHash.length > 0) {
    for (const part of rawHash.split('&')) {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) continue;
      const key = part.slice(0, eqIdx);
      if (key === SHARE_HASH_KEY) {
        const value = part.slice(eqIdx + 1).trim();
        return {
          lockedReadOnly: true,
          source: 'embedded',
          encodedPayload: decodeURIComponent(value),
        };
      }
    }
  }

  const params = new URLSearchParams(locationLike.search);
  const mode = (params.get('mode') ?? '').toLowerCase();
  const readonly = (params.get('readonly') ?? '').toLowerCase();
  const viewParam = (params.get('view') ?? '').toLowerCase();

  if (
    mode === 'view' ||
    mode === 'readonly' ||
    readonly === '1' ||
    readonly === 'true' ||
    viewParam === 'readonly'
  ) {
    return {
      lockedReadOnly: true,
      source: 'query',
      encodedPayload: null,
    };
  }

  return {
    lockedReadOnly: false,
    source: 'none',
    encodedPayload: null,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(base64url: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(base64url)) {
    throw new Error('Invalid characters in shared link payload.');
  }
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Shared rig payload exceeds maximum supported size.');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.byteLength;
  }
  return result;
}

async function compressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const writePromise = writer.write(new Uint8Array(data)).then(() => writer.close());
  const readPromise = readStreamWithLimit(cs.readable, MAX_DECOMPRESSED_BYTES);
  const [, compressed] = await Promise.all([writePromise, readPromise]);
  return compressed;
}

async function decompressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const writePromise = writer.write(new Uint8Array(data)).then(() => writer.close());
  const readPromise = readStreamWithLimit(ds.readable, MAX_DECOMPRESSED_BYTES);
  const [, decompressed] = await Promise.all([writePromise, readPromise]);
  return decompressed;
}

/**
 * Encodes a canonical RigDocument into a compact, URL-safe hash payload.
 * Uses browser-native deflate-raw CompressionStream when available, with an
 * uncompressed UTF-8 base64url fallback.
 */
export async function encodeRigPayload(
  rig: RigDocument,
  options?: { forceUncompressed?: boolean },
): Promise<{ payload: string; rawJsonLength: number; compressed: boolean }> {
  const json = JSON.stringify(rig);
  const rawBytes = new TextEncoder().encode(json);

  if (!options?.forceUncompressed && typeof CompressionStream === 'function') {
    const compressedBytes = await compressDeflateRaw(rawBytes);
    return {
      payload: `${PAYLOAD_PREFIX_DEFLATE}${bytesToBase64Url(compressedBytes)}`,
      rawJsonLength: rawBytes.byteLength,
      compressed: true,
    };
  }

  return {
    payload: `${PAYLOAD_PREFIX_PLAIN}${bytesToBase64Url(rawBytes)}`,
    rawJsonLength: rawBytes.byteLength,
    compressed: false,
  };
}

/**
 * Decodes and validates a shared RigDocument payload from a `#view=...` hash.
 */
export async function decodeRigPayload(
  payload: string,
): Promise<{ ok: true; rig: RigDocument } | { ok: false; error: string }> {
  const trimmed = payload.trim();
  if (!trimmed) {
    return { ok: false, error: 'The shared link is missing rig data.' };
  }

  try {
    let jsonBytes: Uint8Array;
    if (trimmed.startsWith(PAYLOAD_PREFIX_DEFLATE)) {
      if (typeof DecompressionStream !== 'function') {
        return {
          ok: false,
          error: 'This browser does not support DecompressionStream to open compressed share links.',
        };
      }
      const compressed = base64UrlToBytes(trimmed.slice(PAYLOAD_PREFIX_DEFLATE.length));
      jsonBytes = await decompressDeflateRaw(compressed);
    } else if (trimmed.startsWith(PAYLOAD_PREFIX_PLAIN)) {
      jsonBytes = base64UrlToBytes(trimmed.slice(PAYLOAD_PREFIX_PLAIN.length));
    } else {
      return {
        ok: false,
        error: 'Unrecognized shared link format. Ask the sender for a fresh share link.',
      };
    }

    const jsonText = new TextDecoder().decode(jsonBytes);
    const parsed = JSON.parse(jsonText) as unknown;
    const validation = validateRigDocument(parsed);
    if (!validation.valid) {
      return {
        ok: false,
        error: `Shared rig data is invalid (${validation.issues[0]?.message ?? 'schema mismatch'}).`,
      };
    }

    return { ok: true, rig: parsed as RigDocument };
  } catch {
    return {
      ok: false,
      error:
        'Could not decode this shared rig link. It may have been truncated by a messaging app — ask the sender for a fresh link.',
    };
  }
}

/**
 * Builds a clean, self-contained Read-Only share URL embedding the current RigDocument
 * inside the URL fragment (`#view=v1....`) so zero data is ever sent to any server.
 */
export async function buildEmbeddedShareUrl(
  rig: RigDocument,
  baseHref: string,
): Promise<ShareUrlResult> {
  const { payload, rawJsonLength, compressed } = await encodeRigPayload(rig);
  const url = new URL(baseHref);
  url.search = '';
  url.hash = `${SHARE_HASH_KEY}=${payload}`;
  return {
    url: url.toString(),
    payloadLength: payload.length,
    rawJsonLength,
    compressed,
  };
}

/**
 * Builds a short Read-Only Kiosk URL (`?mode=view`) for locking the current browser/device
 * into Read-Only Viewer Mode without embedding rig data in the URL.
 */
export function buildKioskReadOnlyUrl(baseHref: string): string {
  const url = new URL(baseHref);
  url.search = '';
  url.hash = '';
  url.searchParams.set('mode', 'view');
  return url.toString();
}

/**
 * Strips share query/hash parameters to build the base editable app URL.
 */
export function buildMainAppUrl(baseHref: string): string {
  const url = new URL(baseHref);
  url.search = '';
  url.hash = '';
  return url.toString();
}

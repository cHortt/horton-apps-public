// Read and write zip packages. Unchanged entries keep their original compressed
// bytes, so a MuseScore export can replace the score XML without repacking
// styles, thumbnails, or the other sidecars.

import { deflateSync, inflateSync } from "./fflate.mjs";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;

export function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== CENTRAL) fail();
    const versionMade = view.getUint16(cursor + 4, true);
    const versionNeeded = view.getUint16(cursor + 6, true);
    const flag = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const time = view.getUint16(cursor + 12, true);
    const date = view.getUint16(cursor + 14, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const internalAttr = view.getUint16(cursor + 36, true);
    const externalAttr = view.getUint32(cursor + 38, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLen);
    const centralExtra = bytes.slice(cursor + 46 + nameLen, cursor + 46 + nameLen + extraLen);
    const comment = bytes.slice(cursor + 46 + nameLen + extraLen, cursor + 46 + nameLen + extraLen + commentLen);
    cursor += 46 + nameLen + extraLen + commentLen;
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("Could not read that zip file.");
    }
    const local = readLocal(bytes, view, localOffset, nameBytes);
    entries.push({
      name: new TextDecoder("utf-8").decode(nameBytes),
      nameBytes,
      versionMade,
      versionNeeded,
      flag,
      method,
      time,
      date,
      crc,
      compressed: bytes.slice(local.dataStart, local.dataStart + compressedSize),
      uncompressedSize,
      localExtra: local.extra,
      centralExtra,
      comment,
      internalAttr,
      externalAttr,
    });
  }
  return entries;
}

function readLocal(bytes, view, offset, nameBytes) {
  if (view.getUint32(offset, true) !== LOCAL) fail();
  const flag = view.getUint16(offset + 6, true);
  const method = view.getUint16(offset + 8, true);
  const nameLen = view.getUint16(offset + 26, true);
  const extraLen = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLen + extraLen;
  if (flag & 1) fail();
  if (method !== 0 && method !== 8) fail();
  const localName = bytes.slice(offset + 30, offset + 30 + nameLen);
  if (!sameBytes(localName, nameBytes) && !(flag & 0x8)) {
    // The central directory is the source of truth for the name. A mismatch
    // without a data descriptor still uses the central name.
  }
  return { extra: bytes.slice(offset + 30 + nameLen, dataStart), dataStart };
}

export function entryData(entry) {
  if (entry.method === 0) return entry.compressed;
  if (entry.method !== 8) fail();
  const data = inflateSync(entry.compressed);
  if ((crc32(data) >>> 0) !== (entry.crc >>> 0)) fail();
  return data;
}

export function writeZip(entries) {
  const prepared = entries.map(prepareEntry);
  let total = 22;
  for (const entry of prepared) {
    total += 30 + entry.nameBytes.length + entry.localExtra.length + entry.compressed.length;
    total += 46 + entry.nameBytes.length + entry.centralExtra.length + entry.comment.length;
  }
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const offsets = [];
  let cursor = 0;
  for (const entry of prepared) {
    offsets.push(cursor);
    cursor = writeLocal(out, view, cursor, entry);
  }
  const centralStart = cursor;
  for (let i = 0; i < prepared.length; i++) cursor = writeCentral(out, view, cursor, prepared[i], offsets[i]);
  writeEocd(view, cursor, prepared.length, centralStart, cursor - centralStart);
  if (cursor + 22 !== out.length) fail();
  return out;
}

function prepareEntry(entry) {
  if (!entry.data) return entry;
  const data = entry.data;
  const compressed = data.length ? deflateSync(data) : data;
  return {
    ...entry,
    method: data.length ? 8 : 0,
    flag: (entry.flag & ~0x0008) | 0x0800,
    crc: crc32(data) >>> 0,
    compressed,
    uncompressedSize: data.length,
    nameBytes: entry.nameBytes || new TextEncoder().encode(entry.name),
    localExtra: entry.localExtra || new Uint8Array(0),
    centralExtra: entry.centralExtra || new Uint8Array(0),
    comment: entry.comment || new Uint8Array(0),
    versionMade: entry.versionMade || 20,
    versionNeeded: 20,
    time: entry.time || 0,
    date: entry.date || 0,
    internalAttr: entry.internalAttr || 0,
    externalAttr: entry.externalAttr || 0,
  };
}

function writeLocal(out, view, offset, entry) {
  view.setUint32(offset, LOCAL, true);
  view.setUint16(offset + 4, entry.versionNeeded, true);
  view.setUint16(offset + 6, entry.flag, true);
  view.setUint16(offset + 8, entry.method, true);
  view.setUint16(offset + 10, entry.time, true);
  view.setUint16(offset + 12, entry.date, true);
  view.setUint32(offset + 14, entry.crc, true);
  view.setUint32(offset + 18, entry.compressed.length, true);
  view.setUint32(offset + 22, entry.uncompressedSize, true);
  view.setUint16(offset + 26, entry.nameBytes.length, true);
  view.setUint16(offset + 28, entry.localExtra.length, true);
  let cursor = offset + 30;
  out.set(entry.nameBytes, cursor);
  cursor += entry.nameBytes.length;
  out.set(entry.localExtra, cursor);
  cursor += entry.localExtra.length;
  out.set(entry.compressed, cursor);
  return cursor + entry.compressed.length;
}

function writeCentral(out, view, offset, entry, localOffset) {
  view.setUint32(offset, CENTRAL, true);
  view.setUint16(offset + 4, entry.versionMade, true);
  view.setUint16(offset + 6, entry.versionNeeded, true);
  view.setUint16(offset + 8, entry.flag, true);
  view.setUint16(offset + 10, entry.method, true);
  view.setUint16(offset + 12, entry.time, true);
  view.setUint16(offset + 14, entry.date, true);
  view.setUint32(offset + 16, entry.crc, true);
  view.setUint32(offset + 20, entry.compressed.length, true);
  view.setUint32(offset + 24, entry.uncompressedSize, true);
  view.setUint16(offset + 28, entry.nameBytes.length, true);
  view.setUint16(offset + 30, entry.centralExtra.length, true);
  view.setUint16(offset + 32, entry.comment.length, true);
  view.setUint16(offset + 34, 0, true);
  view.setUint16(offset + 36, entry.internalAttr, true);
  view.setUint32(offset + 38, entry.externalAttr, true);
  view.setUint32(offset + 42, localOffset, true);
  let cursor = offset + 46;
  out.set(entry.nameBytes, cursor);
  cursor += entry.nameBytes.length;
  out.set(entry.centralExtra, cursor);
  cursor += entry.centralExtra.length;
  out.set(entry.comment, cursor);
  return cursor + entry.comment.length;
}

function writeEocd(view, offset, count, centralStart, centralSize) {
  view.setUint32(offset, EOCD, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, count, true);
  view.setUint16(offset + 10, count, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true);
}

function findEocd(bytes) {
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 0x05 || bytes[i + 3] !== 0x06) continue;
    const commentLen = bytes[i + 20] | (bytes[i + 21] << 8);
    if (i + 22 + commentLen === bytes.length) return i;
  }
  fail();
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function fail() {
  throw new Error("Could not read that zip file.");
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

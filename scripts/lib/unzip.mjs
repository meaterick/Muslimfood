// Minimal ZIP reader for large public-data archives: lists entries from the
// central directory and streams one entry at a time (stored or deflated),
// so a 350 MB archive never has to fit in memory.

import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

async function readAt(fh, position, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/** Entries of a ZIP file: { name, method, compressedSize, size, offset }. */
export async function listZip(file) {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65557);
    const tail = await readAt(fh, size - tailLen, tailLen);
    let at = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) {
        at = i;
        break;
      }
    }
    if (at < 0) throw new Error('not a ZIP file (no end of central directory)');
    let count = tail.readUInt16LE(at + 10);
    let cdSize = tail.readUInt32LE(at + 12);
    let cdOffset = tail.readUInt32LE(at + 16);
    // ZIP64: the real values live in the ZIP64 end record.
    if (at >= 20 && tail.readUInt32LE(at - 20) === ZIP64_LOCATOR) {
      const recOffset = Number(tail.readBigUInt64LE(at - 20 + 8));
      const rec = await readAt(fh, recOffset, 56);
      if (rec.readUInt32LE(0) === ZIP64_EOCD) {
        count = Number(rec.readBigUInt64LE(32));
        cdSize = Number(rec.readBigUInt64LE(40));
        cdOffset = Number(rec.readBigUInt64LE(48));
      }
    }
    const cd = await readAt(fh, cdOffset, cdSize);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== CENTRAL) throw new Error('corrupt central directory');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let entrySize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const nameBuf = cd.subarray(p + 46, p + 46 + nameLen);
      // Bit 11: UTF-8 names; older Korean archives use CP949.
      const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'euc-kr').decode(nameBuf);
      // ZIP64 extra field (id 1) holds sizes/offset that do not fit in 32 bits.
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 1) {
          let q = e + 4;
          if (entrySize === 0xffffffff) (entrySize = Number(cd.readBigUInt64LE(q))), (q += 8);
          if (compressedSize === 0xffffffff) (compressedSize = Number(cd.readBigUInt64LE(q))), (q += 8);
          if (offset === 0xffffffff) offset = Number(cd.readBigUInt64LE(q));
        }
        e += 4 + len;
      }
      entries.push({ name, method, compressedSize, size: entrySize, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/** A readable stream of one entry's uncompressed bytes. */
export async function openEntry(file, entry) {
  const fh = await open(file, 'r');
  let start;
  try {
    const head = await readAt(fh, entry.offset, 30);
    if (head.readUInt32LE(0) !== LOCAL) throw new Error(`bad local header for ${entry.name}`);
    start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  } finally {
    await fh.close();
  }
  if (entry.compressedSize === 0) return Readable.from([]);
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`unsupported compression ${entry.method} for ${entry.name}`);
  const raw = createReadStream(file, { start, end: start + entry.compressedSize - 1 });
  if (entry.method === 0) return raw;
  const inflate = createInflateRaw();
  raw.on('error', (err) => inflate.destroy(err));
  return raw.pipe(inflate);
}

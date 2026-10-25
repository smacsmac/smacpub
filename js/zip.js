/* Lecteur ZIP minimal pour les EPUB.
   Aucune dépendance : la décompression utilise DecompressionStream, natif dans Chrome. */
"use strict";

class ZipArchive {
  constructor(bytes, entries) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.entries = entries; // Map nom -> entrée
    this.lower = new Map();
    for (const name of entries.keys()) this.lower.set(name.toLowerCase(), name);
  }

  static async open(source) {
    const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    // Fin du répertoire central (EOCD), cherchée depuis la fin du fichier.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Ce fichier n'est pas une archive EPUB valide.");

    let count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    if (offset === 0xffffffff || count === 0xffff) {
      const loc = eocd - 20; // ZIP64
      if (loc >= 0 && view.getUint32(loc, true) === 0x07064b50) {
        const z = Number(view.getBigUint64(loc + 8, true));
        if (view.getUint32(z, true) === 0x06064b50) {
          count = Number(view.getBigUint64(z + 32, true));
          offset = Number(view.getBigUint64(z + 48, true));
        }
      }
    }

    const entries = new Map();
    let p = offset;
    for (let n = 0; n < count && p + 46 <= bytes.length; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      let csize = view.getUint32(p + 20, true);
      let usize = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      let local = view.getUint32(p + 42, true);
      const name = ZipArchive.decodeName(bytes.subarray(p + 46, p + 46 + nameLen), flags);

      if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff) {
        let e = p + 46 + nameLen;
        const end = e + extraLen;
        while (e + 4 <= end) {
          const id = view.getUint16(e, true), size = view.getUint16(e + 2, true);
          if (id === 0x0001) {
            let q = e + 4;
            if (usize === 0xffffffff) { usize = Number(view.getBigUint64(q, true)); q += 8; }
            if (csize === 0xffffffff) { csize = Number(view.getBigUint64(q, true)); q += 8; }
            if (local === 0xffffffff) { local = Number(view.getBigUint64(q, true)); }
          }
          e += 4 + size;
        }
      }
      if (!name.endsWith("/")) entries.set(name.replace(/\\/g, "/").replace(/^\/+/, ""), { method, csize, usize, local });
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (!entries.size) throw new Error("Archive EPUB vide ou illisible.");
    return new ZipArchive(bytes, entries);
  }

  static decodeName(bytes, flags) {
    if (flags & 0x800) return new TextDecoder("utf-8").decode(bytes);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return new TextDecoder("windows-1252").decode(bytes); }
  }

  /** Nom réel d'une entrée (tolère la casse et l'encodage d'URL des vieux EPUB). */
  resolve(path) {
    if (!path) return null;
    if (this.entries.has(path)) return path;
    let alt = path;
    try { alt = decodeURIComponent(path); } catch { /* ignore */ }
    if (this.entries.has(alt)) return alt;
    return this.lower.get(path.toLowerCase()) || this.lower.get(alt.toLowerCase()) || null;
  }

  has(path) { return this.resolve(path) !== null; }

  names() { return [...this.entries.keys()]; }

  /** Données (encore compressées) d'une entrée. */
  raw(name) {
    const e = this.entries.get(name), v = this.view;
    if (v.getUint32(e.local, true) !== 0x04034b50) throw new Error("Entrée ZIP corrompue : " + name);
    const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
    return { e, data: this.bytes.subarray(start, start + e.csize) };
  }

  /** Contenu décompressé (Uint8Array) ou null si absent. */
  async read(path) {
    const name = this.resolve(path);
    if (!name) return null;
    const { e, data } = this.raw(name);
    if (e.method === 0) return data.slice();
    if (e.method !== 8) throw new Error("Compression non prise en charge : " + name);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Les n premiers octets d'une entrée, sans tout décompresser (pour lire la taille d'une image). */
  async head(path, n) {
    const name = this.resolve(path);
    if (!name) return null;
    const { e, data } = this.raw(name);
    if (e.method === 0) return data.subarray(0, n);
    if (e.method !== 8) return null;
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const out = new Uint8Array(n);
    let got = 0;
    while (got < n) {
      const { value, done } = await reader.read();
      if (done) break;
      const k = Math.min(value.length, n - got);
      out.set(value.subarray(0, k), got);
      got += k;
    }
    reader.cancel().catch(() => {});
    return out.subarray(0, got);
  }
}

/** Écriture d'un ZIP sans compression (les images le sont déjà) : sert à convertir les CBR. */
const ZipWriter = {
  crc32(data) {
    let t = ZipWriter.table;
    if (!t) {
      t = ZipWriter.table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  },

  /** entries : [{ name, data: Uint8Array }] → Blob (assemblé par morceaux, sans gros tampon unique). */
  store(entries, type) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const { name, data } of entries) {
      const nb = enc.encode(name), crc = this.crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, nb.length, true);
      parts.push(local.buffer, nb, data);
      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
      dir.setUint32(16, crc, true); dir.setUint32(20, data.length, true); dir.setUint32(24, data.length, true);
      dir.setUint16(28, nb.length, true); dir.setUint32(42, offset, true);
      central.push(dir.buffer, nb);
      offset += 30 + nb.length + data.length;
    }
    const size = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: type || "application/zip" });
  },
};

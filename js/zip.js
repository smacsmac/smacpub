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

  /** Contenu décompressé (Uint8Array) ou null si absent. */
  async read(path) {
    const name = this.resolve(path);
    if (!name) return null;
    const e = this.entries.get(name);
    const v = this.view;
    if (v.getUint32(e.local, true) !== 0x04034b50) throw new Error("Entrée ZIP corrompue : " + name);
    const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
    const data = this.bytes.subarray(start, start + e.csize);
    if (e.method === 0) return data.slice();
    if (e.method !== 8) throw new Error("Compression non prise en charge : " + name);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
}

/* Bandes dessinées : CBZ (images dans un ZIP) et CBR (images dans un RAR, converti en ZIP à l'import).
   Une BD se présente au lecteur comme un livre dont chaque « chapitre » est une planche :
   la couverture seule, puis les pages deux par deux (une image large, double page, reste seule).
   En mode une page, une planche de deux pages se lit en deux pages ; en mode deux pages,
   elles s'affichent côte à côte. */
"use strict";

const ComicUtil = {
  IMAGE: /\.(jpe?g|jfif|png|gif|webp|avif|bmp)$/i,

  /** Type d'archive d'après ses premiers octets (l'extension ment souvent : beaucoup de .cbr sont des ZIP). */
  kind(bytes) {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip";
    if (bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) return "rar";
    if (bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf) return "7z";
    return null;
  },

  /** Une page de BD : une image, hors fichiers cachés et dossiers parasites (__MACOSX…). */
  isPage(name) {
    return this.IMAGE.test(name) && !/(^|\/)(__MACOSX\/|\.)/i.test(name);
  },

  /** Tri « naturel » : page2 avant page10. */
  sort(names) {
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return names.sort((a, b) => coll.compare(a, b));
  },

  /** Largeur et hauteur d'une image (JPEG, PNG, GIF, WebP, BMP) lues dans ses premiers octets. */
  size(b) {
    if (!b || b.length < 30) return null;
    const be16 = (i) => (b[i] << 8) | b[i + 1];
    const be32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const le16 = (i) => b[i] | (b[i + 1] << 8);
    const le24 = (i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
    if (b[0] === 0x89 && b[1] === 0x50) return { w: be32(16), h: be32(20) };
    if (b[0] === 0x47 && b[1] === 0x49) return { w: le16(6), h: le16(8) };
    if (b[0] === 0x42 && b[1] === 0x4d) return { w: le16(18), h: Math.abs(new DataView(b.buffer, b.byteOffset).getInt32(22, true)) };
    if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) { // RIFF…WEBP
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === "VP8X") return { w: le24(24) + 1, h: le24(27) + 1 };
      if (chunk === "VP8 ") return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
      if (chunk === "VP8L") {
        const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    if (b[0] === 0xff && b[1] === 0xd8) { // JPEG : premier marqueur SOFn
      let i = 2;
      while (i + 8 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: be16(i + 5), w: be16(i + 7) };
        i += 2 + be16(i + 2);
      }
    }
    return null;
  },

  /** Planches : la couverture seule, puis deux pages par planche ; une double page reste seule. */
  spreads(pages) {
    const out = [];
    let i = 0;
    if (pages.length) out.push([i++]);
    while (i < pages.length) {
      if (pages[i].wide || i + 1 >= pages.length || pages[i + 1].wide) out.push([i++]);
      else { out.push([i, i + 1]); i += 2; }
    }
    return out;
  },

  /** Charge le décompresseur RAR (js/unrar.js) la première fois qu'on en a besoin. */
  loadUnrar() {
    if (window.SmacUnrar) return Promise.resolve();
    if (!this.loading) {
      this.loading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "js/unrar.js";
        s.onload = () => resolve();
        s.onerror = () => { this.loading = null; reject(new Error("Le décompresseur RAR (js/unrar.js) est introuvable.")); };
        document.head.append(s);
      });
    }
    return this.loading;
  },

  /** CBR → ZIP (sans compression) : on extrait les images une seule fois, à l'import.
      Le fichier d'origine n'est pas modifié ; c'est cette copie lisible qui est rangée dans la bibliothèque. */
  async rarToZip(buffer, onProgress) {
    await this.loadUnrar();
    if (!this.wasm) this.wasm = Uint8Array.from(atob(window.SMAC_UNRAR_WASM), (c) => c.charCodeAt(0)).buffer;
    let extractor;
    try {
      extractor = await window.SmacUnrar.createExtractorFromData({ wasmBinary: this.wasm, data: buffer });
      const wanted = new Set();
      for (const h of extractor.getFileList().fileHeaders) {
        if (!h.flags.directory && (this.isPage(h.name) || /(^|\/)comicinfo\.xml$/i.test(h.name))) wanted.add(h.name);
      }
      if (![...wanted].some((n) => this.isPage(n))) throw new Error("Aucune image trouvée dans ce fichier.");
      const entries = [];
      for (const f of extractor.extract({ files: (h) => wanted.has(h.name) }).files) {
        if (f.extraction) entries.push({ name: f.fileHeader.name.replace(/\\/g, "/"), data: f.extraction });
        // libère la copie gardée par l'extracteur, au fur et à mesure
        try { delete extractor.dataFiles[extractor.getExtractedFileName(f.fileHeader.name)]; } catch { /* sans importance */ }
        if (onProgress) onProgress(entries.length, wanted.size);
        if (entries.length % 8 === 0) await new Promise((r) => setTimeout(r));
      }
      return ZipWriter.store(entries, "application/vnd.comicbook+zip");
    } catch (err) {
      const reason = err && err.reason;
      if (reason === "ERAR_MISSING_PASSWORD" || reason === "ERAR_BAD_PASSWORD") throw new Error("Ce fichier est protégé par un mot de passe.");
      if (reason === "ERAR_BAD_DATA" || reason === "ERAR_BAD_ARCHIVE" || reason === "ERAR_UNKNOWN_FORMAT") throw new Error("Archive RAR endommagée ou illisible.");
      throw err;
    }
  },
};

class Comic {
  constructor(zip, names) {
    this.zip = zip;
    this.names = names;
    this.urls = new Map();
  }

  static async open(source) {
    const zip = await ZipArchive.open(source);
    const names = ComicUtil.sort(zip.names().filter((n) => ComicUtil.isPage(n)));
    if (!names.length) throw new Error("Aucune image trouvée : ce n'est pas une bande dessinée.");
    const comic = new Comic(zip, names);
    await comic.parse();
    return comic;
  }

  async parse() {
    // Orientation de chaque page : une image plus large que haute est une double page.
    this.pages = [];
    for (const name of this.names) {
      const s = ComicUtil.size(await this.zip.head(name, 65536).catch(() => null));
      this.pages.push({ name, wide: !!(s && s.w > s.h * 1.1) });
    }
    this.groups = ComicUtil.spreads(this.pages);
    this.firstPage = [];
    let n = 0;
    for (const g of this.groups) { this.firstPage.push(n); n += g.length; }
    this.spine = this.groups.map((_, i) => ({ path: "planche-" + i, type: "comic" }));
    this.coverPath = this.names[0];
    this.metadata = { title: "", authors: [], language: "", publisher: "", date: "", description: "" };
    await this.readInfo();

    // Sommaire : un dossier = un chapitre ; sinon, une entrée par page.
    const chapterOf = (p) => this.groups.findIndex((g) => g.includes(p));
    const dir = (name) => name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
    const dirs = [...new Set(this.names.map(dir))];
    this.toc = dirs.length > 1
      ? dirs.map((d) => {
        const p = this.names.findIndex((name) => dir(name) === d);
        const label = (d.split("/").pop() || "Pages").replace(/[_]+/g, " ");
        return { label, index: chapterOf(p), frag: "smac-p" + (p + 1), depth: 0 };
      })
      : this.names.map((_, p) => ({ label: p === 0 ? "Couverture" : "Page " + (p + 1), index: chapterOf(p), frag: "smac-p" + (p + 1), depth: 0 }));
  }

  /** ComicInfo.xml (format répandu) : titre, série, numéro, auteurs. */
  async readInfo() {
    const name = this.zip.names().find((n) => /(^|\/)comicinfo\.xml$/i.test(n));
    if (!name) return;
    const doc = EpubUtil.parseXml(EpubUtil.decodeText(await this.zip.read(name)));
    if (!doc) return;
    const get = (tag) => EpubUtil.clean(EpubUtil.all(doc, tag)[0]?.textContent);
    const series = get("Series"), number = get("Number"), title = get("Title");
    const head = series ? series + (number ? " n° " + number : "") : "";
    const md = this.metadata;
    md.title = head && title ? `${head} — ${title}` : title || head;
    md.authors = [...new Set([get("Writer"), get("Penciller")].flatMap((s) => s.split(/\s*[,;]\s*/)).filter(Boolean))].slice(0, 4);
    md.language = get("LanguageISO");
    md.publisher = get("Publisher");
    md.date = get("Year");
    md.description = get("Summary");
  }

  get pageCount() { return this.pages.length; }

  /** Numéro (à partir de 1) de la page affichée, d'après la planche et l'image visible. */
  pageNumber(index, media) { return (this.firstPage[index] || 0) + (media || 0) + 1; }

  mimeOf(name) {
    return MIME[(name.split(".").pop() || "").toLowerCase()] || "image/jpeg";
  }

  async coverBlob() {
    const bytes = await this.zip.read(this.coverPath);
    return bytes ? new Blob([bytes], { type: this.mimeOf(this.coverPath) }) : null;
  }

  resourceUrl(name) {
    if (!this.urls.has(name)) {
      this.urls.set(name, this.zip.read(name)
        .then((bytes) => (bytes ? URL.createObjectURL(new Blob([bytes], { type: this.mimeOf(name) })) : null))
        .catch(() => null));
    }
    return this.urls.get(name);
  }

  /** Prépare les images de la planche suivante pour que la page se tourne sans attente. */
  preload(index) {
    const g = this.groups[index];
    if (!g) return;
    for (const p of g) {
      this.resourceUrl(this.pages[p].name).then((url) => {
        if (!url) return;
        const img = new Image();
        img.src = url;
        img.decode().catch(() => {});
      });
    }
  }

  async renderData(index) {
    const doc = document.implementation.createHTMLDocument("");
    const group = this.groups[index] || [];
    doc.body.className = "smac-comic";
    for (const [k, p] of group.entries()) {
      const page = doc.createElement("div");
      page.className = "smac-comic-page " + (group.length === 1 ? "smac-comic-alone" : k === 0 ? "smac-comic-left" : "smac-comic-right");
      page.id = "smac-p" + (p + 1);
      const img = doc.createElement("img");
      img.alt = "";
      img.src = (await this.resourceUrl(this.pages[p].name)) || "";
      page.append(img);
      doc.body.append(page);
    }
    this.preload(index + 1);
    return { body: doc.body, styles: [Comic.CSS], lang: "", dir: "", htmlClass: "" };
  }

  /** Une planche n'a pas de texte : pas de recherche, et la progression se compte en pages. */
  async chapterText() { return ""; }

  async lengths() { return this.groups.map((g) => g.length); }

  indexOf() { return -1; }

  destroy() {
    for (const p of this.urls.values()) p.then((u) => u && URL.revokeObjectURL(u));
    this.urls.clear();
  }
}

/* Mise en page d'une planche (confinée au livre par BookCss, comme les styles d'un EPUB).
   Chaque page occupe une colonne entière, l'image y est centrée ; une page seule (couverture,
   double page) s'étale sur toute la largeur. En double page, les deux pages se touchent au milieu. */
Comic.CSS = `
.smac-comic-page { height: calc(var(--smac-vh) * 100); margin: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; break-inside: avoid; }
.smac-comic-page img { display: block; width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; }
.smac-comic-alone { column-span: all; }
:root[data-cols="2"] .smac-comic-left { justify-content: flex-end; }
:root[data-cols="2"] .smac-comic-right { justify-content: flex-start; }
`;

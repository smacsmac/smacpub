/* Lecture d'un EPUB (2 ou 3) : métadonnées, ordre de lecture, sommaire, couverture, chapitres.
   Le fichier d'origine n'est jamais modifié : tout est interprété à la volée. */
"use strict";

const XLINK_NS = "http://www.w3.org/1999/xlink";
const OPS_NS = "http://www.idpf.org/2007/ops";

const MIME = {
  xhtml: "application/xhtml+xml", html: "text/html", htm: "text/html", xml: "application/xml",
  css: "text/css", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
  mp3: "audio/mpeg", mp4: "video/mp4", m4a: "audio/mp4", ogg: "audio/ogg", webm: "video/webm",
};

const EpubUtil = {
  /** Décode du texte en respectant BOM et encodage déclaré ; repli sur windows-1252 pour les vieux fichiers. */
  decodeText(bytes) {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
    const m = head.match(/<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i) || head.match(/<meta[^>]*charset\s*=\s*["']?([\w.:-]+)/i);
    const attempt = (label, fatal) => {
      try { return new TextDecoder(label, { fatal }).decode(bytes); } catch { return null; }
    };
    if (m && !/^utf-?8$/i.test(m[1])) {
      const t = attempt(m[1], false);
      if (t !== null) return t;
    }
    return attempt("utf-8", true) ?? new TextDecoder("windows-1252").decode(bytes);
  },

  /** Résout un lien relatif à un fichier de l'archive → { path, frag } ou { external }. */
  resolve(base, href) {
    href = (href || "").trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { external: href };
    const encodedBase = base.split("/").map(encodeURIComponent).join("/");
    const u = new URL(href, "https://epub.invalid/" + encodedBase);
    const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
    return { path: dec(u.pathname.slice(1)), frag: dec(u.hash.slice(1)) };
  },

  parseXml(text) {
    const doc = new DOMParser().parseFromString(text.replace(/^﻿/, "").trimStart(), "application/xml");
    return doc.getElementsByTagName("parsererror").length ? null : doc;
  },

  /** Analyse un chapitre : XHTML strict si possible, sinon HTML tolérant. */
  parseHtml(text, preferHtml) {
    text = text.replace(/^﻿/, "");
    if (!preferHtml) {
      const doc = new DOMParser().parseFromString(text.trimStart(), "application/xhtml+xml");
      if (!doc.getElementsByTagName("parsererror").length && doc.body) return doc;
    }
    return new DOMParser().parseFromString(text, "text/html");
  },

  /** Éléments par nom local (indifférent aux espaces de noms et préfixes). */
  all(root, name) {
    if (!root) return [];
    const out = [];
    for (const el of root.getElementsByTagName("*")) {
      const ln = el.localName;
      if (ln === name || ln.endsWith(":" + name)) out.push(el);
    }
    return out;
  },

  kids(root, name) {
    return root ? [...root.children].filter((el) => el.localName === name || el.localName.endsWith(":" + name)) : [];
  },

  clean(s) { return (s || "").replace(/\s+/g, " ").trim(); },

  /** Nœuds texte d'un chapitre, dans l'ordre (hors <script>/<style>). Base commune au rendu et à la recherche. */
  textNodes(root) {
    const nodes = [];
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentNode && n.parentNode.localName;
      if (p !== "script" && p !== "style") nodes.push(n);
    }
    return nodes;
  },

  /** Texte « plié » pour une recherche insensible à la casse, aux accents et aux apostrophes typographiques. */
  fold(text) {
    const cache = EpubUtil._foldCache || (EpubUtil._foldCache = new Map());
    let out = "", prev = "";
    const map = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      let f = cache.get(ch);
      if (f === undefined) {
        if (/\s/.test(ch)) f = " ";
        else if ("’‘ʼ`´".includes(ch)) f = "'";
        else if ("«»“”„".includes(ch)) f = '"';
        else if (ch === "œ" || ch === "Œ") f = "oe";
        else if (ch === "æ" || ch === "Æ") f = "ae";
        else f = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        cache.set(ch, f);
      }
      if (f === " " && prev === " ") continue;
      if (f) prev = f[f.length - 1];
      out += f;
      for (let k = 0; k < f.length; k++) map.push(i);
    }
    map.push(text.length);
    return { text: out, map };
  },
};

class Epub {
  constructor(zip) {
    this.zip = zip;
    this.urls = new Map();     // chemin -> Promise<blob URL>
    this.css = new Map();      // chemin -> Promise<texte CSS réécrit>
    this.texts = new Map();    // index -> texte du chapitre
  }

  static async open(source) {
    const epub = new Epub(await ZipArchive.open(source));
    await epub.parse();
    return epub;
  }

  async readText(path) {
    const bytes = await this.zip.read(path);
    return bytes ? EpubUtil.decodeText(bytes) : null;
  }

  async readXml(path) {
    const text = await this.readText(path);
    if (text === null) return null;
    return EpubUtil.parseXml(text) || new DOMParser().parseFromString(text, "text/html");
  }

  async parse() {
    const U = EpubUtil;
    let opfPath = null;
    const container = await this.readXml("META-INF/container.xml");
    if (container) {
      const root = U.all(container, "rootfile").find((r) => /\.opf$/i.test(r.getAttribute("full-path") || ""))
        || U.all(container, "rootfile")[0];
      opfPath = root && root.getAttribute("full-path");
    }
    if (!opfPath || !this.zip.has(opfPath)) opfPath = this.zip.names().find((n) => /\.opf$/i.test(n));
    if (!opfPath) throw new Error("Impossible de trouver la description du livre (fichier OPF).");
    this.opfPath = this.zip.resolve(opfPath);
    const opf = await this.readXml(this.opfPath);
    if (!opf) throw new Error("Description du livre illisible.");

    // Métadonnées
    const md = U.all(opf, "metadata")[0] || opf;
    const first = (name) => U.clean(U.all(md, name)[0]?.textContent);
    const description = first("description");
    this.metadata = {
      title: first("title"),
      authors: [...new Set(U.all(md, "creator").map((e) => U.clean(e.textContent)).filter(Boolean))].slice(0, 4),
      language: first("language"),
      publisher: first("publisher"),
      date: first("date"),
      description: description ? new DOMParser().parseFromString(description, "text/html").body.textContent.trim() : "",
    };

    // Manifeste
    this.manifest = new Map();
    this.byPath = new Map();
    for (const el of U.all(opf, "item")) {
      const href = el.getAttribute("href");
      if (!href) continue;
      const r = U.resolve(this.opfPath, href);
      if (r.external) continue;
      const item = {
        id: el.getAttribute("id") || "",
        path: this.zip.resolve(r.path) || r.path,
        type: (el.getAttribute("media-type") || "").toLowerCase(),
        props: (el.getAttribute("properties") || "").split(/\s+/),
      };
      this.manifest.set(item.id, item);
      this.byPath.set(item.path, item);
    }

    // Ordre de lecture (spine)
    const spineEl = U.all(opf, "spine")[0];
    const readable = (it) => it && this.zip.has(it.path) && (!it.type || /html|xml|image\//.test(it.type) || /\.x?html?$/i.test(it.path));
    this.spine = [];
    for (const ref of U.all(spineEl, "itemref")) {
      const it = this.manifest.get(ref.getAttribute("idref"));
      if (readable(it) && !this.spine.some((s) => s.path === it.path)) this.spine.push({ path: it.path, type: it.type });
    }
    if (!this.spine.length) {
      for (const it of this.manifest.values()) {
        if (/html/.test(it.type) && !it.props.includes("nav") && this.zip.has(it.path)) this.spine.push({ path: it.path, type: it.type });
      }
    }
    if (!this.spine.length) throw new Error("Ce livre ne contient aucun chapitre lisible.");
    this.spineIndex = new Map(this.spine.map((s, i) => [s.path, i]));

    this.toc = await this.parseToc(opf, spineEl);
    this.coverPath = await this.findCover(opf);
    if (!this.metadata.title) this.metadata.title = "";
  }

  /** Index du chapitre correspondant à un chemin, ou -1. */
  indexOf(path) {
    const real = this.zip.resolve(path);
    const i = real !== null ? this.spineIndex.get(real) : undefined;
    return i === undefined ? -1 : i;
  }

  async parseToc(opf, spineEl) {
    const U = EpubUtil;
    let entries = [];
    const add = (label, base, href, depth) => {
      if (!href) return;
      const r = U.resolve(base, href);
      if (r.external) return;
      const index = this.indexOf(r.path);
      if (index < 0) return;
      entries.push({ label: U.clean(label) || "Sans titre", index, frag: r.frag, depth });
    };

    // EPUB 3 : document de navigation
    const navItem = [...this.manifest.values()].find((it) => it.props.includes("nav"));
    if (navItem) {
      const text = await this.readText(navItem.path);
      if (text) {
        const doc = EpubUtil.parseHtml(text, false);
        const navs = U.all(doc, "nav");
        const typeOf = (n) => n.getAttributeNS(OPS_NS, "type") || n.getAttribute("epub:type") || "";
        const nav = navs.find((n) => typeOf(n).split(/\s+/).includes("toc")) || navs[0];
        const walk = (ol, depth) => {
          for (const li of U.kids(ol, "li")) {
            const a = U.kids(li, "a")[0] || U.kids(li, "span")[0];
            if (a) add(a.textContent, navItem.path, a.getAttribute("href"), depth);
            const sub = U.kids(li, "ol")[0];
            if (sub) walk(sub, depth + 1);
          }
        };
        const ol = nav && U.all(nav, "ol")[0];
        if (ol) walk(ol, 0);
      }
    }

    // EPUB 2 : NCX
    if (!entries.length) {
      const ncxId = spineEl && spineEl.getAttribute("toc");
      const ncxItem = (ncxId && this.manifest.get(ncxId)) || [...this.manifest.values()].find((it) => it.type === "application/x-dtbncx+xml" || /\.ncx$/i.test(it.path));
      const ncx = ncxItem && (await this.readXml(ncxItem.path));
      if (ncx) {
        const walk = (parent, depth) => {
          for (const np of U.kids(parent, "navPoint")) {
            const label = U.kids(np, "navLabel")[0];
            const content = U.kids(np, "content")[0];
            add(label ? label.textContent : "", ncxItem.path, content && content.getAttribute("src"), depth);
            walk(np, depth + 1);
          }
        };
        walk(U.all(ncx, "navMap")[0], 0);
      }
    }

    // Aucun sommaire exploitable : on en génère un à partir des titres des chapitres.
    if (!entries.length) {
      for (let i = 0; i < this.spine.length; i++) {
        const text = (await this.readText(this.spine[i].path)) || "";
        const m = text.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i) || text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const label = m ? U.clean(m[1].replace(/<[^>]+>/g, " ")) : "";
        if (label) entries.push({ label, index: i, frag: "", depth: 0 });
      }
      if (!entries.length) entries = this.spine.map((_, i) => ({ label: "Section " + (i + 1), index: i, frag: "", depth: 0 }));
    }
    return entries;
  }

  async findCover(opf) {
    const U = EpubUtil;
    const items = [...this.manifest.values()];
    const isImage = (it) => it && (/^image\//.test(it.type) || /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(it.path)) && this.zip.has(it.path);

    let item = items.find((it) => it.props.includes("cover-image"));
    if (isImage(item)) return item.path;
    const meta = U.all(opf, "meta").find((m) => m.getAttribute("name") === "cover");
    const id = meta && meta.getAttribute("content");
    item = id && (this.manifest.get(id) || this.byPath.get(this.zip.resolve(U.resolve(this.opfPath, id).path)));
    if (isImage(item)) return item.path;
    item = items.find((it) => isImage(it) && /cover|couv/i.test(it.id + " " + it.path));
    if (item) return item.path;

    // Pages de couverture HTML : on prend leur première image.
    const pages = [];
    const ref = U.all(opf, "reference").find((r) => /cover/i.test(r.getAttribute("type") || ""));
    if (ref) pages.push(U.resolve(this.opfPath, ref.getAttribute("href") || "").path);
    for (const it of items) if (/html/.test(it.type) && /cover|couv/i.test(it.id + " " + it.path)) pages.push(it.path);
    pages.push(this.spine[0].path);
    for (const page of pages) {
      const text = page && (await this.readText(page));
      if (!text) continue;
      const m = text.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i) || text.match(/<image[^>]+href\s*=\s*["']([^"']+)["']/i);
      if (!m) continue;
      const bodyText = text.replace(/<head[\s\S]*?<\/head>/i, "").replace(/<[^>]+>/g, "").trim();
      if (page === this.spine[0].path && bodyText.length > 300) continue;
      const path = this.zip.resolve(U.resolve(page, m[1]).path);
      if (path) return path;
    }
    return null;
  }

  mimeOf(path) {
    const it = this.byPath.get(path);
    if (it && it.type) return it.type;
    return MIME[(path.split(".").pop() || "").toLowerCase()] || "application/octet-stream";
  }

  async coverBlob() {
    if (!this.coverPath) return null;
    const bytes = await this.zip.read(this.coverPath);
    return bytes ? new Blob([bytes], { type: this.mimeOf(this.coverPath) }) : null;
  }

  /** Adresse blob: d'une ressource de l'archive (image, police…), créée une seule fois. */
  resourceUrl(path) {
    const name = this.zip.resolve(path);
    if (!name) return Promise.resolve(null);
    if (!this.urls.has(name)) {
      this.urls.set(name, (async () => {
        const type = this.mimeOf(name);
        const body = type === "text/css" ? await this.cssText(name) : await this.zip.read(name);
        return URL.createObjectURL(new Blob([body], { type }));
      })().catch(() => null));
    }
    return this.urls.get(name);
  }

  cssText(path, depth = 0) {
    const name = this.zip.resolve(path);
    if (!name) return Promise.resolve("");
    if (!this.css.has(name)) {
      this.css.set(name, this.readText(name).then((t) => this.rewriteCss(t || "", name, depth)).catch(() => ""));
    }
    return this.css.get(name);
  }

  /** Réécrit une feuille de style : ressources → blob:, @import intégrés, tailles fixes → relatives. */
  async rewriteCss(css, base, depth = 0) {
    const replaceAsync = async (str, re, fn) => {
      const parts = [];
      let last = 0;
      for (const m of str.matchAll(re)) {
        parts.push(str.slice(last, m.index), fn(...m));
        last = m.index + m[0].length;
      }
      parts.push(str.slice(last));
      return (await Promise.all(parts)).join("");
    };
    css = await replaceAsync(css, /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/gi, async (m, href) => {
      const r = EpubUtil.resolve(base, href);
      return !r.external && depth < 4 ? await this.cssText(r.path, depth + 1) : "";
    });
    css = await replaceAsync(css, /url\(\s*(["']?)([^"')]+)\1\s*\)/gi, async (m, q, href) => {
      if (/^(data|blob):/i.test(href) || href.startsWith("#")) return m;
      const r = EpubUtil.resolve(base, href);
      if (r.external) return m;
      const url = await this.resourceUrl(r.path);
      return url ? `url("${url}")` : m;
    });
    // Tailles de police absolues (pt, px) → rem : les réglages A−/A+ restent efficaces.
    return css.replace(/(font-size\s*:\s*)([\d.]+)(pt|px)\b/gi, (m, prop, n, unit) =>
      prop + (+(parseFloat(n) / (unit.toLowerCase() === "pt" ? 12 : 16)).toFixed(3)) + "rem");
  }

  /** Document d'un chapitre, nettoyé (sans scripts). Identique pour le rendu et la recherche. */
  async chapterDocument(index) {
    const item = this.spine[index];
    let doc;
    if (/^image\//.test(item.type)) {
      doc = document.implementation.createHTMLDocument("");
      const img = doc.createElement("img");
      img.setAttribute("src", item.path.split("/").pop());
      img.className = "smac-full-image";
      doc.body.append(img);
    } else {
      const text = (await this.readText(item.path)) || "";
      doc = EpubUtil.parseHtml(text, /html?$/.test(item.type) && !/xhtml/.test(item.type));
    }
    for (const el of [...doc.getElementsByTagName("script")]) el.remove();
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_CDATA_SECTION | NodeFilter.SHOW_PROCESSING_INSTRUCTION);
    const odd = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) odd.push(n);
    for (const n of odd) n.nodeType === Node.CDATA_SECTION_NODE ? n.replaceWith(doc.createTextNode(n.data)) : n.remove();
    return doc;
  }

  async chapterText(index) {
    if (!this.texts.has(index)) {
      const doc = await this.chapterDocument(index);
      this.texts.set(index, doc.body ? EpubUtil.textNodes(doc.body).map((n) => n.data).join("") : "");
    }
    return this.texts.get(index);
  }

  /** Longueur (en caractères) de chaque chapitre : sert au calcul du pourcentage lu. */
  async lengths(onProgress) {
    const out = [];
    for (let i = 0; i < this.spine.length; i++) {
      out.push((await this.chapterText(i)).length);
      if (onProgress) onProgress(i + 1, this.spine.length);
    }
    this.texts.clear();
    return out;
  }

  /** Chapitre prêt à afficher : styles réécrits, images en blob:, liens internes repérés. */
  async renderData(index) {
    const path = this.spine[index].path;
    const doc = await this.chapterDocument(index);
    const U = EpubUtil;
    const styles = [];
    const styleEls = [...doc.getElementsByTagName("*")].filter((el) => el.localName === "link" || el.localName === "style");
    for (const el of styleEls) {
      if (el.localName === "style") styles.push(this.rewriteCss(el.textContent, path));
      else if (/stylesheet/i.test(el.getAttribute("rel") || "") && !/alternate/i.test(el.getAttribute("rel"))) {
        const r = U.resolve(path, el.getAttribute("href"));
        if (!r.external) styles.push(this.cssText(r.path));
      }
      el.remove();
    }

    const body = doc.body;
    const jobs = [];
    const swap = (el, attr, ns) => {
      const value = ns ? el.getAttributeNS(ns, "href") || el.getAttribute("href") : el.getAttribute(attr);
      if (!value) return;
      const r = U.resolve(path, value);
      if (r.external) return;
      jobs.push(this.resourceUrl(r.path).then((url) => {
        if (!url) return;
        if (ns) { el.setAttributeNS(XLINK_NS, "xlink:href", url); el.setAttribute("href", url); }
        else el.setAttribute(attr, url);
      }));
    };
    for (const el of body.getElementsByTagName("*")) {
      switch (el.localName) {
        case "img": swap(el, "src"); el.removeAttribute("srcset"); el.removeAttribute("loading"); break;
        case "image": swap(el, "href", XLINK_NS); break;
        case "video": swap(el, "src"); swap(el, "poster"); break;
        case "audio": case "source": case "track": swap(el, "src"); break;
        case "a": {
          const href = el.getAttribute("href") || el.getAttributeNS(XLINK_NS, "href");
          if (!href) break;
          const r = U.resolve(path, href);
          if (r.external) el.setAttribute("data-smac-external", r.external);
          else el.setAttribute("data-smac-link", JSON.stringify({ index: this.indexOf(r.path), frag: r.frag }));
          break;
        }
      }
      const style = el.getAttribute("style");
      if (style && /url\(/i.test(style)) jobs.push(this.rewriteCss(style, path).then((s) => el.setAttribute("style", s)));
    }
    const [css] = await Promise.all([Promise.all(styles), Promise.all(jobs)]);
    const html = doc.documentElement;
    return {
      body,
      styles: css,
      lang: html.getAttribute("lang") || html.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang") || "",
      dir: html.getAttribute("dir") || "",
      htmlClass: html.getAttribute("class") || "",
    };
  }

  destroy() {
    for (const p of this.urls.values()) p.then((u) => u && URL.revokeObjectURL(u));
    this.urls.clear();
    this.css.clear();
    this.texts.clear();
  }
}

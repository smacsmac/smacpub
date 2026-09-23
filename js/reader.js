/* Affichage paginé d'un EPUB dans une iframe isolée (colonnes CSS).
   Une position est { index (chapitre), char (caractère dans le chapitre), media? } :
   elle ne dépend ni de la taille du texte ni de celle de la fenêtre. */
"use strict";

class Reader {
  constructor(stage, epub, opts) {
    this.stage = stage;
    this.epub = epub;
    this.opts = opts;
    this.settings = opts.settings;
    this.index = -1;
    this.page = 0;
    this.pages = 1;
    this.anchor = { char: 0 };
    this.queue = Promise.resolve();
    this.loadToken = 0;
    this.folded = new Map();
    this.wheelLast = 0;
    this.wheelAcc = 0;
    const lengths = opts.lengths && opts.lengths.length === epub.spine.length ? opts.lengths : null;
    this.prefix = [0];
    if (lengths) for (const n of lengths) this.prefix.push(this.prefix[this.prefix.length - 1] + n);
    this.total = lengths ? this.prefix[this.prefix.length - 1] : 0;
  }

  async init() {
    const f = document.createElement("iframe");
    f.className = "book-frame";
    f.setAttribute("sandbox", "allow-same-origin"); // aucun script du livre ne s'exécute
    f.setAttribute("title", "Contenu du livre");
    f.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
    const loaded = new Promise((r) => f.addEventListener("load", r, { once: true }));
    this.stage.prepend(f);
    await loaded;
    this.frame = f;
    this.doc = f.contentDocument;
    this.win = f.contentWindow;
    const fonts = this.doc.createElement("style");
    fonts.textContent = window.SMAC_FONT_CSS || "";
    this.userStyle = this.doc.createElement("style");
    this.doc.head.append(fonts, this.userStyle);
    this.range = this.doc.createRange();
    this.bind();
    this.resizer = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.relayout(), 120);
    });
    this.resizer.observe(this.stage);
  }

  bind() {
    const d = this.doc;
    const toStage = (e) => [e.clientX + this.frame.offsetLeft, e.clientY + this.frame.offsetTop];
    d.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a");
      if (a && (a.hasAttribute("data-smac-link") || a.hasAttribute("data-smac-external"))) {
        e.preventDefault();
        this.follow(a);
        return;
      }
      if (a) e.preventDefault();
      if (!this.win.getSelection().isCollapsed || this.swiped) return;
      this.opts.onTap && this.opts.onTap(...toStage(e), this.pointerType);
    });
    d.addEventListener("pointerdown", (e) => {
      this.pointerType = e.pointerType;
      this.swipeStart = [e.clientX, e.clientY];
      this.swiped = false;
    });
    d.addEventListener("pointerup", (e) => {
      if (!this.swipeStart || e.pointerType === "mouse") return;
      const dx = e.clientX - this.swipeStart[0], dy = e.clientY - this.swipeStart[1];
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        this.swiped = true;
        dx < 0 ? this.next() : this.prev();
      }
      this.swipeStart = null;
    });
    d.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    d.addEventListener("keydown", (e) => this.opts.onKey && this.opts.onKey(e));
    d.addEventListener("mousemove", (e) => this.opts.onPointerMove && this.opts.onPointerMove(...toStage(e)));
    this.win.addEventListener("scroll", () => {
      const se = this.doc.scrollingElement;
      if (Math.abs(se.scrollLeft - this.page * this.W) > 1) se.scrollLeft = this.page * this.W;
      if (se.scrollTop) se.scrollTop = 0;
    });
  }

  follow(a) {
    const ext = a.getAttribute("data-smac-external");
    if (ext) {
      if (/^https?:/i.test(ext)) window.open(ext, "_blank", "noopener");
      return;
    }
    let target;
    try { target = JSON.parse(a.getAttribute("data-smac-link")); } catch { return; }
    if (target.index < 0) return;
    const from = this.location();
    this.display(target.frag ? { index: target.index, frag: target.frag } : { index: target.index, page: 0 })
      .then(() => this.opts.onLink && this.opts.onLink(from));
  }

  /* ---------- Mise en page ---------- */

  setSettings(settings) {
    this.settings = settings;
    return this.relayout();
  }

  relayout() {
    return this.run(() => {
      if (!this.doc || this.index < 0) return;
      this.layout();
      this.measure();
      this.setPage(this.pageOfAnchor(this.anchor), this.anchor);
    });
  }

  layout() {
    const s = this.settings;
    const sw = this.stage.clientWidth, sh = this.stage.clientHeight;
    const compact = sw < 700;
    const pad = compact ? 20 : 28;
    const measure = s.fontSize * ({ narrow: 28, medium: 34, wide: 44 }[s.width] || 34);
    const room = sw - (compact ? 0 : 112);
    const textW = Math.max(160, Math.min(measure, room - 2 * pad));
    const W = Math.round(textW + 2 * pad);
    const top = sh < 520 ? 44 : 64, bottom = sh < 520 ? 36 : 52;
    const H = Math.max(160, sh - top - bottom);
    this.W = W;
    this.H = H;
    this.pad = pad;
    Object.assign(this.frame.style, {
      width: W + "px", height: H + "px", left: Math.round((sw - W) / 2) + "px", top: top + "px",
    });
    const css = this.css();
    if (this.userStyle.textContent !== css) this.userStyle.textContent = css; // évite une remise en page inutile
  }

  measure() {
    this.pages = Math.max(1, Math.round(this.doc.scrollingElement.scrollWidth / this.W));
  }

  css() {
    const s = this.settings, t = s.colors, W = this.W, H = this.H, P = this.pad;
    const family = { literata: '"Literata", Georgia, serif', sans: 'system-ui, Roboto, "Noto Sans", "Segoe UI", sans-serif' }[s.font];
    return `
html {
  margin: 0 !important; padding: 0 ${P}px !important; border: 0 !important; box-sizing: content-box !important;
  width: auto !important; min-width: 0 !important; max-width: none !important;
  height: ${H}px !important; min-height: 0 !important; max-height: none !important;
  column-width: ${W - 2 * P}px !important; column-gap: ${2 * P}px !important; column-fill: auto !important;
  column-count: auto !important; column-rule: none !important;
  overflow: hidden !important; writing-mode: horizontal-tb !important;
  font-size: ${s.fontSize}px !important; color: ${t.fg}; background: transparent !important;
  color-scheme: ${t.dark ? "dark" : "light"}; -webkit-text-size-adjust: none; text-size-adjust: none;
  overflow-wrap: break-word;
}
body {
  margin: 0 !important; padding: 0 !important; border: 0 !important;
  width: auto !important; min-width: 0 !important; max-width: none !important;
  height: auto !important; min-height: 0 !important; max-height: none !important;
  overflow: visible !important; position: static !important; float: none !important;
  columns: auto !important; transform: none !important; background: transparent !important;
  line-height: ${s.lineHeight};
}
${family ? `html body, html body *:not(pre, code, kbd, samp, tt, pre *) { font-family: ${family} !important; }` : ""}
html body p, html body li, html body blockquote, html body dd, html body div { line-height: ${s.lineHeight} !important; }
${s.justify ? `html body p:not([align], [style*="text-align"], [class*="center"], [class*="right"]) { text-align: justify !important; -webkit-hyphens: auto; hyphens: auto; }` : ""}
img, svg, video, canvas { max-width: 100% !important; max-height: ${H}px !important; object-fit: contain; box-sizing: border-box; }
img, svg, figure, video, pre, tr { break-inside: avoid; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; }
pre { white-space: pre-wrap !important; }
table { max-width: 100%; }
a { color: ${t.link}; }
.smac-full-image { display: block; margin: 0 auto; }
::selection { background: ${t.selection}; }
::highlight(smac-search) { background-color: ${t.highlight}; color: inherit; }
${t.forceBg ? "html body *:not(img, svg, video) { background-color: transparent !important; }" : ""}
${t.forceColor ? `html body *:not(img, svg, video) { color: inherit !important; border-color: ${t.line} !important; }
html body a, html body a * { color: ${t.link} !important; }` : ""}
`;
  }
  /* ---------- Chargement d'un chapitre ---------- */

  /** Analyse un chapitre. Les très longs (vieux EPUB « tout en un fichier ») sont découpés
      en parties affichées une à une ; les positions restent comptées sur le chapitre entier. */
  async prepare(index) {
    const data = await this.epub.renderData(index);
    const body = data.body;
    const nodes = EpubUtil.textNodes(body);
    const starts = [];
    let length = 0;
    for (const n of nodes) { starts.push(length); length += n.data.length; }

    // Conteneur à découper : on descend dans les enveloppes uniques (<div class="book">…).
    let container = body;
    for (;;) {
      const els = [...container.children];
      const loose = [...container.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.data));
      if (els.length !== 1 || loose || !/^(div|section|article|main)$/.test(els[0].localName)) break;
      container = els[0];
    }
    const kids = [...container.childNodes];
    const isMedia = (el) => /^(img|svg|video)$/.test(el.localName) && !(el.parentElement && el.parentElement.closest("svg"));
    const lenOf = (k) => (k.nodeType === 3 ? k.data.length : k.nodeType === 1 ? k.textContent.length : 0);
    const mediaOf = (k) => (k.nodeType === 1 ? (isMedia(k) ? 1 : 0) + [...k.querySelectorAll("img, svg, video")].filter(isMedia).length : 0);

    const first = nodes.findIndex((n) => container.contains(n));
    const parts = [];
    let part = { a: 0, base: first < 0 ? length : starts[first], mediaBase: 0, len: 0 };
    const LIMIT = 60000;
    if (length > LIMIT * 1.5) {
      kids.forEach((k, i) => {
        const heading = k.nodeType === 1 && /^h[1-3]$/.test(k.localName);
        if (i > part.a && (part.len >= LIMIT || (heading && part.len >= LIMIT / 3))) {
          parts.push({ ...part, b: i });
          part = { a: i, base: part.base + part.len, mediaBase: part.mediaBase + part.media, len: 0 };
        }
        part.len += lenOf(k);
        part.media = (part.media || 0) + mediaOf(k);
      });
    }
    parts.push({ ...part, b: kids.length });

    // Fragment (#ancre) → partie, et position des entrées du sommaire dans ce chapitre.
    const ids = new Map();
    parts.forEach((p, n) => {
      for (let i = p.a; i < p.b; i++) {
        const k = kids[i];
        if (k.nodeType !== 1) continue;
        for (const el of [k, ...k.querySelectorAll("[id], [name]")]) {
          for (const v of [el.getAttribute("id"), el.getAttribute("name")]) if (v && !ids.has(v)) ids.set(v, n);
        }
      }
    });
    const charOf = (el) => {
      let lo = 0, hi = nodes.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (el.compareDocumentPosition(nodes[mid]) & Node.DOCUMENT_POSITION_FOLLOWING) hi = mid;
        else lo = mid + 1;
      }
      return lo < nodes.length ? starts[lo] : length;
    };
    const find = (frag) => body.querySelector(`[id="${CSS.escape(frag)}"], [name="${CSS.escape(frag)}"]`);
    const marks = new Map();
    (this.opts.toc || []).forEach((e, i) => {
      if (e.index !== index) return;
      const el = e.frag && find(e.frag);
      marks.set(i, el ? charOf(el) : 0);
    });
    this.chapter = { index, data, body, container, kids, parts, ids, marks, length };
  }

  async load(index, part) {
    const token = ++this.loadToken;
    const slow = setTimeout(() => this.opts.onLoading && this.opts.onLoading(true), 150);
    try {
      if (!this.chapter || this.chapter.index !== index) {
        this.chapter = null;
        await this.prepare(index);
        if (token !== this.loadToken) return false;
      }
      const ch = this.chapter, data = ch.data, p = ch.parts[part], d = this.doc;
      this.frame.style.visibility = "hidden";
      for (const el of [...d.head.querySelectorAll("style[data-book]")]) el.remove();
      for (const text of data.styles) {
        const el = d.createElement("style");
        el.setAttribute("data-book", "");
        el.textContent = text;
        d.head.insertBefore(el, this.userStyle);
      }
      const html = d.documentElement;
      const lang = data.lang || this.opts.language;
      lang ? html.setAttribute("lang", lang) : html.removeAttribute("lang");
      data.dir ? html.setAttribute("dir", data.dir) : html.removeAttribute("dir");
      html.className = data.htmlClass;
      // <body> et enveloppes copiés sans leur contenu, puis les nœuds de la partie.
      const chain = [];
      for (let el = ch.container; el; el = el === ch.body ? null : el.parentElement) chain.unshift(el);
      const body = d.importNode(chain[0], false);
      let cur = body;
      for (const el of chain.slice(1)) cur = cur.appendChild(d.importNode(el, false));
      for (let i = p.a; i < p.b; i++) cur.appendChild(d.importNode(ch.kids[i], true));
      html.replaceChild(body, d.body);
      if (this.win.CSS && this.win.CSS.highlights) this.win.CSS.highlights.clear();
      this.index = index;
      this.part = part;
      this.base = p.base;
      this.mediaBase = p.mediaBase;
      this.layout();
      await this.settle();
      if (token !== this.loadToken) return false;
      this.collect();
      this.measure();
      this.frame.style.visibility = "";
      return true;
    } finally {
      clearTimeout(slow);
      this.opts.onLoading && this.opts.onLoading(false);
    }
  }

  settle() {
    const pending = [...this.doc.images].filter((i) => !i.complete).map((i) => i.decode().catch(() => {}));
    const timeout = new Promise((r) => setTimeout(r, 3000));
    return Promise.race([Promise.all([Promise.all(pending), this.doc.fonts.ready]), timeout]);
  }

  collect() {
    const nodes = EpubUtil.textNodes(this.doc.body);
    const starts = new Array(nodes.length);
    const vis = [];
    let pos = 0;
    for (let i = 0; i < nodes.length; i++) {
      starts[i] = pos;
      pos += nodes[i].data.length;
      if (/\S/.test(nodes[i].data)) vis.push(i);
    }
    this.nodes = nodes;
    this.starts = starts;
    this.vis = vis;
    this.length = pos; // longueur de la partie affichée
    this.media = [...this.doc.body.querySelectorAll("img, svg, video")].filter((el) => !el.parentElement.closest("svg"));
  }

  isLastPart() { return this.part === this.chapter.parts.length - 1; }

  /** Partie contenant un caractère (position comptée sur tout le chapitre). */
  partOf(char, media) {
    const parts = this.chapter.parts;
    if (media != null) {
      const i = parts.findIndex((p) => media >= p.mediaBase && media < p.mediaBase + (p.media || 0));
      if (i >= 0) return i;
    }
    for (let i = parts.length - 1; i >= 0; i--) if (char >= parts[i].base) return i;
    return 0;
  }

  /* ---------- Géométrie : caractère ↔ page (positions locales à la partie) ---------- */

  scrollX() { return this.doc.scrollingElement.scrollLeft; }

  pageAtX(x) { return Math.min(this.pages - 1, Math.max(0, Math.floor(x / this.W))); }

  /** Page du premier caractère visible à partir de (node, off), ou null. */
  charPage(node, off, backward = false) {
    const r = this.range, len = node.data.length;
    for (let n = 0; n < 48; n++) {
      const o = backward ? off - n : off + n;
      if (o < 0 || o >= len) break;
      r.setStart(node, o);
      r.setEnd(node, o + 1);
      for (const rc of r.getClientRects()) if (rc.height > 0) return this.pageAtX(rc.left + this.scrollX());
    }
    return null;
  }

  elementPage(el) {
    const rc = el.getClientRects()[0];
    return rc ? this.pageAtX(rc.left + this.scrollX()) : null;
  }

  /** Premier caractère situé sur la page p ou après (recherche dichotomique). */
  firstCharOfPage(p) {
    const vis = this.vis, nodes = this.nodes;
    if (!vis.length) return 0;
    const last = (k) => this.charPage(nodes[vis[k]], nodes[vis[k]].data.length - 1, true);
    let lo = 0, hi = vis.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      let pg = last(mid);
      if (pg === null) {
        let j = mid + 1;
        while (j < hi && (pg = last(j)) === null) j++;
        if (pg === null) hi = mid;
        else if (pg < p) lo = j + 1;
        else hi = j;
        continue;
      }
      if (pg < p) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= vis.length) return this.length;
    const k = vis[lo], node = nodes[k];
    let a = 0, b = node.data.length;
    while (a < b) {
      const m = (a + b) >> 1;
      const pg = this.charPage(node, m);
      if (pg === null || pg >= p) b = m;
      else a = m + 1;
    }
    return this.starts[k] + a;
  }

  nodeIndexAt(c) {
    let lo = 0, hi = this.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid] <= c) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - 1);
  }

  pageOfChar(c) {
    if (!this.nodes.length) return 0;
    if (c >= this.length) return this.pages - 1;
    const i = this.nodeIndexAt(c);
    for (let k = i; k < this.nodes.length && k < i + 200; k++) {
      const off = k === i ? c - this.starts[k] : 0;
      if (off >= this.nodes[k].data.length) continue;
      const pg = this.charPage(this.nodes[k], off);
      if (pg !== null) return pg;
    }
    return 0;
  }

  /** Repère stable de la page p : son premier caractère, ou une image si la page n'a pas de texte. */
  anchorForPage(p) {
    const char = this.firstCharOfPage(p);
    const textPage = char < this.length ? this.pageOfChar(char) : this.pages;
    if (textPage > p) {
      const m = this.media.findIndex((el) => this.elementPage(el) === p);
      if (m >= 0) return { char: this.base + char, media: this.mediaBase + m };
    }
    return { char: this.base + char };
  }

  pageOfAnchor(a) {
    const m = a.media != null ? this.media[a.media - this.mediaBase] : null;
    if (m) {
      const pg = this.elementPage(m);
      if (pg !== null) return pg;
    }
    return this.pageOfChar(Math.max(0, (a.char || 0) - this.base));
  }

  findFrag(frag) {
    return this.doc.getElementById(frag) || this.doc.getElementsByName(frag)[0] || null;
  }

  /** Range DOM pour un intervalle (positions du chapitre), dans la partie affichée. */
  rangeFor(start, end) {
    if (!this.nodes.length) return null;
    const at = (c) => {
      c = Math.min(Math.max(0, c - this.base), this.length);
      const i = this.nodeIndexAt(c);
      return [this.nodes[i], Math.min(c - this.starts[i], this.nodes[i].data.length)];
    };
    const r = this.doc.createRange();
    r.setStart(...at(start));
    r.setEnd(...at(end));
    return r;
  }

  /* ---------- Navigation ---------- */

  run(fn) {
    this.queue = this.queue.then(() => (this.destroyed ? null : fn())).catch((err) => {
      console.error(err);
      this.opts.onError && this.opts.onError(err);
    });
    return this.queue;
  }

  /** target : { index, char?, media?, frag?, page?: nombre | "last", part?, snap? } */
  display(target) { return this.run(() => this.go(target)); }

  async go(t) {
    const index = Math.min(Math.max(0, t.index || 0), this.epub.spine.length - 1);
    if (!this.chapter || this.chapter.index !== index) {
      if (!(await this.load(index, 0))) return;
    }
    const parts = this.chapter.parts;
    let part;
    if (t.part != null) part = Math.min(Math.max(0, t.part), parts.length - 1);
    else if (t.page === "last") part = parts.length - 1;
    else if (typeof t.page === "number") part = 0;
    else if (t.frag) part = this.chapter.ids.get(t.frag) ?? 0;
    else part = this.partOf(t.char || 0, t.media);
    if (part !== this.part && !(await this.load(index, part))) return;

    let page, anchor = null;
    if (t.page === "last") page = this.pages - 1;
    else if (typeof t.page === "number") page = Math.min(Math.max(0, t.page), this.pages - 1);
    else if (t.frag) {
      const el = this.findFrag(t.frag);
      page = el ? this.elementPage(el) ?? 0 : 0;
    } else {
      anchor = { char: t.char || 0 };
      if (t.media != null) anchor.media = t.media;
      page = this.pageOfAnchor(anchor);
      if (t.snap) anchor = null; // repère recalé sur le début de la page
    }
    this.setPage(page, anchor || this.anchorForPage(page));
  }

  setPage(p, anchor) {
    this.page = p;
    this.anchor = anchor;
    this.doc.scrollingElement.scrollLeft = p * this.W;
    this.emit();
  }

  next() {
    return this.run(async () => {
      this.via = "next";
      try {
        if (this.page < this.pages - 1) this.setPage(this.page + 1, this.anchorForPage(this.page + 1));
        else if (!this.isLastPart()) await this.go({ index: this.index, part: this.part + 1, page: 0 });
        else if (this.index < this.epub.spine.length - 1) await this.go({ index: this.index + 1, page: 0 });
        else this.opts.onEnd && this.opts.onEnd();
      } finally { this.via = null; }
    });
  }

  prev() {
    return this.run(async () => {
      this.via = "prev";
      try {
        if (this.page > 0) this.setPage(this.page - 1, this.anchorForPage(this.page - 1));
        else if (this.part > 0) await this.go({ index: this.index, part: this.part - 1, page: "last" });
        else if (this.index > 0) await this.go({ index: this.index - 1, page: "last" });
      } finally { this.via = null; }
    });
  }

  /** Molette / pavé tactile : une page par geste. */
  wheel(e) {
    e.preventDefault();
    const now = performance.now();
    if (now - this.wheelLast > 200) { this.wheelAcc = 0; this.wheelDone = false; }
    this.wheelLast = now;
    if (this.wheelDone) return;
    this.wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(this.wheelAcc) >= 40) {
      this.wheelAcc > 0 ? this.next() : this.prev();
      this.wheelDone = true;
    }
  }

  location() {
    const loc = { index: this.index, char: this.anchor.char };
    if (this.anchor.media != null) loc.media = this.anchor.media;
    return loc;
  }

  progressAt(index, char) {
    if (!this.total) return index / this.epub.spine.length;
    return Math.min(1, (this.prefix[index] + char) / this.total);
  }

  /** Position (chapitre + caractère) correspondant à une fraction du livre. */
  locationAt(fraction) {
    if (!this.total) return { index: Math.min(this.epub.spine.length - 1, Math.floor(fraction * this.epub.spine.length)), page: 0 };
    const target = fraction * this.total;
    let i = 0;
    while (i < this.epub.spine.length - 1 && this.prefix[i + 1] <= target) i++;
    return { index: i, char: Math.round(target - this.prefix[i]), snap: true };
  }

  emit() {
    const lastPage = this.page === this.pages - 1;
    const start = this.base + this.firstCharOfPage(this.page);
    const end = this.base + (lastPage ? this.length + (this.isLastPart() ? 1 : 0) : this.firstCharOfPage(this.page + 1));
    const atEnd = this.index === this.epub.spine.length - 1 && this.isLastPart() && lastPage;
    let tocIndex = -1;
    (this.opts.toc || []).forEach((e, i) => {
      if (e.index < this.index || (e.index === this.index && (this.chapter.marks.get(i) ?? 0) < Math.max(end, start + 1))) tocIndex = i;
    });
    const mediaOnPage = [];
    this.media.forEach((el, i) => { if (this.elementPage(el) === this.page) mediaOnPage.push(this.mediaBase + i); });
    // Pages restantes dans le chapitre (estimation pour les parties suivantes).
    let pagesLeft = this.pages - 1 - this.page;
    if (!this.isLastPart()) {
      const perChar = this.pages / Math.max(1, this.length);
      pagesLeft += Math.round((this.chapter.length - this.base - this.length) * perChar);
    }
    this.opts.onRelocate({
      ...this.location(),
      start, end, mediaOnPage, atEnd, tocIndex, pagesLeft, via: this.via || "jump",
      single: this.pages === 1 && this.chapter.parts.length === 1,
      progress: atEnd ? 1 : this.progressAt(this.index, Math.min(this.anchor.char, this.chapter.length)),
    });
  }

  /* ---------- Recherche ---------- */

  async search(query, isStale) {
    const q = EpubUtil.fold(query).text.trim();
    const results = [];
    if (q.length < 2) return results;
    for (let i = 0; i < this.epub.spine.length && results.length < 300; i++) {
      if (isStale && isStale()) return null;
      const text = await this.epub.chapterText(i);
      if (!this.folded.has(i)) this.folded.set(i, EpubUtil.fold(text));
      const f = this.folded.get(i);
      for (let pos = f.text.indexOf(q); pos !== -1 && results.length < 300; pos = f.text.indexOf(q, pos + q.length)) {
        const start = f.map[pos], end = f.map[pos + q.length - 1] + 1;
        results.push({
          index: i, start, end,
          before: text.slice(Math.max(0, start - 60), start), match: text.slice(start, end), after: text.slice(end, end + 80),
        });
      }
      if (i % 8 === 7) await new Promise((r) => setTimeout(r));
    }
    return results;
  }

  async showResult(r) {
    await this.display({ index: r.index, char: r.start });
    const range = this.rangeFor(r.start, r.end);
    if (range && this.win.Highlight && this.win.CSS.highlights) {
      this.win.CSS.highlights.set("smac-search", new this.win.Highlight(range));
    }
  }

  clearHighlight() {
    if (this.win && this.win.CSS && this.win.CSS.highlights) this.win.CSS.highlights.delete("smac-search");
  }

  /** Extrait de texte à partir d'un caractère du chapitre (pour les signets). */
  textFrom(start, max) {
    if (!this.nodes.length) return "";
    let out = "";
    const local = Math.max(0, start - this.base);
    for (let i = this.nodeIndexAt(local), off = local - this.starts[i]; i < this.nodes.length && out.length < max * 2; i++, off = 0) {
      out += this.nodes[i].data.slice(Math.max(0, off));
    }
    out = out.replace(/\s+/g, " ").trim();
    return out.length > max ? out.slice(0, max).replace(/\s+\S*$/, "") + "…" : out;
  }

  focus() { if (this.win) this.win.focus(); }

  destroy() {
    this.destroyed = true;
    this.loadToken++;
    if (this.resizer) this.resizer.disconnect();
    clearTimeout(this.resizeTimer);
    if (this.frame) this.frame.remove();
    this.folded.clear();
    this.chapter = null;
  }
}

/* Affichage paginé d'un EPUB (colonnes CSS), directement dans la page de l'appli.
   Pas d'iframe : les extensions du navigateur (TransOver, dictionnaires…) lisent le texte
   comme sur n'importe quel site. Les styles du livre sont confinés à <smac-root>, et ceux de
   l'appli n'y entrent pas (@scope dans css/app.css).
   Une position est { index (chapitre), char (caractère dans le chapitre), media? } :
   elle ne dépend ni de la taille du texte ni de celle de la fenêtre. */
"use strict";

/* ---------- Feuilles de style du livre, confinées à <smac-root> ---------- */

const BookCss = {
  /** Découpe une liste de sélecteurs aux virgules (hors parenthèses, crochets et chaînes). */
  split(text) {
    const out = [];
    let depth = 0, quote = null, start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === "\\") i++;
      else if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === "," && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
    }
    out.push(text.slice(start));
    return out.map((s) => s.trim()).filter(Boolean);
  },

  /** Fin du premier sélecteur composé (avant un espace ou un combinateur). */
  compoundEnd(s) {
    let depth = 0, quote = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === "\\") i++;
      else if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (depth === 0 && /[\s>+~]/.test(c)) return i;
    }
    return s.length;
  },

  /** html / :root → smac-root, body → smac-body, et tout le reste est placé sous smac-root.
      Renvoie null pour un sélecteur qui ne peut rien viser dans le livre. */
  scope(sel) {
    let rest = sel.trim(), out = "smac-root", comb = " ";
    let end = this.compoundEnd(rest), head = rest.slice(0, end);
    const html = head.match(/^(?:html|:root)(?![\w-])/i);
    if (html) {
      out += head.slice(html[0].length);
      rest = rest.slice(end);
      const c = rest.match(/^\s*([>+~]?)\s*/);
      rest = rest.slice(c[0].length);
      if (!rest) return out;
      if (c[1] === "+" || c[1] === "~") return null;
      comb = c[1] ? " > " : " ";
      end = this.compoundEnd(rest);
      head = rest.slice(0, end);
    }
    const body = head.match(/^body(?![\w-])/i);
    if (body) return out + comb + "smac-body" + head.slice(body[0].length) + rest.slice(end);
    if (html && comb === " > ") return null; // html > x : seul <body> est affiché
    return out + " " + rest;
  },

  /** Unités liées à la racine ou à la fenêtre → variables de la page (réglées par le lecteur).
      Les tailles de police fixes (pt, px) deviennent relatives : A−/A+ restent efficaces. */
  units(style) {
    for (let i = 0; i < style.length; i++) {
      const prop = style[i], v = style.getPropertyValue(prop);
      if (!v || /url\(/i.test(v)) continue;
      let nv = v.replace(/(-?(?:\d+\.?\d*|\.\d+))(rem|vh|vw|vmin|vmax)\b/gi, (m, n, u) => `calc(var(--smac-${u.toLowerCase()}) * ${n})`);
      if (prop === "font-size") {
        nv = nv.replace(/^\s*(\d+\.?\d*|\.\d+)(pt|px)\s*$/i, (m, n, u) =>
          `calc(var(--smac-rem) * ${+(n / (u.toLowerCase() === "pt" ? 12 : 16)).toFixed(4)})`);
      }
      if (nv !== v) style.setProperty(prop, nv, style.getPropertyPriority(prop));
    }
  },

  rules(list, parent) {
    const has = (name) => typeof window[name] !== "undefined";
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r instanceof CSSStyleRule) {
        const before = r.selectorText;
        const parts = this.split(before).map((s) => this.scope(s)).filter(Boolean);
        if (parts.length) r.selectorText = parts.join(", ");
        // Sélecteur impossible à confiner : la règle est supprimée plutôt que de toucher l'appli.
        if (!parts.length || r.selectorText === before) { parent.deleteRule(i); continue; }
        this.units(r.style);
      } else if (r instanceof CSSMediaRule || r instanceof CSSSupportsRule ||
        (has("CSSContainerRule") && r instanceof CSSContainerRule) || (has("CSSLayerBlockRule") && r instanceof CSSLayerBlockRule)) {
        this.rules(r.cssRules, r);
      } else if (!(r instanceof CSSFontFaceRule || r instanceof CSSKeyframesRule || r instanceof CSSNamespaceRule ||
        (has("CSSLayerStatementRule") && r instanceof CSSLayerStatementRule))) {
        parent.deleteRule(i); // @page, @scope, @property… : inutiles ici
      }
    }
  },

  sheet(css) {
    const sheet = new CSSStyleSheet();
    try { sheet.replaceSync(css); } catch { /* feuille illisible : ignorée */ }
    this.rules(sheet.cssRules, sheet);
    return sheet;
  },
};

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
    this.zoom = { s: 1, x: 0, y: 0, ts: 1, tx: 0, ty: 0 };
    this.touches = new Map();
    this.held = new Set();
    this.bookSheets = [];
    this.sheetCache = new Map();
    const lengths = opts.lengths && opts.lengths.length === epub.spine.length ? opts.lengths : null;
    this.prefix = [0];
    if (lengths) for (const n of lengths) this.prefix.push(this.prefix[this.prefix.length - 1] + n);
    this.total = lengths ? this.prefix[this.prefix.length - 1] : 0;
  }

  async init() {
    const view = document.createElement("div");
    view.className = "book-frame";
    view.id = "smac-view";
    view.setAttribute("role", "document");
    view.setAttribute("aria-label", "Contenu du livre");
    this.root = document.createElement("smac-root");
    view.append(this.root);
    this.stage.prepend(view);
    this.frame = view;
    this.userSheet = new CSSStyleSheet();
    this.adopt();
    this.range = document.createRange();
    // Une extension (TransOver…) peut remplacer des nœuds texte (même texte) : on refera la liste.
    this.observer = new MutationObserver(() => { this.stale = true; });
    this.bind();
    this.resizer = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.relayout(), 120);
    });
    this.resizer.observe(this.stage);
  }

  /** Feuilles du livre + réglages de lecture, ajoutées après celles de l'appli. */
  adopt() {
    const mine = new Set([...this.sheetCache.values(), this.userSheet]);
    const others = document.adoptedStyleSheets.filter((s) => !mine.has(s));
    document.adoptedStyleSheets = this.destroyed ? others : [...others, ...this.bookSheets, this.userSheet];
  }

  bind() {
    const v = this.frame;
    const stagePos = (e) => {
      const st = this.stage.getBoundingClientRect();
      return [e.clientX - st.left, e.clientY - st.top];
    };
    v.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a, area");
      if (a && (a.hasAttribute("data-smac-link") || a.hasAttribute("data-smac-external"))) {
        e.preventDefault();
        this.follow(a);
        return;
      }
      if (a) e.preventDefault();
      if (!window.getSelection().isCollapsed || this.swiped || this.zoomed) return;
      this.opts.onTap && this.opts.onTap(...stagePos(e), this.pointerType);
    });
    // Aucun lien ni formulaire du livre ne doit quitter l'appli.
    v.addEventListener("auxclick", (e) => { if (e.target.closest && e.target.closest("a, area")) e.preventDefault(); });
    v.addEventListener("submit", (e) => e.preventDefault(), true);
    v.addEventListener("pointerdown", (e) => {
      this.pointerType = e.pointerType;
      this.swipeStart = [e.clientX, e.clientY];
      this.swiped = false;
      if (e.pointerType !== "mouse") this.touchStart(e, e.clientX, e.clientY);
    });
    v.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" && this.touchMove(e, e.clientX, e.clientY)) this.swipeStart = null;
    });
    const up = (e) => {
      if (e.pointerType !== "mouse") this.touchEnd(e);
      if (!this.swipeStart || e.pointerType === "mouse" || this.touches.size) return;
      const dx = e.clientX - this.swipeStart[0], dy = e.clientY - this.swipeStart[1];
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        this.swiped = true;
        dx < 0 ? this.next() : this.prev();
      }
      this.swipeStart = null;
    };
    v.addEventListener("pointerup", up);
    v.addEventListener("pointercancel", up);
    // Glisser une image (ou n'importe où avec Ctrl) déplace la page ; glisser sur le texte le sélectionne.
    v.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || !(e.ctrlKey || (e.target.closest && e.target.closest("img, svg, video")))) return;
      e.preventDefault();
      let last = [e.screenX, e.screenY];
      const move = (ev) => {
        this.pan(ev.screenX - last[0], ev.screenY - last[1]);
        last = [ev.screenX, ev.screenY];
      };
      const stop = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", stop); };
      addEventListener("mousemove", move);
      addEventListener("mouseup", stop);
    });
    this.stage.addEventListener("mousemove", (e) => { this.pointer = stagePos(e); });
    this.root.addEventListener("scroll", () => {
      const r = this.root;
      if (Math.abs(r.scrollLeft - this.page * this.W) > 1) r.scrollLeft = this.page * this.W;
      if (r.scrollTop) r.scrollTop = 0;
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
      if (!this.body || this.index < 0) return;
      // On garde le zoom : même niveau, même endroit de la page au centre de l'écran.
      const z = this.zoom, f = this.frame;
      const keep = this.zoomed && {
        ts: z.ts,
        fx: (this.stage.clientWidth / 2 - f.offsetLeft - z.tx) / (z.ts * f.offsetWidth),
        fy: (this.stage.clientHeight / 2 - f.offsetTop - z.ty) / (z.ts * f.offsetHeight),
      };
      this.resetZoom(true);
      this.layout();
      this.measure();
      this.setPage(this.pageOfAnchor(this.anchor), this.anchor);
      if (keep) {
        z.ts = keep.ts;
        z.tx = this.stage.clientWidth / 2 - f.offsetLeft - keep.fx * keep.ts * f.offsetWidth;
        z.ty = this.stage.clientHeight / 2 - f.offsetTop - keep.fy * keep.ts * f.offsetHeight;
        this.clampZoom();
        z.s = z.ts; z.x = z.tx; z.y = z.ty;
        this.applyZoom();
      }
    });
  }

  layout() {
    const s = this.settings;
    const sw = this.stage.clientWidth, sh = this.stage.clientHeight;
    const compact = sw < 700;
    const pad = compact ? 20 : 28;
    const measure = s.fontSize * ({ narrow: 28, medium: 34, wide: 44 }[s.width] || 34);
    const room = sw - (compact ? 0 : 112);
    // Double page : forcée, ou automatique si la fenêtre est assez large (paysage).
    const fitsTwo = room >= 2 * (s.fontSize * 24 + 2 * pad) && sw > sh * 1.15;
    const cols = compact ? 1 : s.spread === "two" ? 2 : s.spread === "one" ? 1 : fitsTwo ? 2 : 1;
    const textW = Math.max(160, Math.min(measure, (room - 2 * cols * pad) / cols));
    const colW = Math.round(textW + 2 * pad);
    const W = colW * cols; // largeur visible = une « page » (une ou deux colonnes)
    // Plein écran : presque sans marges, rien que la page.
    const top = s.immersive ? 12 : sh < 520 ? 44 : 64, bottom = s.immersive ? 12 : sh < 520 ? 36 : 52;
    const H = Math.max(160, sh - top - bottom);
    if (cols !== this.cols || W !== this.W) this.resetZoom(true);
    if (!this.spine) { this.spine = document.createElement("div"); this.spine.className = "spine"; this.stage.append(this.spine); }
    this.spine.hidden = cols !== 2;
    Object.assign(this.spine.style, { left: Math.round((sw - W) / 2) + colW + "px", top: top + "px", height: H + "px" });
    this.cols = cols;
    this.colW = colW;
    this.W = W;
    this.H = H;
    this.pad = pad;
    Object.assign(this.frame.style, {
      width: W + "px", height: H + "px", left: Math.round((sw - W) / 2) + "px", top: top + "px",
    });
    const css = this.css();
    if (css !== this.cssText) { this.cssText = css; this.userSheet.replaceSync(css); } // évite une remise en page inutile
  }

  measure() {
    const columns = Math.max(1, Math.round(this.root.scrollWidth / this.colW));
    this.pages = Math.ceil(columns / this.cols);
  }

  /** Réglages de lecture. #smac-view (un id) l'emporte sur les styles du livre quand c'est voulu ;
      :where(…) garde au contraire une priorité minimale (le livre peut alors la surcharger). */
  css() {
    const s = this.settings, t = s.colors, W = this.colW, H = this.H, P = this.pad;
    const family = { literata: '"Literata", Georgia, serif', sans: 'system-ui, Roboto, "Noto Sans", "Segoe UI", sans-serif' }[s.font];
    const V = "#smac-view", B = `${V} smac-body`, soft = `:where(${V})`;
    return `
:where(${V} > smac-root) { all: initial; }
${V} > smac-root {
  display: block !important; box-sizing: content-box !important; position: relative !important;
  margin: 0 !important; padding: 0 ${P}px !important; border: 0 !important;
  width: auto !important; min-width: 0 !important; max-width: none !important;
  height: ${H}px !important; min-height: 0 !important; max-height: none !important;
  column-width: ${W - 2 * P}px !important; column-gap: ${2 * P}px !important; column-fill: auto !important;
  column-count: auto !important; column-rule: none !important;
  overflow: hidden !important; writing-mode: horizontal-tb !important; transform: none !important;
  font-size: ${s.fontSize}px !important; color: ${t.fg}; background: transparent !important;
  --smac-rem: ${s.fontSize}px; --smac-vh: ${H / 100}px; --smac-vw: ${W / 100}px;
  --smac-vmin: ${Math.min(W, H) / 100}px; --smac-vmax: ${Math.max(W, H) / 100}px;
  -webkit-text-size-adjust: none; text-size-adjust: none; overflow-wrap: break-word;
  touch-action: none; cursor: auto; user-select: text; -webkit-user-select: text;
}
${B} {
  display: block !important; margin: 0 !important; padding: 0 !important; border: 0 !important;
  width: auto !important; min-width: 0 !important; max-width: none !important;
  height: auto !important; min-height: 0 !important; max-height: none !important;
  overflow: visible !important; position: static !important; float: none !important;
  columns: auto !important; transform: none !important; background: transparent !important;
  line-height: ${s.lineHeight};
}
${family ? `${B}, ${B} *:not(pre, code, kbd, samp, tt, pre *) { font-family: ${family} !important; }` : ""}
${B} p, ${B} li, ${B} blockquote, ${B} dd, ${B} div { line-height: ${s.lineHeight} !important; }
${s.justify ? `${B} p:not([align], [style*="text-align"], [class*="center"], [class*="right"]) { text-align: justify !important; -webkit-hyphens: auto; hyphens: auto; }` : ""}
${V} img, ${V} svg, ${V} video, ${V} canvas { max-width: 100% !important; max-height: ${H}px !important; }
${soft} :is(img, svg, video, canvas) { object-fit: contain; box-sizing: border-box; }
${soft} :is(img, svg, figure, video, pre, tr) { break-inside: avoid; }
${soft} :is(h1, h2, h3, h4, h5, h6) { break-after: avoid; }
${V} pre { white-space: pre-wrap !important; }
${soft} table { max-width: 100%; }
${soft} a { color: ${t.link}; }
${soft} .smac-full-image { display: block; margin: 0 auto; }
${soft} :is(img, svg, video) { cursor: grab; -webkit-user-drag: none; }
${V} ::selection { background: ${t.selection}; }
::highlight(smac-search) { background-color: ${t.highlight}; color: inherit; }
${t.forceBg ? `${B} *:not(img, svg, video) { background-color: transparent !important; }` : ""}
${t.forceColor ? `${B}, ${B} *:not(img, svg, video) { color: inherit !important; border-color: ${t.line} !important; }
${B} a, ${B} a * { color: ${t.link} !important; }` : ""}
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
      const ch = this.chapter, data = ch.data, p = ch.parts[part], root = this.root;
      this.frame.style.visibility = "hidden";
      this.bookSheets = data.styles.map((css) => {
        if (!this.sheetCache.has(css)) this.sheetCache.set(css, BookCss.sheet(css));
        return this.sheetCache.get(css);
      });
      this.adopt();
      const lang = data.lang || this.opts.language;
      lang ? root.setAttribute("lang", lang) : root.removeAttribute("lang");
      data.dir ? root.setAttribute("dir", data.dir) : root.removeAttribute("dir");
      data.htmlClass ? root.setAttribute("class", data.htmlClass) : root.removeAttribute("class");
      // <body> du livre → <smac-body> (mêmes attributs), puis les enveloppes et les nœuds de la partie.
      const chain = [];
      for (let el = ch.container; el; el = el === ch.body ? null : el.parentElement) chain.unshift(el);
      const body = document.createElement("smac-body");
      for (const a of chain[0].attributes) {
        try { body.setAttributeNS(a.namespaceURI, a.name, a.value); } catch { /* attribut invalide */ }
      }
      let cur = body;
      for (const el of chain.slice(1)) cur = cur.appendChild(document.importNode(el, false));
      for (let i = p.a; i < p.b; i++) cur.appendChild(document.importNode(ch.kids[i], true));
      for (const el of [body, ...body.querySelectorAll("[style]")]) if (el.style && el.style.length) BookCss.units(el.style);
      this.observer.disconnect();
      root.replaceChildren(body);
      this.body = body;
      if (window.CSS && CSS.highlights) CSS.highlights.delete("smac-search");
      this.index = index;
      this.part = part;
      this.base = p.base;
      this.mediaBase = p.mediaBase;
      this.layout();
      await this.settle();
      if (token !== this.loadToken) return false;
      this.collect();
      this.measure();
      this.observer.observe(body, { childList: true, subtree: true, characterData: true });
      this.frame.style.visibility = "";
      return true;
    } finally {
      clearTimeout(slow);
      this.opts.onLoading && this.opts.onLoading(false);
    }
  }

  settle() {
    const pending = [...this.body.querySelectorAll("img")].filter((i) => !i.complete).map((i) => i.decode().catch(() => {}));
    const timeout = new Promise((r) => setTimeout(r, 3000));
    return Promise.race([Promise.all([Promise.all(pending), document.fonts.ready]), timeout]);
  }

  collect() {
    this.stale = false;
    const nodes = EpubUtil.textNodes(this.body);
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
    this.media = [...this.body.querySelectorAll("img, svg, video")].filter((el) => !el.parentElement.closest("svg"));
  }

  /** Refait la liste des nœuds texte si une extension a touché au texte affiché. */
  fresh() { if (this.stale && this.body) this.collect(); }

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

  /** Abscisse dans la page (sans zoom, défilement compris) d'un rectangle mesuré à l'écran. */
  localX(rc) {
    return (rc.left - this.root.getBoundingClientRect().left) / this.zoom.s + this.root.scrollLeft;
  }

  pageAtX(x) { return Math.min(this.pages - 1, Math.max(0, Math.floor(x / this.W))); }

  /** Page du premier caractère visible à partir de (node, off), ou null. */
  charPage(node, off, backward = false) {
    const r = this.range, len = node.data.length;
    for (let n = 0; n < 48; n++) {
      const o = backward ? off - n : off + n;
      if (o < 0 || o >= len) break;
      r.setStart(node, o);
      r.setEnd(node, o + 1);
      for (const rc of r.getClientRects()) if (rc.height > 0) return this.pageAtX(this.localX(rc));
    }
    return null;
  }

  elementPage(el) {
    const rc = el.getClientRects()[0];
    return rc ? this.pageAtX(this.localX(rc)) : null;
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
    const q = frag.replace(/["\\]/g, "\\$&");
    return this.body.querySelector(`[id="${q}"], [name="${q}"]`);
  }

  /** Range DOM pour un intervalle (positions du chapitre), dans la partie affichée. */
  rangeFor(start, end) {
    this.fresh();
    if (!this.nodes.length) return null;
    const at = (c) => {
      c = Math.min(Math.max(0, c - this.base), this.length);
      const i = this.nodeIndexAt(c);
      return [this.nodes[i], Math.min(c - this.starts[i], this.nodes[i].data.length)];
    };
    const r = document.createRange();
    r.setStart(...at(start));
    r.setEnd(...at(end));
    return r;
  }

  /* ---------- Navigation ---------- */

  run(fn) {
    this.queue = this.queue.then(() => {
      if (this.destroyed) return null;
      this.fresh();
      return fn();
    }).catch((err) => {
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
    this.root.scrollLeft = p * this.W;
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

  /* ---------- Zoom et déplacement de la vue ----------
     La page (#smac-view) est agrandie par une transformation CSS ; la barre, le pied de page
     et les boutons restent à leur taille normale. Coordonnées x, y : dans la scène. */

  /** Molette ou pincement du pavé tactile (ctrl + molette). */
  zoomWheel(e, x, y) {
    e.preventDefault();
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    this.zoomBy(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.002)), x, y);
  }

  /** Multiplie le zoom par `factor` ; le point (x, y) reste immobile. */
  zoomBy(factor, x, y, instant) {
    const z = this.zoom;
    if (x == null) [x, y] = this.pointer || [this.stage.clientWidth / 2, this.stage.clientHeight / 2];
    const target = Math.min(5, Math.max(1, z.ts * factor));
    if (target <= 1.001 && factor < 1) {
      // Retour à 100 % : on recentre la page.
      z.ts = 1; z.tx = 0; z.ty = 0;
    } else {
      const fx = (x - this.frame.offsetLeft - z.tx) / z.ts, fy = (y - this.frame.offsetTop - z.ty) / z.ts;
      z.ts = target;
      z.tx = x - this.frame.offsetLeft - fx * target;
      z.ty = y - this.frame.offsetTop - fy * target;
      this.clampZoom();
    }
    if (instant) { z.s = z.ts; z.x = z.tx; z.y = z.ty; this.applyZoom(); }
    else this.animateZoom();
  }

  /** Calque posé sur la page pendant le zoom : glisser (souris ou doigt) pour déplacer, pincer pour zoomer. */
  makeShield() {
    const sh = document.createElement("div");
    sh.className = "zoom-shield";
    sh.hidden = true;
    sh.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      sh.setPointerCapture(e.pointerId);
      this.touchStart(e, e.clientX, e.clientY);
      sh.classList.add("dragging");
    });
    sh.addEventListener("pointermove", (e) => this.touchMove(e, e.clientX, e.clientY));
    const end = (e) => { this.touchEnd(e); if (!this.touches.size) sh.classList.remove("dragging"); };
    sh.addEventListener("pointerup", end);
    sh.addEventListener("pointercancel", end);
    sh.addEventListener("dblclick", () => this.resetZoom());
    this.stage.append(sh);
    this.shield = sh;
  }

  /* Glisser à un doigt / à la souris = déplacer ; deux doigts = pincer pour zoomer. */
  touchStart(e, x, y) {
    const st = this.stage.getBoundingClientRect();
    this.touches.set(e.pointerId, [x - st.left, y - st.top]);
    this.pinch = null;
  }

  touchMove(e, x, y) {
    const prev = this.touches.get(e.pointerId);
    if (!prev) return false;
    const st = this.stage.getBoundingClientRect();
    const cur = [x - st.left, y - st.top];
    this.touches.set(e.pointerId, cur);
    const pts = [...this.touches.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (this.pinch) {
        this.pan(mid[0] - this.pinch.mid[0], mid[1] - this.pinch.mid[1]);
        this.zoomBy(dist / this.pinch.dist, mid[0], mid[1], true);
      }
      this.pinch = { dist: Math.max(1, dist), mid };
      return true;
    }
    if (this.zoomed) { this.pan(cur[0] - prev[0], cur[1] - prev[1]); return true; }
    return false;
  }

  touchEnd(e) {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
  }

  pan(dx, dy) {
    const z = this.zoom;
    z.tx += dx; z.ty += dy;
    this.clampZoom();
    z.x = z.tx; z.y = z.ty;
    this.applyZoom();
  }

  /** La page peut sortir en partie de l'écran (pour la placer où l'on veut), jamais complètement. */
  clampZoom() {
    const z = this.zoom, f = this.frame;
    const limit = (v, start, size, total) => {
      const w = size * z.ts, m = Math.min(w, total) * 0.25;
      return Math.min(total - m - start, Math.max(m - w - start, v));
    };
    z.tx = limit(z.tx, f.offsetLeft, f.offsetWidth, this.stage.clientWidth);
    z.ty = limit(z.ty, f.offsetTop, f.offsetHeight, this.stage.clientHeight);
  }

  animateZoom() {
    if (this.zoomRaf) return;
    const step = () => {
      const z = this.zoom, k = 0.28;
      z.s += (z.ts - z.s) * k; z.x += (z.tx - z.x) * k; z.y += (z.ty - z.y) * k;
      const done = Math.abs(z.ts - z.s) < 0.002 && Math.abs(z.tx - z.x) < 0.3 && Math.abs(z.ty - z.y) < 0.3;
      if (done) { z.s = z.ts; z.x = z.tx; z.y = z.ty; }
      this.applyZoom();
      this.zoomRaf = done ? 0 : requestAnimationFrame(step);
    };
    this.zoomRaf = requestAnimationFrame(step);
  }

  applyZoom() {
    const z = this.zoom;
    const moved = z.s !== 1 || z.x !== 0 || z.y !== 0;
    this.frame.style.transform = moved ? `translate(${z.x}px, ${z.y}px) scale(${z.s})` : "";
    if (!this.shield) this.makeShield();
    this.shield.hidden = !this.zoomed;
    this.opts.onZoom && this.opts.onZoom(z.ts, this.zoomed);
  }

  resetZoom(instant) {
    const z = this.zoom;
    if (!z || (!this.zoomed && z.s === 1 && z.x === 0 && z.y === 0)) return;
    z.ts = 1; z.tx = 0; z.ty = 0;
    if (instant) {
      cancelAnimationFrame(this.zoomRaf);
      this.zoomRaf = 0;
      z.s = 1; z.x = 0; z.y = 0;
      this.applyZoom();
    } else this.animateZoom();
  }

  /** Vue agrandie ou décalée. */
  get zoomed() { const z = this.zoom; return z.ts > 1 || z.tx !== 0 || z.ty !== 0; }

  /* Clavier : WASD déplace la page, ↑ / ↓ zooment, tant que la touche est enfoncée. */
  hold(code, down) {
    if (down) this.held.add(code);
    else this.held.delete(code);
    if (this.held.size && !this.holdRaf) {
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
        last = now;
        const speed = 700 * dt;
        let dx = 0, dy = 0;
        // La page suit la touche : W la fait monter, S descendre, A aller à gauche, D à droite.
        const up = this.settings.invertY ? speed : -speed; // option « Inverser W et S »
        if (this.held.has("KeyW")) dy += up;
        if (this.held.has("KeyS")) dy -= up;
        if (this.held.has("KeyA")) dx -= speed;
        if (this.held.has("KeyD")) dx += speed;
        if (dx || dy) this.pan(dx, dy);
        if (this.held.has("ArrowUp")) this.zoomBy(Math.exp(1.2 * dt));
        if (this.held.has("ArrowDown")) this.zoomBy(Math.exp(-1.2 * dt));
        this.holdRaf = this.held.size ? requestAnimationFrame(tick) : 0;
      };
      this.holdRaf = requestAnimationFrame(tick);
    }
  }

  releaseKeys() { this.held.clear(); }

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
    if (range && window.Highlight && CSS.highlights) CSS.highlights.set("smac-search", new Highlight(range));
  }

  clearHighlight() {
    if (window.CSS && CSS.highlights) CSS.highlights.delete("smac-search");
  }

  /** Extrait de texte à partir d'un caractère du chapitre (pour les signets). */
  textFrom(start, max) {
    this.fresh();
    if (!this.nodes.length) return "";
    let out = "";
    const local = Math.max(0, start - this.base);
    for (let i = this.nodeIndexAt(local), off = local - this.starts[i]; i < this.nodes.length && out.length < max * 2; i++, off = 0) {
      out += this.nodes[i].data.slice(Math.max(0, off));
    }
    out = out.replace(/\s+/g, " ").trim();
    return out.length > max ? out.slice(0, max).replace(/\s+\S*$/, "") + "…" : out;
  }

  /** Rend le clavier au lecteur (un bouton de la barre ne garde pas le focus). */
  focus() {
    const a = document.activeElement;
    if (a && a !== document.body && a.blur) a.blur();
  }

  destroy() {
    this.destroyed = true;
    this.adopt();
    if (this.observer) this.observer.disconnect();
    cancelAnimationFrame(this.zoomRaf);
    cancelAnimationFrame(this.holdRaf);
    this.loadToken++;
    if (this.resizer) this.resizer.disconnect();
    clearTimeout(this.resizeTimer);
    if (this.frame) this.frame.remove();
    if (this.spine) this.spine.remove();
    if (this.shield) this.shield.remove();
    this.folded.clear();
    this.chapter = null;
  }
}

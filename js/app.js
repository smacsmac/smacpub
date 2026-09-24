/* Smacpub — interface : bibliothèque, lecteur, réglages, sauvegarde. */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (p) => new Intl.NumberFormat("fr", { style: "percent", maximumFractionDigits: 0 }).format(Math.floor((p || 0) * 100) / 100);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "à l’instant";
  for (const [sec, unit, max] of [[60, "minute", 60], [3600, "hour", 24], [86400, "day", 30], [2592000, "month", 12], [31536000, "year", Infinity]]) {
    const v = Math.floor(s / sec);
    if (v < max) return rtf.format(-v, unit);
  }
  return "";
}

function toast(message, type = "", ms = 3500) {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = message;
  $("#toasts").append(el);
  const close = () => el.remove();
  if (ms) setTimeout(close, ms);
  return { close, set: (m) => { el.textContent = m; } };
}

/* ================= Réglages ================= */

const Settings = {
  KEY: "smacpub:settings",
  DEFAULTS: { theme: "auto", accent: "orange", font: "literata", fontSize: 19, lineHeight: 1.6, width: "medium", spread: "auto", justify: true, name: "" },
  data: null,
  load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(this.KEY)) || {}; } catch { /* stockage indisponible */ }
    this.data = { ...this.DEFAULTS, ...this.clean(saved) };
  },
  clean(s) {
    const out = {};
    if (["auto", "light", "sepia", "dark"].includes(s.theme)) out.theme = s.theme;
    if (["literata", "sans", "original"].includes(s.font)) out.font = s.font;
    if (ACCENTS[s.accent]) out.accent = s.accent;
    if (["auto", "one", "two"].includes(s.spread)) out.spread = s.spread;
    if (Number.isFinite(+s.fontSize)) out.fontSize = Math.min(36, Math.max(12, Math.round(+s.fontSize)));
    if ([1.35, 1.6, 1.85].includes(+s.lineHeight)) out.lineHeight = +s.lineHeight;
    if (["narrow", "medium", "wide"].includes(s.width)) out.width = s.width;
    if (typeof s.justify === "boolean") out.justify = s.justify;
    if (typeof s.name === "string") out.name = s.name.slice(0, 40);
    return out;
  },
  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  },
  set(key, value) {
    this.data[key] = value;
    this.save();
    if (key === "theme" || key === "accent") applyTheme();
    else if (Read.reader) Read.reader.setSettings(readerSettings());
    syncControls();
  },
};

/* Couleurs d'accent : [thème clair/sépia, thème sombre] */
const ACCENTS = {
  orange: ["#b5542b", "#e8905f"],
  violet: ["#7446b8", "#b89af0"],
  bleu: ["#2d68ad", "#80b2ec"],
  vert: ["#3b7a4b", "#83c796"],
  rose: ["#bd3d6c", "#f090b3"],
  ardoise: ["#4b5665", "#aab6c4"],
};

const THEME_COLORS = {
  light: { fg: "#25221e", link: "#9a4522", selection: "rgba(181,84,43,.22)", highlight: "rgba(255,196,0,.45)", line: "#e4dfd6", dark: false, forceBg: false, forceColor: false },
  sepia: { fg: "#4b3b2b", link: "#8a3f1c", selection: "rgba(156,74,34,.22)", highlight: "rgba(230,160,0,.42)", line: "#ddcfb3", dark: false, forceBg: true, forceColor: false },
  dark: { fg: "#d9d4ca", link: "#e8905f", selection: "rgba(232,144,95,.3)", highlight: "rgba(255,196,0,.32)", line: "#2e2e33", dark: true, forceBg: true, forceColor: true },
};
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

function resolvedTheme() {
  const t = Settings.data.theme;
  return t === "auto" ? (darkQuery.matches ? "dark" : "light") : t;
}

function readerSettings() {
  const s = Settings.data;
  const theme = resolvedTheme();
  const accent = (ACCENTS[s.accent] || ACCENTS.orange)[theme === "dark" ? 1 : 0];
  const colors = { ...THEME_COLORS[theme], link: accent, selection: `color-mix(in srgb, ${accent} 26%, transparent)` };
  return { fontSize: s.fontSize, font: s.font, lineHeight: s.lineHeight, width: s.width, spread: s.spread, justify: s.justify, colors };
}

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
  document.documentElement.dataset.accent = Settings.data.accent;
  updateThemeColor();
  if (Read.reader) Read.reader.setSettings(readerSettings());
}

function updateThemeColor() {
  const meta = $('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue(Read.el.hidden ? "--bg" : "--page-bg").trim();
  if (meta && bg) meta.content = bg;
}

function syncControls() {
  const s = Settings.data;
  for (const group of $$("[data-setting]")) {
    for (const b of $$("button", group)) b.classList.toggle("active", String(s[group.dataset.setting]) === b.dataset.value);
  }
  $("#font-size-val").textContent = s.fontSize;
  $("#justify").checked = s.justify;
}

/* ================= Import ================= */

async function hashId(buffer) {
  if (crypto.subtle) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
    return [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const bytes = new Uint8Array(buffer); // repli : FNV-1a 2 × 32 bits
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 16777619);
    h2 = Math.imul(h2 ^ bytes[i], 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0") + bytes.length.toString(16);
}

async function makeThumb(blob) {
  if (!blob) return null;
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 600 / bmp.height);
    if (scale === 1 && blob.size < 350000) { bmp.close(); return blob; }
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return (await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86))) || blob;
  } catch {
    return blob.size < 3e6 ? blob : null; // SVG, formats exotiques : on garde l'original
  }
}

async function importFiles(fileList) {
  const files = [...fileList].filter((f) => /\.epub$/i.test(f.name) || f.type === "application/epub+zip");
  if (!files.length) { toast("Seuls les fichiers .epub peuvent être ajoutés.", "error"); return []; }
  const progress = toast(files.length > 1 ? `Ajout de ${files.length} livres…` : `Ajout de « ${files[0].name} »…`, "", 0);
  const ids = [];
  let added = 0, already = 0;
  const failed = [];
  for (const [i, file] of files.entries()) {
    if (files.length > 1) progress.set(`Ajout ${i + 1} / ${files.length} : ${file.name}`);
    try {
      const buffer = await file.arrayBuffer();
      const id = await hashId(buffer);
      ids.push(id);
      if (await DB.get("books", id)) { already++; continue; }
      const epub = await Epub.open(buffer);
      const md = epub.metadata;
      const cover = await makeThumb(await epub.coverBlob().catch(() => null));
      const lengths = await epub.lengths();
      await DB.addBook({
        id,
        title: md.title || file.name.replace(/\.epub$/i, "").replace(/[_]+/g, " "),
        author: md.authors.join(", "),
        language: md.language,
        publisher: md.publisher,
        description: md.description.slice(0, 2000),
        fileName: file.name,
        size: file.size,
        addedAt: Date.now(),
        cover,
        lengths,
      }, new Blob([buffer], { type: "application/epub+zip" }));
      epub.destroy();
      added++;
    } catch (err) {
      console.error(file.name, err);
      failed.push(file.name);
    }
  }
  progress.close();
  if (added) toast(added > 1 ? `${added} livres ajoutés à votre bibliothèque.` : "Livre ajouté à votre bibliothèque.");
  if (already) toast(already > 1 ? `${already} livres étaient déjà dans la bibliothèque.` : "Ce livre est déjà dans la bibliothèque.");
  if (failed.length) toast(`Impossible de lire : ${failed.join(", ")}`, "error", 6000);
  if (added) {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    await Library.refresh();
  }
  return ids;
}

/* ================= Bibliothèque ================= */

const Library = {
  books: [],
  filter: "all",
  sort: "recent",
  query: "",
  covers: new Map(),

  async refresh() {
    const [books, states] = await Promise.all([DB.all("books"), DB.all("state")]);
    const byId = new Map(states.map((s) => [s.id, s]));
    this.books = books.map((b) => ({ ...b, state: byId.get(b.id) || { id: b.id } }));
    this.render();
  },

  coverUrl(b) {
    if (!b.cover) return null;
    if (!this.covers.has(b.id)) this.covers.set(b.id, URL.createObjectURL(b.cover));
    return this.covers.get(b.id);
  },

  progress(b) { return b.state.finished ? 1 : b.state.progress || 0; },

  coverHtml(b, withBar = true) {
    const url = this.coverUrl(b);
    const p = this.progress(b);
    const hue = Math.round(([...b.title].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) * 137.508) % 360);
    const art = url
      ? `<img src="${url}" alt="" loading="lazy" data-fallback="${hue}">`
      : `<div class="gen-cover" style="--h:${hue}"><b>${esc(b.title)}</b><span>${esc(b.author)}</span></div>`;
    const bar = withBar && b.state.lastReadAt && p > 0 && p < 1 ? `<div class="progress"><i style="width:${(p * 100).toFixed(1)}%"></i></div>` : "";
    return `<div class="cover">${art}${bar}</div>`;
  },

  visible() {
    const q = this.query ? EpubUtil.fold(this.query).text.trim() : "";
    const list = this.books.filter((b) => {
      const s = b.state;
      if (this.filter === "reading" && !(s.lastReadAt && !s.finished)) return false;
      if (this.filter === "unread" && s.lastReadAt) return false;
      if (this.filter === "finished" && !s.finished) return false;
      if (this.filter === "favorite" && !s.favorite) return false;
      return !q || EpubUtil.fold(b.title + " " + b.author).text.includes(q);
    });
    const coll = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
    const cmp = {
      recent: (a, b) => (b.state.lastReadAt || 0) - (a.state.lastReadAt || 0) || b.addedAt - a.addedAt,
      added: (a, b) => b.addedAt - a.addedAt,
      title: (a, b) => coll.compare(a.title, b.title),
      author: (a, b) => coll.compare(a.author || "~", b.author || "~") || coll.compare(a.title, b.title),
      progress: (a, b) => this.progress(b) - this.progress(a),
    }[this.sort];
    return list.sort(cmp);
  },

  render() {
    const lib = $("#library");
    const empty = !this.books.length;
    lib.classList.toggle("is-empty", empty);
    $("#empty").hidden = !empty;

    const current = this.books.filter((b) => b.state.lastReadAt && !b.state.finished)
      .sort((a, b) => b.state.lastReadAt - a.state.lastReadAt)[0];
    const hour = new Date().getHours();
    const name = Settings.data.name.trim();
    $("#greeting").textContent = `${hour >= 18 || hour < 5 ? "Bonsoir" : "Bonjour"}${name ? ", " + name : ""}.`;
    let sub = "Que voulez-vous lire aujourd’hui ?";
    if (current) {
      sub = Date.now() - current.state.lastReadAt > 14 * 86400000
        ? `Ça fait un moment ! Vous avez laissé « ${current.title} » ${ago(current.state.lastReadAt)}.`
        : "Prêt à reprendre votre lecture ?";
    }
    $("#greeting-sub").textContent = sub;

    const hero = $("#hero");
    hero.hidden = !current;
    if (current) {
      const s = current.state, url = this.coverUrl(current);
      hero.innerHTML = `
        ${url ? `<div class="hero-bg" style="background-image:url('${url}')"></div>` : ""}
        <div data-open="${current.id}">${this.coverHtml(current, false)}</div>
        <div class="hero-body">
          <p class="eyebrow">Continuer la lecture</p>
          <h2>${esc(current.title)}</h2>
          ${current.author ? `<p class="author">${esc(current.author)}</p>` : ""}
          <p class="where">${s.chapter ? `<strong>${esc(s.chapter)}</strong> · ` : ""}${ago(s.lastReadAt)}</p>
          <div class="bar"><i style="width:${(this.progress(current) * 100).toFixed(1)}%"></i></div>
          <div class="hero-actions">
            <button class="btn primary lg" data-open="${current.id}"><svg class="icon"><use href="#i-book"/></svg>Continuer · ${pct(s.progress)}</button>
          </div>
        </div>`;
    }

    const list = this.visible();
    $("#book-count").textContent = this.books.length ? this.books.length : "";
    $("#no-match").hidden = !!list.length || empty;
    $("#grid").innerHTML = list.map((b) => {
      const s = b.state, p = this.progress(b);
      let meta;
      if (s.finished) meta = `<span class="done">✓ Terminé</span>`;
      else if (s.lastReadAt) meta = `<span>${pct(p)}</span><span>·</span><span>${ago(s.lastReadAt)}</span>`;
      else meta = Date.now() - b.addedAt < 7 * 86400000 ? `<span class="new">Nouveau</span>` : `<span>Pas commencé</span>`;
      return `
        <article class="card">
          <button class="card-open" data-open="${b.id}" title="${esc(b.title)}">
            ${this.coverHtml(b)}
            <h3>${esc(b.title)}</h3>
            <p class="author">${esc(b.author) || "&nbsp;"}</p>
            <div class="meta">${meta}</div>
          </button>
          ${s.favorite ? `<span class="fav-badge" title="Favori"><svg class="icon"><use href="#i-star"/></svg></span>` : ""}
          <button class="icon-btn card-more" data-menu="${b.id}" aria-label="Options" aria-haspopup="menu"><svg class="icon"><use href="#i-more"/></svg></button>
        </article>`;
    }).join("");
    for (const c of $$("#filters .chip")) c.classList.toggle("active", c.dataset.filter === this.filter);
  },

  book(id) { return this.books.find((b) => b.id === id); },

  openMenu(button, id) {
    const b = this.book(id);
    if (!b) return;
    const s = b.state, menu = $("#menu");
    menu.innerHTML = `
      <button data-act="open"><svg class="icon"><use href="#i-book"/></svg>${s.lastReadAt ? "Reprendre la lecture" : "Commencer la lecture"}</button>
      <button data-act="favorite"><svg class="icon"><use href="#i-star"/></svg>${s.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}</button>
      <button data-act="finished"><svg class="icon"><use href="#i-check"/></svg>${s.finished ? "Marquer comme non terminé" : "Marquer comme terminé"}</button>
      ${s.lastReadAt ? `<button data-act="restart"><svg class="icon"><use href="#i-restart"/></svg>Recommencer au début</button>` : ""}
      <button data-act="cover"><svg class="icon"><use href="#i-image"/></svg>Changer la couverture…</button>
      ${b.customCover ? `<button data-act="cover-reset"><svg class="icon"><use href="#i-undo"/></svg>Couverture d’origine</button>` : ""}
      <hr>
      <button data-act="remove" class="danger"><svg class="icon"><use href="#i-trash"/></svg>Retirer de la bibliothèque</button>`;
    menu.dataset.id = id;
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    this.menuButton = button;
    const r = button.getBoundingClientRect(), m = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8)) + "px";
    menu.style.top = (r.bottom + m.height + 8 < innerHeight ? r.bottom + 6 : Math.max(8, r.top - m.height - 6)) + "px";
    menu.querySelector("button").focus();
  },

  closeMenu() {
    $("#menu").hidden = true;
    if (this.menuButton) this.menuButton.setAttribute("aria-expanded", "false");
    this.menuButton = null;
  },

  async setCover(b, cover, custom) {
    const { state, ...book } = b;
    await DB.put("books", { ...book, cover, customCover: custom });
    if (this.covers.has(b.id)) { URL.revokeObjectURL(this.covers.get(b.id)); this.covers.delete(b.id); }
    toast(custom ? "Couverture mise à jour." : "Couverture d’origine rétablie.");
    await this.refresh();
  },

  async act(action, id) {
    this.closeMenu();
    const b = this.book(id);
    if (!b) return;
    const s = { ...b.state, bookmarks: b.state.bookmarks || [] };
    if (action === "open") return go("#/livre/" + id);
    if (action === "favorite") s.favorite = !s.favorite;
    if (action === "finished") {
      s.finished = !s.finished;
      if (s.finished) s.lastReadAt = s.lastReadAt || Date.now();
      else if (s.progress >= 1) s.progress = 0.99;
    }
    if (action === "cover") {
      const input = $("#cover-input");
      input.dataset.id = id;
      input.click();
      return;
    }
    if (action === "cover-reset") {
      let cover = null;
      try {
        const epub = await Epub.open(await DB.get("files", id));
        cover = await makeThumb(await epub.coverBlob());
        epub.destroy();
      } catch (err) { console.error(err); }
      return this.setCover(b, cover, false);
    }
    if (action === "restart") {
      Object.assign(s, { location: null, progress: 0, finished: false, chapter: "" });
      toast(`« ${b.title} » reprendra au début.`);
    }
    if (action === "remove") {
      const ok = await confirmDialog(`Retirer « ${b.title} » ?`,
        "Le livre, sa position de lecture et ses signets seront effacés de Smacpub. Votre fichier EPUB d’origine n’est pas touché.",
        "Retirer");
      if (!ok) return;
      await DB.removeBook(id);
      if (this.covers.has(id)) { URL.revokeObjectURL(this.covers.get(id)); this.covers.delete(id); }
      toast(`« ${b.title} » a été retiré.`);
      return this.refresh();
    }
    await DB.put("state", s);
    await this.refresh();
  },
};

function confirmDialog(title, text, okLabel) {
  const d = $("#confirm-dialog");
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  $("#confirm-ok").textContent = okLabel;
  d.returnValue = "";
  d.showModal();
  return new Promise((resolve) => d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true }));
}

/* ================= Lecteur ================= */

const Read = {
  el: $("#reader"),
  reader: null,
  book: null,
  state: null,
  epub: null,
  loc: null,
  searchToken: 0,

  async open(id) {
    if (this.book && this.book.id === id) return;
    if (this.book) this.close();
    const opening = (this.opening = Symbol());
    const [book, file, saved] = await Promise.all([DB.get("books", id), DB.get("files", id), DB.get("state", id)]);
    if (opening !== this.opening) return;
    if (!book || !file) { toast("Ce livre n’est plus dans la bibliothèque.", "error"); return go("#/", true); }
    this.book = book;
    this.state = { id, bookmarks: [], ...saved };
    this.libraryScroll = scrollY;
    $("#library").hidden = true;
    this.el.hidden = false;
    document.title = book.title + " — Smacpub";
    $("#r-book-title").textContent = book.title;
    $("#r-chapter").textContent = book.author || "";
    $("#r-foot-left").textContent = "";
    $("#r-foot-right").textContent = "";
    $("#r-loading").hidden = false;
    updateThemeColor();
    try {
      this.epub = await Epub.open(file);
    } catch (err) {
      console.error(err);
      toast("Impossible d’ouvrir ce livre : " + err.message, "error", 6000);
      this.close();
      return go("#/", true);
    }
    if (opening !== this.opening) return this.epub.destroy();
    const toc = this.epub.toc;
    this.chapterLabels = this.epub.spine.map((_, i) => {
      let label = "";
      for (const e of toc) if (e.index <= i) label = e.label;
      return label;
    });
    this.reader = new Reader($("#r-stage"), this.epub, {
      settings: readerSettings(),
      lengths: book.lengths,
      toc,
      language: book.language,
      onRelocate: (loc) => this.relocated(loc),
      onTap: (x, y, type) => this.tap(x, y, type),
      onKey: onKey,
      onPointerMove: (x, y) => this.pointer(y),
      onLink: (from) => this.showReturn(from),
      onLoading: (on) => { $("#r-loading").hidden = !on; },
      onZoom: (z) => {
        const pill = $("#r-zoom");
        pill.hidden = z <= 1;
        Read.el.classList.toggle("zoomed", z > 1);
        $("span", pill).textContent = Math.round(z * 100) + " %";
      },
      onEnd: () => toast("Vous avez terminé ce livre. Bravo !"),
      onError: (err) => toast("Erreur d’affichage : " + err.message, "error"),
    });
    await this.reader.init();
    if (opening !== this.opening) return;
    this.renderToc();
    this.renderBookmarks();
    $("#r-search").value = "";
    $("#r-results").innerHTML = "";
    $("#r-search-status").textContent = "";
    await this.reader.display(this.state.location || { index: 0, page: 0 });
    if (opening !== this.opening) return;
    $("#r-loading").hidden = true;
    this.showChrome(2500);
    this.reader.focus();
    try { localStorage.setItem("smacpub:lastBook", id); } catch { /* ignore */ }
  },

  close() {
    this.opening = null;
    if (this.reader) this.reader.destroy();
    if (this.epub) this.epub.destroy();
    this.reader = this.epub = this.book = this.loc = null;
    this.closeOverlays();
    this.hideReturn();
    this.el.hidden = true;
    this.el.classList.remove("chrome");
    $("#r-zoom").hidden = true;
    $("#library").hidden = false;
    document.title = "Smacpub";
    updateThemeColor();
    scrollTo(0, this.libraryScroll || 0);
    try { localStorage.removeItem("smacpub:lastBook"); } catch { /* ignore */ }
  },

  relocated(loc) {
    if (!this.reader || !this.epub) return;
    this.loc = loc;
    const s = this.state;
    s.location = { index: loc.index, char: loc.char };
    if (loc.media != null) s.location.media = loc.media;
    s.progress = loc.progress;
    s.lastReadAt = Date.now();
    if (loc.atEnd && loc.via === "next") s.finished = true; // arrivé au bout en lisant (pas via un lien vers les notes)
    const entry = this.epub.toc[loc.tocIndex];
    s.chapter = entry ? entry.label : "";
    DB.put("state", s).catch((err) => console.error(err));

    $("#r-chapter").textContent = s.chapter || this.book.author || "";
    $("#r-foot-left").textContent = s.chapter;
    const left = loc.pagesLeft;
    const pagesLeft = loc.single ? ""
      : left <= 0 ? `Dernière page<span class="long"> du chapitre</span> · `
      : `${plural(left, "page restante", "pages restantes")}<span class="long"> dans ce chapitre</span> · `;
    $("#r-foot-right").innerHTML = pagesLeft + pct(loc.progress);
    $("#r-progress .progress-fill").style.width = (loc.progress * 100).toFixed(2) + "%";
    const marked = !!this.bookmarkHere();
    $("#r-bookmark-btn").classList.toggle("on", marked);
    const ribbon = $("#r-ribbon");
    ribbon.hidden = !marked;
    if (marked) {
      const f = this.reader.frame;
      ribbon.style.left = f.offsetLeft + f.offsetWidth - this.reader.pad - 24 + "px";
    }
    for (const b of $$("#r-toc button")) b.classList.toggle("current", +b.dataset.toc === loc.tocIndex);
  },

  /* --- Navigation --- */
  next() { this.turned(); this.reader.next(); },
  prev() { this.turned(); this.reader.prev(); },
  turned() {
    this.reader.clearHighlight();
    if (this.returnTo && ++this.returnTurns > 10) this.hideReturn();
    if (document.activeElement && document.activeElement.closest(".reader-bar")) this.reader.focus();
    clearTimeout(this.chromeTimer);
    this.hideChrome();
  },

  tap(x, y, type) {
    if (this.closeOverlays()) return;
    if (type !== "touch" && type !== "pen") return; // à la souris, cliquer dans le texte ne tourne pas la page
    const w = this.el.clientWidth;
    if (x < w * 0.3) this.prev();
    else if (x > w * 0.7) this.next();
    else this.toggleChrome();
  },

  /* --- Barre du haut (masquée pendant la lecture) --- */
  showChrome(hideAfter) {
    this.el.classList.add("chrome");
    clearTimeout(this.chromeTimer);
    if (hideAfter) this.chromeTimer = setTimeout(() => this.hideChrome(), hideAfter);
  },
  hideChrome() {
    if ($("#r-panel").classList.contains("open") || !$("#r-typo").hidden || $(".reader-bar").matches(":hover, :focus-within")) return;
    this.el.classList.remove("chrome");
  },
  toggleChrome() {
    this.el.classList.contains("chrome") ? this.el.classList.remove("chrome") : this.showChrome(4000);
  },
  pointer(y) {
    if (y < 72) this.showChrome();
    else if (this.el.classList.contains("chrome")) {
      clearTimeout(this.chromeTimer);
      this.chromeTimer = setTimeout(() => this.hideChrome(), 1200);
    }
  },

  /* --- Panneaux --- */
  openPanel(tab) {
    $("#r-typo").hidden = true;
    $("#r-panel").classList.add("open");
    $("#r-scrim").hidden = false;
    for (const t of $$("#r-panel .tab")) t.classList.toggle("active", t.dataset.tab === tab);
    for (const p of $$("#r-panel .panel-body")) p.classList.toggle("active", p.dataset.pane === tab);
    this.panelTab = tab;
    this.showChrome();
    if (tab === "search") { const i = $("#r-search"); i.focus(); i.select(); }
    if (tab === "toc") {
      const cur = $("#r-toc .current");
      if (cur) cur.scrollIntoView({ block: "center" });
      (cur || $("#r-toc button") || $("#r-panel-close")).focus({ preventScroll: true });
    }
    if (tab === "bookmarks") $("#r-panel-close").focus();
  },
  togglePanel(tab) {
    if ($("#r-panel").classList.contains("open") && this.panelTab === tab) this.closeOverlays();
    else this.openPanel(tab);
  },
  closeOverlays() {
    let closed = false;
    if ($("#r-panel").classList.contains("open")) { $("#r-panel").classList.remove("open"); closed = true; }
    if (!$("#r-typo").hidden) { $("#r-typo").hidden = true; closed = true; }
    $("#r-scrim").hidden = true;
    if (closed && this.reader) { this.reader.focus(); this.showChrome(1500); }
    return closed;
  },

  renderToc() {
    $("#r-toc").innerHTML = this.epub.toc.map((e, i) =>
      `<li><button class="d${Math.min(e.depth, 4)}" data-toc="${i}">${esc(e.label)}</button></li>`).join("");
  },

  /* --- Signets --- */
  bookmarkHere() {
    const l = this.loc;
    if (!l) return null;
    return (this.state.bookmarks || []).find((b) => b.index === l.index &&
      (b.media != null ? l.mediaOnPage.includes(b.media) : b.char >= l.start && b.char < l.end));
  },

  toggleBookmark() {
    if (!this.loc) return;
    const s = this.state, here = this.bookmarkHere();
    if (here) {
      s.bookmarks = s.bookmarks.filter((b) => b !== here);
      toast("Signet retiré");
    } else {
      const l = this.loc;
      const b = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        index: l.index, char: l.start, chapter: s.chapter || this.chapterLabels[l.index] || "",
        text: this.reader.textFrom(l.start, 140) || "Illustration", progress: l.progress, createdAt: Date.now(),
      };
      if (l.media != null) b.media = l.media;
      s.bookmarks.push(b);
      toast("Signet ajouté");
    }
    DB.put("state", s).catch((err) => console.error(err));
    this.relocated(this.loc);
    this.renderBookmarks();
  },

  renderBookmarks() {
    const list = [...(this.state.bookmarks || [])].sort((a, b) => a.index - b.index || a.char - b.char);
    $("#r-bookmarks").innerHTML = list.length ? list.map((b) => `
      <li>
        <button class="mark-open" data-mark="${b.id}">
          <span class="mark-chapter"><svg class="icon sm"><use href="#i-bookmark"/></svg>${esc(b.chapter || "Signet")} · ${pct(b.progress)}</span>
          <span class="mark-text">« ${esc(b.text)} »</span>
          <span class="mark-date">${ago(b.createdAt)}</span>
        </button>
        <button class="icon-btn mark-del" data-del="${b.id}" title="Supprimer ce signet"><svg class="icon sm"><use href="#i-trash"/></svg></button>
      </li>`).join("")
      : `<li class="panel-empty">Aucun signet pour l’instant.<br>Appuyez sur <kbd>B</kbd> ou sur l’icône signet pour marquer une page.</li>`;
  },

  /* --- Recherche --- */
  async search(query) {
    const token = ++this.searchToken;
    const status = $("#r-search-status"), out = $("#r-results");
    if (query.trim().length < 2) { status.textContent = ""; out.innerHTML = ""; return; }
    status.textContent = "Recherche…";
    const results = await this.reader.search(query, () => token !== this.searchToken || !this.reader);
    if (!results || token !== this.searchToken) return;
    this.results = results;
    status.textContent = results.length ? (results.length >= 300 ? "Plus de 300 résultats" : plural(results.length, "résultat", "résultats")) : "Aucun résultat.";
    out.innerHTML = results.map((r, i) => `
      <li><button data-res="${i}">
        <span class="res-chapter">${esc(this.chapterLabels[r.index] || "Chapitre " + (r.index + 1))}</span>
        <span class="res-text">${r.before.length >= 60 ? "…" : ""}${esc(r.before.replace(/\s+/g, " ").trimStart())}<mark>${esc(r.match)}</mark>${esc(r.after.replace(/\s+/g, " "))}…</span>
      </button></li>`).join("");
  },

  /* --- Lien interne : bouton « Revenir » --- */
  showReturn(from) {
    this.returnTo = from;
    this.returnTurns = 0;
    $("#r-return").hidden = false;
  },
  hideReturn() {
    this.returnTo = null;
    $("#r-return").hidden = true;
  },
};

/* ================= Clavier ================= */

function onKey(e) {
  if (!Read.reader || Read.el.hidden) {
    if (e.key === "Escape") Library.closeMenu();
    return;
  }
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    if (e.key === "Escape") { e.preventDefault(); e.target.blur(); Read.closeOverlays(); }
    return;
  }
  if ($("dialog[open]")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); Read.openPanel("search"); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const onButton = tag === "BUTTON";
  switch (e.key) {
    case "ArrowRight": case "ArrowDown": case "PageDown": Read.next(); break;
    case "ArrowLeft": case "ArrowUp": case "PageUp": Read.prev(); break;
    case " ": if (onButton) return; e.shiftKey ? Read.prev() : Read.next(); break;
    case "t": case "T": Read.togglePanel("toc"); break;
    case "b": case "B": Read.toggleBookmark(); break;
    case "f": case "F": case "/": Read.openPanel("search"); break;
    case "+": case "=": Settings.set("fontSize", Math.min(36, Settings.data.fontSize + 1)); break;
    case "-": case "_": Settings.set("fontSize", Math.max(12, Settings.data.fontSize - 1)); break;
    case "0": Read.reader.resetZoom(); break;
    case "Escape":
      if (Read.reader.zoomed) Read.reader.resetZoom();
      else if (!Read.closeOverlays()) go("#/");
      break;
    default: return;
  }
  e.preventDefault();
}

/* ================= Navigation (URL) ================= */

function go(hash, replace) {
  if (replace) { history.replaceState(null, "", hash); route(); }
  else location.hash = hash;
}

function route() {
  const m = location.hash.match(/^#\/livre\/([\w-]+)/);
  if (m) Read.open(m[1]);
  else if (Read.book || Read.opening) { Read.close(); Library.refresh(); }
}

/* ================= Sauvegarde ================= */

async function exportData() {
  const [books, states] = await Promise.all([DB.all("books"), DB.all("state")]);
  const byId = new Map(books.map((b) => [b.id, b]));
  const data = {
    app: "smacpub", version: 1, exportedAt: new Date().toISOString(),
    settings: Settings.data,
    books: states.map((s) => ({ title: byId.get(s.id)?.title, author: byId.get(s.id)?.author, ...s })),
  };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
  a.download = `smacpub-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Sauvegarde exportée.");
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  if (!data || data.app !== "smacpub" || !Array.isArray(data.books)) {
    toast("Ce fichier n’est pas une sauvegarde Smacpub.", "error");
    return;
  }
  let n = 0;
  for (const inc of data.books) {
    if (!inc || typeof inc.id !== "string") continue;
    const cur = (await DB.get("state", inc.id)) || { id: inc.id };
    const merged = { ...cur };
    if ((inc.lastReadAt || 0) > (cur.lastReadAt || 0)) {
      for (const k of ["location", "progress", "lastReadAt", "finished", "chapter", "favorite"]) if (k in inc) merged[k] = inc[k];
    } else if (merged.favorite === undefined && inc.favorite) merged.favorite = true;
    const known = new Set((cur.bookmarks || []).map((b) => b.id));
    merged.bookmarks = [...(cur.bookmarks || []), ...(Array.isArray(inc.bookmarks) ? inc.bookmarks : []).filter((b) => b && !known.has(b.id))];
    await DB.put("state", merged);
    n++;
  }
  if (data.settings) {
    Object.assign(Settings.data, Settings.clean(data.settings));
    Settings.save();
    applyTheme();
    syncControls();
    $("#s-name").value = Settings.data.name;
  }
  await Library.refresh();
  toast(`Sauvegarde importée (${plural(n, "livre", "livres")}).`);
}

async function showStorageInfo() {
  const el = $("#storage-info");
  if (!navigator.storage || !navigator.storage.estimate) { el.textContent = ""; return; }
  const [{ usage = 0 }, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : false]);
  const mb = new Intl.NumberFormat("fr", { maximumFractionDigits: 1 }).format(usage / 1048576);
  el.textContent = `Espace utilisé sur cet appareil : ${mb} Mo.` + (persisted ? " Stockage protégé ✓" : "");
}

/* ================= Événements ================= */

function bind() {
  // Bibliothèque
  $("#add-btn").addEventListener("click", () => $("#file-input").click());
  $("#empty-add").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) await importFiles(files);
  });
  $("#lib-search").addEventListener("input", (e) => { Library.query = e.target.value; Library.render(); });
  $("#sort").addEventListener("change", (e) => {
    Library.sort = e.target.value;
    try { localStorage.setItem("smacpub:sort", Library.sort); } catch { /* ignore */ }
    Library.render();
  });
  $("#filters").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) { Library.filter = chip.dataset.filter; Library.render(); }
  });
  $("#library").addEventListener("click", (e) => {
    const more = e.target.closest("[data-menu]");
    if (more) { e.stopPropagation(); return Library.openMenu(more, more.dataset.menu); }
    const open = e.target.closest("[data-open]");
    if (open) go("#/livre/" + open.dataset.open);
  });
  $("#library").addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || !img.dataset.fallback) return;
    const card = Library.books.find((b) => Library.covers.get(b.id) === img.getAttribute("src"));
    img.outerHTML = `<div class="gen-cover" style="--h:${img.dataset.fallback}"><b>${esc(card ? card.title : "")}</b><span>${esc(card ? card.author : "")}</span></div>`;
  }, true);
  $("#menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b) Library.act(b.dataset.act, $("#menu").dataset.id);
  });
  document.addEventListener("click", (e) => { if (!$("#menu").hidden && !e.target.closest("#menu")) Library.closeMenu(); });

  // Paramètres
  $("#settings-btn").addEventListener("click", () => {
    $("#s-name").value = Settings.data.name;
    showStorageInfo();
    $("#settings-dialog").showModal();
  });
  $("#s-name").addEventListener("input", (e) => { Settings.data.name = e.target.value.slice(0, 40); Settings.save(); Library.render(); });
  for (const group of $$("[data-setting]")) {
    group.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-value]");
      if (!b) return;
      const key = group.dataset.setting;
      Settings.set(key, key === "lineHeight" ? +b.dataset.value : b.dataset.value);
    });
  }
  $("#export-btn").addEventListener("click", exportData);
  $("#import-btn").addEventListener("click", () => $("#backup-input").click());
  $("#cover-input").addEventListener("change", async (e) => {
    const f = e.target.files[0], b = Library.book(e.target.dataset.id);
    e.target.value = "";
    if (!f || !b) return;
    const cover = await makeThumb(f);
    if (!cover) return toast("Cette image n’a pas pu être lue.", "error");
    await Library.setCover(b, cover, true);
  });
  $("#backup-input").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) await importBackup(f);
  });

  // Lecteur
  $("#r-back").addEventListener("click", () => go("#/"));
  $("#r-toc-btn").addEventListener("click", () => Read.togglePanel("toc"));
  $("#r-search-btn").addEventListener("click", () => Read.togglePanel("search"));
  $("#r-bookmark-btn").addEventListener("click", () => Read.toggleBookmark());
  $("#r-type-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const pop = $("#r-typo");
    const show = pop.hidden;
    Read.closeOverlays();
    pop.hidden = !show;
    if (show) Read.showChrome();
  });
  $("#font-smaller").addEventListener("click", () => Settings.set("fontSize", Math.max(12, Settings.data.fontSize - 1)));
  $("#font-bigger").addEventListener("click", () => Settings.set("fontSize", Math.min(36, Settings.data.fontSize + 1)));
  $("#justify").addEventListener("change", (e) => Settings.set("justify", e.target.checked));
  $("#r-prev").addEventListener("click", (e) => { e.stopPropagation(); Read.prev(); });
  $("#r-next").addEventListener("click", (e) => { e.stopPropagation(); Read.next(); });
  $("#r-scrim").addEventListener("click", () => Read.closeOverlays());
  $("#r-panel-close").addEventListener("click", () => Read.closeOverlays());
  $$("#r-panel .tab").forEach((t) => t.addEventListener("click", () => Read.openPanel(t.dataset.tab)));
  document.addEventListener("click", (e) => {
    if (!$("#r-typo").hidden && !e.target.closest("#r-typo, #r-type-btn")) { $("#r-typo").hidden = true; Read.reader && Read.reader.focus(); }
  });

  $("#r-toc").addEventListener("click", (e) => {
    const b = e.target.closest("[data-toc]");
    if (!b) return;
    const entry = Read.epub.toc[+b.dataset.toc];
    Read.reader.clearHighlight();
    Read.hideReturn();
    Read.reader.display(entry.frag ? { index: entry.index, frag: entry.frag } : { index: entry.index, page: 0 });
    Read.closeOverlays();
  });
  $("#r-bookmarks").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      Read.state.bookmarks = Read.state.bookmarks.filter((b) => b.id !== del.dataset.del);
      DB.put("state", Read.state);
      Read.renderBookmarks();
      if (Read.loc) Read.relocated(Read.loc);
      return;
    }
    const open = e.target.closest("[data-mark]");
    const b = open && Read.state.bookmarks.find((m) => m.id === open.dataset.mark);
    if (b) {
      Read.reader.display({ index: b.index, char: b.char, media: b.media });
      Read.closeOverlays();
    }
  });
  let searchTimer;
  $("#r-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => Read.search(e.target.value), 250);
  });
  $("#r-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { clearTimeout(searchTimer); Read.search(e.target.value); }
  });
  $("#r-results").addEventListener("click", (e) => {
    const b = e.target.closest("[data-res]");
    if (!b) return;
    for (const x of $$("#r-results button.current")) x.classList.remove("current");
    Read.reader.showResult(Read.results[+b.dataset.res]);
    Read.closeOverlays();
  });
  $("#r-return").addEventListener("click", () => {
    if (Read.returnTo) Read.reader.display(Read.returnTo);
    Read.hideReturn();
  });

  // Barre de progression : cliquer pour aller à un endroit du livre
  const track = $("#r-progress"), tip = $(".progress-tip", track);
  const fraction = (e) => Math.min(1, Math.max(0, (e.clientX - track.getBoundingClientRect().left) / track.clientWidth));
  track.addEventListener("mousemove", (e) => {
    tip.hidden = false;
    tip.textContent = pct(fraction(e));
    tip.style.left = Math.min(Math.max(e.clientX, 30), innerWidth - 30) + "px";
  });
  track.addEventListener("mouseleave", () => { tip.hidden = true; });
  track.addEventListener("click", (e) => {
    if (!Read.reader) return;
    Read.reader.clearHighlight();
    Read.reader.display(Read.reader.locationAt(fraction(e)));
  });

  // Marges autour de la page : clic = page précédente / suivante
  const stage = $("#r-stage");
  stage.addEventListener("click", (e) => {
    if (e.target !== stage || !Read.reader) return;
    if (Read.closeOverlays() || Read.reader.zoomed) return;
    const f = Read.reader.frame;
    if (e.clientX < f.offsetLeft) Read.prev();
    else if (e.clientX > f.offsetLeft + f.offsetWidth) Read.next();
    else Read.toggleChrome();
  });
  // Molette : zoom doux centré sur le curseur (voir Reader.zoomWheel).
  stage.addEventListener("wheel", (e) => {
    if (!Read.reader) return;
    const r = stage.getBoundingClientRect();
    Read.reader.zoomWheel(e, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $("#r-zoom").addEventListener("click", () => Read.reader && Read.reader.resetZoom());
  Read.el.addEventListener("mousemove", (e) => Read.pointer(e.clientY));

  window.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", route);
  darkQuery.addEventListener("change", () => { if (Settings.data.theme === "auto") applyTheme(); });

  // Glisser-déposer
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  window.addEventListener("dragenter", (e) => { if (hasFiles(e)) { depth++; $("#drop").hidden = false; } });
  window.addEventListener("dragleave", (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; $("#drop").hidden = true; } });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $("#drop").hidden = true;
    importFiles(e.dataTransfer.files);
  });
}

/* ================= Démarrage ================= */

async function start() {
  Settings.load();
  try { Library.sort = localStorage.getItem("smacpub:sort") || "recent"; } catch { /* ignore */ }
  $("#sort").value = Library.sort;
  applyTheme();
  syncControls();
  bind();

  try {
    await DB.open();
  } catch (err) {
    console.error(err);
    toast("Le stockage local est indisponible : la bibliothèque ne pourra pas être enregistrée.", "error", 10000);
  }
  await Library.refresh().catch((err) => console.error(err));

  // Ouvre directement le livre en cours si l'appli a été fermée pendant la lecture.
  let last = null;
  try { last = localStorage.getItem("smacpub:lastBook"); } catch { /* ignore */ }
  if (!location.hash && last && Library.book(last)) history.replaceState(null, "", "#/livre/" + last);
  route();

  // Fichiers ouverts depuis l'app Fichiers de ChromeOS (appli installée).
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files || !params.files.length) return;
      const files = await Promise.all(params.files.map((h) => h.getFile()));
      const ids = await importFiles(files);
      if (ids.length) go("#/livre/" + ids[0]);
    });
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker :", err));
  }
}

start();

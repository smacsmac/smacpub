/* Stockage local (IndexedDB) : livres, fichiers EPUB et état de lecture. Rien ne quitte l'appareil. */
"use strict";

const DB = {
  NAME: "smacpub",
  VERSION: 1,
  db: null,

  open() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.NAME, this.VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "id" });
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
        if (!db.objectStoreNames.contains("state")) db.createObjectStore("state", { keyPath: "id" });
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
    return this.ready;
  },

  async tx(stores, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      Promise.resolve(fn(t)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("Transaction annulée"));
    });
  },

  req(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },

  get(store, key) { return this.tx(store, "readonly", (t) => this.req(t.objectStore(store).get(key))); },
  all(store) { return this.tx(store, "readonly", (t) => this.req(t.objectStore(store).getAll())); },
  // Les clés seules : savoir QUELS livres sont sur cet appareil sans charger
  // les fichiers eux-mêmes, qui pèsent des centaines de mégaoctets.
  keys(store) { return this.tx(store, "readonly", (t) => this.req(t.objectStore(store).getAllKeys())); },
  /* TOUTE ÉCRITURE APPELLE LA SYNCHRO, ET C'EST ÉCRIT ICI, UNE FOIS.
     Ça l'était ailleurs, dans chaque bouton — et le lecteur, qui enregistre
     la page à chaque fois qu'on la tourne, n'était pas dans la liste. Il
     fallait donc appuyer sur un bouton pour que sa lecture monte au PC, ce
     qui est exactement ce qu'une synchronisation est censée éviter. Un seul
     point de passage : une écriture ajoutée demain sera suivie sans que
     personne y pense.

     `muet` n'est utilisé que par la synchro elle-même, quand elle range ce
     qu'elle vient de recevoir : se réveiller sur ses propres écritures
     relancerait une synchro sans fin. */
  prevenir(store, muet) {
    if (muet || typeof Sync === "undefined") return;
    if (store === "state" || store === "books" || (Array.isArray(store) && store.includes("books"))) Sync.bientot();
  },

  put(store, value, key, muet) {
    return this.tx(store, "readwrite", (t) => { key === undefined ? t.objectStore(store).put(value) : t.objectStore(store).put(value, key); })
      .then((r) => { this.prevenir(store, muet); return r; });
  },

  addBook(book, file) {
    return this.tx(["books", "files"], "readwrite", (t) => {
      t.objectStore("books").put(book);
      t.objectStore("files").put(file, book.id);
    }).then((r) => { this.prevenir("books"); return r; });
  },

  removeBook(id) {
    return this.tx(["books", "files", "state"], "readwrite", (t) => {
      for (const s of ["books", "files", "state"]) t.objectStore(s).delete(id);
    }).then((r) => { this.prevenir("books"); return r; });
  },
};

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
  put(store, value, key) {
    return this.tx(store, "readwrite", (t) => { key === undefined ? t.objectStore(store).put(value) : t.objectStore(store).put(value, key); });
  },

  addBook(book, file) {
    return this.tx(["books", "files"], "readwrite", (t) => {
      t.objectStore("books").put(book);
      t.objectStore("files").put(file, book.id);
    });
  },

  removeBook(id) {
    return this.tx(["books", "files", "state"], "readwrite", (t) => {
      for (const s of ["books", "files", "state"]) t.objectStore(s).delete(id);
    });
  },
};

/* Le serveur du PC, et la passerelle vers Phonétique.
 *
 * L'APPLI NE DÉPEND PAS DU SERVEUR. Sans adresse, ou hors de la maison, elle
 * se comporte exactement comme avant : tout vit dans le navigateur, et c'est
 * ce qui lui permet de lire dans l'autobus. Ce fichier n'ajoute qu'un pont.
 *
 * CE QUI EST PARTAGÉ, ET CE QUI NE L'EST PAS.
 *   partagé : les livres (le fichier lui-même), les couvertures, les
 *             positions de lecture, les signets, les favoris, les titres
 *             qu'on a choisis, et les livres retirés ;
 *   pas partagé : les réglages d'affichage. Un Chromebook et un PC n'ont ni
 *             le même écran ni la même distance aux yeux ; imposer la taille
 *             de texte de l'un à l'autre serait une mauvaise idée déguisée en
 *             synchronisation.
 *
 * LA FUSION N'EST PAS NOUVELLE. C'est celle de « importer une sauvegarde »,
 * sortie de sa fonction pour servir aux deux (`mergeState`) : pour chaque
 * livre, la position la plus récemment lue gagne, et les signets des deux
 * côtés s'additionnent. Aucun « qui gagne » à départager, et deux appareils
 * qui se rencontrent finissent identiques quel que soit l'ordre.
 *
 * UN LIVRE RETIRÉ LAISSE UNE PIERRE TOMBALE. Sans elle, le livre retiré sur
 * le PC reviendrait du Chromebook à la synchro suivante, et inversement, sans
 * fin. La pierre porte la date du retrait : si on rajoute le même fichier
 * après, c'est l'ajout qui est le plus récent, et le livre revient pour de
 * bon.
 */
"use strict";

const Sync = {
  KEY: "smacpubServeur",
  base: "",
  busy: false,
  dire: false,          // l'utilisateur attend-il une réponse ?
  timer: null,
  fichiers: new Set(),  // les livres dont LE PC a le fichier
  couvertures: new Set(),
  manquants: new Set(), // les livres dont CET APPAREIL n'a que la fiche
  envoi: null,          // dépôt de fichiers en cours

  /* L'adresse. Servie DEPUIS le serveur, l'appli n'a rien à régler : elle
   * parle à l'endroit d'où elle vient. C'est le cas courant, et il ne mérite
   * pas un formulaire. Une adresse explicite ne sert qu'à la copie installée
   * depuis GitHub Pages, qui vit à une autre adresse et garde ses données
   * là-bas — ce qui est très bien : elle n'a pas à déménager pour parler au
   * PC. */
  adresse() {
    const choisie = (localStorage.getItem(this.KEY) || "").trim().replace(/\/+$/, "");
    if (choisie) return choisie;
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
    return "";
  },
  explicite() { return (localStorage.getItem(this.KEY) || "").trim(); },

  /* UN PC ABSENT NE RÉPOND PAS « NON » : IL NE RÉPOND RIEN. Une adresse en
   * 192.168 hors de la maison laisse la requête en l'air jusqu'à ce que le
   * système abandonne — trente secondes, parfois plus d'une minute. On coupe
   * nous-mêmes, et court : être ailleurs est la situation normale, pas une
   * panne qu'il faut attendre. (La leçon vient du suivi d'input, qui a mis
   * une minute à s'ouvrir pour ne pas l'avoir faite.) */
  async fetch(url, { ms = 5000, ...reste } = {}) {
    const a = new AbortController();
    const t = setTimeout(() => a.abort(), ms);
    try { return await fetch(url, { ...reste, signal: a.signal }); }
    finally { clearTimeout(t); }
  },
  pourquoi(err) {
    return err && (err.name === "AbortError" || /abort/i.test(err.message || ""))
      ? "pas de réponse" : (err && err.message) || "erreur";
  },

  dit(texte, ennui) {
    const el = document.getElementById("srv-line");
    if (!el) return;
    el.textContent = texte || "";
    el.classList.toggle("warn", !!ennui);
  },

  /* Y a-t-il un serveur au bout ? On le demande avant de se plaindre : sur
   * GitHub Pages, l'origine répond 404 à /health, et ce n'est pas une panne. */
  async vivant() {
    const base = this.adresse();
    if (!base) return false;
    try {
      const r = await this.fetch(base + "/health", { ms: 2500, cache: "no-store" });
      if (!r.ok) return false;
      const d = await r.json();
      return !!d && d.app === "smacpub";
    } catch { return false; }
  },

  /* ── la synchronisation ──────────────────────────────────────────── */

  async sync(manuel) {
    const base = this.adresse();
    if (!base) { if (manuel) this.dit("Aucune adresse : le serveur est désactivé.", true); return false; }
    /* Un appui pendant une synchro déjà partie ne doit pas être avalé en
     * silence : on adopte l'appui, et celle qui est en l'air rendra des
     * comptes comme si on l'avait demandée. */
    if (this.busy) { if (manuel) { this.dire = true; this.dit("Je parle au PC…"); } return false; }
    this.busy = true;
    this.dire = !!manuel;
    if (this.dire) this.dit("Je parle au PC…");
    try {
      const r = await this.fetch(base + "/donnees", { ms: 8000, cache: "no-store" });
      if (!r.ok) throw new Error("le PC a répondu " + r.status);
      const dist = await r.json();
      if (!dist || !Array.isArray(dist.livres)) throw new Error("réponse inattendue");
      this.fichiers = new Set(dist.fichiers || []);

      const local = await this.fusionner(dist);

      const envoi = await this.fetch(base + "/donnees", {
        ms: 20000, method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(local),
      });
      if (!envoi.ok) throw new Error("envoi refusé (" + envoi.status + ")");

      try {
        const c = await this.fetch(base + "/couvertures", { ms: 5000, cache: "no-store" });
        if (c.ok) this.couvertures = new Set(((await c.json()).fichiers || []).map((f) => f.name));
      } catch { /* sans la liste, on redéposera : ce n'est pas grave */ }

      await Library.refresh();
      this.dit("À jour avec le PC — " + new Date().toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" }));
      this.pousser();            // les fichiers suivent, en arrière-plan
      return true;
    } catch (err) {
      /* Hors de la maison, le PC ne répond pas : c'est NORMAL. On ne le dit
       * que si on l'a demandé. */
      if (this.dire) this.dit("Le PC ne répond pas — " + this.pourquoi(err), true);
      else this.dit("");
      return false;
    } finally { this.busy = false; this.dire = false; }
  },

  /* Après une modification : sans précipitation, une page tournée ne vaut pas
   * un aller-retour réseau. */
  bientot() {
    if (!this.adresse()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(false), 5000);
  },

  async fusionner(dist) {
    const [books, states] = await Promise.all([DB.all("books"), DB.all("state")]);
    const locB = new Map(books.map((b) => [b.id, b]));
    const locS = new Map(states.map((s) => [s.id, s]));
    const distB = new Map((dist.livres || []).map((l) => [l.id, l]));
    const distS = new Map((dist.etats || []).map((e) => [e.id, e]));

    // Les pierres tombales des deux côtés, la plus récente l'emporte.
    const retires = {};
    for (const [id, at] of Object.entries(dist.retires || {})) {
      const n = Number(at) || 0;
      if (n) retires[id] = n;
    }
    for (const s of states) if (s.retire) retires[s.id] = Math.max(retires[s.id] || 0, s.retire);

    const aCouvrir = [];        // couvertures à télécharger
    this.manquants = new Set();

    for (const id of new Set([...locB.keys(), ...distB.keys(), ...Object.keys(retires)])) {
      const b = locB.get(id), l = distB.get(id);
      const mort = retires[id] || 0;
      const ajout = Math.max((b && b.addedAt) || 0, (l && l.addedAt) || 0);

      // Retiré après le dernier ajout : il s'en va, et la pierre reste.
      if (mort && mort >= ajout) {
        if (b) {
          await DB.removeBook(id);
          locB.delete(id);
          if (Library.covers.has(id)) { URL.revokeObjectURL(Library.covers.get(id)); Library.covers.delete(id); }
        }
        await DB.put("state", { id, retire: mort });
        locS.set(id, { id, retire: mort });
        continue;
      }
      // Rajouté depuis : la pierre tombale est périmée.
      if (mort) { delete retires[id]; const s = locS.get(id); if (s && s.retire) { delete s.retire; await DB.put("state", s); } }

      if (!l) continue;                     // il n'est que chez nous : on l'enverra
      if (!b) {
        /* Le PC l'a, nous pas. On crée la fiche SANS le fichier : la
         * couverture suffit à le voir sur l'étagère, et le fichier — qui pèse
         * mille fois plus — ne descend qu'à l'ouverture. C'est ce qui permet
         * d'ouvrir l'appli sur le Chromebook et de voir toute sa
         * bibliothèque tout de suite. */
        const fiche = { ...l };
        delete fiche.cover;
        await DB.put("books", fiche);
        locB.set(id, fiche);
        if (l.couverture) aCouvrir.push([id, l.couverture]);
      } else if (l.couverture && (l.coverAt || 0) > (b.coverAt || 0)) {
        aCouvrir.push([id, l.couverture]);  // la couverture a changé là-bas
      } else if (l.couverture && !b.cover) {
        aCouvrir.push([id, l.couverture]);  // fiche sans image : on retente
      }
    }

    // Les états : la fusion de « importer une sauvegarde », mot pour mot.
    for (const [id, inc] of distS) {
      if (retires[id]) continue;
      const cur = locS.get(id) || { id };
      const fusion = mergeState(cur, inc);
      await DB.put("state", fusion);
      locS.set(id, fusion);
    }

    for (const [id, nom] of aCouvrir) await this.prendreCouverture(id, nom);

    // Ce que nous avons, pour le PC. Les images ne passent pas par le JSON :
    // elles ont leur route, et le catalogue ne porte que leurs noms.
    const livres = [...locB.values()].filter((b) => !retires[b.id]).map((b) => {
      const { cover, ...reste } = b;
      return { ...reste, coverAt: b.coverAt || b.addedAt || 0,
               couverture: b.cover ? nomCouverture(b) : (b.couverture || "") };
    });
    const etats = [...locS.values()].filter((s) => !s.retire && Object.keys(s).length > 1);
    /* Ce qui n'est ici qu'une fiche. C'est l'état normal d'un livre ajouté sur
       l'autre machine, et c'est ce que l'étagère signale par « ↓ PC » : le
       titre et la couverture sont là, le fichier descendra à l'ouverture. */
    const aNous = new Set(await DB.keys("files"));
    this.manquants = new Set(livres.filter((b) => !aNous.has(b.id)).map((b) => b.id));
    return { livres, etats, retires };
  },

  async prendreCouverture(id, nom) {
    const base = this.adresse();
    try {
      const r = await this.fetch(base + "/couvertures/" + encodeURIComponent(nom), { ms: 15000 });
      if (!r.ok) return;
      const blob = await r.blob();
      const book = await DB.get("books", id);
      if (!book) return;
      const coverAt = Number((nom.match(/-([a-z0-9]+)\.\w+$/i) || [])[1] ? parseInt((nom.match(/-([a-z0-9]+)\.\w+$/i) || [])[1], 36) : 0) || book.addedAt || Date.now();
      await DB.put("books", { ...book, cover: blob, couverture: nom, coverAt });
      if (Library.covers.has(id)) { URL.revokeObjectURL(Library.covers.get(id)); Library.covers.delete(id); }
    } catch { /* on retentera à la prochaine synchro */ }
  },

  /* ── les fichiers ────────────────────────────────────────────────── */

  /* Déposer la bibliothèque, un livre à la fois. La première fois, ce sont
   * peut-être des gigaoctets : c'est long, et ça n'a pas à bloquer la lecture.
   * On y va en arrière-plan, dans l'ordre, et un échec n'arrête pas les
   * suivants. */
  async pousser() {
    if (this.envoi) return this.envoi;
    this.envoi = (async () => {
      const base = this.adresse();
      const books = await DB.all("books");
      let fichiers = 0, images = 0;
      for (const b of books) {
        if (b.cover) {
          const nom = nomCouverture(b);
          if (!this.couvertures.has(nom)) {
            try {
              const image = await versImageServable(b.cover);
              const r = await this.fetch(base + "/couvertures/" + nom, {
                ms: 30000, method: "PUT", headers: { "content-type": image.type }, body: image,
              });
              if (r.ok) { this.couvertures.add(nom); images++; }
            } catch { /* tant pis, la prochaine fois */ }
          }
        }
        if (this.fichiers.has(b.id)) continue;
        const file = await DB.get("files", b.id);
        if (!file) continue;                       // nous ne l'avons pas non plus
        try {
          const r = await this.fetch(base + "/livres/" + b.id, {
            ms: 10 * 60 * 1000, method: "PUT",
            headers: { "content-type": "application/octet-stream" }, body: file,
          });
          if (r.ok) { this.fichiers.add(b.id); this.manquants.delete(b.id); fichiers++; }
        } catch { /* un livre trop gros ou une coupure : on retentera */ }
      }
      if (fichiers || images) {
        this.dit(`À jour avec le PC — ${fichiers ? plural(fichiers, "livre déposé", "livres déposés") : ""}`
          + `${fichiers && images ? ", " : ""}${images ? plural(images, "couverture", "couvertures") : ""}`);
        await Library.refresh();
      }
    })().finally(() => { this.envoi = null; });
    return this.envoi;
  },

  /* Ouvrir un livre que seul le PC possède : on le descend d'abord. C'est le
   * moment choisi exprès — on ne descend pas trois gigaoctets « au cas où »,
   * on descend le livre qu'on vient de demander. */
  async prendreLivre(id, dire) {
    const base = this.adresse();
    if (!base) return null;
    const avance = dire ? toast("Je descends ce livre du PC…", "", 0) : null;
    try {
      const r = await this.fetch(base + "/livres/" + id, { ms: 10 * 60 * 1000 });
      if (!r.ok) throw new Error("le PC a répondu " + r.status);
      const blob = await r.blob();
      await DB.put("files", blob, id);
      this.manquants.delete(id);
      Library.render();
      if (avance) avance.close();
      return blob;
    } catch (err) {
      if (avance) avance.close();
      if (dire) toast("Ce livre n’a pas pu être descendu du PC : " + this.pourquoi(err), "error", 6000);
      return null;
    }
  },

  /* ── la passerelle vers Phonétique ───────────────────────────────── */

  /* Le dépôt est fait PAR LE SERVEUR, pas par le navigateur. Une page servie
   * en https ne peut pas appeler le http de Phonétique — un navigateur
   * refuse — et il n'y a aucune raison d'installer une deuxième autorité pour
   * contourner ça. Le serveur, lui, n'a pas cette règle : on lui demande, il
   * dépose, et les couvertures voyagent de PC à PC sans repasser par ici.
   *
   * Phonétique REMPLACE sa boîte à chaque dépôt. On envoie donc toujours tout
   * ce qui est marqué « envoyé », pierres tombales comprises — c'est le
   * serveur qui le construit à partir du catalogue. */
  async versPhonetique(dire) {
    const base = this.adresse();
    if (!base) return { ok: false, raison: "il faut le serveur du PC pour envoyer à Phonétique" };
    await this.sync(false);                    // le PC doit voir les marques d'abord
    try {
      const r = await this.fetch(base + "/passerelle", {
        ms: 60000, method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      const d = await r.json().catch(() => ({ ok: false, raison: "réponse illisible" }));
      if (!r.ok || !d.ok) {
        if (dire) toast("Phonétique : " + (d.raison || r.status), "error", 7000);
        return d;
      }
      if (dire) toast(d.envoyees
        ? `${plural(d.envoyees, "BD envoyée", "BD envoyées")} à Phonétique`
          + (d.tombes ? `, ${plural(d.tombes, "retirée", "retirées")}` : "")
        : "Plus aucune BD chez Phonétique.");
      return d;
    } catch (err) {
      if (dire) toast("Phonétique : " + this.pourquoi(err), "error", 6000);
      return { ok: false, raison: this.pourquoi(err) };
    }
  },

  async reglagePhonetique(adresse) {
    const base = this.adresse();
    if (!base) return false;
    try {
      const r = await this.fetch(base + "/reglages", {
        ms: 5000, method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phonetique: adresse }),
      });
      return r.ok;
    } catch { return false; }
  },

  async litReglages() {
    const base = this.adresse();
    if (!base) return null;
    try {
      const r = await this.fetch(base + "/reglages", { ms: 3000, cache: "no-store" });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  },
};

/* Le nom d'une couverture porte la date du choix : `<id>-<date>.jpg`. Changer
 * la couverture change donc le NOM, et c'est ce qui fait que l'autre machine
 * — et Phonétique, qui ne retélécharge une image que si son nom a changé —
 * savent qu'il y a du neuf. */
function nomCouverture(b) {
  const quand = b.coverAt || b.addedAt || 0;
  const type = (b.cover && b.cover.type) || "";
  const ext = /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg";
  return b.id + "-" + quand.toString(36) + "." + ext;
}

/* Phonétique ne sert que .jpg, .png et .webp : tout le reste — un SVG, un
 * GIF, une image sans type — part en JPEG. Le serveur écrirait le fichier
 * sans se plaindre, et l'image resterait invisible là-bas. */
async function versImageServable(blob) {
  if (/^image\/(jpeg|png|webp)$/.test(blob.type || "")) return blob;
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    bmp.close();
    const jpeg = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
    if (jpeg) return jpeg;
  } catch { /* illisible : on tente tel quel */ }
  return new Blob([blob], { type: "image/jpeg" });
}

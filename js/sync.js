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
  /* Le nom de cette page, tiré au sort à son ouverture. Il part avec chaque
     envoi pour que le serveur sache qui écrit, et que la page qui écrit ne se
     réveille pas sur sa propre écriture. */
  moi: Math.random().toString(36).slice(2, 10),
  maj: 0,               // la date du catalogue du PC, telle qu'on l'a vue
  etat: "neuf",         // neuf · travail · ok · souci · absent
  quand: 0,             // la dernière synchro réussie
  es: null,             // le fil ouvert vers le serveur
  essais: 0,

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
    if (el) {
      el.textContent = texte || "";
      el.classList.toggle("warn", !!ennui);
    }
  },

  /* LE BOUTON DE LA BARRE DU HAUT. Il dit trois choses et pas une de plus :
     une coche quand les deux machines sont d'accord, une roue quand on parle
     au PC, un point d'exclamation quand il ne répond pas. Et on peut appuyer
     dessus — c'est le seul moment où une synchro doit rendre des comptes à
     voix haute, puisque c'est le seul moment où on l'a demandée. */
  montre(etat, pourquoi) {
    if (etat) this.etat = etat;
    const b = document.getElementById("sync-btn");
    if (!b) return;
    const quand = this.quand
      ? new Date(this.quand).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" })
      : "";
    const mots = {
      neuf:    ["#i-restart", "Synchroniser avec le PC"],
      travail: ["#i-restart", "Je parle au PC…"],
      ok:      ["#i-check", quand ? `À jour avec le PC — ${quand}` : "À jour avec le PC"],
      souci:   ["#i-cloud-off", pourquoi || "Le PC ne répond pas"],
      absent:  ["#i-cloud-off", "Aucun serveur : tout reste dans ce navigateur"],
    }[this.etat] || ["#i-restart", ""];
    const n = this.manquants.size;
    const suite = { ok: (n ? "\n" + plural(n, "livre est encore sur le PC ; il descendra à son ouverture.",
                                            "livres sont encore sur le PC ; ils descendront à leur ouverture.") : "")
                        + "\nAppuyez pour synchroniser maintenant.",
                    souci: "\nAppuyez pour réessayer.",
                    travail: "", neuf: "", absent: "" }[this.etat] || "";
    b.hidden = false;
    b.dataset.etat = this.etat;
    b.title = mots[1] + suite;
    b.setAttribute("aria-label", mots[1]);
    b.querySelector("use").setAttribute("href", mots[0]);
    const p = b.querySelector(".sync-n");
    if (p) { p.textContent = n ? n : ""; p.hidden = !n; }
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
    if (!base) { if (manuel) this.dit("Aucune adresse : le serveur est désactivé.", true);
                 this.montre("absent"); return false; }
    /* Un appui pendant une synchro déjà partie ne doit pas être avalé en
     * silence : on adopte l'appui, et celle qui est en l'air rendra des
     * comptes comme si on l'avait demandée. */
    if (this.busy) { if (manuel) { this.dire = true; this.dit("Je parle au PC…"); } return false; }
    this.busy = true;
    this.dire = !!manuel;
    if (this.dire) this.dit("Je parle au PC…");
    this.montre("travail");
    try {
      const r = await this.fetch(base + "/donnees", { ms: 8000, cache: "no-store" });
      if (!r.ok) throw new Error("le PC a répondu " + r.status);
      const dist = await r.json();
      if (!dist || !Array.isArray(dist.livres)) throw new Error("réponse inattendue");
      this.fichiers = new Set(dist.fichiers || []);

      const local = await this.fusionner(dist);

      /* RIEN À DIRE, DONC ON SE TAIT. Le cas courant d'une synchro, c'est
         celle qu'on n'a pas demandée : le PC a prévenu, on a relu, et on n'a
         rien à ajouter. Renvoyer quand même le catalogue identique, c'est une
         requête et un pâté de JSON pour rien — et comme on vient de ranger
         les deux côtés de la même façon (`canon`), « identique » se voit
         maintenant d'un coup d'œil. */
      const aDire = JSON.stringify([local.livres, local.etats, local.retires])
                 !== JSON.stringify([dist.livres, dist.etats, dist.retires]);
      this.maj = dist.maj || this.maj;
      if (aDire) {
        const envoi = await this.fetch(base + "/donnees", {
          ms: 20000, method: "PUT",
          headers: { "content-type": "application/json", "x-smacpub-qui": this.moi },
          body: JSON.stringify(local),
        });
        if (!envoi.ok) throw new Error("envoi refusé (" + envoi.status + ")");
        const dit = await envoi.json().catch(() => null);
        // La date du catalogue, pour que la veille sache reconnaître un
        // changement qui n'est pas de nous.
        this.maj = (dit && dit.maj) || this.maj;
      }

      try {
        const c = await this.fetch(base + "/couvertures", { ms: 5000, cache: "no-store" });
        if (c.ok) this.couvertures = new Set(((await c.json()).fichiers || []).map((f) => f.name));
      } catch { /* sans la liste, on redéposera : ce n'est pas grave */ }

      await Library.refresh();
      this.quand = Date.now();
      this.dit("À jour avec le PC — " + new Date().toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" }));
      this.montre("ok");
      this.flux();               // et on reste au bout du fil
      this.pousser();            // les fichiers suivent, en arrière-plan
      return true;
    } catch (err) {
      /* Hors de la maison, le PC ne répond pas : c'est NORMAL. On ne le dit
       * que si on l'a demandé. */
      if (this.dire) this.dit("Le PC ne répond pas — " + this.pourquoi(err), true);
      else this.dit("");
      this.montre("souci", "Le PC ne répond pas — " + this.pourquoi(err));
      return false;
    } finally { this.busy = false; this.dire = false; }
  },

  /* Après une modification. Deux secondes, pas plus : on tourne une page, on
   * pose le livre, on prend l'autre appareil — le temps de traverser la
   * pièce, c'est déjà monté. Mais pas zéro non plus : tourner dix pages
   * d'affilée ne vaut pas dix aller-retours, et le minuteur qu'on remet à
   * zéro à chaque fois s'en occupe.
   *
   * `muet` dans `DB.prevenir` est l'autre moitié de cette mécanique : sans
   * lui, la synchro se réveillerait sur ce qu'elle vient elle-même d'écrire. */
  bientot(ms = 2000) {
    if (!this.adresse()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(false), ms);
  },

  /* ── rester au courant ───────────────────────────────────────────── */

  /* LE FIL. Le serveur garde cette page au bout d'un `EventSource` et lui dit
   * « le catalogue a changé » à l'instant où il change : l'autre appareil n'a
   * donc rien à demander, et rien à attendre. Si le fil casse — le PC
   * redémarre, le Wi-Fi tombe — on le renoue, en espaçant les tentatives
   * plutôt qu'en s'acharnant. */
  flux() {
    const base = this.adresse();
    if (this.es || !base || typeof EventSource === "undefined") return;
    let es;
    try { es = new EventSource(base + "/flux"); } catch { return; }
    this.es = es;
    es.onopen = () => { this.essais = 0; };
    es.onmessage = (e) => {
      let d = null;
      try { d = JSON.parse(e.data); } catch { return; }
      // Celui qui vient d'écrire n'a rien à relire : il sait déjà.
      if (!d || d.auteur === this.moi) return;
      this.maj = d.maj || this.maj;
      this.bientot(250);          // le temps de laisser passer une rafale
    };
    es.onerror = () => {
      es.close();
      if (this.es === es) this.es = null;
      const attente = Math.min(60000, 2000 * Math.pow(2, this.essais++));
      setTimeout(() => this.flux(), attente);
    };
  },

  /* LA VEILLE, et c'est une ceinture, pas une bretelle. Un `EventSource` peut
   * mourir sans le dire — un portable qui sort de veille, un intermédiaire qui
   * coupe. On demande donc de temps en temps au PC la date de son catalogue :
   * c'est deux cents octets, et ça ne coûte rien quand la page est cachée,
   * puisqu'on ne demande pas. */
  veille() {
    setInterval(async () => {
      if (document.visibilityState !== "visible" || this.busy || !this.adresse()) return;
      if (this.es && this.es.readyState === 1) {
        // Le fil est vivant : rien à demander. On vérifie quand même une fois
        // de temps en temps que le PC est toujours là, sinon le bouton
        // mentirait longtemps.
        return;
      }
      try {
        const r = await this.fetch(this.adresse() + "/health", { ms: 3000, cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (d && d.app === "smacpub" && (d.maj || 0) !== this.maj) this.sync(false);
      } catch { /* le PC n'est pas là : on réessaiera */ }
    }, 30000);

    /* Revenir sur l'appli, c'est très souvent arriver du autre appareil. */
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        // On s'en va : ce qui attendait part MAINTENANT, pas dans deux
        // secondes — l'autre appareil est peut-être déjà dans l'autre main.
        if (this.timer) { clearTimeout(this.timer); this.timer = null; this.sync(false); }
        return;
      }
      this.flux();
      this.sync(false);
    });
    window.addEventListener("online", () => { this.flux(); this.sync(false); });
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
        await DB.put("state", { id, retire: mort }, undefined, true);
        locS.set(id, { id, retire: mort });
        continue;
      }
      // Rajouté depuis : la pierre tombale est périmée.
      if (mort) { delete retires[id]; const s = locS.get(id); if (s && s.retire) { delete s.retire; await DB.put("state", s, undefined, true); } }

      if (!l) continue;                     // il n'est que chez nous : on l'enverra
      if (!b) {
        /* Le PC l'a, nous pas. On crée la fiche SANS le fichier : la
         * couverture suffit à le voir sur l'étagère, et le fichier — qui pèse
         * mille fois plus — ne descend qu'à l'ouverture. C'est ce qui permet
         * d'ouvrir l'appli sur le Chromebook et de voir toute sa
         * bibliothèque tout de suite. */
        const fiche = { ...l };
        delete fiche.cover;
        await DB.put("books", fiche, undefined, true);
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
      await DB.put("state", fusion, undefined, true);
      locS.set(id, fusion);
    }

    for (const [id, nom] of aCouvrir) await this.prendreCouverture(id, nom);

    // Ce que nous avons, pour le PC. Les images ne passent pas par le JSON :
    // elles ont leur route, et le catalogue ne porte que leurs noms.
    const livres = [...locB.values()].filter((b) => !retires[b.id]).map((b) => {
      const { cover, ...reste } = b;
      return canon({ ...reste, coverAt: b.coverAt || b.addedAt || 0,
                     couverture: b.cover ? nomCouverture(b) : (b.couverture || "") });
    }).sort(parId);
    const etats = [...locS.values()]
      .filter((s) => !s.retire && Object.keys(s).length > 1)
      .map(canon).filter((s) => Object.keys(s).length > 1).sort(parId);
    /* Ce qui n'est ici qu'une fiche. C'est l'état normal d'un livre ajouté sur
       l'autre machine, et c'est ce que l'étagère signale par « ↓ PC » : le
       titre et la couverture sont là, le fichier descendra à l'ouverture. */
    const aNous = new Set(await DB.keys("files"));
    this.manquants = new Set(livres.filter((b) => !aNous.has(b.id)).map((b) => b.id));
    // Les pierres tombales aussi sont rangées : l'ordre des clés d'un objet
    // change son écriture, et c'est son écriture que le PC compare.
    const tombes = {};
    for (const id of Object.keys(retires).sort()) tombes[id] = retires[id];
    return { livres, etats, retires: tombes };
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
      await DB.put("books", { ...book, cover: blob, couverture: nom, coverAt }, undefined, true);
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
                ms: 30000, method: "PUT",
                headers: { "content-type": image.type, "x-smacpub-qui": this.moi }, body: image,
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
            headers: { "content-type": "application/octet-stream", "x-smacpub-qui": this.moi },
            body: file,
          });
          if (r.ok) { this.fichiers.add(b.id); this.manquants.delete(b.id); fichiers++; }
        } catch { /* un livre trop gros ou une coupure : on retentera */ }
      }
      if (fichiers || images) {
        this.dit(`À jour avec le PC — ${fichiers ? plural(fichiers, "livre déposé", "livres déposés") : ""}`
          + `${fichiers && images ? ", " : ""}${images ? plural(images, "couverture", "couvertures") : ""}`);
        await Library.refresh();
      }
      this.montre();
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
      await DB.put("files", blob, id, true);
      this.manquants.delete(id);
      Library.render();
      this.montre();
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

/* UN MÊME SENS DOIT S'ÉCRIRE D'UNE SEULE FAÇON, et c'est tout sauf un détail
 * d'esthétique.
 *
 * Le PC compare le catalogue qu'il reçoit à celui qu'il garde — en TEXTE,
 * parce que c'est la seule comparaison qui ne se trompe pas sur ce qu'il
 * écrira. Deux appareils d'accord sur le fond mais pas sur la forme — une clé
 * de plus qui ne veut rien dire (`bookmarks: []`, `finished: false`), les
 * mêmes clés dans un autre ordre, les mêmes livres dans un autre ordre — lui
 * paraissent donc en désaccord. Et comme il prévient les pages à chaque
 * changement, le désaccord tourne en rond : il prévient, l'autre relit,
 * réécrit à sa façon, il prévient à nouveau. Mesuré avant correction : un
 * seul tour de page déclenchait huit envois.
 *
 * On range donc avant d'envoyer : les clés en ordre, les tableaux en ordre, et
 * RIEN de ce qui ne veut rien dire. Tout ce que l'appli lit, elle le lit déjà
 * avec un repli (`s.progress || 0`, `s.finished ? …`) : une clé absente et une
 * clé à zéro sont la même chose pour elle. */
function canon(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    if (!v) continue;                                   // 0, "", false, null, undefined
    if (Array.isArray(v) && !v.length) continue;
    if (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out;
}
const parId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

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

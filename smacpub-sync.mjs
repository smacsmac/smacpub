// Smacpub — le serveur du PC.
//
// L'application n'en a pas besoin pour marcher : elle garde tout dans le
// navigateur, et c'est ce qui lui permet de lire dans l'autobus. Ce serveur
// ne remplace rien. Il ajoute **un endroit où la bibliothèque vit aussi**,
// sur le PC — et c'est ce qui permet au Chromebook et au PC d'avoir la même
// bibliothèque, au lieu de deux collections qui s'ignorent.
//
// QUATRE CHOSES VALENT D'ÊTRE DITES AVANT DE LIRE LE CODE.
//
// 1. LE SERVEUR NE FUSIONNE RIEN. C'est l'appli qui fusionne, avec la
//    fonction qui servait déjà à importer une sauvegarde : pour chaque
//    livre, la position la plus récemment lue gagne, les signets des deux
//    côtés s'additionnent. Le serveur garde un fichier et le rend. Toute
//    l'intelligence reste là où elle était déjà écrite.
//
// 2. L'IDENTIFIANT D'UN LIVRE EST L'EMPREINTE DE SON FICHIER (SHA-256 des
//    premiers 12 octets du condensé, `app.js:hashId`). Le même fichier ajouté
//    sur deux machines donne donc le même identifiant, sans s'être concertées.
//    C'est ce qui rend la synchronisation possible — et c'est aussi
//    l'identifiant qu'on donne à Phonétique, qui exige qu'il ne change jamais.
//
// 3. LES FICHIERS DES LIVRES PASSENT PAR ICI, MAIS JAMAIS PAR LE JSON. Un
//    CBZ pèse cent fois le catalogue entier. Ils sont déposés tels quels dans
//    `smacpub-livres/`, en flux, écrits à côté puis renommés. Le catalogue ne
//    porte que leurs noms.
//
// 4. C'EST CE SERVEUR QUI PARLE À PHONÉTIQUE, PAS LE NAVIGATEUR. Une page
//    servie en https ne peut pas appeler le http de Phonétique — un
//    navigateur refuse. Le serveur, lui, n'a pas cette règle : l'appli lui
//    demande de déposer, il dépose. Pas de deuxième autorité à installer, et
//    les couvertures voyagent de PC à PC.
//
//     node smacpub-sync.mjs
//
// Rien à installer : Node seul, aucune dépendance.
import { createServer } from 'node:http';
import { createServer as createServerSecure, request as requestSecure } from 'node:https';
import { request as requestClair } from 'node:http';
import { readFile, writeFile, mkdir, readdir, unlink, rename, stat } from 'node:fs/promises';
import { existsSync, statSync, readFileSync, createReadStream, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ICI = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SMACPUB_PORT) || 8794;
const PORT_SUR = Number(process.env.SMACPUB_PORT_HTTPS) || (PORT + 1);
const DONNEES = process.env.SMACPUB_DONNEES || join(ICI, 'smacpub-donnees.json');
const BIBLIO = process.env.SMACPUB_LIVRES || join(dirname(DONNEES), 'smacpub-livres');
const COUVS = process.env.SMACPUB_COUVERTURES || join(dirname(DONNEES), 'smacpub-couvertures');
const COPIES = join(dirname(DONNEES), 'smacpub-copies');
const GARDE = 30;                       // copies du catalogue conservées
const MAX_JSON = 32 * 1024 * 1024;      // le catalogue : gros, mais pas énorme
const MAX_LIVRE = 1024 * 1024 * 1024;   // un livre : jusqu'à un gigaoctet
const MAX_IMAGE = 16 * 1024 * 1024;

// Les fichiers de l'application, et EUX SEULS. Une liste fermée plutôt qu'un
// dossier ouvert : le serveur vit dans le dossier du dépôt, où il y a aussi
// un .git, des licences et un script de fabrication. Rien de tout ça n'a à
// sortir sur le réseau de la maison.
const TYPES = {
  html:'text/html; charset=utf-8', css:'text/css; charset=utf-8',
  js:'text/javascript; charset=utf-8', webmanifest:'application/manifest+json; charset=utf-8',
  png:'image/png', svg:'image/svg+xml', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp',
};
const APPLI = [
  'index.html', 'css/app.css', 'manifest.webmanifest', 'sw.js',
  'js/fonts.js', 'js/zip.js', 'js/epub.js', 'js/comic.js', 'js/unrar.js',
  'js/db.js', 'js/reader.js', 'js/app.js', 'js/sync.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];
const SERVIS = new Map(APPLI.map(f => ['/' + f, f]));
SERVIS.set('/', 'index.html');

// Le navigateur peut arriver d'ailleurs : l'appli installée depuis GitHub
// Pages garde ses données à SON adresse (un navigateur les range par
// origine), et c'est très bien ainsi — elle n'a pas à déménager pour parler
// au PC. D'où ces en-têtes, les mêmes que Phonétique : sans la ligne
// « Private-Network », Chrome refuserait qu'une page publique appelle une
// adresse en 192.168.
const OUVERT = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'Content-Type, X-Smacpub-Qui',
  'access-control-allow-private-network': 'true',
  'access-control-max-age': '600',
};

/* LE SERVEUR PRÉVIENT, AU LIEU D'ÊTRE INTERROGÉ.
 *
 * Deux appareils ouverts sur la même bibliothèque, et il fallait appuyer sur
 * un bouton de chaque côté : celui qui écrit ne pouvait pas le dire, et celui
 * qui lit ne pouvait pas le savoir. Interroger le serveur toutes les cinq
 * secondes réglerait la question en gaspillant tout, et serait quand même en
 * retard de cinq secondes.
 *
 * Alors le serveur garde les pages ouvertes au bout du fil — un `text/
 * event-stream`, le mécanisme que les navigateurs ont pour ça — et leur dit
 * « le catalogue a changé » à l'instant où il change. C'est une ligne de
 * texte, pas les données : chaque page va les chercher elle-même, en passant
 * par la fusion habituelle.
 *
 * `auteur` est là pour une raison précise : celui qui vient d'écrire n'a rien
 * à relire. Sans ce nom, chaque page qui enregistre se réveillerait
 * elle-même, relirait tout et réécrirait l'identique — un aller-retour entier
 * pour rien, à chaque page tournée.
 */
const abonnes = new Set();
function previens(maj, auteur){
  const ligne = `data: ${JSON.stringify({ maj, auteur })}\n\n`;
  for(const res of [...abonnes]){
    try{ res.write(ligne); }catch{ abonnes.delete(res); }
  }
}
const quiEcrit = req => String(req.headers['x-smacpub-qui'] || '').slice(0, 40);

const json = (res, code, obj) => {
  const corps = JSON.stringify(obj);
  res.writeHead(code, { ...OUVERT, 'content-type':'application/json; charset=utf-8',
                        'cache-control':'no-store',
                        'content-length': Buffer.byteLength(corps) });
  res.end(corps);
};
const sec = n => String(n).replace(/[^A-Za-z0-9._-]/g, '');   // jamais un chemin
const estId = s => /^[a-f0-9]{8,64}$/i.test(s);

// ── le catalogue ─────────────────────────────────────────────────────────
// Un seul fichier, lisible à l'œil nu, et une copie datée à chaque écriture
// différente de la précédente. Le même choix que noter et que le suivi
// d'input, pour la même raison : le jour où quelque chose tourne mal, on veut
// pouvoir ouvrir le fichier d'avant dans un éditeur de texte.
//
// `retires` est un cimetière, et il est indispensable. Sans lui, un livre
// retiré sur le PC reviendrait du Chromebook à la synchro suivante — et
// inversement, pour toujours. Une pierre tombale porte la date du retrait :
// c'est elle qui tranche.
const VIDE = { app:'smacpub', version:1, maj:0, livres:[], etats:[], retires:{},
               reglages:{ phonetique:'' } };

async function litDonnees(){
  try{
    const d = JSON.parse(await readFile(DONNEES, 'utf8'));
    if(!d || typeof d !== 'object' || !Array.isArray(d.livres)) return { ...VIDE };
    return { ...VIDE, ...d,
             livres: d.livres, etats: Array.isArray(d.etats) ? d.etats : [],
             retires: (d.retires && typeof d.retires === 'object') ? d.retires : {},
             reglages: { ...VIDE.reglages, ...(d.reglages || {}) } };
  }catch(err){
    if(err.code !== 'ENOENT') console.warn('  ! catalogue illisible :', err.message);
    return { ...VIDE };
  }
}

async function copieAvant(){
  if(!existsSync(DONNEES)) return;
  try{
    await mkdir(COPIES, { recursive:true });
    const quand = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await writeFile(join(COPIES, `smacpub-${quand}.json`), await readFile(DONNEES));
    const vieilles = (await readdir(COPIES)).filter(f => f.endsWith('.json')).sort();
    for(const f of vieilles.slice(0, Math.max(0, vieilles.length - GARDE)))
      await unlink(join(COPIES, f)).catch(() => {});
  }catch(err){ console.warn('  ! copie impossible :', err.message); }
}

// Écrire à côté puis renommer : une coupure de courant au mauvais moment
// laisse l'ancien fichier entier, jamais un demi-fichier.
async function ecritJson(chemin, obj){
  const tmp = chemin + '.en-cours';
  await writeFile(tmp, JSON.stringify(obj, null, 1));
  await rename(tmp, chemin);
}

async function ecritDonnees(recu){
  const avant = await litDonnees();
  const suite = { app:'smacpub', version:1, maj: Date.now(),
                  livres: recu.livres, etats: recu.etats || [],
                  retires: recu.retires || {},
                  // Les réglages ne passent JAMAIS par ici : l'appli remplace
                  // le catalogue en entier, et elle écraserait l'adresse de
                  // Phonétique avec celle qu'elle avait au chargement. Ils ont
                  // leur propre route, pour cette seule raison.
                  reglages: avant.reglages };
  const pareil = JSON.stringify([avant.livres, avant.etats, avant.retires])
              === JSON.stringify([suite.livres, suite.etats, suite.retires]);
  if(pareil) return { ...avant, change:false };
  await copieAvant();
  await ecritJson(DONNEES, suite);
  return { ...suite, change:true };
}

// Ce que le serveur a vraiment sur le disque. Le catalogue dit « ce livre
// existe » ; ceci dit « et son fichier est là ». Les deux ne sont pas la même
// chose : un dépôt interrompu laisse une fiche sans fichier, et l'appli doit
// pouvoir le voir pour le redéposer.
async function surDisque(dossier){
  const out = new Map();
  try{
    for(const nom of await readdir(dossier)){
      if(nom.startsWith('.') || nom.includes('.en-cours')) continue;
      try{
        const st = await stat(join(dossier, nom));
        if(st.isFile()) out.set(nom, st.size);
      }catch{}
    }
  }catch{ /* dossier pas encore créé */ }
  return out;
}

// ── recevoir ─────────────────────────────────────────────────────────────
// Ce qui arrive par le réseau a une taille annoncée : on la croit sur parole
// pour refuser tout de suite, et on recompte en lisant.
function litCorps(req, max){
  return new Promise((ok, non) => {
    if(Number(req.headers['content-length'] || 0) > max) return non(new Error('trop gros'));
    let n = 0; const bouts = [];
    req.on('data', b => { n += b.length;
      if(n > max){ non(new Error('trop gros')); req.destroy(); return; }
      bouts.push(b); });
    req.on('end', () => ok(Buffer.concat(bouts)));
    req.on('error', non);
  });
}

// Un livre ne passe pas par la mémoire. Il tombe dans un fichier à côté, et
// n'est renommé qu'une fois entier : une interruption ne laisse donc jamais
// un demi-livre dans la bibliothèque, seulement un résidu `.en-cours` que le
// dépôt suivant écrase.
function recoitFichier(req, dossier, nom, max){
  return new Promise(async (ok, non) => {
    if(Number(req.headers['content-length'] || 0) > max) return non(new Error('trop gros'));
    try{ await mkdir(dossier, { recursive:true }); }catch{}
    const final = join(dossier, nom);
    const tmp = final + '.en-cours';
    const flux = createWriteStream(tmp);
    let n = 0, fini = false;
    const rate = err => { if(fini) return; fini = true;
      flux.destroy(); unlink(tmp).catch(() => {}); non(err); };
    req.on('data', b => { n += b.length; if(n > max) rate(new Error('trop gros')); });
    req.on('error', rate);
    flux.on('error', rate);
    req.pipe(flux);
    flux.on('finish', async () => {
      if(fini) return; fini = true;
      try{ await rename(tmp, final); ok(n); }
      catch(err){ await unlink(tmp).catch(() => {}); non(err); }
    });
  });
}

// ── servir ───────────────────────────────────────────────────────────────
function fichierAppli(res, nom){
  const chemin = join(ICI, nom);
  if(!existsSync(chemin)){ res.writeHead(404, OUVERT); return res.end('introuvable'); }
  const ext = (nom.match(/\.(\w+)$/) || [])[1] || '';
  // Pas de cache sur la page ni sur les scripts : c'est le service worker
  // qui décide de ce qui est gardé, et un navigateur qui garderait une
  // vieille copie par-dessus rendrait toute mise à jour imprévisible.
  const dur = /^(png|svg|jpe?g|webp)$/.test(ext) ? 'public, max-age=86400' : 'no-store';
  res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream',
                       'cache-control': dur });
  createReadStream(chemin).pipe(res);
}

function fichierBrut(res, dossier, nom, type){
  const chemin = join(dossier, nom);
  let st;
  try{ st = statSync(chemin); }catch{ return json(res, 404, { ok:false, raison:'introuvable' }); }
  res.writeHead(200, { ...OUVERT, 'content-type':type, 'content-length':st.size,
                       // Un livre ne change jamais : son identifiant EST son
                       // empreinte. On peut donc le garder un an sans risque.
                       'cache-control':'public, max-age=31536000, immutable' });
  createReadStream(chemin).pipe(res);
}

const typeImage = nom => TYPES[(nom.match(/\.(\w+)$/) || [])[1]] || 'application/octet-stream';

// ── la passerelle vers Phonétique ────────────────────────────────────────
// Phonétique tient une boîte aux lettres : un fichier JSON qu'une autre
// application écrit EN ENTIER et qu'elle relève toute seule. Trois règles
// commandent tout ce qui suit, et elles viennent de sa fiche.
//
// 1. C'est un REMPLACEMENT, pas un ajout : on envoie toujours le catalogue
//    complet des livres marqués « envoyé », pierres tombales comprises. Un
//    envoi partiel ferait revenir un livre déjà retiré sur un appareil qui
//    n'avait pas encore relevé.
// 2. `at` doit MONTER pour qu'une correction passe. Phonétique ignore une
//    entrée dont le `at` n'a pas bougé — c'est ce qui protège le compte de
//    mots qu'on a tapé à la main. Chaque appui sur « Envoyer » pose donc un
//    `at` neuf sur le livre concerné.
// 3. La couverture est un NOM DE FICHIER, pas une image. On copie l'image
//    chez Phonétique, puis on nomme ce fichier dans l'entrée.
function requete(url, { method='GET', headers={}, body=null, ms=20000 } = {}){
  return new Promise((ok, non) => {
    let u;
    try{ u = new URL(url); }catch{ return non(new Error('adresse illisible')); }
    const faire = u.protocol === 'https:' ? requestSecure : requestClair;
    const opt = { method, headers,
                  // Le certificat de Phonétique est fabriqué par Phonétique :
                  // le vérifier n'a pas de sens ici, et sur le réseau de la
                  // maison il n'y a personne à tromper.
                  ...(u.protocol === 'https:' ? { rejectUnauthorized:false } : {}) };
    const r = faire(u, opt, rep => {
      const bouts = [];
      rep.on('data', b => bouts.push(b));
      rep.on('end', () => ok({ code: rep.statusCode, corps: Buffer.concat(bouts) }));
    });
    r.setTimeout(ms, () => { r.destroy(new Error('pas de réponse')); });
    r.on('error', non);
    if(body) r.end(body); else r.end();
  });
}

async function depose(adresse){
  const base = String(adresse || '').trim().replace(/\/+$/, '');
  if(!base) return { ok:false, raison:'aucune adresse de Phonétique' };
  const d = await litDonnees();
  const etats = new Map((d.etats || []).map(e => [e.id, e]));
  const images = await surDisque(COUVS);

  const entrees = [];
  let envoyees = 0, tombes = 0, posees = 0, manquantes = 0;

  for(const l of d.livres){
    const e = etats.get(l.id) || {};
    if(!e.phon && !e.phonEfface) continue;              // jamais envoyé : pas notre affaire
    const at = Number(e.phonAt) || Date.now();
    if(e.phonEfface){ entrees.push({ id:l.id, efface:1, at }); tombes++; continue; }
    // Le titre envoyé est celui que TU vois : celui que tu as choisi en
    // renommant, sinon celui du fichier.
    const titre = String(e.customTitle || l.title || '').trim();
    const entree = { id:l.id, titre, at };
    if(l.couverture && images.has(l.couverture)){
      // Le nom porte son extension : le serveur de Phonétique écrit le nom
      // tel quel, mais ne sert que .jpg, .jpeg, .png et .webp — un nom sans
      // extension serait accepté puis invisible.
      const r = await requete(base + '/recolte/couvertures/' + encodeURIComponent(l.couverture), {
        method:'PUT', headers:{ 'content-type': typeImage(l.couverture) },
        body: await readFile(join(COUVS, l.couverture)),
      }).catch(err => ({ code:0, corps:Buffer.from(err.message) }));
      if(r.code === 200){ entree.couverture = l.couverture; posees++; }
      else manquantes++;
    }else if(l.couverture) manquantes++;
    entrees.push(entree);
    envoyees++;
  }

  // Un catalogue vide n'est pas rien : c'est « plus aucune BD chez
  // Phonétique ». On le dépose quand même — les pierres tombales en font
  // partie, et c'est ce qui fait disparaître un livre là-bas.
  const r = await requete(base + '/recolte', {
    method:'PUT', headers:{ 'content-type':'application/json' },
    body: Buffer.from(JSON.stringify({ entrees }), 'utf8'),
  }).catch(err => ({ code:0, corps:Buffer.from(err.message) }));

  if(r.code !== 200) return { ok:false, raison:
    r.code ? `Phonétique a répondu ${r.code} : ${r.corps.toString('utf8').slice(0, 200)}`
           : 'Phonétique ne répond pas (' + r.corps.toString('utf8').slice(0, 120) + ')' };

  console.log(`  ${new Date().toTimeString().slice(0,8)}  → Phonétique : `
    + `${envoyees} livre(s), ${tombes} retiré(s), ${posees} couverture(s)`);
  return { ok:true, envoyees, tombes, couvertures:posees, manquantes, adresse:base };
}

// ── les routes ───────────────────────────────────────────────────────────
async function poigne(req, res){
  let p = '/';
  try{ p = decodeURIComponent(new URL(req.url, 'http://x').pathname); }catch{}

  if(req.method === 'OPTIONS'){ res.writeHead(204, OUVERT); return res.end(); }

  if(p === '/health'){
    const d = await litDonnees();
    const f = await surDisque(BIBLIO);
    return json(res, 200, { ok:true, app:'smacpub', maj:d.maj || 0,
                            livres:d.livres.length, fichiers:f.size,
                            phonetique: !!d.reglages.phonetique });
  }

  if(p === '/flux'){
    if(req.method !== 'GET') return json(res, 405, { ok:false, raison:'méthode' });
    res.writeHead(200, { ...OUVERT, 'content-type':'text/event-stream; charset=utf-8',
                         'cache-control':'no-store', 'connection':'keep-alive',
                         // Un intermédiaire qui met en tampon garderait les
                         // lignes pour lui : ce flux n'a d'intérêt qu'immédiat.
                         'x-accel-buffering':'no' });
    res.write(': bonjour\n\n');
    abonnes.add(res);
    // Un battement régulier : sans trafic, un navigateur ou un intermédiaire
    // ferme une connexion tranquille, et personne ne saurait qu'elle est
    // morte. Le « : » en fait un commentaire, donc rien à traiter côté page.
    const battement = setInterval(() => {
      try{ res.write(': bat\n\n'); }catch{ clearInterval(battement); abonnes.delete(res); }
    }, 25000);
    const fini = () => { clearInterval(battement); abonnes.delete(res); };
    req.on('close', fini);
    req.on('error', fini);
    res.on('error', fini);
    return;
  }

  if(p === '/donnees'){
    if(req.method === 'GET'){
      const d = await litDonnees();
      const f = await surDisque(BIBLIO);
      // `fichiers` n'est pas dans le fichier : on le relève du disque à
      // chaque demande. Une fiche sans fichier est ainsi toujours visible.
      return json(res, 200, { ...d, fichiers:[...f.keys()] });
    }
    if(req.method === 'PUT' || req.method === 'POST'){
      let recu;
      try{ recu = JSON.parse((await litCorps(req, MAX_JSON)).toString('utf8')); }
      catch(err){ return json(res, 400, { ok:false, raison:'corps illisible : ' + err.message }); }
      if(!recu || !Array.isArray(recu.livres))
        return json(res, 400, { ok:false, raison:'il manque « livres »' });
      if(!Array.isArray(recu.etats))
        return json(res, 400, { ok:false, raison:'il manque « etats »' });
      try{
        const d = await ecritDonnees(recu);
        if(d.change){
          console.log(`  ${new Date().toTimeString().slice(0,8)}  reçu `
            + `${d.livres.length} livre(s), ${Object.keys(d.retires).length} retiré(s)`
            + (abonnes.size ? `  → ${abonnes.size} page(s) prévenue(s)` : ''));
          previens(d.maj, quiEcrit(req));
        }
        return json(res, 200, { ok:true, maj:d.maj, change:d.change, livres:d.livres.length });
      }catch(err){ return json(res, 500, { ok:false, raison:err.message }); }
    }
    return json(res, 405, { ok:false, raison:'méthode' });
  }

  if(p === '/reglages'){
    if(req.method === 'GET'){
      const d = await litDonnees();
      return json(res, 200, { ok:true, ...d.reglages });
    }
    if(req.method === 'PUT' || req.method === 'POST'){
      let recu;
      try{ recu = JSON.parse((await litCorps(req, 64 * 1024)).toString('utf8')); }
      catch(err){ return json(res, 400, { ok:false, raison:'corps illisible : ' + err.message }); }
      const d = await litDonnees();
      if(typeof recu.phonetique === 'string')
        d.reglages.phonetique = recu.phonetique.trim().replace(/\/+$/, '').slice(0, 300);
      await ecritJson(DONNEES, d);
      return json(res, 200, { ok:true, ...d.reglages });
    }
    return json(res, 405, { ok:false, raison:'méthode' });
  }

  if(p === '/passerelle'){
    if(req.method !== 'POST' && req.method !== 'PUT')
      return json(res, 405, { ok:false, raison:'méthode' });
    let recu = {};
    try{ recu = JSON.parse((await litCorps(req, 64 * 1024)).toString('utf8') || '{}'); }catch{}
    const d = await litDonnees();
    const r = await depose(recu.adresse || d.reglages.phonetique);
    return json(res, r.ok ? 200 : 502, r);
  }

  // ── les livres ──
  if(p.startsWith('/livres/')){
    const id = sec(p.slice('/livres/'.length));
    if(!estId(id)) return json(res, 400, { ok:false, raison:'identifiant invalide' });
    if(req.method === 'GET' || req.method === 'HEAD'){
      const f = await surDisque(BIBLIO);
      const nom = [...f.keys()].find(n => n === id || n.startsWith(id + '.'));
      if(!nom) return json(res, 404, { ok:false, raison:'ce livre n’est pas sur le PC' });
      return fichierBrut(res, BIBLIO, nom, 'application/octet-stream');
    }
    if(req.method === 'PUT'){
      try{
        const n = await recoitFichier(req, BIBLIO, id, MAX_LIVRE);
        console.log(`  ${new Date().toTimeString().slice(0,8)}  livre ${id} `
          + `(${Math.round(n / 1048576)} Mo)`);
        // Un livre qui arrive, c'est un livre que l'autre appareil peut
        // maintenant ouvrir : il a le droit de l'apprendre tout de suite.
        previens(Date.now(), quiEcrit(req));
        return json(res, 200, { ok:true, id, octets:n });
      }catch(err){ return json(res, err.message === 'trop gros' ? 413 : 500,
                               { ok:false, raison:err.message }); }
    }
    if(req.method === 'DELETE'){
      const f = await surDisque(BIBLIO);
      for(const nom of f.keys())
        if(nom === id || nom.startsWith(id + '.')) await unlink(join(BIBLIO, nom)).catch(() => {});
      return json(res, 200, { ok:true, id });
    }
    return json(res, 405, { ok:false, raison:'méthode' });
  }

  // ── les couvertures ──
  if(p === '/couvertures'){
    if(req.method !== 'GET') return json(res, 405, { ok:false, raison:'méthode' });
    const f = await surDisque(COUVS);
    return json(res, 200, { ok:true, dossier:COUVS,
                            fichiers:[...f].map(([name, size]) => ({ name, size })) });
  }
  if(p.startsWith('/couvertures/')){
    const nom = sec(p.slice('/couvertures/'.length));
    // Le nom d'une couverture porte la date du choix : `<id>-<date>.jpg`.
    // Changer la couverture change donc le NOM, et c'est ce qui fait que
    // l'autre machine — et Phonétique — savent qu'il faut la retélécharger.
    if(!/^[a-f0-9]{8,64}(-[a-z0-9]{1,12})?\.(jpe?g|png|webp)$/i.test(nom))
      return json(res, 400, { ok:false, raison:'nom invalide' });
    if(req.method === 'GET' || req.method === 'HEAD')
      return fichierBrut(res, COUVS, nom, typeImage(nom));
    if(req.method === 'PUT'){
      const type = (req.headers['content-type'] || '').split(';')[0].trim();
      if(!/^image\/(jpeg|png|webp)$/.test(type))
        return json(res, 415, { ok:false, raison:`type non accepté : ${type || 'absent'}` });
      try{
        const n = await recoitFichier(req, COUVS, nom, MAX_IMAGE);
        // Les couvertures d'avant pour ce livre n'ont plus de raison d'être.
        const base = nom.replace(/(-[a-z0-9]+)?\.\w+$/i, '');
        for(const vieux of (await surDisque(COUVS)).keys())
          if(vieux !== nom && (vieux === base || vieux.startsWith(base + '-') || vieux.startsWith(base + '.')))
            await unlink(join(COUVS, vieux)).catch(() => {});
        previens(Date.now(), quiEcrit(req));
        return json(res, 200, { ok:true, fichier:nom, octets:n });
      }catch(err){ return json(res, err.message === 'trop gros' ? 413 : 500,
                               { ok:false, raison:err.message }); }
    }
    return json(res, 405, { ok:false, raison:'méthode' });
  }

  const f = SERVIS.get(p);
  if(f && (req.method === 'GET' || req.method === 'HEAD')) return fichierAppli(res, f);
  res.writeHead(404, { ...OUVERT, 'content-type':'text/plain; charset=utf-8' });
  res.end('introuvable');
}

// ── le certificat de noter ───────────────────────────────────────────────
// Le Chromebook n'installe une application que depuis une adresse sûre, et il
// fait déjà confiance à l'autorité de noter. En fabriquer une deuxième pour la
// même maison et la même machine, ce serait une deuxième à installer, pour
// rien. On lit la sienne, sans jamais rien y écrire.
function dossierCert(){
  const essais = [];
  if(process.env.SMACPUB_CERT) essais.push(process.env.SMACPUB_CERT);
  essais.push(join(ICI, 'noter-cert'), join(ICI, '..', 'noter-cert'),
              join(ICI, '..', 'noter', 'noter-cert'),
              'C:\\Hub\\noter\\noter-cert');
  for(const d of essais){
    try{
      if(statSync(join(d, 'server.crt')).size && statSync(join(d, 'server.key')).size) return d;
    }catch{}
  }
  return null;
}

function adressesLan(){
  const out = [];
  for(const liste of Object.values(networkInterfaces() || {}))
    for(const a of liste || [])
      if(a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

// ── démarrage ────────────────────────────────────────────────────────────
const serveur = createServer((req, res) => {
  poigne(req, res).catch(err => {
    console.error('  ! ', err.message);
    try{ json(res, 500, { ok:false, raison:err.message }); }catch{}
  });
});
serveur.on('error', err => {
  console.error(err.code === 'EADDRINUSE'
    ? `\n  Le port ${PORT} est déjà pris. Une autre copie tourne peut-être déjà.\n`
    : '\n  ' + err.message + '\n');
  process.exit(1);
});
serveur.listen(PORT, '0.0.0.0', async () => {
  const d = await litDonnees();
  const livres = await surDisque(BIBLIO);
  const couvs = await surDisque(COUVS);
  const mo = [...livres.values()].reduce((t, n) => t + n, 0) / 1048576;
  console.log('\n  Smacpub — serveur');
  console.log('  ' + '─'.repeat(52));
  console.log(`  catalogue  ${DONNEES}`
    + (existsSync(DONNEES) ? `  (${d.livres.length} livre(s))` : '  (nouveau)'));
  console.log(`  livres     ${BIBLIO}  (${livres.size} fichier(s), ${mo.toFixed(0)} Mo)`);
  console.log(`  couvertures ${COUVS}  (${couvs.size})`);
  console.log(`  copies     ${COPIES}  (${GARDE} dernières)`);
  console.log('  flux       /flux — les pages ouvertes sont prévenues sans rien demander');
  console.log(`  Phonétique ${d.reglages.phonetique || '— (à régler dans l’appli)'}`);

  const dc = dossierCert();
  if(dc){
    try{
      const sur = createServerSecure({
        key: readFileSync(join(dc, 'server.key'), 'utf8'),
        cert: readFileSync(join(dc, 'server.crt'), 'utf8'),
      }, (req, res) => poigne(req, res).catch(() => {}));
      sur.on('error', e => console.warn('  ! https indisponible :', e.message));
      sur.listen(PORT_SUR, '0.0.0.0');
      console.log(`  certificat ${dc}  (celui de noter, lu seulement)`);
    }catch(err){ console.warn('  ! certificat illisible :', err.message); }
  }else{
    console.log('  certificat introuvable — démarre noter une fois pour qu’il en');
    console.log('             crée un, puis relance. Sans lui, le Chromebook ne');
    console.log('             proposera pas d’installer l’application.');
  }

  console.log('');
  console.log(`  SUR CE PC                 http://localhost:${PORT}`);
  const ips = adressesLan();
  if(ips.length && dc){
    console.log(`  SUR LE CHROMEBOOK         https://${ips[0]}:${PORT_SUR}`);
    console.log('     barre d’adresse › « Installer »');
  }else if(ips.length){
    console.log(`  SUR LE CHROMEBOOK         http://${ips[0]}:${PORT}  (sans certificat)`);
  }
  console.log('');
});

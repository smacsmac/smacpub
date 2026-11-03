// Le serveur du PC et la passerelle vers Phonétique, de bout en bout.
//
// Ce test monte un vrai serveur, un faux Phonétique qui valide comme le vrai,
// et deux vrais navigateurs — le PC et le Chromebook, chacun avec son propre
// stockage. Il vérifie ce qui compte vraiment :
//
//   • qu'un livre ajouté d'un côté apparaisse de l'autre, couverture
//     comprise, SANS que son fichier ait eu besoin de descendre ;
//   • qu'il descende tout seul quand on l'ouvre ;
//   • qu'une position de lecture ne se perde jamais dans l'échange ;
//   • qu'un livre retiré ne revienne pas à la synchro suivante — c'est tout
//     l'intérêt des pierres tombales, et c'est le piège classique de ce genre
//     de synchronisation ;
//   • que ce qui part chez Phonétique soit LE TITRE QU'ON A CHOISI, avec sa
//     couverture, et que la retirer laisse une pierre tombale ;
//   • que l'appli s'ouvre vite quand le PC ne répond pas.
//
//     node tests/test-serveur.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, '..');
const PORT = Number(process.env.SMACPUB_PORT_ESSAI || 8894);
const PORT_PHON = PORT + 2;
const BASE = `http://127.0.0.1:${PORT}`;
const PHON = `http://127.0.0.1:${PORT_PHON}`;
let ok = 0, ko = 0;
const chk = (c, n, e = '') => { c ? ok++ : ko++;
  console.log(c ? '  ✓' : '  ✗ ÉCHEC', n, e === '' ? '' : JSON.stringify(e)); };
const titre = t => console.log(`── ${t} ──`);
const dort = ms => new Promise(r => setTimeout(r, ms));

let chromium = null;
for(const spec of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']){
  try{ ({ chromium } = await import(spec)); break; }catch(_){}
}
if(!chromium) throw new Error(
  'playwright est introuvable — « npm i -D playwright && npx playwright install chromium »');
const PRET = process.env.SMACPUB_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const lancement = existsSync(PRET) ? { executablePath: PRET } : {};

const nid = mkdtempSync(join(tmpdir(), 'smacpub-essai-'));
const DONNEES = join(nid, 'donnees.json');
const BOITE = join(nid, 'phonetique-entrees.json');
const BDIMG = join(nid, 'entrees-couvertures');
let serveur = null, phonetique = null, b = null;

/* ── un CBZ pour de vrai ──────────────────────────────────────────────────
   Un ZIP « stocké » (sans compression), écrit à la main : c'est le format que
   l'appli lit, et il est trop simple pour mériter une dépendance. */
const CRC = (() => { const t = new Int32Array(256);
  for(let n = 0; n < 256; n++){ let c = n;
    for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c; }
  return buf => { let c = -1;
    for(const o of buf) c = t[(c ^ o) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0; };
})();
// Un PNG de 1×1 : assez pour que le navigateur en fasse une image.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64');

function cbz(pages, graine = 0){
  const locaux = [], centraux = [];
  let offset = 0;
  for(const [nom, brut] of pages){
    // Une graine différente par livre : deux livres ne doivent pas avoir la
    // même empreinte, puisque l'empreinte EST l'identifiant.
    const data = graine ? Buffer.concat([brut, Buffer.from([graine])]) : brut;
    const n = Buffer.from(nom, 'utf8');
    const crc = CRC(data);
    const tete = Buffer.alloc(30);
    tete.writeUInt32LE(0x04034b50, 0); tete.writeUInt16LE(20, 4);
    tete.writeUInt32LE(crc, 14); tete.writeUInt32LE(data.length, 18);
    tete.writeUInt32LE(data.length, 22); tete.writeUInt16LE(n.length, 26);
    locaux.push(tete, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    centraux.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const corps = Buffer.concat(locaux);
  const centre = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(pages.length, 8); fin.writeUInt16LE(pages.length, 10);
  fin.writeUInt32LE(centre.length, 12); fin.writeUInt32LE(corps.length, 16);
  return Buffer.concat([corps, centre, fin]);
}

const BD1 = join(nid, 'Tintin - On a marche sur la Lune.cbz');
const BD2 = join(nid, 'Asterix chez les Bretons.cbz');
writeFileSync(BD1, cbz([['page1.png', PNG], ['page2.png', PNG]], 1));
writeFileSync(BD2, cbz([['01.png', PNG], ['02.png', PNG], ['03.png', PNG]], 2));

/* ── un faux Phonétique ───────────────────────────────────────────────────
   Les mêmes routes et LES MÊMES REFUS que le vrai (relevés dans
   `phonetique-sync.mjs` : il manque `entrees`, une entrée sans `id`, un type
   d'image non accepté, un nom de fichier dangereux). Un faux complaisant ne
   prouverait rien. */
function montePhonetique(){
  mkdirSync(BDIMG, { recursive:true });
  return new Promise(pret => {
    phonetique = createServer(async (req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const dit = (code, obj) => { res.writeHead(code, { 'content-type':'application/json' });
        res.end(JSON.stringify(obj)); };
      const corps = () => new Promise(r => { const b = [];
        req.on('data', c => b.push(c)); req.on('end', () => r(Buffer.concat(b))); });

      if(p === '/recolte'){
        if(req.method === 'GET'){
          try{ return dit(200, JSON.parse(readFileSync(BOITE, 'utf8'))); }
          catch{ return dit(200, { entrees:[] }); }
        }
        if(req.method === 'PUT'){
          let o;
          try{ o = JSON.parse((await corps()).toString('utf8')); }
          catch{ return dit(400, { error:'JSON invalide' }); }
          if(!o || typeof o !== 'object') return dit(400, { error:'pas un objet' });
          if(!Array.isArray(o.entrees)) return dit(400, { error:'il manque « entrees »' });
          if(o.entrees.length > 2000) return dit(400, { error:'trop d’entrées' });
          for(const e of o.entrees)
            if(!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id.trim())
              return dit(400, { error:'une entrée n’a pas d’identifiant' });
          o._at = Date.now();
          writeFileSync(BOITE, JSON.stringify(o, null, 1));
          return dit(200, { ok:true, entrees:o.entrees.length });
        }
      }
      if(p.startsWith('/recolte/couvertures/')){
        const nom = p.slice('/recolte/couvertures/'.length);
        if(!/^[A-Za-z0-9._-]{1,120}$/.test(nom) || nom.includes('..'))
          return dit(400, { error:'nom invalide' });
        if(req.method === 'PUT'){
          const type = (req.headers['content-type'] || '').split(';')[0].trim();
          if(!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(type))
            return dit(415, { error:'type non accepté : ' + type });
          writeFileSync(join(BDIMG, nom), await corps());
          return dit(200, { ok:true, fichier:nom });
        }
      }
      dit(404, { error:'inconnu' });
    });
    phonetique.listen(PORT_PHON, '127.0.0.1', pret);
  });
}

function monteServeur(){
  return new Promise((pret, non) => {
    serveur = spawn(process.execPath, [join(RACINE, 'smacpub-sync.mjs')], {
      env: { ...process.env, SMACPUB_PORT:String(PORT), SMACPUB_DONNEES:DONNEES,
             SMACPUB_LIVRES:join(nid, 'livres'), SMACPUB_COUVERTURES:join(nid, 'couvertures'),
             SMACPUB_CERT:join(nid, 'pas-de-cert') },
      stdio:['ignore', 'pipe', 'pipe'],
    });
    let sortie = '';
    serveur.stdout.on('data', d => { sortie += d;
      if(sortie.includes('SUR CE PC')) pret(sortie); });
    serveur.stderr.on('data', d => { sortie += d; });
    setTimeout(() => non(new Error('le serveur n’a pas démarré :\n' + sortie)), 10000);
  });
}

// Un appareil : son navigateur à lui, donc son stockage à lui.
async function appareil(nom){
  const ctx = await b.newContext({ viewport:{ width:1280, height:900 } });
  const p = await ctx.newPage();
  const fautes = [];
  p.on('pageerror', e => fautes.push(nom + ' : ' + e.message));
  await p.goto(BASE + '/', { waitUntil:'domcontentloaded' });
  await p.waitForFunction(
    () => typeof Sync !== 'undefined' && typeof Library !== 'undefined' && !!Library.books,
    null, { timeout:15000 });
  await dort(800);                               // la synchro du démarrage
  return { ctx, p, fautes };
}

const synchro = p => p.evaluate(() => Sync.sync(true));
const etagere = p => p.evaluate(() => Library.books.map(l => ({
  id:l.id, titre:l.title, couv:!!l.cover, pc:Sync.manquants.has(l.id),
  phon:!!l.state.phon, pos:l.state.progress || 0 })));
const boite = () => { try{ return JSON.parse(readFileSync(BOITE, 'utf8')); }
                      catch{ return { entrees:[] }; } };

try{
  await montePhonetique();
  const demarrage = await monteServeur();
  b = await chromium.launch({ ...lancement, args:['--no-sandbox'] });

  // ── 1 ────────────────────────────────────────────────────────────────────
  titre('LE SERVEUR SERT L’APPLI, ET RIEN D’AUTRE');
  const sante = await (await fetch(BASE + '/health')).json();
  chk(sante.ok && sante.app === 'smacpub', 'il se présente', sante);
  for(const [route, attendu] of [['/', 200], ['/js/sync.js', 200], ['/js/app.js', 200],
                                 ['/css/app.css', 200], ['/icons/icon-192.png', 200],
                                 ['/README.md', 404], ['/smacpub-sync.mjs', 404],
                                 ['/.git/config', 404], ['/tools/build-single.py', 404]]){
    const r = await fetch(BASE + route);
    chk(r.status === attendu, `${route} → ${attendu}`, r.status);
  }
  chk(demarrage.includes('catalogue'), 'et il dit où vivent les données');

  // ── 2 ────────────────────────────────────────────────────────────────────
  titre('UN LIVRE AJOUTÉ SUR LE PC MONTE AU PC');
  const pc = await appareil('PC');
  await pc.p.setInputFiles('#file-input', [BD1, BD2]);
  await pc.p.waitForFunction(() => Library.books.length === 2, null, { timeout:30000 });
  const sur = await etagere(pc.p);
  chk(sur.length === 2, 'les deux BD sont sur l’étagère', sur.map(l => l.titre));
  chk(sur.every(l => l.couv), 'avec leur couverture');
  chk(await synchro(pc.p), 'la synchro réussit');
  await pc.p.waitForFunction(() => !Sync.envoi, null, { timeout:60000 });
  const cat = JSON.parse(readFileSync(DONNEES, 'utf8'));
  chk(cat.livres.length === 2, 'le catalogue du PC a les deux livres', cat.livres.length);
  chk(cat.livres.every(l => l.couverture && /\.(png|jpg|webp)$/.test(l.couverture)),
    'chaque fiche nomme sa couverture, extension comprise',
    cat.livres.map(l => l.couverture));
  chk(!JSON.stringify(cat).includes('"cover"'), 'et aucune image n’est entrée dans le JSON');
  const fichiers = readdirSync(join(nid, 'livres'));
  chk(fichiers.length === 2, 'les deux fichiers sont sur le disque', fichiers);
  chk(readdirSync(join(nid, 'couvertures')).length === 2, 'et les deux couvertures');
  chk(fichiers.every(f => readFileSync(join(nid, 'livres', f)).length > 100),
    'et ce sont de vrais fichiers, pas des coquilles');

  // ── 3 ────────────────────────────────────────────────────────────────────
  titre('LE CHROMEBOOK VOIT TOUTE LA BIBLIOTHÈQUE SANS RIEN DESCENDRE');
  const cb = await appareil('Chromebook');
  const vu = await etagere(cb.p);
  chk(vu.length === 2, 'les deux livres sont là', vu.map(l => l.titre));
  chk(vu.every(l => l.couv), 'avec leur couverture, venue du PC');
  chk(vu.every(l => l.pc), 'et marqués « sur le PC » : le fichier n’est pas descendu');
  const poids = await cb.p.evaluate(async () => {
    const f = await DB.all('files');
    return f.length;
  });
  chk(poids === 0, 'rien de lourd dans ce navigateur', poids);

  // ── 4 ────────────────────────────────────────────────────────────────────
  titre('ET LE FICHIER DESCEND QUAND ON OUVRE LE LIVRE');
  const id1 = vu.find(l => /Lune/.test(l.titre)).id;
  await cb.p.evaluate(id => { location.hash = '#/livre/' + id; }, id1);
  await cb.p.waitForFunction(() => !document.getElementById('reader').hidden, null, { timeout:30000 });
  await cb.p.waitForFunction(() => document.getElementById('r-loading').hidden, null, { timeout:30000 });
  const descendu = await cb.p.evaluate(async id => !!(await DB.get('files', id)), id1);
  chk(descendu, 'le fichier est maintenant sur l’appareil');
  chk(await cb.p.evaluate(() => Read.book && Read.book.format === 'comic'),
    'et la BD est ouverte, pas une page d’erreur');

  // ── 5 ────────────────────────────────────────────────────────────────────
  titre('UNE POSITION DE LECTURE NE SE PERD JAMAIS');
  // On referme le livre d'abord : un lecteur ouvert enregistre SA position à
  // lui quand il bouge, et il écraserait celle qu'on pose ici.
  await cb.p.evaluate(() => { location.hash = '#/'; });
  await cb.p.waitForFunction(() => !Read.reader, null, { timeout:10000 });
  await cb.p.evaluate(async id => {
    const s = (await DB.get('state', id)) || { id };
    await DB.put('state', { ...s, progress:0.42, lastReadAt:Date.now(), chapter:'Planche 2' });
    await Library.refresh();
  }, id1);
  chk(await synchro(cb.p), 'le Chromebook envoie sa position');
  chk(await synchro(pc.p), 'le PC relit');
  const posPc = (await etagere(pc.p)).find(l => l.id === id1).pos;
  chk(Math.abs(posPc - 0.42) < 0.001, 'le PC a la position du Chromebook', posPc);
  // Et dans l'autre sens, sur l'autre livre, sans que le premier bouge.
  const id2 = sur.find(l => l.id !== id1).id;
  await pc.p.evaluate(async id => {
    const s = (await DB.get('state', id)) || { id };
    await DB.put('state', { ...s, progress:0.77, lastReadAt:Date.now() });
    await Library.refresh();
  }, id2);
  await synchro(pc.p);
  await synchro(cb.p);
  const deux = await etagere(cb.p);
  chk(Math.abs(deux.find(l => l.id === id2).pos - 0.77) < 0.001,
    'et le Chromebook reçoit celle du PC', deux.find(l => l.id === id2).pos);
  chk(Math.abs(deux.find(l => l.id === id1).pos - 0.42) < 0.001,
    'sans écraser la sienne', deux.find(l => l.id === id1).pos);

  // ── 6 ────────────────────────────────────────────────────────────────────
  // LE CŒUR DE L'AFFAIRE : il ne faut appuyer sur rien. C'est ce qui manquait
  // — le lecteur enregistrait la page tournée sans le dire à la synchro, et
  // l'autre appareil n'avait aucun moyen de l'apprendre.
  titre('ET PERSONNE N’A À APPUYER SUR QUOI QUE CE SOIT');
  const envois = [];
  pc.p.on('request', r => {
    if(r.method() === 'PUT' && /\/donnees$/.test(r.url())) envois.push(Date.now());
  });
  const avant6 = await cb.p.evaluate(i => (Library.book(i).state.progress || 0), id2);
  // Une vraie page tournée, dans le vrai lecteur.
  await pc.p.evaluate(i => { location.hash = '#/livre/' + i; }, id2);
  await pc.p.waitForFunction(() => Read.reader && document.getElementById('r-loading').hidden,
    null, { timeout:30000 });
  await pc.p.keyboard.press('ArrowRight');
  const recu = await cb.p.waitForFunction(
    a => { const b = Library.book(a.id); return !!b && (b.state.progress || 0) !== a.avant; },
    { id:id2, avant:avant6 }, { timeout:20000 }).then(() => true).catch(() => false);
  chk(recu, 'le Chromebook a reçu la page tournée, sans qu’on y touche');
  chk(envois.length >= 1 && envois.length <= 2,
    'et le PC n’a envoyé qu’une fois, pas dix', envois.length);
  // Celui qui écrit est prévenu de sa propre écriture : s'il la relisait, il
  // réécrirait, et ainsi de suite — une synchro qui s'entretient toute seule.
  const compte6 = envois.length;
  await dort(4000);
  chk(envois.length === compte6,
    'et quatre secondes plus tard, plus rien ne bouge : aucune boucle',
    [compte6, envois.length]);
  chk(await pc.p.evaluate(() =>
    document.getElementById('sync-btn').dataset.etat === 'ok'
    && document.querySelector('#sync-btn use').getAttribute('href') === '#i-check'),
    'le bouton de la barre porte une coche');
  await pc.p.evaluate(() => { location.hash = '#/'; });
  await pc.p.waitForFunction(() => !Read.reader, null, { timeout:10000 });

  // ── 7 ────────────────────────────────────────────────────────────────────
  titre('LE TITRE QU’ON CHOISIT EST CELUI QUI COMPTE');
  await cb.p.evaluate(async id => {
    const s = (await DB.get('state', id)) || { id };
    await DB.put('state', { ...s, customTitle:'Tintin — Objectif Lune (relié)', titleAt:Date.now() });
    await Library.refresh();
  }, id1);
  await synchro(cb.p);
  await synchro(pc.p);
  const renomme = (await etagere(pc.p)).find(l => l.id === id1).titre;
  chk(renomme === 'Tintin — Objectif Lune (relié)', 'le PC voit le titre choisi', renomme);

  // ── 7 ────────────────────────────────────────────────────────────────────
  titre('LA PASSERELLE VERS PHONÉTIQUE');
  chk(await pc.p.evaluate(a => Sync.reglagePhonetique(a), PHON),
    'l’adresse de Phonétique s’enregistre sur le PC');
  // Le bouton du menu ⋯, pour de vrai : on ouvre le menu et on clique.
  await pc.p.evaluate(() => { location.hash = '#/'; });
  await pc.p.waitForFunction(() => !document.getElementById('library').hidden, null, { timeout:10000 });
  await pc.p.evaluate(id => Library.openMenu(document.querySelector(`[data-menu="${id}"]`), id), id1);
  const libelle = await pc.p.evaluate(() =>
    document.querySelector('#menu [data-act="phon"]').textContent.trim());
  chk(/Envoyer à Phonétique/.test(libelle), 'le menu propose d’envoyer', libelle);
  await pc.p.click('#menu [data-act="phon"]');
  await pc.p.waitForFunction(() => {
    const t = [...document.querySelectorAll('.toast')].map(e => e.textContent).join(' ');
    return /Phonétique/.test(t);
  }, null, { timeout:30000 });
  const b1 = boite();
  chk(b1.entrees.length === 1, 'une seule entrée est partie', b1.entrees.length);
  chk(b1.entrees[0] && b1.entrees[0].id === id1,
    'avec l’empreinte du fichier comme identifiant', b1.entrees[0] && b1.entrees[0].id);
  chk(b1.entrees[0] && b1.entrees[0].titre === 'Tintin — Objectif Lune (relié)',
    'et LE TITRE CHOISI, pas celui du fichier', b1.entrees[0] && b1.entrees[0].titre);
  chk(b1.entrees[0] && b1.entrees[0].at > 0, 'horodatée', b1.entrees[0] && b1.entrees[0].at);
  const couv = b1.entrees[0] && b1.entrees[0].couverture;
  chk(!!couv && /\.(jpe?g|png|webp)$/i.test(couv),
    'la couverture est nommée, avec une extension que Phonétique sert', couv);
  chk(!!couv && existsSync(join(BDIMG, couv)), 'et l’image est bien arrivée chez lui', couv);
  chk(!!couv && readFileSync(join(BDIMG, couv)).length > 50, 'entière');

  titre('ET ELLE N’ENVOIE QUE CE QU’ON A MARQUÉ');
  chk(!b1.entrees.some(e => e.id === id2), 'l’autre BD n’a pas suivi');

  titre('UNE CORRECTION DE TITRE REPART AVEC UN HORODATAGE PLUS GRAND');
  const avant = b1.entrees[0].at;
  await dort(5);
  await pc.p.evaluate(async id => {
    const s = await DB.get('state', id);
    await DB.put('state', { ...s, customTitle:'On a marché sur la Lune', titleAt:Date.now() });
    await Library.refresh();
    await Sync.versPhonetique(false);
  }, id1);
  const b2 = boite();
  chk(b2.entrees[0].titre === 'On a marché sur la Lune', 'le titre corrigé est parti', b2.entrees[0].titre);
  chk(b2.entrees[0].at >= avant, 'avec un « at » qui n’a pas reculé', [avant, b2.entrees[0].at]);

  titre('RETIRER DE PHONÉTIQUE LAISSE UNE PIERRE TOMBALE');
  await pc.p.evaluate(id => Library.act('phon-off', id), id1);
  await dort(1500);
  const b3 = boite();
  chk(b3.entrees.length === 1 && b3.entrees[0].efface === 1,
    'l’entrée reste, marquée effacée', b3.entrees);
  chk(b3.entrees[0].at >= b2.entrees[0].at,
    'avec un « at » plus grand, sinon Phonétique l’ignorerait',
    [b2.entrees[0].at, b3.entrees[0].at]);

  // ── 8 ────────────────────────────────────────────────────────────────────
  titre('UN LIVRE RETIRÉ NE REVIENT PAS');
  await pc.p.evaluate(async id => {
    await DB.removeBook(id);
    await DB.put('state', { id, retire:Date.now() });
    await Library.refresh();
  }, id2);
  await synchro(pc.p);
  chk((await etagere(pc.p)).length === 1, 'il a disparu du PC');
  await synchro(cb.p);
  chk((await etagere(cb.p)).length === 1, 'puis du Chromebook', await etagere(cb.p));
  await synchro(pc.p);
  await synchro(cb.p);
  chk((await etagere(pc.p)).length === 1 && (await etagere(cb.p)).length === 1,
    'et deux synchros de plus ne le ressuscitent pas');
  const cat2 = JSON.parse(readFileSync(DONNEES, 'utf8'));
  chk(Object.keys(cat2.retires).includes(id2), 'la pierre tombale est sur le PC', cat2.retires);

  titre('MAIS LE RAJOUTER, OUI');
  await cb.p.setInputFiles('#file-input', [BD2]);
  await cb.p.waitForFunction(() => Library.books.length === 2, null, { timeout:30000 });
  await synchro(cb.p);
  await synchro(pc.p);
  chk((await etagere(pc.p)).length === 2, 'le PC le revoit', await etagere(pc.p));
  const cat3 = JSON.parse(readFileSync(DONNEES, 'utf8'));
  chk(!cat3.retires[id2], 'et la pierre tombale a été levée', cat3.retires);

  // ── 9 ────────────────────────────────────────────────────────────────────
  titre('PHONÉTIQUE ABSENT NE CASSE RIEN');
  await pc.p.evaluate(a => Sync.reglagePhonetique(a), 'http://127.0.0.1:1');
  const echec = await pc.p.evaluate(() => Sync.versPhonetique(false));
  chk(echec && echec.ok === false, 'l’envoi échoue proprement', echec && echec.raison);
  chk(!!(echec && echec.raison), 'et il dit pourquoi', echec && echec.raison);
  chk((await etagere(pc.p)).length === 2, 'la bibliothèque est intacte');
  await pc.p.evaluate(a => Sync.reglagePhonetique(a), PHON);

  // ── 10 ───────────────────────────────────────────────────────────────────
  titre('UN ENVOI ABÎMÉ NE CASSE RIEN');
  const avantJson = readFileSync(DONNEES, 'utf8');
  const refus = await fetch(BASE + '/donnees', { method:'PUT',
    headers:{ 'content-type':'application/json' }, body:JSON.stringify({ livres:'oui' }) });
  chk(refus.status === 400, 'un catalogue sans tableau est refusé', refus.status);
  chk(readFileSync(DONNEES, 'utf8') === avantJson, 'et le fichier du PC n’a pas bougé');
  const nom = await fetch(BASE + '/couvertures/..%2Fevade.jpg');
  chk(nom.status === 400 || nom.status === 404, 'un nom qui remonte ailleurs est refusé', nom.status);
  const type = await fetch(BASE + '/couvertures/abcdef12-1.jpg',
    { method:'PUT', headers:{ 'content-type':'text/plain' }, body:'pas une image' });
  chk(type.status === 415, 'une couverture qui n’est pas une image est refusée', type.status);

  // ── 11 ───────────────────────────────────────────────────────────────────
  titre('AUCUNE ERREUR DE PAGE, DES DEUX CÔTÉS');
  chk(!pc.fautes.length && !cb.fautes.length, 'rien n’a explosé en route',
    [...pc.fautes, ...cb.fautes]);

  await pc.ctx.close();
  await cb.ctx.close();

  // ── 12 ───────────────────────────────────────────────────────────────────
  // Un serveur refusé net (connexion impossible) ne reproduirait pas la
  // panne : l'échec est immédiat. Il faut un serveur qui ACCEPTE et se taise
  // — c'est ce que fait ce relais, et c'est tout l'intérêt du test.
  titre('L’APPLI S’OUVRE VITE QUAND LE PC NE RÉPOND PAS');
  let muet = false;
  const enAttente = [];
  const relais = createServer((req, res) => {
    if(muet){ enAttente.push(res); return; }
    import('node:http').then(({ request }) => {
      const sortant = request({ hostname:'127.0.0.1', port:PORT, path:req.url,
                                method:req.method, headers:req.headers }, rep => {
        res.writeHead(rep.statusCode, rep.headers);
        rep.pipe(res);
      });
      sortant.on('error', () => { try{ res.writeHead(502); res.end(); }catch{} });
      req.pipe(sortant);
    });
  });
  await new Promise(r => relais.listen(PORT + 1, '127.0.0.1', r));
  const VIA = `http://127.0.0.1:${PORT + 1}`;
  const ctx = await b.newContext({ viewport:{ width:1280, height:900 } });
  const p = await ctx.newPage();
  await p.goto(VIA + '/', { waitUntil:'domcontentloaded' });
  await p.waitForFunction(() => typeof Sync !== 'undefined', null, { timeout:15000 });
  await dort(1500);                                  // le service worker s'installe
  chk(await p.evaluate(() => !!navigator.serviceWorker.controller
    || navigator.serviceWorker.getRegistration().then(r => !!r)), 'le service worker s’installe');
  muet = true;
  const t0 = Date.now();
  await p.goto(VIA + '/', { waitUntil:'domcontentloaded', timeout:30000 });
  await p.waitForFunction(() => !!document.getElementById('grid'), null, { timeout:15000 });
  const ms = Date.now() - t0;
  chk(ms < 5000, `et vite : ${ms} ms, pas soixante secondes`, ms);
  chk(await p.evaluate(() => !!document.querySelector('#library')),
    'c’est bien l’application, pas une page d’erreur');
  // Et le bouton ne doit pas mentir : un PC muet, c'est un nuage barré.
  await p.evaluate(() => document.getElementById('sync-btn').click());
  const souci = await p.waitForFunction(
    () => document.getElementById('sync-btn').dataset.etat === 'souci',
    null, { timeout:20000 }).then(() => true).catch(() => false);
  chk(souci, 'et le bouton le dit : le PC ne répond pas');
  for(const r of enAttente){ try{ r.writeHead(504); r.end(); }catch{} }
  await ctx.close();
  relais.close();

}finally{
  if(b) await b.close().catch(() => {});
  if(serveur) serveur.kill();
  if(phonetique) phonetique.close();
  rmSync(nid, { recursive:true, force:true });
}

console.log(`\n${ok} réussites, ${ko} échecs`);
process.exit(ko ? 1 : 0);

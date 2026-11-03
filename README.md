# Smacpub

Un petit lecteur EPUB et BD (CBR, CBZ), simple et élégant, qui fonctionne **entièrement hors-ligne**, pensé pour un Chromebook.
Pas de compte : vos livres et vos positions de lecture restent sur votre appareil.
Et si vous le voulez, **un serveur sur votre PC** pour que deux machines voient la même bibliothèque — il est facultatif, et l'appli ne l'attend jamais.

## Ce que fait l'appli

**Bibliothèque**
- Ajout d'EPUB et de BD (`.cbr`, `.cbz`) par bouton ou glisser-déposer (plusieurs à la fois). Les doublons sont détectés.
- Grille de couvertures avec progression. Une couverture est générée si le livre n'en a pas.
- Carte « Continuer la lecture » en haut : le dernier livre ouvert, le chapitre, le pourcentage.
- Filtres (en cours, à lire, terminés, favoris), tri (récents, titre, auteur, ajout, progression), recherche par titre ou auteur.
- Menu par livre : favori, marquer comme terminé, recommencer au début, renommer (le titre choisi s'affiche partout dans l'appli, le fichier garde son nom ; retour au titre d'origine possible), changer la couverture (avec retour à l'originale), retirer de la bibliothèque (le fichier d'origine n'est jamais touché).

**Lecture**
- Pages à tourner (flèches, espace, glissement du doigt, clic dans les marges).
- **La position est enregistrée à chaque page tournée**, même si l'appli est fermée brutalement. En rouvrant l'appli, on retombe directement sur la page où on s'était arrêté.
- Cette position ne dépend pas de la taille du texte : on peut changer de police ou redimensionner la fenêtre sans perdre sa page.
- Sommaire (y compris pour les vieux EPUB sans sommaire : il est reconstruit à partir des titres).
- Recherche dans le livre, sans tenir compte des accents ni des majuscules, avec surlignage du résultat.
- Signets avec un extrait du passage, le chapitre et la date.
- Liens internes (notes de bas de page…) avec un bouton « Revenir ».
- Barre de progression cliquable pour sauter n'importe où dans le livre.
- Une ou deux pages à la fois (automatique quand la fenêtre est assez large).
- Zoom (molette, pincement, `E`/`Q` ou flèches ↑/↓), doux et centré sur le curseur, plus fin en tenant `Maj` ; la barre et les boutons ne sont pas agrandis.
  On déplace la page en la faisant glisser ou avec W A S D (plus lentement en tenant `Maj`), même au-delà des bords ; le zoom est conservé d'une page à l'autre ; `Échap` pour revenir.
- **Vues mémorisées** : jusqu'à 4 par livre, chacune garde le zoom et la position (`Maj` + `1` à `4` pour mémoriser, `1` à `4` pour y aller).
  Elles servent sur toutes les pages du livre : en BD, par exemple, une vue en haut à gauche et une autre en bas à droite, à rappeler à chaque page.
  Aussi dans le menu Aa (cases 1 à 4).
  `C` tourne la page et va à la vue 1, `X` revient à la page précédente et va à la vue 4 (option dans ⚙, activée par défaut) :
  on lit une planche de la vue 1 à la vue 4, puis `C` pour la suivante.
- Plein écran avec `F` (ou le bouton ⛶) : la barre et le pied de page disparaissent, la page prend toute la place. Hors plein écran, toute l'interface reste visible.
- Thèmes clair, sépia et sombre, et une couleur d'accent au choix (orange, violet, bleu, vert, rose, ardoise) ; police « livre » (Literata, incluse), sans-serif ou celle de l'éditeur ; taille, interligne, largeur de colonne, texte justifié.

**Bandes dessinées (CBR, CBZ)**
- Les `.cbz` (ZIP) et les `.cbr` (RAR, y compris RAR5) s'ouvrent comme un livre : planches en ordre naturel
  (`page2` avant `page10`), couverture seule, puis pages en vis-à-vis en mode deux pages ; une double page panoramique s'affiche seule, en grand.
- Un `.cbr` est décompressé une seule fois, à l'ajout (un message indique l'avancement) ; ensuite il s'ouvre aussi vite qu'un `.cbz`.
  Le fichier d'origine n'est jamais modifié.
- Titre, numéro et auteurs lus dans `ComicInfo.xml` quand il existe ; sinon le nom du fichier. Les sous-dossiers deviennent des chapitres du sommaire.
- Zoom, déplacement W A S D, plein écran, signets et reprise de lecture marchent comme pour un livre.
  La recherche et les réglages de texte sont masqués (il n'y a pas de texte).
- Non pris en charge : les archives protégées par mot de passe et les `.cb7` (7-Zip).

**Vieux EPUB**
- EPUB 2 (NCX) et EPUB 3 (nav), HTML mal formé, encodages anciens (ISO-8859-1, Windows-1252…), métadonnées manquantes.
- Les chapitres très longs (un livre entier dans un seul fichier) sont découpés à l'affichage pour rester rapides.
- Les scripts éventuellement présents dans un livre ne s'exécutent jamais (ils sont retirés, comme les liens `javascript:`).

**Extensions du navigateur (TransOver, dictionnaires…)**
- Le texte du livre est affiché directement dans la page : les extensions qui traduisent ou définissent
  un mot au survol ou à la sélection fonctionnent comme sur n'importe quel site.
- Si vous ouvrez Smacpub **depuis un fichier** (`smacpub.html`), Chrome demande une autorisation :
  `chrome://extensions` → l'extension (par ex. TransOver) → **Détails** → activer **« Autoriser l'accès aux URL de fichier »**.
  Ce n'est pas nécessaire avec la version installée depuis GitHub Pages.

## Installer sur le Chromebook

### Option A : comme une vraie application (recommandé)

1. Publiez le dossier avec **GitHub Pages** : sur GitHub, *Settings → Pages → Build and deployment*,
   choisissez *Deploy from a branch*, la branche qui contient ces fichiers et le dossier `/ (root)`.
   (GitHub Pages est gratuit pour un dépôt public.)
2. Ouvrez l'adresse indiquée (du type `https://<utilisateur>.github.io/smacpub/`) dans Chrome.
3. Cliquez sur l'icône **Installer** dans la barre d'adresse (ou menu ⋮ → *Caster, enregistrer et partager → Installer la page en tant qu'appli*).

Smacpub apparaît alors dans le lanceur du Chromebook et s'ouvre dans sa propre fenêtre, **sans connexion Internet**.
Bonus : dans l'app *Fichiers*, clic droit sur un `.epub`, `.cbr` ou `.cbz` → *Ouvrir avec → Smacpub*.

### Option B : directement depuis un dossier

Téléchargez le dépôt (*Code → Download ZIP*), décompressez-le dans *Mes fichiers*, puis ouvrez `index.html` avec Chrome.
Tout fonctionne aussi, mais l'appli n'apparaît pas dans le lanceur.

### Option C : un seul fichier

`python3 tools/build-single.py` produit `smacpub.html`, qui contient toute l'appli (styles, scripts, police, lecteur RAR).
Il suffit de l'ouvrir avec Chrome.

## Raccourcis clavier

| Touche | Action |
| --- | --- |
| `→` ou `Espace` | Page suivante |
| `←` ou `Maj+Espace` | Page précédente |
| `C` / `X` | Page suivante / précédente, en allant à la vue 1 / à la vue 4 (option dans ⚙, activée par défaut) |
| `T` | Sommaire |
| `B` | Ajouter / retirer un signet |
| `R` ou `/` | Rechercher dans le livre |
| `F` | Plein écran : rien que la page (`F` ou `Échap` pour sortir) |
| `+` / `−` | Taille du texte |
| `9` / `0` | Une page / deux pages à la fois |
| `1` à `4` | Aller à une vue mémorisée (zoom + position) ; `Maj` + `1` à `4` pour mémoriser la vue actuelle |
| Molette, `E` / `Q`, `↑` / `↓` | Zoomer / dézoomer vers le curseur (`E` ou `↑` zoome, `Q` ou `↓` dézoome) ; avec `Maj`, plus finement |
| `W` `A` `S` `D` | Déplacer la page : `W` vers le haut, `S` vers le bas, `A` à gauche, `D` à droite ; avec `Maj`, plus lentement (ou glisser une image, les marges, ou n'importe où avec `Ctrl` ; options dans ⚙ pour inverser W et S, ou A et D) |
| `Échap` | Taille et position normales, fermer un menu, puis revenir à la bibliothèque |

## Le serveur du PC (facultatif)

`node smacpub-sync.mjs` — ou un double-clic sur `demarrer-smacpub.cmd`. Rien à installer : Node seul, aucune dépendance.

Il fait deux choses, et pas une de plus.

1. **Il sert l'application** sur `http://localhost:8794` et, si le certificat de noter est à portée, sur `https://<adresse-du-pc>:8795` — la deuxième est celle qui permet au Chromebook de l'installer comme une vraie application.
2. **Il garde la bibliothèque** : le catalogue dans `smacpub-donnees.json` (lisible à l'œil nu, avec les trente dernières versions dans `smacpub-copies/`), les fichiers dans `smacpub-livres/`, les couvertures dans `smacpub-couvertures/`.

### Il n'y a rien à appuyer

La synchronisation se fait toute seule, dans les deux sens.

- **Ce que vous changez part tout seul**, deux secondes plus tard : une page tournée, un signet, un favori, un titre renommé, un livre ajouté ou retiré. Toute écriture passe par un seul point (`js/db.js`, `prevenir`), donc aucune ne peut être oubliée.
- **Ce que l'autre appareil change arrive tout seul**, dans la seconde : le serveur garde les pages ouvertes au bout d'un fil (`/flux`) et leur dit « le catalogue a changé » à l'instant où il change. Pas d'interrogation toutes les cinq secondes, et pas de retard de cinq secondes non plus.
- Si ce fil meurt sans le dire — un portable qui sort de veille, un PC qui redémarre — une veille discrète le renoue et rattrape ce qui manque.

**Le bouton de la barre du haut**, à gauche de l'engrenage, dit où on en est : une coche quand les deux machines sont d'accord (avec l'heure de la dernière synchro), une roue qui tourne pendant l'échange, un nuage barré quand le PC ne répond pas. Le chiffre orange compte les livres dont cet appareil n'a que la fiche. On peut appuyer dessus pour forcer une synchro — mais normalement, on n'a pas à y penser.

### Ce que ça change

Le PC et le Chromebook voient **la même étagère**. Un livre ajouté sur l'un apparaît sur l'autre avec son titre et sa couverture, et **son fichier ne descend qu'à la première ouverture** — le catalogue pèse quelques kilo-octets, un CBZ parfois trois cents mégaoctets. Un livre qui n'est pas encore là porte la mention `↓ PC` sur l'étagère.

Sont partagés : les livres, les couvertures, les positions de lecture, les signets, les favoris, les titres que vous avez choisis en renommant, et les livres retirés. Ne le sont pas : les réglages d'affichage — un Chromebook et un PC n'ont ni le même écran ni la même distance aux yeux.

La fusion n'a rien de neuf : c'est celle d'« importer une sauvegarde ». Pour chaque livre, la position la plus récemment lue gagne, et les signets des deux côtés s'additionnent. Deux appareils qui se rencontrent finissent identiques, quel que soit l'ordre.

### Un livre retiré ne revient pas

Retirer un livre laisse une **pierre tombale** datée. Sans elle, le livre retiré sur le PC reviendrait du Chromebook à la synchro suivante, et inversement, sans fin. Et si vous rajoutez le même fichier plus tard, c'est l'ajout qui est le plus récent : le livre revient pour de bon.

### Où mettre l'adresse

Nulle part, dans le cas normal : servie depuis le PC, l'appli parle à l'adresse d'où elle vient. Le champ **⚙ Paramètres → Serveur du PC** ne sert qu'à la copie installée depuis GitHub Pages, qui vit à une autre adresse — elle garde ses données là-bas, ce qui est très bien, et il lui suffit de connaître le PC pour se synchroniser avec lui. Dans ce cas il faut installer une fois l'autorité de noter sur l'appareil, sans quoi le navigateur refusera d'appeler le `https` du PC.

## Envoyer un livre à Phonétique

Phonétique — l'autre application de la maison — tient une **chronologie** de tout ce qui a été lu. Smacpub peut y déposer ses titres et ses couvertures : dans le menu **⋯** d'un livre, **« Envoyer à Phonétique »**. Le titre envoyé est **celui que vous voyez** : celui que vous avez choisi en renommant, sinon celui du fichier.

- Il n'y va que si vous le dites, livre par livre. Rien ne part tout seul.
- **« Renvoyer à Phonétique »** repart avec un horodatage neuf : c'est ainsi qu'une correction de titre passe.
- **« Retirer de Phonétique »** le fait disparaître de la chronologie, et la disparition voyage entre ses appareils.
- Vos comptes de mots et vos dates de lecture, chez Phonétique, **ne sont jamais touchés** : la passerelle n'écrit que le titre et la couverture.
- L'adresse du serveur de Phonétique se met dans **⚙ Paramètres → Serveur du PC**. C'est le PC qui appelle Phonétique, jamais le navigateur : une page servie en https ne peut pas appeler du http, et il n'y a aucune raison d'installer une deuxième autorité pour contourner ça.

Côté Phonétique, il faut que son serveur ait les routes de la boîte aux lettres (`/recolte`) : remplacer son `index.html` ne suffit pas, il faut aussi son `phonetique-sync.mjs`, et le redémarrer. Le signe que c'est bon : la ligne `entrées …` à son démarrage.

## Vos données

- Les livres, positions, signets et favoris sont stockés dans le navigateur (IndexedDB), uniquement sur cet appareil — et sur le PC si son serveur tourne.
- ⚙ **Paramètres → Exporter mes données** crée un petit fichier de sauvegarde (positions, signets, favoris, réglages).
  **Importer une sauvegarde** le recharge, par exemple sur un autre ordinateur : après avoir ré-ajouté les mêmes EPUB, tout est retrouvé.
- Gardez vos fichiers EPUB d'origine : la sauvegarde ne les contient pas.
- Effacer les données du site dans Chrome efface aussi la bibliothèque. Si le serveur du PC tourne, elle revient à la synchro suivante.

## Idées pour plus tard

Collections personnalisées, surlignage et notes, recherche dans toute la bibliothèque, petites statistiques de lecture,
édition des métadonnées… L'appli a été volontairement gardée légère.

## Fichiers

```
index.html             structure de la page
css/app.css            apparence (thèmes clair / sépia / sombre)
js/zip.js              lecture des archives ZIP (décompression native du navigateur)
js/epub.js             analyse des EPUB : métadonnées, sommaire, couverture, chapitres
js/comic.js            BD (CBZ, CBR) : planches, doubles pages, ComicInfo.xml, conversion des RAR
js/unrar.js            décompression RAR (UnRAR compilé en WebAssembly), chargé seulement pour les .cbr
js/reader.js           affichage paginé et positions de lecture
js/db.js               stockage local (IndexedDB)
js/sync.js             le serveur du PC et la passerelle vers Phonétique
js/app.js              bibliothèque, lecteur, réglages, sauvegarde
js/fonts.js            police Literata intégrée
sw.js                  fonctionnement hors-ligne (service worker)
manifest.webmanifest   installation comme application
tools/build-single.py  assemble le tout en un seul fichier smacpub.html
smacpub-sync.mjs       le serveur du PC (facultatif, Node seul)
demarrer-smacpub.cmd   pour le lancer d'un double-clic sur Windows
tests/test-serveur.mjs éprouve le serveur et la passerelle, deux vrais navigateurs
```

`node tests/test-serveur.mjs` monte un vrai serveur, un faux Phonétique qui refuse ce que le vrai refuse, et deux navigateurs isolés : un livre ajouté d'un côté arrive de l'autre, une position ne se perd pas, un livre retiré ne revient pas, le titre choisi est celui qui part, et l'appli s'ouvre en moins d'une seconde même quand le PC accepte la connexion et se tait.

Aucune étape de compilation : ce sont des fichiers HTML, CSS et JavaScript ordinaires.
Seul `js/unrar.js` est généré (depuis [node-unrar-js](https://github.com/YuJianrong/node-unrar.js) 2.0.2, regroupé avec esbuild, WebAssembly inclus).
L'appli installée récupère les mises à jour d'elle-même (elles s'appliquent au lancement suivant) ;
augmenter la version `CACHE` dans `sw.js` force un rafraîchissement complet.

## Licences

- Police [Literata](https://github.com/googlefonts/literata) : SIL Open Font License 1.1 (`LICENSES/Literata-OFL.txt`).
- Icônes [Lucide](https://lucide.dev) : licence ISC (`LICENSES/Lucide-ISC.txt`).
- [node-unrar-js](https://github.com/YuJianrong/node-unrar.js) : licence MIT (`LICENSES/node-unrar-js-MIT.txt`).
- UnRAR, d'Alexander Roshal : licence UnRAR, libre d'usage pour lire les archives RAR (`LICENSES/UnRAR.txt`).

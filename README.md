# Smacpub

Un petit lecteur EPUB et BD (CBR, CBZ), simple et élégant, qui fonctionne **entièrement hors-ligne**, pensé pour un Chromebook.
Pas de compte, pas de serveur : vos livres et vos positions de lecture restent sur votre appareil.

## Ce que fait l'appli

**Bibliothèque**
- Ajout d'EPUB et de BD (`.cbr`, `.cbz`) par bouton ou glisser-déposer (plusieurs à la fois). Les doublons sont détectés.
- Grille de couvertures avec progression. Une couverture est générée si le livre n'en a pas.
- Carte « Continuer la lecture » en haut : le dernier livre ouvert, le chapitre, le pourcentage.
- Filtres (en cours, à lire, terminés, favoris), tri (récents, titre, auteur, ajout, progression), recherche par titre ou auteur.
- Menu par livre : favori, marquer comme terminé, recommencer au début, changer la couverture (avec retour à l'originale), retirer de la bibliothèque (le fichier d'origine n'est jamais touché).

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
- Zoom (molette, pincement, flèches ↑/↓), doux et centré sur le curseur ; la barre et les boutons ne sont pas agrandis.
  On déplace la page en la faisant glisser ou avec W A S D, même au-delà des bords ; le zoom est conservé d'une page à l'autre ; `0` ou `Échap` pour revenir.
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
| `T` | Sommaire |
| `B` | Ajouter / retirer un signet |
| `R` ou `/` | Rechercher dans le livre |
| `F` | Plein écran : rien que la page (`F` ou `Échap` pour sortir) |
| `+` / `−` | Taille du texte |
| `1` / `2` | Une page / deux pages à la fois |
| Molette, `↑` / `↓` | Zoomer / dézoomer vers le curseur |
| `W` `A` `S` `D` | Déplacer la page : `W` vers le haut, `S` vers le bas, `A` à gauche, `D` à droite (ou glisser une image, les marges, ou n'importe où avec `Ctrl` ; option dans ⚙ pour inverser W et S) |
| `0` | Taille et position normales |
| `Échap` | Fermer un menu, puis revenir à la bibliothèque |

## Vos données

- Les livres, positions, signets et favoris sont stockés dans le navigateur (IndexedDB), uniquement sur cet appareil.
- ⚙ **Paramètres → Exporter mes données** crée un petit fichier de sauvegarde (positions, signets, favoris, réglages).
  **Importer une sauvegarde** le recharge, par exemple sur un autre ordinateur : après avoir ré-ajouté les mêmes EPUB, tout est retrouvé.
- Gardez vos fichiers EPUB d'origine : la sauvegarde ne les contient pas.
- Effacer les données du site dans Chrome efface aussi la bibliothèque.

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
js/app.js              bibliothèque, lecteur, réglages, sauvegarde
js/fonts.js            police Literata intégrée
sw.js                  fonctionnement hors-ligne (service worker)
manifest.webmanifest   installation comme application
tools/build-single.py  assemble le tout en un seul fichier smacpub.html
```

Aucune étape de compilation : ce sont des fichiers HTML, CSS et JavaScript ordinaires.
Seul `js/unrar.js` est généré (depuis [node-unrar-js](https://github.com/YuJianrong/node-unrar.js) 2.0.2, regroupé avec esbuild, WebAssembly inclus).
L'appli installée récupère les mises à jour d'elle-même (elles s'appliquent au lancement suivant) ;
augmenter la version `CACHE` dans `sw.js` force un rafraîchissement complet.

## Licences

- Police [Literata](https://github.com/googlefonts/literata) : SIL Open Font License 1.1 (`LICENSES/Literata-OFL.txt`).
- Icônes [Lucide](https://lucide.dev) : licence ISC (`LICENSES/Lucide-ISC.txt`).
- [node-unrar-js](https://github.com/YuJianrong/node-unrar.js) : licence MIT (`LICENSES/node-unrar-js-MIT.txt`).
- UnRAR, d'Alexander Roshal : licence UnRAR, libre d'usage pour lire les archives RAR (`LICENSES/UnRAR.txt`).

# Smacpub

Un petit lecteur EPUB, simple et élégant, qui fonctionne **entièrement hors-ligne**, pensé pour un Chromebook.
Pas de compte, pas de serveur : vos livres et vos positions de lecture restent sur votre appareil.

## Ce que fait l'appli

**Bibliothèque**
- Ajout d'EPUB par bouton ou glisser-déposer (plusieurs à la fois). Les doublons sont détectés.
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
- Zoom à la molette, doux et centré sur le curseur ; glisser pour se déplacer, `0` ou `Échap` pour revenir.
- Thèmes clair, sépia et sombre, et une couleur d'accent au choix (orange, violet, bleu, vert, rose, ardoise) ; police « livre » (Literata, incluse), sans-serif ou celle de l'éditeur ; taille, interligne, largeur de colonne, texte justifié.

**Vieux EPUB**
- EPUB 2 (NCX) et EPUB 3 (nav), HTML mal formé, encodages anciens (ISO-8859-1, Windows-1252…), métadonnées manquantes.
- Les chapitres très longs (un livre entier dans un seul fichier) sont découpés à l'affichage pour rester rapides.
- Les scripts éventuellement présents dans un livre ne s'exécutent jamais.

## Installer sur le Chromebook

### Option A : comme une vraie application (recommandé)

1. Publiez le dossier avec **GitHub Pages** : sur GitHub, *Settings → Pages → Build and deployment*,
   choisissez *Deploy from a branch*, la branche qui contient ces fichiers et le dossier `/ (root)`.
   (GitHub Pages est gratuit pour un dépôt public.)
2. Ouvrez l'adresse indiquée (du type `https://<utilisateur>.github.io/smacpub/`) dans Chrome.
3. Cliquez sur l'icône **Installer** dans la barre d'adresse (ou menu ⋮ → *Caster, enregistrer et partager → Installer la page en tant qu'appli*).

Smacpub apparaît alors dans le lanceur du Chromebook et s'ouvre dans sa propre fenêtre, **sans connexion Internet**.
Bonus : dans l'app *Fichiers*, clic droit sur un `.epub` → *Ouvrir avec → Smacpub*.

### Option B : directement depuis un dossier

Téléchargez le dépôt (*Code → Download ZIP*), décompressez-le dans *Mes fichiers*, puis ouvrez `index.html` avec Chrome.
Tout fonctionne aussi, mais l'appli n'apparaît pas dans le lanceur.

## Raccourcis clavier

| Touche | Action |
| --- | --- |
| `→` ou `Espace` | Page suivante |
| `←` ou `Maj+Espace` | Page précédente |
| `T` | Sommaire |
| `B` | Ajouter / retirer un signet |
| `F` ou `/` | Rechercher dans le livre |
| `+` / `−` | Taille du texte |
| `1` / `2` | Une page / deux pages à la fois |
| Molette | Zoomer vers le curseur (`0` pour revenir à 100 %) |
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
js/reader.js           affichage paginé et positions de lecture
js/db.js               stockage local (IndexedDB)
js/app.js              bibliothèque, lecteur, réglages, sauvegarde
js/fonts.js            police Literata intégrée
sw.js                  fonctionnement hors-ligne (service worker)
manifest.webmanifest   installation comme application
```

Aucune dépendance, aucune étape de compilation : ce sont des fichiers HTML, CSS et JavaScript ordinaires.
L'appli installée récupère les mises à jour d'elle-même (elles s'appliquent au lancement suivant) ;
augmenter la version `CACHE` dans `sw.js` force un rafraîchissement complet.

## Licences

- Police [Literata](https://github.com/googlefonts/literata) : SIL Open Font License 1.1 (`LICENSES/Literata-OFL.txt`).
- Icônes [Lucide](https://lucide.dev) : licence ISC (`LICENSES/Lucide-ISC.txt`).

# Halte — consignes pour Claude

Audioguide géolocalisé en PWA statique (sans serveur ni compte) : 31 lieux « hors des clous »
(Toulouse 16, Paris 10, Charleville-Mézières 5), filtrables par catégorie (Histoire, Culture, WTF, Anecdote, Caché),
récits « express » (~30-40 s, bouton « Écouter ») et « histoire » (~1-2 min, « Version longue ») lus par la voix du téléphone.
Pas de liste de villes : la carte (vue France, pastilles regroupées) sert de sélecteur.
Interface « Pop » (refonte nov. 2026) : carte plein écran, panneau du bas à 3 hauteurs, fiche lieu, mini-lecteur + lecteur
plein écran, « Vous y êtes » dans le panneau. **Pas d'alerte de proximité** (choix du propriétaire).
Le propriétaire n'est pas programmeur : explique simplement, sans jargon inutile.

## Règles de travail
- Réponses **courtes, en français**, lisibles sur téléphone.
- **Ne jamais modifier le texte d'un récit sans le signaler** explicitement (lieu + ce qui change).
- Toujours `python3 pipeline/build.py` (qui lance `verify.py`) avant de proposer un changement ;
  ne jamais contourner un échec de `verify.py` : ajouter la note de source manquante dans `facts`, ou corriger le récit.
- Lancer `python3 pipeline/e2e_test.py` si l'app (`app/`) est touchée (Playwright requis).
- Travailler sur une **branche** et ouvrir une pull request. **Fusionner soi-même** dès que la CI est verte
  (app, documentation, nouveaux lieux), puis dire au propriétaire ce qui est en ligne et lister les récits
  nouveaux ou modifiés à relire.
- **Demander l'accord avant** : tout ce qui est payant ; supprimer des lieux ou des données ; modifier le texte
  d'un récit déjà relu par le propriétaire ; un gros changement de l'interface.
- **Rien de payant** sans accord (API, hébergement, fournisseur de tuiles…).
- Dire clairement ce qui n'a pas pu être vérifié (ex. vrai téléphone, GPS, voix, iPhone).
- En fin de session : mettre à jour `ROADMAP.md`.

## Où sont les choses
| Chemin | Rôle |
|---|---|
| `data/places.json` | **Source de vérité** : `cities` (centre + zone), `categories`, lieux (`city`, `cats`), coordonnées, rayon, récits, `sources`, `facts` (notes sourcées). On modifie ici. |
| `app/data/lieux.json` | **Généré** par `build.py` (sans `facts`). Ne pas éditer à la main. |
| `app/index.html`, `styles.css`, `app.js`, `map.js` | L'app (HTML/CSS/JS sans bibliothèque ni framework). `styles.css` commence par le design system (jetons clair/sombre, composants) ; icônes SVG dans `index.html`. |
| `app/sw.js` | Service worker (hors ligne). Stratégie cache d'abord + mise à jour en arrière-plan. **Changer `VER` à chaque modification de l'app.** |
| `pipeline/verify.py` | Chaque chiffre/date/siècle d'un récit doit figurer dans `facts` ; lieu dans la zone de sa ville ; catégories connues. |
| `pipeline/build.py` | verify → `app/data/lieux.json` → `dist/` (fichier unique + zip, ignorés par git). |
| `pipeline/e2e_test.py` | 81 tests navigateur (accueil, vue France, panneau 3 hauteurs, regroupements, liste qui suit la carte, filtres, fiche, bouton retour, GPS simulé, « Vous y êtes », mini-lecteur et lecteur, pause/reprise, réglages, mode sombre, 360 px, cibles ≥ 44 px). |
| `maquettes/` | Audit, maquettes, vitrine du design system (`design-system.html`), captures avant/après. Non publié. |
| `pipeline/prompt_template.md` | Consigne pour rédiger un récit à partir de notes. |
| `.github/workflows/deploy.yml` | CI : build + tests sur toute branche/PR ; publication GitHub Pages sur `main` seulement. |

## Mise en ligne
Automatique à chaque fusion dans `main` → https://virnichka.github.io/Halte/ (l'ancienne adresse `/toulouse-a-lecoute/` ne marche plus)
(dépôt public, GitHub Pages gratuit). L'ancien déploiement manuel Cloudflare Pages existe encore.

## Pistes futures — ne rien commencer sans demander
Voir `ROADMAP.md`. Écarté pour l'instant : chat en ligne.

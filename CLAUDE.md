# Toulouse à l'écoute — consignes pour Claude

Audioguide géolocalisé en PWA statique (sans serveur ni compte) : 11 lieux du centre de Toulouse,
récits « express » (~30-40 s) et « histoire » (~1-2 min) lus par la voix du téléphone.
Le propriétaire n'est pas programmeur : explique simplement, sans jargon inutile.

## Règles de travail
- Réponses **courtes, en français**, lisibles sur téléphone.
- **Ne jamais modifier le texte d'un récit sans le signaler** explicitement (lieu + ce qui change).
- Toujours `python3 pipeline/build.py` (qui lance `verify.py`) avant de proposer un changement ;
  ne jamais contourner un échec de `verify.py` : ajouter la note de source manquante dans `facts`, ou corriger le récit.
- Lancer `python3 pipeline/e2e_test.py` si l'app (`app/`) est touchée (Playwright requis).
- Travailler sur une **branche**, ouvrir une pull request, **demander l'accord avant de fusionner**.
- **Rien de payant** sans accord (API, hébergement, fournisseur de tuiles…).
- Dire clairement ce qui n'a pas pu être vérifié (ex. vrai téléphone, GPS, voix, iPhone).
- En fin de session : mettre à jour `ROADMAP.md`.

## Où sont les choses
| Chemin | Rôle |
|---|---|
| `data/places.json` | **Source de vérité** : lieux, coordonnées, rayon, récits, `sources`, `facts` (notes sourcées). On modifie ici. |
| `app/data/toulouse.json` | **Généré** par `build.py` (sans `facts`). Ne pas éditer à la main. |
| `app/index.html`, `styles.css`, `app.js`, `map.js` | L'app (HTML/CSS/JS sans bibliothèque ni framework). |
| `app/sw.js` | Service worker (hors ligne). Stratégie cache d'abord + mise à jour en arrière-plan. |
| `pipeline/verify.py` | Chaque chiffre/date/siècle d'un récit doit figurer dans `facts`. |
| `pipeline/build.py` | verify → `app/data/toulouse.json` → `dist/` (fichier unique + zip, ignorés par git). |
| `pipeline/e2e_test.py` | 32 tests navigateur (carte, GPS simulé, proximité, lecteur, pause/reprise). |
| `pipeline/prompt_template.md` | Consigne pour rédiger un récit à partir de notes. |
| `.github/workflows/deploy.yml` | CI : build + tests sur toute branche/PR ; publication GitHub Pages sur `main` seulement. |

## Mise en ligne
Automatique à chaque fusion dans `main` → https://virnichka.github.io/toulouse-a-lecoute/
(dépôt public, GitHub Pages gratuit). L'ancien déploiement manuel Cloudflare Pages existe encore.

## Pistes futures — ne rien commencer sans demander
Voir `ROADMAP.md`. Écarté pour l'instant : chat en ligne.

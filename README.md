# Halte — prototype d'audioguide géolocalisé

Une web app installable (PWA), sans serveur ni compte : des lieux qui sortent de l'ordinaire, classés par catégorie
(Histoire, Culture, WTF, Anecdote, Caché), dans plusieurs villes (Toulouse 16, Paris 10, Charleville-Mézières 5).
Chaque lieu a un récit
« Express » (≈ 30 à 40 s) et un récit « Histoire » (≈ 1 à 2 min), lus à voix haute par la voix de l'appareil.
Quand vous approchez d'un lieu (rayon de 40 à 80 m), l'app vous le propose.

## Essayer tout de suite
- `dist/audioguide.html` (créé par `python3 pipeline/build.py`) : un seul fichier, à ouvrir dans un navigateur.
- **Mode démo** : ⚙ Réglages → « Mode démo » pour se placer près d'un lieu, dans n'importe quelle ville.

## Mettre en ligne (automatique)
Chaque modification poussée sur `main` déclenche `.github/workflows/deploy.yml` (GitHub Actions) :
1. `pipeline/build.py` → lance d'abord `verify.py` ; **arrêt si un chiffre n'est pas dans les sources** ;
2. `pipeline/e2e_test.py` → tests navigateur ; arrêt si un test échoue ;
3. publication du dossier `app/` sur GitHub Pages (HTTPS, gratuit pour un dépôt public).

Sur les autres branches et les pull requests, seules les étapes 1 et 2 tournent (rien n'est publié).
Réglage unique : dépôt → Settings → Pages → Source : **GitHub Actions**.

Sur le téléphone, la nouvelle version arrive à la 2ᵉ ouverture de l'app (le service worker sert
d'abord la version en cache, puis se met à jour en arrière-plan).

Mise en ligne manuelle (secours) : `python3 pipeline/build.py`, puis déposer le contenu de `app/`
(ou `dist/audioguide-app.zip`) sur un hébergement statique en HTTPS.

## Contenu
| Fichier | Rôle |
|---|---|
| `data/places.json` | Source de vérité : villes, catégories, lieux (ville, catégories, coordonnées, récits, **notes de sources** `facts`, liens) |
| `pipeline/verify.py` | Vérifie que chaque chiffre, date et siècle des récits figure dans les notes de sources |
| `pipeline/build.py` | Vérifie, puis génère `app/data/lieux.json`, le fichier unique et le zip |
| `pipeline/e2e_test.py` | Test navigateur (Playwright) : carte, GPS simulé, proximité, lecteur, pause/reprise |
| `pipeline/prompt_template.md` | Consigne à donner au LLM pour rédiger un récit à partir de notes (autres villes) |

Reconstruire : `python3 pipeline/build.py`. Tester : `python3 pipeline/e2e_test.py` (nécessite Playwright).

## Limites connues (à lire avant de se fier au prototype)
1. **Écran verrouillé** : l'app demande à garder l'écran allumé pendant l'écoute (option dans ⚙), mais si l'utilisateur
   verrouille son téléphone, une web app (surtout sur iPhone) ne suit plus le GPS ni ne continue la lecture.
   La version stores (Expo / React Native) lève cette limite.
2. **Voix** : c'est celle de l'appareil (qualité variable). Pour une voix plus naturelle : pré-générer des mp3
   (Piper en local, gratuit, ou une API de synthèse vocale) et les servir comme fichiers statiques.
3. **Fond de carte** : tuiles OpenStreetMap publiques, acceptables pour un usage perso. Pour une diffusion
   large, prendre un fournisseur de tuiles (offre gratuite ou auto-hébergement) : la politique d'OSM l'impose.
   Hors ligne : les textes et la voix fonctionnent ; seules les tuiles déjà vues sont en cache.
4. **Fiabilité des récits** : rédigés par une IA à partir de sources web publiques, puis recoupés
   automatiquement sur les chiffres. Ce n'est pas une preuve : **relire avant de diffuser**. Certaines sources sont
   des miroirs de Wikipédia (licence CC BY-SA, attribution requise) ; privilégier les sources primaires
   (Mérimée / POP du ministère de la Culture, Ville de Toulouse) pour une version publique.
5. **Données ouvertes** : les dates varient parfois selon les sources (ex. création du port Saint-Sauveur) ;
   le récit le signale plutôt que de trancher.
6. **Musée des Augustins** : en réouverture progressive à la date de rédaction ; vérifier avant de s'y rendre.
7. **Lieux** : 31 lieux (la place Saint-Georges a été écartée faute de sources fiables). Les 20 lieux ajoutés en
   novembre 2026 (WTF, Caché, Paris, Charleville) ont des **coordonnées approximatives** : à vérifier sur place.

## Ajouter des lieux ou une ville
0. Nouvelle ville : l'ajouter dans `cities` (`data/places.json`) avec son centre et sa zone (`bbox`).
1. Lister les lieux (OpenStreetMap / Wikidata / base Mérimée) avec coordonnées.
2. Pour chaque lieu, réunir 3 à 5 sources et rédiger la liste `facts` (une affirmation sourcée par ligne).
3. Faire écrire les récits par un LLM **uniquement à partir de ces notes** (`pipeline/prompt_template.md`) ;
   un modèle local (Ollama) convient et garde tout sur ta machine.
4. `python3 pipeline/verify.py` puis relecture humaine, puis `python3 pipeline/build.py`.

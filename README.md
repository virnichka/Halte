# Halte — prototype d'audioguide géolocalisé

Une web app installable (PWA), sans serveur ni compte : des lieux qui sortent de l'ordinaire, classés par catégorie
(Histoire, Culture, WTF, Anecdote, Caché), dans plusieurs villes (Toulouse 16, Paris 10, Charleville-Mézières 5).
Chaque lieu a une version courte
(« Écouter », ≈ 30 à 40 s) et une « Version longue » (≈ 1 à 2 min), lues à voix haute par la voix de l'appareil.
Quand vous êtes sur place (rayon de 40 à 80 m), le panneau du bas l'indique (« Vous y êtes ») : pas d'alerte, un toucher suffit pour écouter.

Pas de liste de villes : **la carte sert de sélecteur**. Au premier lancement, vue de la France (les lieux proches
sont regroupés en pastilles avec leur nombre) ; ensuite, la dernière zone regardée, ou votre position si la
localisation est déjà autorisée. La liste montre les lieux de la zone affichée.

**Interface** : carte plein écran ; en bas, un panneau qu'on tire vers le haut (replié : le lieu le plus proche et
« Écouter » ; à moitié ou plein écran : la liste et les filtres). Toucher une pastille ouvre la fiche du lieu
(Écouter, Version longue, Itinéraire vers l'app de cartes du téléphone, sources). Pendant l'écoute, un mini-lecteur
reste en bas ; on l'agrandit pour lire le texte. Le bouton « retour » du téléphone ferme la fiche ou le lecteur.
Mode sombre automatique (celui du téléphone).

## Essayer tout de suite
- `dist/halte.html` (créé par `python3 pipeline/build.py`) : un seul fichier, à ouvrir dans un navigateur.
- **Mode démo** : Réglages → « Pour tester » → « Mode démo » pour se placer près d'un lieu, dans n'importe quelle ville.

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
(ou `dist/halte-app.zip`) sur un hébergement statique en HTTPS.

## Contenu
| Fichier | Rôle |
|---|---|
| `data/places.json` | Source de vérité : villes, catégories, lieux (ville, catégories, coordonnées, récits, **notes de sources** `facts`, liens) |
| `pipeline/verify.py` | Vérifie que chaque chiffre, date et siècle des récits figure dans les notes de sources |
| `pipeline/build.py` | Vérifie, puis génère `app/data/lieux.json`, le fichier unique et le zip |
| `pipeline/e2e_test.py` | Test navigateur (Playwright) : accueil, carte et panneau, fiche, GPS simulé, « Vous y êtes », lecteur, pause/reprise, réglages, sombre, 360 px |
| `maquettes/` | Audit, maquettes, design system, captures avant/après (non publié) |
| `pipeline/prompt_template.md` | Consigne à donner au LLM pour rédiger un récit à partir de notes (autres villes) |

Reconstruire : `python3 pipeline/build.py`. Tester : `python3 pipeline/e2e_test.py` (nécessite Playwright).

## Limites connues (à lire avant de se fier au prototype)
1. **Écran verrouillé** : l'app demande à garder l'écran allumé pendant l'écoute et le suivi de position, mais si l'utilisateur
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
   (Mérimée / POP du ministère de la Culture, sites des villes) pour une version publique.
5. **Données ouvertes** : les dates varient parfois selon les sources (ex. création du port Saint-Sauveur) ;
   le récit le signale plutôt que de trancher.
6. **Musée des Augustins** : en réouverture progressive à la date de rédaction ; vérifier avant de s'y rendre.
7. **Lieux** : 31 lieux (la place Saint-Georges a été écartée faute de sources fiables). Les 20 lieux ajoutés en
   novembre 2026 (WTF, Caché, Paris, Charleville) ont des **coordonnées approximatives** : à vérifier sur place.

## Design system de l'interface (direction « Pop »)
Vitrine : `maquettes/design-system.html` (ouvrir dans un navigateur ; mode sombre = celui du système).
Les styles sont en tête de `app/styles.css` (jetons, puis composants, puis mise en page de l'app).
- **Couleurs** : encre violet nuit `#1a1538` (texte, bouton principal), fonds très clairs ; une couleur par catégorie
  (Histoire bleu canard, Culture framboise, WTF ambre, Anecdote vert, Caché violet) ; version sombre complète.
  Contrastes vérifiés dans la vitrine (niveau AA).
- **Typo** : police du téléphone (arrondie sur iPhone, Roboto sur Android) ; 6 tailles, de 13 à 26 px.
- **Formes** : espacements multiples de 4 px ; rayons 10 / 14 / 18 / 30 px ; 4 ombres ; cibles tactiles ≥ 44 px.
- **Composants** : bouton (principal, secondaire), bouton rond et flottant, puce de filtre, étiquette de catégorie,
  badge « Vous y êtes », anneau de progression, tuile de catégorie, pastille de carte et regroupement, ligne de lieu,
  panneau du bas, mini-lecteur, lecteur (barre, boutons), contrôle segmenté, champ de choix.
- **Icônes** : SVG dessinées pour Halte (plus d'émojis). **Carte** : tuiles OpenStreetMap adoucies par un filtre (gratuit).
- **Mouvement** : animations courtes, coupées si le téléphone demande moins d'animations.

## Ajouter des lieux ou une ville
0. Nouvelle ville : l'ajouter dans `cities` (`data/places.json`) avec son centre et sa zone (`bbox`) ;
   elle sert seulement aux vérifications et au mode démo (pas de liste de villes dans l'app).
1. Lister les lieux (OpenStreetMap / Wikidata / base Mérimée) avec coordonnées.
2. Pour chaque lieu, réunir 3 à 5 sources et rédiger la liste `facts` (une affirmation sourcée par ligne).
3. Faire écrire les récits par un LLM **uniquement à partir de ces notes** (`pipeline/prompt_template.md`) ;
   un modèle local (Ollama) convient et garde tout sur ta machine.
4. `python3 pipeline/verify.py` puis relecture humaine, puis `python3 pipeline/build.py`.

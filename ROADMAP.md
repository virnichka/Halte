# Feuille de route — Halte

Une ligne = une brique = une session. Ne commencer une brique « à faire » qu'avec l'accord du propriétaire.

## Fait
- [x] v2 de l'app (interface optimisée), 11 lieux, verify.py, 32 tests navigateur
- [x] Projet rangé dans GitHub (`virnichka/Halte`)
- [x] Publication automatique sur GitHub Pages (vérification + tests avant chaque mise en ligne)
- [x] `CLAUDE.md` et `ROADMAP.md`
- [x] Nouveau nom « Halte » ; plusieurs villes (Toulouse, Paris, Charleville-Mézières)
- [x] Filtres par catégorie : Histoire, Culture, WTF, Anecdote, Caché ; interface épurée
- [x] +20 lieux (5 Toulouse insolites, 10 Paris, 5 Charleville) ; 43 tests navigateur
- [x] Fin du renommage (mémoire du téléphone, cache hors ligne, fichiers générés) ; numéros remplacés par l'icône de catégorie, nom du lieu affiché sur la carte quand on le touche ; 44 tests
- [x] Plus de liste de villes : vue de la France, pastilles regroupées avec leur nombre, liste = zone affichée, dernière zone mémorisée, localisation relancée si déjà autorisée ; fiche simplifiée (« Écouter » + « Version longue ») ; 49 tests
- [x] Refonte de l'interface, direction « Pop » (audit → 3 maquettes → design system → app) : carte plein écran, panneau du bas, fiche lieu avec itinéraire, mini-lecteur et lecteur plein écran, « Vous y êtes » (alerte de proximité supprimée), réglages simplifiés, écran d'accueil, icônes SVG, mode sombre, nouvelle icône d'app ; 81 tests (PR #8, validée par le propriétaire)
- [x] Interface plus sobre (gris neutres, moins de couleurs et d'ombres) ; panneau du bas facile à baisser : glisser le doigt vers le bas n'importe où dans le panneau (fiche ou liste), bouton « Réduire » sur la liste, toucher la carte replie la liste ; 86 tests

## À vérifier par le propriétaire
- [ ] Sur un vrai téléphone : glisser la fiche / la liste vers le bas pour les baisser (iPhone et Android)
- [ ] Nouvelle interface sur un vrai téléphone : glisser le panneau, bouton « retour » (Android), itinéraire, police arrondie (iPhone), lisibilité au soleil
- [ ] Tester sur un vrai téléphone : GPS sur place, voix, installation, mise à jour à la 2ᵉ ouverture
- [ ] Supprimer l'ancien projet Cloudflare Pages quand la nouvelle adresse convient
- [ ] Relire les 20 nouveaux récits (texte écrit par IA, sources issues d'une recherche web)
- [ ] Vérifier sur place / sur une carte les coordonnées des 20 nouveaux lieux (approximatives)
- [x] Dépôt GitHub renommé « Halte » (nouvelle adresse du site)

## Pistes (ne rien faire sans demander)
- [ ] Fond (plus tard) : coordonnées vérifiées, sources primaires plutôt que miroirs de Wikipédia, plus de lieux « Caché »
- [ ] Recherche d'une ville ou d'une adresse sur la carte (utile quand il y aura beaucoup de villes)
- [ ] iPhone : vérifier que la voix démarre au premier toucher (risque connu)
- [ ] Plus de lieux WTF / Caché — par lots de 5 (sources → `facts` → récits → verify → relecture humaine)
- [ ] Voix pré-générées « ambiance podcast » en dialogue (mp3) — script à lancer sur l'ordinateur du propriétaire
- [ ] Lieux personnels stockés sur le téléphone
- [ ] Changer de fournisseur de tuiles de carte si diffusion large (OSM public = petit usage seulement)
- [ ] Plus tard seulement : comptes et partage public (RGPD, modération)

## Écarté pour l'instant
- Parcours thématiques ordonnés (l'utilisateur compose lui-même son trajet)
- Chat en ligne

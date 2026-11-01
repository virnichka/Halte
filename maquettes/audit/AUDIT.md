# Audit de l'interface — étape 1 (novembre 2026)

Contexte retenu : on marche dehors, d'une main, souvent au soleil ; 5 secondes de regard puis 1 à 2 minutes d'écoute.
Captures prises dans Chromium (format téléphone 360 px, et 412 px), avec la vraie carte OpenStreetMap.
Planches annotées : `planche_1…4.jpg` ; captures brutes : `avant/` ; script : `captures.py`.

## Problèmes, du plus grave au moins grave

### 🔴 Critiques (gênent l'usage principal)
1. **Alerte de proximité facile à rater** (planche 1). Bloc inséré au milieu de la liste, même couleur sombre que le
   bouton « Me localiser pour commencer » qu'il remplace ; 3 boutons de même poids (Écouter / Version longue / Plus tard) ;
   vibration de 0,18 s, et seulement si l'écran a déjà été touché ; aucun son. Téléphone en poche : rien de fiable.
2. **La carte ne suit pas la marche** (planches 1 et 3). Elle se cale une seule fois, au premier repérage : ensuite le
   lieu et le point bleu sortent de l'écran. Sur un lieu, le point bleu est caché sous la pastille. Localisé à 1 km d'un
   lieu (Paris, Louvre) : zoom sur soi, aucun lieu visible, « Aucun lieu dans cette zone » et un grand écran vide, alors
   que 10 lieux sont à moins de 3 km.
3. **Lecteur : commandes ambiguës, place envahissante** (planche 2). « ■ » ferme le lecteur (on perd sa place), collé à
   la pause, même taille, même couleur. « 1× » aussi visible que la pause. « 1/11 » compte des morceaux de texte
   internes au lieu d'afficher le temps restant. Barre de 4 px, pas de retour en arrière. Texte affiché : la liste
   disparaît. Si la voix échoue : message technique (« synthesis-failed »). Aucun état annoncé au lecteur d'écran.

### 🟠 Importants
4. **Trop d'éléments, peu de place pour l'essentiel** (planches 1 et 3). En-tête + statut + zoom + filtres + gros bouton
   + cartes : sur un vrai 360×640, une seule carte de lieu visible. « Me localiser » en double. Le même lieu écrit 3 fois
   (étiquette carte, alerte, 1ʳᵉ carte).
5. **Pas de fiche lieu ; 31 boutons « Écouter » identiques** (planche 3). Rien ne ressort. Toucher une carte de la liste
   ne fait que déplacer la carte. Sources visibles seulement dans le texte du lecteur. Pas d'itinéraire.
6. **Pastilles noyées dans la carte** (planche 3). Émojis de 30 px dans un rond blanc, qui ressemblent aux icônes
   d'OpenStreetMap (musées, masques de théâtre, croix). Le fond OSM, très coloré, concurrence les pastilles.
7. **Cibles trop petites, et en haut de l'écran** (planche 3). Pastilles 30 px, filtres 36, zoom 38, ⚙ 36,
   « Me localiser » 33 de haut (minimum visé : 44). En-tête et zoom hors de portée du pouce. Filtres coupés à droite
   sans indice qu'on peut faire défiler. Carte de liste cliquable mais pas atteignable au clavier / lecteur d'écran ;
   émojis lus à voix haute (« visage qui explose WTF »).

### 🟡 Moyens
8. **Pas de mode sombre ; contours qui disparaissent au soleil** (planche 4). Téléphone en mode sombre : rien ne change.
   Bordures des cartes à 1,2:1 de contraste. Les textes, eux, passent le niveau AA (4,7:1 à 7:1).
9. **Réglages fourre-tout** (planche 4). Fenêtre au centre ; « Mode démo » (outil de test) au même niveau que la voix ;
   « Effacer les lieux déjà écoutés » sans confirmation ; vitesse réglable à 2 endroits.
10. **Premier lancement muet, « déjà écouté » peu gratifiant** (planches 3 et 4). Rien n'explique Halte ; liste dans
   l'ordre du fichier (Toulouse d'abord, même vue de Paris). Lieu écouté = petit ✓ vert qui efface la catégorie ;
   aucun compteur de progression.

## À garder
- Rapide, sans compte, hors ligne ; la localisation est demandée au bon moment (sur un geste, pas au chargement).
- « Écouter le plus proche » en 1 toucher existe déjà ; la liste suit la carte ; regroupements par nombre.
- Repli propre en texte quand la voix manque ; « Prochain lieu » en fin d'écoute.
- La couleur brique : une bonne base d'identité.

## Non vérifié
Vrai téléphone, iPhone/Safari, GPS réel en marchant, voix réelle (le navigateur de test n'en a pas : voix simulée),
lisibilité au soleil (estimée par les contrastes), vibration.

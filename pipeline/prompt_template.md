# Consigne de rédaction d'un récit (à donner à un LLM, local ou non)

Contexte : audioguide à écouter en marchant, en français, lu par une synthèse vocale.

**Entrée** : le nom du lieu et la liste `facts` (notes sourcées). Rien d'autre.

**Consigne**

Tu écris deux récits à voix haute pour le lieu « {NOM} », uniquement à partir des notes ci-dessous.

Règles impératives :
1. N'utilise AUCUN fait, nom, date ou chiffre absent des notes. En cas de doute, omets.
2. Si deux notes se contredisent, dis-le simplement (« les sources divergent ») au lieu de trancher.
3. Écris pour l'oreille : phrases courtes, pas de parenthèses, pas de listes, pas d'abréviations,
   nombres en chiffres, siècles en chiffres romains avec « ᵉ » (XVIᵉ siècle).
4. Premier récit « express » : 100 à 120 mots. Second récit « histoire » : 250 à 330 mots, en 3 ou 4 paragraphes.
5. Commence par situer l'auditeur (« Vous êtes devant… ») et termine par un détail à observer, si une note le permet.
6. Les récits doivent pouvoir se comprendre sans voir le lieu.

Notes :
{FACTS}

**Sortie** : un objet JSON `{"express": "...", "histoire": "..."}` (paragraphes séparés par `\n\n`).

---

Après génération : copier dans `data/places.json`, lancer `python3 pipeline/verify.py`,
puis relire chaque récit contre ses sources avant publication.

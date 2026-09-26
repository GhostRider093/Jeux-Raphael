
## Accueil : « Course ou mode libre ? » (27/09/2026)

- Cliquer une carte d'engin n'envoie plus directement rouler : une 2e étape propose
  **Mode libre**, **Course 1**, **Course 2** (Course 2 seulement à Capestang — Poilhes n'a
  qu'une boucle). « ‹ Changer d'engin » ou Échap ramène aux cartes.
- Une course choisie place l'engin derrière la ligne et lance le décompte dès l'arrivée.
  Au changement de village, le choix passe par l'URL (`&course=0|1`).
- Vérifié dans Chrome (Playwright) : Capestang + berline + Course 2 → décompte, piste « Course 2 » active ;
  Poilhes → Course 2 masquée ; aucun erreur JS. Non poussé.
- Classement partagé : le code serveur existe (`multiplayer/village.py`, fichiers
  `config/race-leaderboards/boucle-<piste>.json`) mais la prod est un nginx statique →
  `/api/village/classement/*` en 404 ; chaque joueur ne voit que son navigateur.

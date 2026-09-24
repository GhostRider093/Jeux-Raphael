# Bilan de session — 24/09/2026 — Mise en ligne automatique

## Ce qui a change

- **Fin des envois tar/scp depuis le poste.** `raphael.crea-doc.fr` est desormais le
  miroir exact de la branche `main` du depot GitHub `GhostRider093/Jeux-Raphael`.
- Workflow `.github/workflows/deploy.yml` : a chaque push sur `main`, rsync vers
  `/opt/raphael-online-site` sur le VPS 212, puis controle HTTP de `index.html`.
- Cle SSH dediee `deploy@raphael-online` (privee dans les secrets GitHub, publique
  dans `authorized_keys` du VPS). Secrets : `VPS_HOST`, `VPS_USER`, `VPS_DEPLOY_PATH`,
  `VPS_SSH_KEY`.
- `main` a rattrape `editeur-cartes-et-circuits` (40 commits) : cockpit en image,
  flotte de dix chasseurs, sensibilite reglable en vol, apercu GLB.
- Lien « retour vers la ville » de `sector-streaming.js` corrige vers
  `archive/ville/raphael2.html` : la copie a la racine du serveur etait un reste
  d'un ancien envoi, supprime par le miroir.

## Ce que le miroir protege ou ignore

- `config/` (profils de manette, classements ecrits par `app.py`) et `__pycache__/`
  ne sont jamais touches sur le serveur.
- Ne partent pas : `scripts/`, `deploy/`, `*.md`, `*.3mf`, `*.bat`, `requirements.txt`.

## Pieges rencontres

- `gh secret set -b "/opt/..."` depuis Git Bash : MSYS a converti le chemin en
  `C:/Program Files/Git/opt/...`. Passer la valeur par `stdin` (`printf ... | gh secret set`).
- Le premier push contenant le workflow n'a pas declenche de run ; lancement manuel
  (`workflow_dispatch`), puis test du declenchement par push avec ce commit.
- GitHub signale `maps/capestang/village.bin` (56 Mo) au-dessus de sa limite conseillee.
  Il passe, mais un fichier de plus de 100 Mo serait refuse : penser a Git LFS si
  une maquette grossit.

## Toujours pas fait

- Le service FastAPI (SSO Ghost Chat + multijoueur) n'est deploye nulle part ;
  `/api/health` repond 404. `deploy/README.md` decrit un VPS 57 perime.


---

# Bilan de session — 24/09/2026 (soir) — Niveaux de qualité et page « Rouler »

## Question de départ

Le jeu tourne sur une RTX 4070 Ti ; tout le monde n'en a pas. Que coûte-t-il vraiment ?

## Mesures (Chromium sans synchronisation verticale, 1080p, Jarvis déjà à 39 % du GPU)

| Situation | ms / image | Triangles | Appels |
| --- | --- | --- | --- |
| Survol, ombres douces 4096 | 2,75 | 2,4 M | 37 |
| Survol, sans ombres | 1,63 | 2,4 M | 37 |
| Survol, ratio 2 (4K), ombres | 5,96 | 2,4 M | 37 |
| Balade à pied, ombres | 1,80 | 2,0 M | 25 |
| Berline bleue, ombres | 2,00 | 2,6 M | 55 |

Leviers, dans l'ordre : ombres (×1,7), définition (ratio 2 = ×4 pixels), feuillage
(84 cartes par arbre, ~440 000 triangles à l'alpha). Processeur et mémoire ne sont pas le
sujet (37 appels, 75 Mo de tas JS). Le téléchargement, si : 25 / 68 / 93 Mo.

## Décision d'Arnaud

Pas de bascule automatique : **trois niveaux choisis par le joueur**, comme dans un vrai
jeu, avec un niveau conseillé d'après une mesure de la machine au premier lancement.
Et une **page à part**, `rouler.html`, avec seulement la trottinette et la berline bleue,
Poilhes ou Capestang. Ensuite : personnaliser la carte de la trottinette et celle de la
berline (à venir ; Arnaud refait d'abord la trottinette).

## Fait

- `maps/qualite.js` : niveaux Bas / Moyen / Élevé, mesure par lots fermés d'un `readPixels`,
  recommandation (< 8 ms Élevé, < 20 ms Moyen), application à chaud, panneau avec compteur.
- `maps/poilhes-scene.js` : feuillage réglable à chaud (`decor.feuillage.regler(n)`, `setDrawRange`).
- `maps/poilhes-village.js` : `startVillage({ modes, qualite, voitureUnique, ouvrir })`,
  moteurs robot / gobelins / chasseur non créés quand le mode n'est pas offert ; la fonction
  renvoie ce qu'elle expose. Sans options, comportement inchangé (vérifié sur `poilhes.html`).
- `rouler.html`, lien dans `index.html`, section dans `CLAUDE.md`.

## Vérifié dans Chromium

Premier lancement : mesure 2,5 ms → Élevé, mémorisé. Berline directe sans panneau de choix,
aide sans la touche C. Moyen mémorisé au clic. Capestang au niveau mémorisé, sans remesure.
`poilhes.html` : robot et chasseur toujours créés, 84 cartes.

## Enseignements

- **Une constante `const` déclarée après une fonction qui l'utilise plante** si la fonction
  est appelée avant la déclaration (zone morte temporelle), même si la fonction est hissée.
  `CARTES` est au niveau du module.
- **Après un changement d'ombres, la carte met ~3 s à retrouver son rythme** : la même image
  coûtait 3,5 ms puis 1,8 ms. Sans cette pause, le niveau Bas paraissait plus lent que
  l'Élevé. « Retester » attend trois secondes si les ombres étaient coupées.
- Sans `readPixels`, on mesure l'envoi des commandes, pas le rendu ; avec la synchronisation
  verticale, tout plafonne à 16,7 ms. Les deux réunis rendaient toute mesure inutile.

## À voir

- Sur Capestang, la trottinette démarre au pied de l'église, la caméra dans un mur : le point
  de départ de la page mériterait d'être choisi (place, rue large). Non touché : Arnaud refait
  la trottinette.
- Ressources absentes signalées en 404, préexistantes : `assets/sons/trottinette-boucle.*`
  (repli sur la synthèse) et `assets/pub/epicerie-ouverte.jpg`.
- `mondes.html` garde ses plafonds en dur ; brancher `qualite.js` quand on voudra.

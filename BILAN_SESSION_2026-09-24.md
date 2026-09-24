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


---

# Bilan de session — 24/09/2026 (nuit) — Skatepark, sauts et figures

## Demande

Améliorer grandement le skatepark, des sauts nets qui partent plus tôt, une touche pour les
loopings et les figures.

## Fait

- **Décollage par prédiction de trajectoire** (`vaDecoller`, quatre points sur 0,16 s) au
  lieu du critère « le sol a fui de 15 cm en une image ». Espace = saut à la demande.
- **Figures** : F looping (calibré sur le temps de vol restant), G 360, flèches haut / bas
  en l'air, chute si l'on retombe à l'envers. Bannière au centre de l'écran.
- **Skatepark** : ligne de vol à l'est (départ déplacé, bande de lancement, tremplin 1,8 m à
  42°, réception jusqu'à v = 17), tremplin sud relevé (1,6 m, exposant 2), table plus haute à
  descente courte, bosses plus hautes, copings d'acier, lèvres rouges, trois bandes de
  lancement bleues à chevrons (41 km/h).

## Mesuré (Chromium, banc `test_skate.py`)

| Situation | Air | Hauteur | Longueur |
| --- | --- | --- | --- |
| Ligne est à 41 km/h | 1,54 s | 3,38 m | 16,6 m |
| Ligne est + F | 1,58 s | 3,57 m | Backflip, réception droite |
| Ligne est + G | 1,55 s | 3,44 m | 360 |
| Espace sur le plat à 32 km/h | 0,52 s | 0,38 m | 4,5 m |
| Table (descente courte) à 33 km/h | 0,43 s | 0,73 m | 3,9 m |
| Chaque bosse à 33 km/h | 0,20–0,32 s | 0,32–0,36 m | 1,8–2,9 m |

## Trois faux départs, et pourquoi

1. Comparaison d'accélérations (le sol fuit plus vite que g) : physiquement juste, mais la
   séparation se fait à quelques millimètres → envols d'une image en rafale.
2. Dégagement testé au seul point d'arrivée : depuis le milieu du tremplin on voit le trou
   par-dessus la rampe → départ 2 m trop tôt, retombée sur la rampe, élan effacé, vrai saut
   mou (0,5 s au lieu de 1,5).
3. Amortissement appliqué à la vitesse de figure : le looping retombait à 260°, chute à
   chaque fois. La figure tourne rond, seule l'inclinaison libre s'amortit.
4. Et : la flèche gaz tenue en l'air comptait comme une inclinaison → double backflip
   involontaire. Une flèche déjà tenue au décollage ne compte plus.

## À voir

- Sans tourner, la trottinette monte sur le relevé du virage et décolle par-dessus (1,7 m,
  8 m) : c'est le dos du virage. Un joueur tourne ; mais un muret ou une barrière au sommet
  du dévers éviterait l'envol dans l'herbe.
- Pas de son de saut ni d'atterrissage, pas de score cumulé.


---

# Bilan de session — 24/09/2026 (tard) — Poilhes City : accueil et titre 3D

- La page `rouler.html` devient **Poilhes City**, un vrai accueil : image de fond (celle
  d'Arnaud, à déposer en `assets/accueil/poilhes-city.jpg` ; le plan aérien en attendant),
  titre 3D, choix village / engin / qualité, bouton Rouler. Rien ne se charge avant le clic.
- **Titre 3D par Blender** (`scripts/blender-titre.py`) : « Poilhes » en or, « CITY » en
  ivoire, extrudés et biseautés, trois lampes, PNG transparent 2400 × 1000 + GLB. Quatre
  polices rendues et montrées ; Titan One par défaut en attendant le choix d'Arnaud.
- Vérifié dans Chromium : accueil sans rendu WebGL avant le clic, berline bleue lancée
  depuis l'accueil, Capestang par rechargement sans repasser par l'accueil, portrait OK.
- Piège : naviguer pendant que la berline charge encore ses textures fait crier GLTFLoader
  (« Couldn't load texture blob ») — ce sont les blobs révoqués, pas un défaut du modèle.

## Soirée — Poilhes City : logo, musiques, hamburger, assistance de conduite

- Logo « Poilhes City » de ChatGPT : le damier était peint dans l'image (RGB, pas
  d'alpha). `scripts/accueil/detourer-damier.py` le retire par statistique locale
  (deux gris à parts égales, aucune couleur). La détection par périodicité a échoué :
  les carreaux font 8 à 11 px, irréguliers.
- Musiques Suno d'Arnaud : « SP-12000 Soul Run » sur l'accueil (premier geste,
  bouton ♪, préférence retenue, fondu au départ), « Nitro Boost » sur la berline
  (suit le bouton de mode `.on` par MutationObserver). `assets/musique/PROVENANCE.md`.
- Accueil : logo 20 % plus large, réglages derrière un hamburger en haut à droite,
  ligne de résumé sous « Rouler ».
- **Assistance de conduite** (`state.assistance`, berline seulement, `setAssistance()`),
  dans `maps/voiture-pilote.js` : le mur devient un rail (vitesse renvoyée le long de
  la façade aux deux tiers, cap réaligné sur la rue), rappel très doux vers la route
  la plus proche hors chaussée (cap + 0,6 m/s de glissement, effacé dès que le joueur
  braque, jamais de frein), dégagement automatique quand on est coincé gaz enfoncé,
  herbe deux fois moins glissante. La trottinette n'est pas touchée (Arnaud la refait
  lui-même). Versions de cache `assistance-20260924` sur les imports.
- Retour d'Arnaud : « la voiture ne colle plus à la route ». Cause probable : le rappel
  déplaçait la caisse et tournait le cap directement (hors pneus), et se déclenchait
  dès que le centre sortait d'une chaussée connue au mètre près ; le réalignement
  contre les murs était par image (0,045 rad × 60 = 2,7 rad/s). Corrigé : le rappel
  passe par `cmd.direction` avant la physique, n'agit qu'avec 3 roues hors chaussée ;
  réalignement 1,2 rad/s, dégagement 0,6 m/s ; réglages exposés dans
  `pilote.reglagesAssistance` pour l'outil de réglage en temps réel d'une autre session.
- Feux de recul (`setRecul`, corps procédural et GLB) et crissement au choc (`chocSon`).
- Bruitages voiture activés d'emblée, musiques baissées (35 % accueil, 28 % berline).
- « L'arrière rentre dans le sol sur certaines textures » : le débattement des roues
  était mesuré depuis le centre de la caisse alors que les roues sont filles de `root`,
  déjà incliné (tangage + roulis) : la pente s'appliquait deux fois, roues arrière
  enfoncées en montée, flottantes en descente. Corrigé (attache sur la caisse inclinée),
  tangage de la voiture lissé à 16/s au lieu de 9, et garde-fou : aucune roue ni aucun
  coin de caisse (pare-chocs) sous le relief, la caisse est relevée d'autant.


---

# Bilan de session — 24/09/2026 (nuit, suite) — L'outil de réglage de la conduite

Priorité posée par Arnaud : « un outil très très fidèle de réglage du comportement de la
voiture et de la trottinette ».

- `maps/reglages.js` : schéma des 27 paramètres de `REGLAGES` + toucher du volant + sauts,
  banc d'essai calculé avec la vraie physique (quelques ms, déterministe), panneau touche T
  (application à chaud, télémétrie, banc recalculé à chaque geste, mémoriser / exporter /
  charger / copier en JS), assistance de conduite en case à cocher sur la berline.
- `scripts/banc-voiture.mjs` : le banc en ligne de commande, sur les engins du fichier ou un
  JSON exporté.
- `voiture-pilote.js` : `TOUCHER` et `SAUT_TROTTINETTE` deviennent des objets exportés lus à
  l'usage ; `reglage` et `regler` exposés. `poilhes-village.js` : touche T, réglages mémorisés
  appliqués à la création et au changement de voiture.
- Vérifié dans Chromium : ouverture sur la trottinette et la berline, couple 26 → 40 appliqué
  et banc recalculé (0-20 : 1,10 → 0,72 s), mémorisation reprise au rechargement, copie en JS.
- Découverte du banc : la trottinette plafonne à **33 km/h**, pas 25 comme le dit son commentaire.
- Note : le dépôt porte aussi les modifications non commitées d'une autre session
  (assistance de conduite, musiques, logo ChatGPT) dans les mêmes fichiers — pas commité ici
  pour ne pas mélanger.
- Nouveau lettrage chromé « POILHES CITY » (une ligne) : damier peint, retiré ; les trous
  fermés (O, C) exigeaient une passe « trous » ajoutée à `detourer-damier.py`. Le voile
  blanc peint au-dessus des lettres n'est pas traité (deux tentatives mangeaient les
  faces claires) : à l'avenir demander à ChatGPT un fond uni magenta, pas « transparent ».
- Diaporama de fond : sept photos du village en bande défilant vers la droite, deux à
  l'écran, à 30 %, sous le voile (`assets/accueil/photos/`).
- Acclamation de la foule (`assets/sons/acclamation.mp3`) sur chaque figure réussie en
  trottinette, proportionnelle au nombre de figures, jamais sur une chute.

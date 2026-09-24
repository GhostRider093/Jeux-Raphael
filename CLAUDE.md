# Nova Flight (Raphael)

Simulateur 3D de vol et de combat aérien jouable dans le navigateur.
Plateforme évolutive : exploration de mondes, pilotage, combat aérien, course, multijoueur.

---

## RÈGLE ABSOLUE — emplacement du projet

- Le seul workspace autorisé est `E:\projet\raphael-online`.
- Si la session s'ouvre dans `C:\Users\icc34\Projet\raphael` : ne rien y lire, créer,
  modifier, lancer ni publier. Basculer d'abord sur `E:\projet\raphael-online`.
- L'ancienne copie du disque C: est une source de récupération **en lecture seule**.
  Toute récupération doit être transférée sur E: avant de poursuivre.
- Avant toute commande ou modification : vérifier le répertoire de travail courant.

---

## Stack

- **Front** : HTML / JavaScript vanilla / Three.js (dépendances vendorées dans `libs/`)
- **Back** : Python / FastAPI — SSO Ghost Chat, profils de manette, matchmaking, WebSocket
- Le **mode solo fonctionne en site statique**. Le multijoueur exige le serveur.

---

## Pages

| Fichier | Rôle |
| --- | --- |
| `index.html` | Menu public |
| `raphael2.html` | Ville et jeu principal |
| `vallee.html` | Vallée : éditeur + mode vol |
| `mondes.html` | Explorateur des 22 mondes, vol et duel synchronisé |
| `multiplayer.html` | Échange du ticket Ghost Chat + matchmaking |
| `puppet_animation_editor.html` | Éditeur d'animation |
| `poilhes.html` | Maquette 3D fidèle du village de Poilhes (données IGN / OSM) |

## Modules JavaScript

| Fichier | Rôle |
| --- | --- |
| `chasseur.js` | Modèle et apparence du chasseur, partagés |
| `combat.js` | Canon, son, cibles au sol, partagés |
| `air-combat.js` | IA aérienne, radar, missiles, dégâts, audio d'alerte, VFX, HUD |
| `rzphzel.js` | Contrôleur principal de la ville et du portail (nom historique — **ne pas renommer**) |
| `maps/world-catalog.js` | Identité, mission, objectifs, points de départ, objets de chaque monde |
| `maps/world-builder.js` | Génération relief, routes, végétation, bâtiments, eau, lave |
| `maps/world-game.js` | Catalogue, chargement pilote, entrées, caméras, UI de mission |
| `maps/world-multiplayer.js` | Client multijoueur |
| `maps/cockpit-view.js` | Cockpit 3D de la vue pilote — modèle Eurofighter, monté sur la caméra |

## Service Python

`app.py`, `server_raphael.py`, `requirements.txt`, `multiplayer/__init__.py`, `multiplayer/routes.py`

---

## Lancement local

```powershell
py -m pip install -r requirements.txt
py server_raphael.py
```

Puis `http://127.0.0.1:8010/index.html`.

> **TODO à trancher** : `README.md` annonce le port `8010`, `DEVELOPMENT_REPORT.md`
> parle d'une détection du port `8000` dans `Lancer_jeu.bat`. Vérifier la valeur réelle
> et aligner les deux documents.

> **TODO à trancher** : `Lancer_jeu.bat` est décrit comme existant dans `README.md`
> et comme « à recréer » dans les anciennes consignes. Vérifier sa présence à la racine.

---

## Multijoueur et SSO

Ghost Chat reste l'**unique** écran de connexion ; Nova Flight n'a pas de seconde base
utilisateurs.

1. Le joueur clique « Jouer à Nova Flight » dans Ghost Chat.
2. Ghost Chat signe un ticket valable 120 s.
3. Nova Flight l'échange contre un cookie HTTP-only valable 7 jours.
4. Le matchmaking place au maximum **deux comptes différents** dans un salon.
5. Un WebSocket transporte positions, tirs, dégâts, destructions, réapparitions.

Contraintes :

- **Un seul worker.** Les salons vivent en mémoire ; plusieurs workers produiraient des
  listes de salons indépendantes et les deux pilotes ne se retrouveraient jamais.
- `NOVA_SSO_SECRET` doit être **strictement identique** des deux côtés. Un écart donne
  « Lien Ghost Chat invalide ». Ne jamais commiter la vraie valeur.
- Nginx Proxy Manager : « Websockets Support » activé sur `raphael.crea-doc.fr`.
  Sans la mise à niveau WebSocket, le SSO passe mais les avions restent invisibles.

> **TODO à trancher** : `NOVA_HOST=127.0.0.1` (doc de publication) est incompatible avec
> `proxy_pass http://172.17.0.1:8010` si NPM tourne en conteneur. Choisir entre bind
> `0.0.0.0` + pare-feu, ou NPM en `network_mode: host`.

> **TODO à trancher** : deux stratégies de reverse proxy coexistent dans les docs —
> `location /api/` seul (assets servis en statique par Nginx) ou `location /` complet
> vers FastAPI. La première est la moins risquée. Supprimer l'autre du dépôt.

Détails : `MULTIPLAYER_DEPLOYMENT.md`.

### Limites connues du MVP

Deux joueurs max · matchmaking public automatique, sans liste de salons ni invitations ·
salons perdus au redémarrage · pas de persistance de profil, classement ou historique.

---

## Mondes

24 cartes procédurales reliées par un réseau de portails — chaque monde contient un anneau
énergétique dans sa moitié nord — **plus les mondes relevés** : ni graine ni générateur, leur
relief et leurs bâtiments viennent des données IGN (voir plus bas). Ils sont trois :
`poilhes`, `capestang`, et `pays-canal` qui réunit les deux villages dans la même carte.

> **TODO** : incohérence de nommage — la table du catalogue dit `Frontière des Tempêtes`,
> la description du réseau de portails dit `Frontière de l'Orage`. Aligner sur l'identifiant
> réel présent dans `world-catalog.js`.

### Ajouter un monde

Ajouter une entrée dans `WORLD_MAPS` de `maps/world-catalog.js`. Minimum requis :
identifiant, taille, type de terrain, plan de circulation, populations procédurales,
point de départ au sol, point de départ aérien, mission.

Toute référence d'objet doit utiliser une clé **déjà déclarée** dans `ASSET_LIBRARY`.
Le moteur construit ensuite automatiquement terrain, routes, décor, objectifs, commandes
et les trois modes de pilote.

---

## Villages réels en 3D (`poilhes.html`)

Maquettes fidèles reconstruites **uniquement à partir de données publiques**, pour
l'instant **deux villages** :

| Village | `?village=` | Zone | Bâtiments | Paquet |
| --- | --- | --- | --- | --- |
| Poilhes (34310) | `poilhes` (défaut) | 1 km × 1 km | 593 | 25 Mo |
| Capestang (34310) | `capestang` | 1,12 km × 1,12 km | 1 648 | 68 Mo |

La chaîne n'a rien de propre à un village : elle lit l'IGN autour d'un point.
`scripts/poilhes/sites.py` tient la liste ; en ajouter un, c'est trois nombres
(longitude, latitude, demi-côté) puis :

```bash
VILLAGE=capestang py scripts/poilhes/build_village.py
```

Sortie dans `maps/<village>/`, cache de téléchargement dans `scripts/poilhes/.cache/<village>/`.
La page lit `?village=`, le catalogue des Mondes lit le champ `village` de la carte.

Poilhes : 1 km × 1 km détaillé + 6 km de relief lointain. Accessible depuis
le menu (« Visiter Poilhes en 3D »). Survol, Balade à pied (collisions), Drone, heure du jour
(soleil calculé pour Poilhes, nuit avec fenêtres et lanternes), visite guidée, recherche de rue.

| Fichier | Rôle |
| --- | --- |
| `scripts/poilhes/build_village.py` | Génère tout `maps/poilhes/` (≈ 40 s, cache disque) |
| `scripts/poilhes/buildings.py` | Toits reconstruits depuis le LiDAR (pans RANSAC, niveaux, surface), murs, cheminées |
| `scripts/poilhes/vineyards.py` | Rangs de vigne réels : cadastre ∩ zones « Vigne », orientation et phase lues sur la photo |
| `scripts/poilhes/vegetation.py` | Arbres réels : sommets LiDAR (MNS − MNT) + infrarouge |
| `maps/poilhes-village.js` | Moteur de visite (terrain, bâtiments, arbres, eau, nuit, navigation) |
| `maps/poilhes-shaders.js` | Façades, tuiles canal, sol, eau, feuillage — tout procédural, sans texture |
| `maps/poilhes-robot.js` | Mode « Robot » (3ᵉ personne) : Titan bleu ou Mech rouge, inertie, collisions en disque, laser, caméra amortie |
| `maps/poilhes-impact.js` | Impact du laser : éclair, onde sur la surface, étincelles, poussière, brûlure |
| `maps/poilhes-enemies.js` | Ennemis : vagues, poursuite, corps à corps, tirs, contournement, mort |
| `maps/poilhes-jet.js` | Mode « Chasseur » : survol du village avec l'appareil partagé |
| `maps/poilhes-scene.js` | **Le décor seul** : relief, bâtiments, eau, arbres, vignes, ciel, et les fonctions qui les interrogent |
| `maps/poilhes-world.js` | Adaptateur : présente le village au moteur des Mondes comme un monde ordinaire |
| `scripts/meshy-fusion.py` | Un lot d'animations Meshy (un GLB par clip) → un seul GLB |
| `scripts/goblins/` | Le jeu de figurines 3MF → cinq GLB jouables (`parse_3mf.py`, `build.py`, `peindre.py`) |
| `scripts/blender-mech.py` | Mech FBX (142 Mo) → `assets/mech/mech.glb` (1,6 Mo : LOD0, PBR, 7 animations) + gltf-transform |

Sources : IGN Géoplateforme (BD TOPO V3, LiDAR HD MNT/MNS, BD ORTHO RVB et IRC, cadastre
Parcellaire Express) — Etalab 2.0 ; OpenStreetMap (noms, piscines, places) — ODbL.

Régénérer : `py scripts/poilhes/build_village.py` (le cache `scripts/poilhes/.cache/` n'est
pas versionné). Console : `RaphaelPoilhes.goTo(x, z)`, `RaphaelPoilhes.setTime(21.5)`,
`RaphaelPoilhes.setMode('balade')`.

En ligne : https://raphael.crea-doc.fr/poilhes.html. Le site statique est sur le **serveur 2**
(`root@212.227.147.177`, conteneur `raphael-online`, racine `/opt/raphael-online-site`, montée
en lecture seule — aucun redémarrage nécessaire). Publier seulement les fichiers concernés :

```bash
tar -cf - poilhes.html maps/poilhes-*.js maps/poilhes assets/mech/mech.glb \
  | ssh root@212.227.147.177 'cd /opt/raphael-online-site && tar -xf - --no-same-owner'
```

### Poilhes dans le moteur des Mondes

`mondes.html?map=poilhes` lance **le vrai jeu** sur le village : chasseur, cockpit 3D, HUD,
radar, missiles, combat aérien. Rien n'est dupliqué — trois pièces s'emboîtent :

1. `poilhes-scene.js` construit le décor et ne connaît ni HUD ni boucle de rendu. C'est le
   découpage qui a rendu tout le reste possible : `poilhes-village.js` (la visite) et le
   moteur des Mondes chargent le **même** village.
2. `poilhes-world.js` le présente sous la forme qu'attend `world-game.js` :
   `{ root, getHeight, bounds, collision, portal, tick }`. `getHeight` renvoie le maximum du
   sol et des **surfaces** (toits, houppiers) : sinon l'avion traverserait les tuiles.
3. `world-game.js` branche sur `world.terrainSource === 'poilhes'` — deux lignes, et le reste
   du moteur ne voit aucune différence.

À savoir :
- Le monde relevé n'a **pas de portail** ni de collision fine (`portal: null`, `collision: null`) ;
  `updatePortal` sait déjà s'en passer. Les murs restent à brancher pour le mode au sol.
- Le décor pose ses meshes dans un `root` fourni, mais le **brouillard et l'environnement**
  restent sur la scène : `buildWorld` n'étant pas appelé, l'adaptateur doit créer `scene.fog`
  lui-même, sinon `setTime` plante en voulant en changer la couleur.
- `built.tick(dt)` fait avancer l'horloge des shaders du village (eau, feuillage, ciel) : sans
  elle, le village est figé et la sphère de ciel reste derrière l'avion.
- 21 Mo de géométrie : le premier chargement prend une demi-minute, pendant laquelle on entend
  déjà le réacteur. Le pourcentage remonte donc jusqu'à l'écran de chargement.

Mode « Chasseur » (survol du village, page `poilhes.html`) :
- **Rien n'est réécrit.** Le maillage vient de `window.RaphaelChasseur` (`chasseur-model.js`)
  et la loi de pilotage de `window.RaphaelFlightModel` (`flight-model.js`), appelée dans le
  même ordre que `maps/world-game.js` : vitesses 38 / 72 / 92 m/s, virage induit, stabilisation.
  Un avion qui répondrait autrement selon la page est précisément ce que ces deux fichiers
  empêchent. Ce sont des scripts **classiques**, chargés par `poilhes.html` avant le module ;
  `chasseur-model.js` va chercher Three.js par la table d'imports de la page, donc **pas de
  seconde copie** de la bibliothèque.
- Propre au village : le plancher suit `max(groundAt, surfaceAt) + 9` — on rase les tuiles et
  les houppiers sans les traverser — et les limites sont celles du relief lointain (±2 900 m).
  Au contact, l'appareil est cabré par le modèle de vol au lieu d'exploser : le village se visite.
- La caméra prend la verticale de **l'appareil** (`camera.up`), sinon le tonneau ne se voit pas.
  `exit()` la remet à l'aplomb du monde — sans cela, tous les autres modes penchent.
- Commandes : flèches, **Z** plein gaz, **Maj** post-combustion, **S** ralentir, **E** / **Ctrl**
  monter et descendre, **V** caméra large ou serrée, **+** / **−** cran de poursuite.

Téléphone (portrait) — `body.tactile`, commandes dans `#tactile` :
- **`touch-action: none` sur le canevas** : sans lui le navigateur confisque le glissé pour
  faire défiler la page, et la caméra paraît « ne pas répondre » alors qu'elle ne reçoit plus
  rien. C'est le défaut n° 1 constaté sur un vrai appareil.
- Manche **visible**, qui naît là où le pouce se pose dans le quart bas-gauche ; trois pastilles
  à droite (TIR maintenu, Cours, Vue) ; regard au glissé ailleurs ; pincement = recul caméra.
  Un manche invisible au centre d'une moitié d'écran ne se trouve pas.
- Le **viseur reste au centre exact** : le tir part du centre de l'écran, décaler la croix pour
  dégager les pouces ferait mentir la visée.
- En portrait : coque et gobelins en bandeau **en haut**, minicarte réduite en haut à droite,
  barre d'aide clavier masquée — le bas de l'écran appartient aux pouces.
- Caméra : recul 12 m au lieu de 18 (à 18 m le robot n'est qu'un jouet sur un écran étroit).
- Rendu : `pixelRatio` plafonné à 1,25 et **ombres portées désactivées** en tactile.

Robot, laser et caméra :
- Laser du bras droit (clic gauche, **F**, ou bouton « Laser » au doigt) : visée par rotation des os
  `RightArm` / `RightForeArm` vers la direction de tir, portée 140 m, arrêté par les murs et le relief
  mais **pas** par les houppiers (la carte des hauteurs ne dit pas ce qu'il y a dessous). Le cylindre
  du trait est décalé sur +Z, sinon la moitié part dans le dos.
- Le tir suit le **viseur** au centre de l'écran (`#viseur`), il n'est plus horizontal : on cherche ce
  que la caméra regarde et le trait part de la main vers ce point, les deux se rejoignent sur la croix.
  Le rayon de visée part **du robot**, pas de l'objectif : sinon le sol touché entre les deux, caméra
  plongeante, tire le point de visée sous terre et le trait pique devant les pieds. La croix passe à
  l'orange quand un gobelin est dessous (`state.verrou`).
- La montée le long des façades est plafonnée à 0,60 rad (0,48 en portrait). Elle valait
  1,15 rad — 66 degrés : dans une ruelle la caméra basculait à la verticale et le jeu devenait
  une vue de dessus. On préfère se rapprocher que monter.
- Caméra amortie (constantes de temps) : resserrage rapide sur obstacle, éloignement lent, pas plafonné
  pour ne jamais se téléporter, montée le long des façades en ruelle, champ ouvert à la course,
  placement immédiat à l'entrée du mode.

Robot : **Titan bleu** (`perso/Meshy_AI_Azure_Titan_biped/…Merged_Animations.glb`) par défaut,
**Mech rouge** (`assets/mech/mech.glb`) en second — boutons dans la barre d'aide du mode.
Vitesse de consigne 2,4 m/s (6,2 avec Maj), atteinte avec accélération et freinage ; l'animation
(marche / course) est choisie et cadencée d'après la vitesse réelle. Collisions : disque de 0,8 m
sur la grille d'obstacles, glissement le long des murs, et dégagement automatique si le robot se
retrouve dedans (sinon on reste bloqué).

Gobelins (premier niveau d'ennemis) :
- Cinq figurines d'impression 3D (`Set_of_5_goblins.3mf`, Maker Girl Millie) : hache, gourdin,
  épée-bouclier, arc, bâton. Chaîne en trois temps, dans `scripts/goblins/` :
  `parse_3mf.py` (lecture en flux du XML de 88 Mo, cache npz) → `build.py` (plinthe coupée,
  220 000 → 9 000 triangles, hauteur 1,55 m, pieds sur y = 0) → `peindre.py`.
- **Pas d'UV, pas de matière : la couleur est cuite dans les sommets.** Zones (peau, cuir,
  pantalon, métal, bois) déduites de la hauteur relative et de l'écart à l'axe du corps,
  puis occlusion (grille d'occupation floutée) et brossage à sec sur les arêtes convexes.
  Mesurer la hauteur sur le **corps** (q < 1,35) et non sur la boîte englobante : plusieurs
  gobelins brandissent leur arme au-dessus de la tête, sinon le visage tombe au milieu de l'échelle.
- Le volume de touche est une capsule qui **monte plus haut que le crâne** : le Titan tire à
  hauteur d'épaule, donc au-dessus d'un gobelin de 1,55 m. Sans cette marge on vide son
  chargeur sur un ennemi collé à soi sans jamais le toucher.
- Les modèles n'ont pas de squelette : la démarche est procédurale (`anime()` dans
  `poilhes-enemies.js`). Le jour où ils reviennent riggés, seule cette fonction change.
- Coque du robot 250 points, redéploiement automatique 4 s après la mise à terre ; vague
  suivante 7 s après le dernier gobelin, un ennemi de plus à chaque fois.
- Faute de plan de circulation, un ennemi lancé droit sur un mur y resterait collé : on
  mesure ce qu'il a **réellement** parcouru sur 0,8 s et, s'il piétine, il longe l'obstacle
  1,6 s d'un côté tiré au sort. C'est grossier mais cela suffit à contourner un pâté de maisons.

**Chevalier d'Enfer** (`assets/knight/knight.glb`, 805 Ko) — la pièce lourde, riggée :
- Source : lot Meshy `Meshy_AI_Inferno_Knight_biped` (quatre GLB de 24 Mo, un par animation,
  chacun réembarquant le personnage entier). `scripts/meshy-fusion.py` garde un fichier comme
  base et y greffe les pistes des autres — c'est légitime parce qu'un lot Meshy sort d'un seul
  export : mêmes nœuds, même ordre (le script le vérifie et refuse sinon). Puis
  `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 1024`.
- 420 points de vie, marche à 2,1 m/s et charge à 4,4 m/s sous 30 m, 26 de dégâts.
  Clips : `Walking`, `Running`, `Punch_Combo_5`, `Reaping_Swing`. **Pas de pose de repos** :
  la marche tourne au ralenti à l'arrêt, ce qui fait une attente convaincante.
- `clonerSquelette()` remplace SkeletonUtils en trente lignes : `Object3D.clone()` copie bien
  la hiérarchie mais laisse les maillages attachés au squelette d'origine — tous les exemplaires
  prendraient la même pose. On rattache chaque copie aux os clonés, retrouvés par leur nom.
- La carte métal/rugosité cuite par Meshy rend l'armure miroir : sans réflexion forte dans le
  village elle vire au noir verni. Les facteurs sont rabattus à `metalness 0.18 / roughness 0.88`,
  la texture garde le détail.
- Tripo a été écarté : compte inexistant, et Atlas Cloud ne fait ni rig ni 3D.

Chaussée en volume (`scripts/poilhes/roads.py`) :
- La BD TOPO donne l'axe, la largeur et la nature de chaque tronçon ; on en tire un ruban
  **indexé** posé sur le relief, avec bombement de 5 cm, caniveau et accotement. Sans index,
  les mêmes routes pesaient quatre fois plus lourd.
- Les marquages se mesurent en **mètres réels**, jamais en fraction de largeur : 15 cm de
  peinture restent 15 cm, et le rythme est le T1 français (3 m de trait, 10 m de vide).
  Sous 4,6 m de large, pas de bande axiale — comme dans la réalité.
- `routes_fin` porte la distance au bout du tronçon : les tronçons se terminant aux
  carrefours, c'est ce qui permet d'y **effacer les bandes**, qu'on ne peint pas en travers
  d'un croisement.
- Aux carrefours, les rues larges passent imperceptiblement au-dessus des étroites
  (`LEVEE + demi * 0.004`), sinon deux rubans à la même altitude se battent pixel par pixel.

Sol, arbres et façades :
- Le masque de sol a un **quatrième canal** : « photo inventée ». Là où `clean_photo()` a
  effacé un arbre ou un toit, l'orthophoto ne montre plus le sol mais une moyenne étalée du
  voisinage — les halos pâles qu'on voyait de part et d'autre des routes bordées de platanes.
  Le shader y repeint un sous-bois accordé à la teinte locale.
- Feuillage : la texture est une **ramille** (trois brindilles, une trentaine de folioles) et
  non une tache verte, 84 cartes par arbre au lieu de 46 et deux fois plus petites, une graine
  par carte (teinte, quart de tour, miroir) et de la translucidité à contre-jour. Écorce
  procédurale pour les troncs : cannelures, plaques claires du platane, lichen au pied.
- Façades : appuis de fenêtre en pierre débordante avec leur ombre, **coulures de pluie** sous
  les appuis, chaînes d'angle et bandeau d'étage sur les maisons anciennes de rue. Ce sont les
  détails qui se lisent à trente mètres, là où le crépi ne se lit plus.

Poids des données — trois leviers, tous appliqués :
1. **La rive des toits** (bande de tuiles au bord) pesait 43 % de tous les sommets de toit :
   les contours de pans issus du LiDAR sont en escalier au demi-mètre et chaque marche était
   insérée telle quelle. `_espacer(pts, 0.35)` et une simplification à `px * 1.4` l'ont divisée.
2. Les attributs de texture (`murs_fac`, `murs_info`, `toits_uv`) sont en **demi-précision**
   (`f16`, lus par `THREE.Float16BufferAttribute`) : trois chiffres significatifs suffisent à
   des coordonnées de toit, et le fichier fond de moitié. **Jamais pour les positions** : sur
   1,3 km, le demi-flottant ne descend pas sous le demi-mètre.
3. Le demi-côté de la zone (`sites.py`) se choisit sur l'étendue bâtie, pas au hasard.

Pièges déjà rencontrés :
- **Un toit ne descend jamais sous son propre égout.** Les pans ajustés au LiDAR plongeaient
  jusqu'au sol quand le nuage de points débordait sur le terrain ou sur un arbre voisin :
  9 068 sommets de toit traînaient à moins de 40 cm du sol. `Roof.plancher`, posé à
  `eave - FASCIA`, est la contrainte physique qui manquait.
- La BD TOPO contient des emprises dégénérées (anneau non fermé) que GEOS refuse de
  soustraire (« Ring edge missing ») — Capestang en avait une, Poilhes aucune. `_debord()`
  recale au millimètre puis renonce au débord pour ce bâtiment-là, jamais pour le village.
- **Le cache du navigateur** : tout module importé sans estampille `?v=` peut revenir périmé,
  et l'import échoue alors en silence (« does not provide an export named … ») — page bloquée
  sur l'écran de chargement, réacteur audible. Les modules du village sont estampillés ;
  le serveur de développement (`app.py`) répond en plus `Cache-Control: no-store`.
- Les graines aléatoires passées en attribut doivent être **arrondies** dans le shader :
  l'interpolation les bruite et les hachages `fract(sin(…))` amplifient ce bruit en lamelles.
- Pas de relief (bump) sur des motifs discontinus (encadrements, volets) : les dérivées
  écran les transforment en pointillés.
- La photo aérienne est très sombre dans les rues étroites (ombres portées) : la chaussée
  ne doit pas en dépendre.
- Les images (`ortho_*`, `sol_*`, `nuit.png`, `plan.jpg`) sont demandées avec `?v=version`
  et `village.json` / `village.bin` en `cache: 'no-cache'` : un index périmé avec une géométrie
  neuve donne « Invalid typed array length ».
- L'orthophoto peint les arbres et les toits **sur le sol** (vue d'avion) : `clean_photo()` les
  efface en prolongeant le sol voisin, sinon les rues sont vertes et pleines d'ombres de midi.
- Le terrain est aplani sous la chaussée (`Terrain.flatten_roads`) : sans cela la route gondole
  au rythme de la grille de 2 m.
- Mech : mesurer sa taille sur les sommets **après squelette** (`Box3.setFromObject` part de la
  géométrie de liaison en centimètres) et retirer la piste `Root_M.position` de « Landing » et
  « Death » (elles font plonger la racine de ~50 m).
- Impact de laser (`maps/poilhes-impact.js`) : la brûlure ne doit apparaître qu'**après** le
  flash (sinon on voit un œil noir au milieu du blanc) et la poussière rester sous 0,25
  d'opacité, sinon l'ensemble vire au gris laiteux. Tout est dimensionné en mètres réels :
  l'effet fait environ 2 m d'envergure, pas la boule de feu de `world-explosion.js`.

---

## Les pays : plusieurs villages dans la même carte

`mondes.html?map=pays-canal` — **Poilhes et Capestang réunis**, à leur écart réel de
**4 022 m**, dans une seule carte de 8 km. Le chasseur décolle au-dessus d'un village et
voit l'autre à l'horizon ; quarante secondes de vol séparent les deux clochers.

Rien n'est reconstruit : les deux villages existent déjà dans `maps/poilhes/` et
`maps/capestang/`, chacun centré sur **sa** propre origine. Un pays les pose dans deux
groupes décalés et fournit les trois choses qu'un village apporte avec lui mais qui, à
plusieurs, doivent être uniques.

| Fichier | Rôle |
| --- | --- |
| `scripts/poilhes/build_pays.py` | Le relief commun : 8 km au pas de 20 m + photo aérienne (~5 Mo, 12 s) |
| `maps/pays-scene.js` | Le pays : un ciel, un relief, N villages décalés, et l'aiguillage des requêtes |
| `maps/pays-world.js` | Adaptateur : présente le pays au moteur des Mondes comme un monde ordinaire |
| `maps/pays-canal/` | `pays.json`, `pays.bin`, `ortho_lointain.jpg` — les données du pays |

Ajouter un pays, c'est une entrée dans `PAYS` de `scripts/poilhes/sites.py` (les villages
membres et le demi-côté du relief), `PAYS=<nom> py scripts/poilhes/build_pays.py`, puis une
entrée au catalogue avec `terrainSource: 'pays'`. Le centre est calculé : c'est le milieu
des centres des villages.

Ce qui devient commun, et pourquoi :

1. **Un seul ciel et un seul soleil.** `creerAmbiance()` (dans `poilhes-scene.js`) a été
   sorti du village pour cela : deux sphères de ciel superposées se battent pixel par pixel,
   et deux `DirectionalLight` éclairent la scène deux fois. Le village reçoit l'ambiance en
   paramètre (`ambiance`) et n'expose plus que `setNight(lampes)` — son éclairage public,
   qui lui reste propre puisque sa carte de nuit couvre son seul kilomètre carré.
2. **Un seul relief lointain.** Les deux plans de 6 km livrés avec les villages se
   recouvriraient, avec deux photos d'expositions et de dates différentes. `build_pays.py`
   en fabrique un de 8 km qui les contient tous les deux. Le village se construit alors avec
   `lointain: false`.
3. **Un seul repère.** `pays.json` donne la place de chaque village en mètres
   (Poilhes +1 654 / +1 144, Capestang −1 654 / −1 144). `groundAt`, `surfaceAt` et
   `blockedAt` cherchent le village qui contient le point, lui passent des coordonnées
   **locales**, et retombent sur le relief du pays entre les deux.

À savoir :

- **La marche de 6 m sous une zone détaillée se recule d'une maille.** Le relief du pays
  passe sous les villages, abaissé de 6 m pour ne jamais percer les tuiles. Si l'abaissement
  commence exactement à la limite, il tombe dans la maille à cheval sur le bord — et un
  fossé de 6 m court tout autour du village, là où la tuile ne le couvre plus. Mesuré après
  correction : 61,21 m juste dedans, 61,32 m juste dehors.
- **Les bords ne tombent pas sur la grille.** Les villages sont à 4 022 m l'un de l'autre,
  pas à un multiple de 20 m du centre du pays : on ne peut pas recopier une ligne de sommets
  comme le fait `far_terrain()` pour un village seul. On échantillonne le terrain du village
  sur une bande d'une maille de part et d'autre.
- **Le plan lointain de la caméra passe de 4 200 à 9 000 m** (`pays-world.js`). À 4 200,
  l'horizon est coupé en plein milieu du pays et le second village clignote. `dispose()`
  remet la valeur d'origine.
- **Les ombres suivent l'avion.** Une carte de 8 km ne tient pas dans une caméra d'ombre :
  elle est recadrée à 420 m autour du joueur, alignée sur les texels — sinon les ombres
  scintillent en vol.
- `spawn` et `size` du catalogue sont **doublés** par `WORLD_LINEAR_SCALE` : on les écrit à
  la moitié de leur valeur réelle. Le départ au sol (827, 572) tombe sur la place de Poilhes.
- Poids : **93 Mo** pour les deux villages, plus d'une minute au premier chargement. Le
  pourcentage couvre les deux, l'un après l'autre.
- Ce qui reste à faire : le pays n'est branché que sur le **chasseur**. La visite à pied,
  le robot et les gobelins (`poilhes.html`) restent sur un village à la fois — il faudrait
  fusionner les métadonnées (rues, lieux, minicarte, recherche d'adresse) des deux villages.

---

## La voiture

Une sportive GT conduisible dans les rues, **dans les trois mondes relevés** :
`poilhes.html` (bouton « Voiture », Poilhes et Capestang) et le moteur des Mondes
(`mondes.html?map=poilhes|capestang|pays-canal&mode=voiture` — le mode « Voiture GT »
rejoint « Chasseur » et « Robot Titan » dans `PLAYER_MODES`).

| Fichier | Rôle |
| --- | --- |
| `maps/voiture-physique.js` | La loi de conduite, sans Three.js : couple moteur, boîte 6 + marche arrière, transfert de charge, dérive des pneus, ellipse de friction, frein à main. C'est à la voiture ce que `flight-model.js` est au chasseur |
| `maps/voiture-model.js` | La carrosserie : charge `assets/car/crimson.glb`, le remet d'aplomb, en sépare les roues ; coque procédurale en secours |
| `maps/voiture-pilote.js` | Le mode : suspension sur quatre roues, collisions, adhérence route/hors-piste, caméra, son moteur, fumée, traces de gomme |
| `apercu-voiture.html` | **La voiture seule**, telle que le jeu la monte : roues détachées en couleur (**R**), qui tournent (**T**) et braquent (**B**), nuit (**N**), teinte (**C**), vues fixes (**1**-**4**) |
| `assets/car/crimson.glb` | 1.86 Mo, 155 000 triangles — Meshy « Crimson Thunder » (muscle car rouge à bandes), `weld` → `simplify --ratio 0.18` → meshopt + WebP 2048 (brut : `crimson-brut.glb`, 32 Mo) |

Commandes : flèches ou **ZQSD**, **Espace** frein à main, **V** caméra (poursuite,
proche, capot), **R** remet sur la chaussée, **M** allume ou coupe le moteur — il est
**muet par défaut**. Frein maintenu **0,75 s à l'arrêt** → marche arrière.
Au doigt : manche bas-gauche (haut accélère, bas freine), bouton **MAIN**, bouton **Vue**.

**Deux voitures**, choisies par les boutons de la barre d'aide (mode Voiture) ou
`RaphaelPoilhes.voiture.choisirVoiture('bleue')` :

| | GT rouge | Berline bleue |
| --- | --- | --- |
| Transmission | propulsion | **traction** |
| Couple / 0-100 / Vmax | 500 N·m · 4,8 s · 303 km/h | 380 N·m · 6,4 s · 248 km/h |
| Virage à fond, pied dedans | 22° de dérive arrière | **5,7°** |
| Le même sur la terre | 68° (tête-à-queue) | **5,1°** |

Ce n'est pas un habillage : `motrice: 'avant' \| 'arriere'` décide de l'essieu qui
reçoit la force, et tout en découle — une traction tire au lieu de pousser, donc elle
élargit son virage au lieu de partir de l'arrière, et il suffit de lever le pied. La
bleue est la voiture à donner à quelqu'un qui ne connaît pas le jeu.

La peinture bleue est la **même texture, repeinte à l'arrivée** : rotation de teinte des
seuls pixels saturés (139 ms, une fois). Les bandes blanches, les optiques et les pneus
ne bougent pas — teinter tout aurait donné une voiture sous gélatine. Rien n'est
retéléchargé.

Chiffres du châssis : 1 470 kg, 500 N·m, six rapports, 0 à 100 en **4,8 s**, et de
l'adhérence à 1,32 sur le bitume contre 0,74 sur la terre — deux roues dans l'herbe
et la voiture tire de ce côté.

Elle se conduit comme une voiture de série, pas comme un châssis de course : **antipatinage**
(la traction reste sous 92 % de l'adhérence arrière), **équilibre sous-vireur** (train arrière
à 1,08 fois l'adhérence avant : elle élargit au lieu de partir de l'arrière), **pneus
progressifs** (B 7,6 / C 1,28 : le décrochage s'annonce au lieu de survenir), **braquage
plafonné à 29°** et un **limiteur de lacet**. La glissade reste accessible, mais au frein à
main seulement — il coupe toutes ces aides d'un coup.

La nuit, phares et feux arrière s'allument (`setNuit`), les feux stop doublent au freinage, et
deux `SpotLight` éclairent vraiment la chaussée.

À savoir :

- **La convention latérale appartient à la physique, pas à la commande.** `v` compte
  positif vers la droite, `lacet` positif tourne à gauche (le `yaw` de Three.js) :
  dérives, moment, termes de Coriolis et accélération latérale en découlent. La
  commande, elle, est naturelle — positif = à droite. Retourner la commande « corrige »
  le volant mais laisse la caisse pencher du mauvais côté en virage : le jour où les
  deux corrections ont été faites en parallèle, elles se sont annulées.
- **Un onglet en arrière-plan doit se taire par un événement, pas par la boucle.**
  `requestAnimationFrame` s'arrête dans un onglet caché : la mise à jour du son n'est
  plus appelée, les gains restent à leur dernière valeur et le moteur ronronne
  indéfiniment. D'où `visibilitychange` / `pagehide` / `blur`, et le moteur muet tant
  qu'on ne l'a pas demandé.
- **Ne pas teinter la texture d'un modèle génératif.** L'atlas de Meshy est déjà rouge,
  blanc et noir : une teinte rouge multipliée par-dessus rosit les bandes blanches et
  les optiques au lieu de raviver le rouge. La couleur du matériau reste blanche.
- **Un atlas d'UV très fragmenté ne supporte pas une décimation brutale.** À 6 %, le
  simplificateur tirait des sommets d'un îlot à l'autre et la carrosserie se couvrait de
  plaques blanches froissées. `weld` d'abord, puis `--ratio 0.18 --error 0.0006`.
- **La marche arrière doit se vouloir.** À 0,35 s de frein à l'arrêt, finir un freinage
  suffisait à l'engager et la voiture repartait en arrière toute seule ; c'est 0,75 s.
- **Un modèle de pneus ne veut plus rien dire à basse vitesse.** La dérive est un rapport
  de vitesses : elle explose quand la vitesse tend vers zéro, les forces saturent et la
  voiture pirouette sur place au moindre coup de volant. Sous 8 m/s on retombe donc
  progressivement sur la cinématique d'Ackermann — sauf frein à main tiré, où le
  tête-à-queue volontaire doit rester possible.
- **Une aide de stabilité ne doit jamais *imposer* le lacet du volant.** Le premier
  correctif rappelait la voiture vers le lacet géométrique d'Ackermann — 3,3 rad/s à fond
  de volant à 60 km/h, quatre fois ce que les pneus tiennent : c'était l'aide elle-même qui
  la mettait en travers. Le rappel est plafonné à µ·g/v et ne freine que l'**excès** de
  rotation ; tourner reste le travail des pneus.
- **Les phares n'éclairent pas leur propre voiture.** Posée sur la tôle du nez, la
  `SpotLight` blanchissait le capot ; elle est reculée de 25 cm devant la carrosserie.
- **L'environnement de réflexion est un ciel de jour.** Gardé la nuit, il fait briller la
  carrosserie en plein midi au milieu d'un village éteint : `envMapIntensity` tombe à 0,10.
- **Un GLB meshopt est quantifié.** Ses positions sont des entiers courts normalisés,
  la vraie échelle vivant dans la matrice du nœud. `applyMatrix4` appliqué dessus
  écrase tout dans un cube de deux unités de côté et plus rien ne se repère.
  `enFlottants()` recopie en flottants **avant** toute transformation.
- **Les roues se détachent par la connexité, pas par un disque.** « Meshy livre un
  maillage d'un seul tenant » n'était qu'à moitié vrai : **deux des quatre roues sont
  des pièces indépendantes** du maillage. On les prend entières — rien n'est coupé,
  donc rien ne manque —, elles donnent le rayon et la largeur **réels**, et l'essieu
  resté soudé à la caisse est découpé au **cylindre** de ce rayon. Un cylindre laisse
  dehors l'aile (au-dessus du pneu) et le passage de roue (plus à l'intérieur).
- **Le rayon devinait faux, et c'est ce qui déchirait les pneus.** L'ancienne mesure —
  le plus petit demi-côté de la boîte englobante des points bas et latéraux — donnait
  **0,403 m** pour une roue qui en fait **0,340**. Le disque avalait donc un morceau
  d'aile, qui se mettait à tourner avec la roue, et laissait en arrière la bande de
  roulement collée à la caisse : des pneus en lambeaux. Les quatre rayons mesurés
  valent aujourd'hui 0,340 — le `RAYON` de la physique est 0,345.
- **Si les quatre roues ne sortent pas, on ne coupe rien** (`separerRoues` rend `null`).
  Une voiture aux roues figées se voit ; elle se voit moins qu'une voiture déchiquetée.
- **Les cartes de Meshy ne se gardent pas : ni normales, ni métal, ni rugosité.**
  La `metalnessMap` est cuite à 1 partout — gardée, la voiture devient chromée. Et la
  `roughnessMap` est pire, parce que le défaut est invisible dans le code : Three.js
  **multiplie** le facteur par la carte. Celle-ci vaut 0,33 en moyenne et descend à
  0,09 ; le « `roughness: 0.86` » censé mater la tôle donnait donc **0,28 en moyenne
  et 0,08 par endroits**. Une carrosserie à 0,08 de rugosité est un miroir : elle
  prenait la couleur du ciel, paraissait mouillée, et l'on croyait voir au travers.
  Une carte se mesure (`getImageData` sur le canal vert) avant de se garder.
- **Une peinture de voiture, c'est un pigment mat sous un vernis** : `metalness: 0`,
  `roughness: 0.58`, et tout le brillant porté par le `clearcoat` (0,55 / 0,22).
  C'est le vernis qui fait le reflet long sur une aile sans transformer la tôle en chrome.
- **`DoubleSide` reste nécessaire** et n'était pour rien dans l'impression de
  transparence : la décimation a retourné une partie des faces, et en `FrontSide` la
  carrosserie se troue — on voit l'habitacle et le flanc opposé au travers. Vérifié à
  l'image : c'était le miroir, pas la face arrière.
- L'orientation n'est pas devinée mais **mesurée** : la plus grande dimension d'une
  voiture est sa longueur, la plus petite sa hauteur. `redresser()` construit la
  rotation qui amène ces axes sur ceux du jeu, puis met à l'échelle sur 4,42 m.
- Le repère du modèle est vérifié par le **pavillon** : son point haut est en arrière
  du milieu, ce qui donne le sens de la marche.
- La grille d'adhérence est rasterisée **au premier passage dans le mode**, pas au
  chargement de la page : une centaine de milliers de triangles de chaussée, et
  aucune raison de faire attendre quelqu'un qui vient seulement survoler le village.
  Seule la chaussée compte (|u| ≤ 1 dans `routes_info`, au-delà c'est l'accotement).
- **Une façade renvoie une voiture, elle ne la catapulte pas** : la composante
  normale est reprise presque sans rebond (1,06) et le glissement le long du mur à
  peine freiné (0,93). Plus sévère, frôler un angle arrêtait net une voiture lancée.
- Le sol suivi est `walkableAt`, pas `groundAt` : c'est ce qui permet de passer **sur**
  le pont du canal au lieu de rouler dessous.
- Si le sol se dérobe plus vite que la suspension ne le rattrape, la voiture décolle
  (`state.enLair`) et ne tient plus rien : le dos d'âne du pont fait sauter.
- **Entrer en voiture, c'est d'abord choisir laquelle.** Un panneau central s'ouvre au
  clic sur « Voiture » (GT rouge ou berline bleue, avec ce qui les sépare écrit noir sur
  blanc) ; en roulant, la touche **C** bascule de l'une à l'autre.
- **`hidden` ne suffit pas sur une rangée en `display: flex`** : l'attribut pose
  `display: none`, qu'une règle CSS explicite écrase aussitôt. La rangée de choix restait
  visible dans tous les modes. Il faut `.row[hidden] { display: none; }`.
- **Une voiture colle à la route.** Elle ne décolle que si le terrain se dérobe plus vite
  que la chute libre — critère physique, comparé image par image — et non au-delà d'un
  seuil fixe en mètres, qui la faisait sauter dans la moindre descente un peu raide.
  Mesuré après correction : **zéro décollage sur 260 images** de conduite.
- **Le tremblement d'écran au contact venait de la caméra, pas du choc.** Son roulis
  suivait le lacet instantané : un frottement de mur faisait trembler toute l'image. Il
  ne suit plus que l'accélération latérale, lissée. Le dégagement des collisions est
  passé de 16 à 5,5 cm par image et par sonde, pour ne plus faire rebondir la voiture
  entre deux murs d'une ruelle.
- **Le toucher du volant se mesure.** Une pichenette de 0,15 s sur une flèche faisait
  tourner la voiture de **10,8°** à 60 km/h : intenable en ville. Le volant monte
  désormais plus lentement (3,0 au lieu de 4,4), revient vite au centre (8,0), et passe
  par une **courbe exponentielle** (1,7) — mêmes raisons que l'expo du manche dans
  `input-shaping.js`. Réglage final : montée 2,4, retour 9,0, courbe 2,0 — mesuré en jeu,
  **2,0°** pour une pichenette (10,8° au départ) et 43,6° pour un appui franc de 0,6 s.
  L'autorité à fond de course est intacte.
- **Les bruitages viennent d'enregistrements, montés par `scripts/sons-voiture.py`.**
  Ce n'est pas une conversion : l'enregistrement fourni est une **accélération** (122 →
  380 Hz, aucun régime tenu). Bouclé tel quel, le moteur monte en rond. Le script mesure
  la hauteur au fil du temps, relit le morceau à vitesse variable pour la rendre
  constante, aplatit l'enveloppe, transpose à 140 Hz (≈ 2 800 tr/min, le milieu de la
  plage) et ferme la boucle par un fondu croisé circulaire. Vérifié : 140 Hz stables,
  raccord à 0,013.
- **Un bruitage de freinage doit commencer AU crissement.** En gardant un quart de
  seconde de marge avant le son, il arrivait après le coup de frein du joueur : on
  l'entendait « en retard » alors qu'il partait à l'heure. Il démarre à 20 ms.
- **Deux barèmes de volume, et c'est nécessaire** : la synthèse est un signal plein, un
  mp3 normalisé passe bien plus bas dans la même chaîne. Au même réglage, le moteur
  s'entendait à peine à côté du démarreur (0,34 / 0,68 pour l'enregistrement contre
  0,045 / 0,10 pour la synthèse).
- Le son du moteur est **synthétisé** au régime (deux dents de scie désaccordées, une
  basse à l'octave, un filtre qui s'ouvre aux gaz) : rien à télécharger, et il suit le
  régime. Mais il sonne synthétique, et un enregistrement le remplace dès qu'il existe :
  déposer `assets/sons/moteur-boucle.mp3` (ou `.wav`, `.ogg`) et, facultativement,
  `moteur-demarrage.*`. La boucle est alors **réaccordée au régime** par sa vitesse de
  lecture (bornée entre 0,55 et 2,6 fois, au-delà un moteur sonne comme un jouet), et
  les oscillateurs se taisent. Aucun fichier, aucune erreur : la synthèse reste.
  Noter la provenance et les droits dans `assets/sons/PROVENANCE.md`, comme pour les
  sons du chasseur.

### L'assistance de conduite (24/09/2026)

Demande d'Arnaud : « que tout le monde puisse y jouer, que les murs remettent la
voiture sur la route très doucement, sans trop la ralentir ». Tout est dans
`maps/voiture-pilote.js`, **berline seulement** (`state.assistance`, `setAssistance(on)`) :

- **Le mur est un rail** : la vitesse qui rentrait dans la façade est renvoyée le long
  du mur (`rail` = part conservée), la caisse se réaligne sur la rue à `realigner` rad/s.
- **Rappel vers la route** : hors chaussée (au moins `rappelRoues` roues dans l'herbe),
  un peu de volant vers la route la plus proche — **jamais un déplacement de la caisse**,
  ni un frein. La caisse ne bouge que par ses pneus, sinon elle « ne colle plus à la
  route ». S'efface dès que le joueur braque.
- **Dégagement** : coincé gaz enfoncé plus d'une demi-seconde, recul à `degager` m/s.
- **Herbe** : l'adhérence hors piste est adoucie de `herbe` (0 = origine).

Les réglages vivent dans `pilote.reglagesAssistance` (le même objet que
`state.reglagesAssistance`) et se modifient **à chaud** : c'est le point d'accroche
d'un outil de réglage en temps réel, avec `REGLAGES` de `voiture-physique.js` pour la
loi de conduite elle-même. Le moteur de la voiture s'entend **d'emblée** depuis le
24/09 (le paragraphe « muet par défaut » plus haut est périmé) ; **M** le coupe.
Les feux de recul s'allument en marche arrière, et un choc contre un mur crisse.

## Niveaux de qualité et la page « Rouler » (`rouler.html`)

Le village pèse 2,4 millions de triangles par image. Mesuré le 24/09/2026 sur une RTX 4070 Ti
en 1080p, sans synchronisation verticale (`maps/qualite.js` porte les chiffres) :

| Situation | ms / image |
| --- | --- |
| Survol, ombres douces 4096 | 2,75 |
| Survol, sans ombres | 1,63 |
| Survol, ratio 2 (4K), ombres | 5,96 |
| Berline, ombres | 2,0 |

Extrapolé : une GTX 1060 tient 60 images/s sans ombres, un portable Intel Iris Xe tombe à
25 images/s avec ombres, un vieux portable (UHD 620) n'est pas jouable en Élevé. D'où trois
niveaux **choisis par le joueur**, comme dans un vrai jeu, et non une bascule automatique
qui donnerait l'impression d'un jeu qui bégaie :

| Niveau | Ratio de pixels | Ombres | Cartes de feuillage / arbre | Anticrénelage |
| --- | --- | --- | --- | --- |
| Bas | 1 | aucune | 20 | non |
| Moyen | 1,5 | 2048 | 42 | oui |
| Élevé | 2 | 4096 douces | 84 | oui |

| Fichier | Rôle |
| --- | --- |
| `maps/qualite.js` | Les niveaux, la mesure (`mesurer`), la recommandation, l'application à chaud (`appliquer`), le panneau (`monterPanneau`) |
| `rouler.html` | **Poilhes City** : l'accueil (image de fond, titre 3D, choix du village, de l'engin et de la qualité, bouton Rouler) puis le jeu — **Poilhes ou Capestang, trottinette et berline bleue seulement**, panneau de qualité. Ni survol, ni robot, ni chasseur : leurs moteurs ne sont pas créés, rien n'est téléchargé pour eux |
| `scripts/blender-titre.py` | Le titre « Poilhes City » en lettres extrudées (or + ivoire), rendu PNG à fond transparent + GLB, par Blender 5.0 en ligne de commande, police au choix |
| `assets/accueil/` | `poilhes-city.jpg` = l'image de fond de l'accueil (à déposer ; sans elle, le plan aérien du village), `titre-<police>.png/.glb` = les titres rendus |

À savoir :
- **Tout s'applique à chaud** : ratio de pixels et ombres sur le rendu, taille de la carte
  d'ombre en jetant `sun.shadow.map`, feuillage par `decor.feuillage.regler(n)` qui pose un
  `setDrawRange` sur les cartes — pas de reconstruction. Seul l'anticrénelage est figé à la
  création du rendu : il suit le niveau mémorisé au chargement suivant.
- **La machine se mesure, on ne lit pas le nom de la carte** : Chrome le donne, Firefox et
  Safari le masquent, et il ne dit rien de l'écran 4K. `mesurer` rend des lots de quatre
  images fermés par un `readPixels` d'un pixel, qui force la carte à finir — sans cela on ne
  mesure que l'envoi des commandes et la synchronisation verticale plafonne tout à 16,7 ms.
  Médiane, cinq lots d'échauffement. Seuils : < 8 ms Élevé, < 20 ms Moyen, sinon Bas.
- **Après un changement d'ombres, la carte met ~3 s à retrouver son rythme** (programmes
  recompilés : 3,5 ms puis 1,8 ms pour la même image). Le premier lancement mesure sur un
  rendu neuf, donc sans ce biais ; « Retester » attend trois secondes si les ombres étaient coupées.
- **Le premier lancement est le seul moment où la machine décide** : mesure en Élevé pendant
  l'écran de chargement, le conseil s'applique et se mémorise (`localStorage`, clé
  `nova.qualite`). Ensuite le joueur choisit, le bouton conseillé reste souligné, et le compteur
  d'images par seconde (plafonné par l'écran, comme partout) montre l'effet du choix.
- `startVillage(options)` accepte désormais `modes` (boutons cachés, moteurs non créés),
  `qualite` (niveau à la création du rendu), `voitureUnique` ('bleue' : pas de panneau de
  choix ni de touche C) et `ouvrir: false` (la page lève l'écran de chargement elle-même).
  Sans options, `poilhes.html` se comporte comme avant. La fonction renvoie ce qu'elle
  expose dans `window.RaphaelPoilhes`, enrichi de `decor`, `sun` et `mode`.
- Pas encore branché sur `mondes.html` : le moteur des Mondes garde ses plafonds en dur
  (`world-game.js`, ratio 2 et ombres douces sur ordinateur).

### L'accueil de Poilhes City

**Rien ne se charge avant le clic sur Rouler** : le rendu WebGL n'est créé qu'à ce moment,
la mesure de la machine aussi (qualité « Auto »), et le clic donne au passage le droit au son.
Choix : village, engin, qualité. Un autre village que celui de l'URL recharge la page avec
`?village=…&engin=…&go=1` — `go=1` saute l'accueil, c'est aussi ce que font les liens de
village du HUD. La berline se lance par le clic sur son bouton `[data-mode=voiture]`, qui est
le seul chemin sachant choisir la bleue.

Le titre est un rendu Blender, pas du texte HTML :

```bash
"C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b --factory-startup \
  --python scripts/blender-titre.py -- --police scripts/fonts/TitanOne-Regular.ttf \
  --sortie assets/accueil/titre-titanone
```

Quatre polices libres (Google Fonts, dans `scripts/fonts/`, non déployées) ont été rendues
le 24/09/2026 : Titan One (retenue par défaut), Luckiest Guy, Righteous, Bangers. Le cadrage
se calcule sur l'emprise réelle du texte, **en largeur et en hauteur** : une police condensée
(Bangers) est étroite mais haute, cadrée sur sa seule largeur elle sortait du cadre.

## L'outil de réglage de la conduite (touche T)

Demandé par Arnaud le 24/09/2026 comme la priorité : **un outil très fidèle de réglage
du comportement de la voiture et de la trottinette.** Fidèle veut dire : il agit sur les
vrais paramètres de la physique, à chaud, et il mesure avec la vraie physique.

| Fichier | Rôle |
| --- | --- |
| `maps/reglages.js` | Le schéma des paramètres (bornes, unités, ce que ça change), le **banc d'essai** calculé pas à pas avec `creerPhysique` (0 → 100, Vmax, freinage, virage, vivacité, frein à main), la mémoire (`localStorage`, clé `nova.reglages.<engin>`), l'export JSON, la copie en JS, et le panneau |
| `scripts/banc-voiture.mjs` | Le même banc en ligne de commande : `node scripts/banc-voiture.mjs [gt\|traction\|trottinette\|fichier.json] [--json]` |
| `maps/voiture-pilote.js` | Expose `reglage` et `regler` ; `TOUCHER` (toucher du volant) et `SAUT_TROTTINETTE` (sauts) sont des objets exportés, lus à chaque image, donc réglables à chaud |
| `maps/poilhes-village.js` | **T** ouvre / ferme le panneau sur l'engin du mode courant ; les réglages mémorisés s'appliquent à la création du pilote et à chaque changement de voiture |

En jeu : **T**. Groupes : moteur, transmission (roues motrices, rapports en liste), châssis,
pneus et freins, aides, direction, aéro, assistance (case, berline), toucher du volant,
sauts (trottinette). Chaque curseur applique **immédiatement** (`pilote.regler`), le banc se
recalcule en 120 ms, la télémétrie (km/h, rapport, régime, g latéral, dérives AV/AR,
patinage) défile en tête. Boutons : Rétablir (valeurs du fichier), Mémoriser (appliqué à
chaque partie, par nom d'engin), Oublier, Exporter (JSON), Charger…, Copier en JS (prêt à
coller dans `REGLAGES`, c'est ainsi qu'un réglage devient définitif).

Le banc, valeurs du fichier au 24/09/2026 : GT 0-100 en 4,85 s, 305 km/h, 53 m de freinage ;
berline 6,41 s, 251 km/h, 55 m ; trottinette 0-20 en 1,1 s, **33 km/h** de pointe (le
commentaire du réglage dit 25 : c'est le banc qui a raison), 1,6 m de freinage. Les deux
voitures sortent sous-vireuses à fond de volant (dérive AV 23°, AR 5-6°).

À savoir :
- Le banc lance des physiques **neuves** (copie du réglage) : il ne touche jamais celle qui
  roule. Ses épreuves partent d'une vitesse imposée (`etat.u`) sur un rapport choisi ; sans
  cela, la boîte partait en marche arrière (frein tenu à l'arrêt = marche arrière).
- Les objets `TOUCHER` et `SAUT_TROTTINETTE` sont **globaux au module** : un réglage du toucher
  vaut pour les deux voitures et la trottinette. La mémoire, elle, est par nom d'engin.
- Le panneau ne se remonte au changement de voiture que s'il est ouvert : fermé, il reste fermé.

## Le village habité : commerces, blason, trottinette

Ce que les données publiques ignorent et que le village sait — les vraies enseignes —
vit dans `maps/poilhes-commerces.js`, pas dans le relevé IGN.

| Fichier / asset | Rôle |
| --- | --- |
| `maps/poilhes-commerces.js` | L'épicerie **Ostal Louis** (devanture 3D sur sa façade, affiche au bord de la rue, pastille au-dessus des toits) et le **blason de l'Olympique Midi Lirou** devant le stade |
| `maps/trottinette.js` | La trottinette et son pilote : assemblage d'un engin et d'un personnage riggé, mains au guidon par rotation d'os |
| `apercu-glb.html` | **Voir un GLB seul**, sur fond neutre, avec sa taille réelle et ses axes : `apercu-glb.html?src=…`, ou `?assemblage=trottinette&pilote=chevalier` |
| `assets/pub/ostal-louis.glb` | 1,86 Mo / 74 988 triangles (Meshy, 84,5 Mo au départ) |
| `assets/pub/omlirou.glb` | 2,29 Mo / 20 524 triangles (41,8 Mo au départ) |
| `assets/perso/trottinette.glb` | 622 Ko / 43 132 triangles (33 Mo au départ) |

Chaîne d'allègement, la même pour tous : `weld` → `simplify --ratio … --error …` →
`optimize --compress meshopt --texture-compress webp`.

À savoir :

- **Un commerce OSM est posé DANS le bâtiment.** Un rayon tiré depuis ce point sort donc
  par la façade : se contenter de « la devanture regarde d'où vient le rayon » la colle
  face au salon. On regarde ce qu'il y a des deux côtés du mur (`blockedAt`) et la
  vitrine se tourne du côté libre.
- **La règle « la plus grande dimension horizontale est la largeur » ne vaut pas pour un
  bâtiment.** La terrasse de l'épicerie avance de deux mètres : la profondeur dépasse la
  largeur, et la devanture se retrouvait de travers. Pour une devanture, l'échelle se
  prend sur la **hauteur**, et l'orientation se vérifie à l'œil dans `apercu-glb.html`.
- **Chercher à quoi ressemble un modèle en le posant d'abord dans le village fait perdre
  un temps fou** : on ne sait jamais si ce qu'on voit est le modèle, un mur ou un platane
  devant. D'où la page d'aperçu — c'est elle qui a montré en dix secondes que la
  devanture regardait déjà +z et que le « pilote humain » était un duo.
- **`Meshy_AI_Pinstripe_Shadows` n'est pas un personnage mais deux** : deux hommes en
  costume dans un seul maillage à peau, vingt os partagés. Parfait en figurant, impossible
  à mettre seul sur une trottinette.
- **Les noms d'os changent d'un fournisseur à l'autre** : Mixamo chez Meshy
  (`RightArm`, `RightForeArm`, `RightHand`), Unreal chez le Chevalier (`upperarm_r`,
  `lowerarm_r`, `hand_r`). On cherche donc un **motif** et un côté, jamais un nom exact.
- **Une pose s'ajoute à celle de repos, elle ne l'écrase pas.** `bone.rotation.set(...)`
  sur un squelette replie le personnage en boule ; on part du quaternion de repos mémorisé
  au chargement et on multiplie.
- **Un personnage posé loin de sa pose de repos disparaît** : sa sphère englobante est
  restée où elle était et le moteur le croit hors champ. `frustumCulled = false` sur ses
  maillages.
- Les mains vont chercher le guidon par la **même mécanique que le bras du Titan qui vise
  au laser** : on tourne l'os pour que le segment os → enfant pointe vers la cible. Les
  poignées, elles, sont mesurées sur le maillage (sommets les plus hauts), jamais écrites
  en dur.

## La trottinette

Un troisième engin jouable, dans le village (`poilhes.html`, bouton **Trottinette**) et
dans les Mondes (mode « Trottinette » sur les trois cartes relevées).

| Fichier / asset | Rôle |
| --- | --- |
| `maps/trottinette.js` | L'assemblage engin + pilote, et l'adaptateur qui le présente au pilote de voiture |
| `placer-pilote.html` | **L'outil de placement** : on pose le bonhomme à la main, on voit le résultat, on enregistre |
| `maps/trottinette-placement.json` | Le réglage enregistré, un par modèle de pilote — c'est lui que le jeu relit |
| `assets/perso/trottinette.glb` | 622 Ko / 43 132 triangles (33 Mo au départ) |
| `assets/perso/pilote.glb` | 559 Ko / 51 046 triangles (49,9 Mo au départ) — ado en veste rouge et noir |

**Rien n'a été réécrit pour elle.** `voiture-pilote.js` sait déjà tout faire — suspension
sur les roues, collisions, caméra, son, traces — il ne lui manquait qu'un véhicule à
poser. La trottinette lui est donc rendue sous exactement la même forme qu'une voiture
(`root`, `caisse` qui se penche, `ombre` de contact), et il ne voit pas la différence.
C'est le même découpage que le village présenté au moteur des Mondes comme une carte
ordinaire. Côté mécanique, `REGLAGES.trottinette` : 110 kg, un seul rapport, 25 km/h en
pointe (33 en descente), centre de gravité haut, elle tourne court.

À savoir :

- **Un engin électrique ne se sonorise pas comme un moteur à essence.** La première
  version reprenait tout du thermique : la forme d'onde riche en harmoniques, le
  passe-bas, la saturation douce — le tout à 180 + 44·v Hz. À 500 Hz, un spectre
  taillé pour une fondamentale de 40 Hz met ses partielles en plein milieu de la bande
  où l'oreille est la plus sensible, et la saturation en rajoute : cela ne sifflait
  pas, cela **sciait**. Mesuré au banc : **32 %** de l'énergie entre 500 Hz et 2 kHz.
- La version actuelle : **deux sinus** (la fondamentale et sa quinte très en retrait),
  qui ne passent **ni par le filtre ni par la saturation**. Un sinus n'a aucune
  harmonique : il ne peut pas devenir agressif, quelle que soit sa hauteur. Loi de
  hauteur adoucie (150 + 26·v Hz), et `userRapport` sert enfin — la quinte reste une
  quinte à toute vitesse. Au banc : 31 % de l'énergie **sous 500 Hz**, 2,6 % entre
  500 Hz et 2 kHz.
- **Et beaucoup plus bas** : niveau plafonné à **0,014** au lieu de 0,06, porté par
  l'accélération (`0,35 + 0,65·gaz`). Soit **10 dB de moins** à 33 km/h (−44,9 dBFS
  contre −34,7) et 11,5 dB de moins à 14 km/h. Un moteur-roue s'entend à peine ; il ne
  monte franchement qu'à l'accélération, et c'est le seul moment où un engin
  électrique se fait entendre.
- Elle ne télécharge plus ni démarreur, ni boucle de six-cylindres, ni crissement de
  freinage : `chargerEchantillons()` ne part pas en électrique.
- Diagnostic : `RaphaelVoiture.son.diagnostic()` donne la source, le **niveau réel**
  envoyé aux haut-parleurs et la **hauteur** du sifflement — un son « trop fort » se
  mesure au lieu de se deviner.

### Le guidon, les roues, la vue guidon

Le modèle Meshy arrive **d'un seul tenant** : un maillage, 43 132 triangles, une seule
pièce connexe (vérifié), positions en entiers courts normalisés. Rien ne se détache tout
seul — il faut couper, et mesurer avant de couper.

- **Le guidon faisait 1,12 m de large**, deux fois une vraie trottinette et près du double
  de l'engin. Il est ramené à **0,58 m**, mais pas à l'échelle : une barre mise à l'échelle
  donne des poignées de cinq centimètres sous des mains qui en font neuf. La barre est donc
  **comprimée** entre la potence et les poignées, et les poignées **déplacées entières**.
  Le tube ayant son axe sur x, le raccourcir ne touche pas à sa section : rien à recalculer
  côté normales. Les poings du pilote tombent alors sur les poignées rapprochées — vérifié,
  0,971 / −0,342, exactement la position mesurée des poignées.
- **Les roues tournent.** Coupées au cylindre, comme l'essieu resté soudé de la voiture, et
  les trois chiffres du cylindre sont mesurés : l'essieu est à l'aplomb de l'**empreinte au
  sol**, le rayon vient d'un **ajustement de cercle** sur le bas du pneu (seul endroit sans
  garde-boue ni fourche), la largeur se prend sous l'essieu. Un triangle ne part avec la
  roue que si ses **trois** sommets y sont, sinon on emporte la jonction avec la fourche.
  Résultat : 1 843 et 1 784 triangles, deux disques de 20 cm.
- **La rotation se corrige du rapport des rayons.** La physique compte les tours avec son
  `rayonRoue` (13 cm), les roues du modèle en font 9,9 : sans le rapport (1,31), le pneu
  tourne trop lentement pour la vitesse du sol et la trottinette glisse sur de la glace.
- **Pas de braquage du guidon.** Le pilote est un maillage figé, ses mains sont soudées aux
  poignées : tourner le guidon les arracherait. À reprendre le jour où l'on aura un pilote
  riggé.

**Le piège, et il a coûté cher** : le rétrécissement mesurait tout **en coordonnées du
monde**. Or le GLB finit de charger quand le véhicule est déjà garé quelque part — à 22 m
du centre de la carte, `|x|` ne vaut plus la demi-largeur du guidon mais la distance à
l'origine. La barre partait alors **à 150 m** : un long fil tendu entre la trottinette et
l'horizon, et des mains qui ne tenaient plus rien. Tout se mesure dans le repère de
l'engin, comme le fait déjà le découpage des roues. Vérifié après correction : guidon
0,58 m, zéro sommet aberrant.

**Vue guidon** (troisième cran de **V**). La vue capot d'une voiture pose la caméra 35 cm
**derrière** le point de référence : sur une trottinette ce point est le pilote, et l'on
regarde son dos. Trois chiffres, calculés et non tâtonnés :
- elle passe **devant son visage** (2 cm devant le centre de l'engin) ;
- elle est **au-dessus de ses épaules** (1,58 m) : entre les deux, on regarde le long de
  ses bras et le bas de l'image n'est qu'un aplat de blouson noir — vérifié en masquant le
  pilote, c'était bien lui ;
- elle **plonge de 34°**, parce que le pilote se tient à 34 cm derrière le guidon et ses
  poignées 50 cm plus bas : ses mains sont à 60° sous l'horizontale, et aucune caméra
  regardant droit devant ne les voit. Plus on approche la caméra du guidon, plus il passe
  **sous** elle : c'est le recul qui le fait remonter dans le cadre, pas la proximité.

### Le son : du roulement, pas un sifflement

Le sifflement de synthèse a été essayé et **abandonné** : deux sinus qui montent avec la
vitesse font une sirène, pas une trottinette. Ce qu'on entend vraiment en roulant, c'est la
gomme sur le bitume. Le son est donc maintenant un **bruit de roulement** — du bruit
légèrement rosé, filtré en bande passante large (Q 0,55 ; une bande étroite siffle), dont
la hauteur (180 + 62·v Hz) et le niveau suivent la vitesse et s'éteignent à l'arrêt. Le
moteur-roue ne reste qu'en filigrane (0,22) et surtout à l'accélération.

- Un bruit large s'écoute sans fatigue là où un sinus agace : le niveau peut monter à
  **0,05** (contre 0,014 pour le sifflement) sans redevenir pénible.
- **Il est allumé d'emblée sur la trottinette**, coupé par défaut sur la voiture. Ce qui
  avait été coupé, c'était un moteur thermique qui démarrait tout seul et tournait sans
  fin. **M** le coupe, **Maj + M** coupe toute la page.
- **Un enregistrement le remplace** dès qu'il existe : déposer
  `assets/sons/trottinette-boucle.mp3` (ou `.wav`) suffit, la boucle est alors réaccordée à
  la vitesse et la synthèse se tait. Deux essais de chargement, donc deux 404 dans la
  console tant que le fichier n'est pas là — c'est la même convention que pour la voiture.

**Elle se penche dans le virage**, comme tout ce qui roule sur deux roues. Une voiture
prend appui sur quatre roues et bascule vers l'**extérieur** ; une trottinette tombe à
l'**intérieur**, et c'est la force centrifuge qui retient cette chute. L'angle ne s'invente
donc pas, il se calcule : `tan(θ) = accélération latérale / g`, l'accélération latérale
d'une trajectoire courbe valant `vitesse × lacet`. Plafonné à 31° — au-delà, un vrai pilote
pose le pied.

- **Pas sur `etat.charge`, qui serait muet.** La force latérale des pneus ne veut plus rien
  dire sous 8 m/s, où la physique retombe progressivement sur la cinématique d'Ackermann —
  et la trottinette ne dépasse jamais 6,9 m/s. C'est le lacet réel qu'on lit, valable dans
  les deux régimes.
- **Signe vérifié en jeu, pas déduit** : `lacet` positif tourne à gauche, un roulis positif
  lève le côté droit, donc penche à gauche — les deux conventions vont dans le même sens.
  Mesuré : +31,7° plein volant à gauche, −30,8° à droite, 16° pour une pichenette de 0,25 s,
  et retour au plat (0,8°) en ligne droite. Sur cette physique, deux corrections de signe
  faites en parallèle se sont déjà annulées une fois.
- **La caisse ne penche pas en plus.** À deux roues il n'y a pas de caisse sur ressorts qui
  roule de son côté : l'engin entier est déjà couché, et ajouter le roulis de suspension de
  la voiture le ferait pencher au-delà de son propre angle d'équilibre.
- Le roulis suit un peu plus vite qu'en voiture (11 au lieu de 9) : se pencher est un geste,
  pas un ressort — sinon l'engin part en virage avant d'y être couché.

À savoir :

- **Le pilote fourni n'est pas riggé**

L'automatique a atteint sa limite, et c'est une limite de principe. **Le pilote fourni
n'est pas riggé** (0 squelette) : `viserGuidon()` (rotation d'os) ne peut rien faire, et
`alignerSansOs()` — qui mesure « les points les plus avancés à hauteur de bras » pour en
faire des poings — prend d'autres sommets pour des mains et pose le bonhomme de travers.
Une mesure qui se trompe ne se corrige pas en la raffinant : on la remplace par un œil.

L'outil montre l'engin et son pilote seuls, sur fond neutre, avec :

- sept réglages — avance, latéral, hauteur, cap, penché, roulis, taille — au curseur **et**
  au chiffre, appliqués à chaque frappe ;
- les **repères mesurés** : deux billes bleues aux poignées, le plan orange du plateau. On
  vient dessus, au lieu de tourner autour du modèle en espérant ;
- les touches <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>A</kbd><kbd>E</kbd><kbd>Q</kbd><kbd>D</kbd>
  (<kbd>Maj</kbd> = millimètre) : une main sur la souris pour tourner autour, l'autre pour
  pousser d'un centimètre — sans lâcher l'angle de vue qu'on vient de trouver ;
- la trottinette en translucide, parce qu'elle cache justement les pieds et les mains ;
- « Enregistrer pour le jeu » → `maps/trottinette-placement.json`, que le village **et** les
  Mondes relisent. Pas de copier-coller dans le code, donc pas d'écart entre l'outil et le jeu.

Ce qu'il faut savoir :

- **Le socle.** Le pilote est enfermé dans un groupe dont l'origine tombe sous ses pieds, au
  milieu de sa silhouette. Sans lui, `y` désignerait l'origine que l'exportateur a bien voulu
  donner au GLB — souvent le bassin — et aucun chiffre du réglage ne serait lisible. Avec lui,
  `y: 0.15` veut dire « debout sur le plateau », l'avant est −z, et `taille` est sa taille en
  mètres.
- **L'ordre de confiance dans `construireTrottinette`** : le réglage enregistré gagne toujours ;
  sinon les bras vont chercher le guidon (modèle riggé) ; sinon la mesure des poings. Un modèle
  qu'on n'a pas encore réglé continue donc de se poser tout seul.
- **Un réglage par modèle**, rangé par chemin de GLB : le chevalier et l'ado n'ont ni la même
  taille ni le même bassin. `?pilote=chevalier` règle le sien sans toucher à l'autre.
- L'écriture du fichier passe par `POST /api/placement-pilote`, **réservé à la machine locale** :
  c'est la seule route du service qui écrit dans le dépôt. Ailleurs, le bouton « Copier » rend
  le même JSON. Le site publié est statique et n'a pas ce service.
- Réglage de l'ado livré : `y 0.15 · z −0.033 · taille 1,483` — mains sur les poignées, semelles
  sur le plateau. C'est la **taille** qui fait tomber les mains à la bonne hauteur : le poser plus
  bas lui enfoncerait les pieds de quatorze centimètres dans le plateau.
- Les poignées elles-mêmes sont mesurées sur le maillage de la trottinette (sommets les
  plus hauts), jamais codées en dur.
- **`root.add(pilote)` après un renommage de variable** : le paramètre `pilote` (une
  chaîne) était ajouté à la place du modèle. Three.js prévient (« object not an instance
  of THREE.Object3D ») mais ne plante pas — le pilote était simplement absent, et on
  cherche longtemps pourquoi un objet « visible, non culé, bien placé » ne s'affiche pas.
  Le bon réflexe : compter les triangles réellement dessinés (`renderer.info.render`).

## Le skatepark du stade

`poilhes.html` et `rouler.html`, mode **Trottinette**, touche **P** — un circuit de 52 × 56 m
posé sur le terrain de l'Olympique Midi Lirou. Anneau à quatre virages relevés ; **ligne de
vol** sur la droite est (départ, bande de lancement, tremplin de 1,8 m à 42°, trou, réception
en pente jusqu'à l'entrée du virage) ; bande de lancement et gros saut au sud ; table et
bosses à l'ouest ; slalom au nord ; half-pipe à copings (bande de lancement sur le plat), mur
nord et plongeoir dans l'infield. Refait le 24/09/2026 pour les sauts et les figures.

**Les bandes de lancement** (béton bleu à chevrons) poussent la trottinette à 41 km/h
(`turboAt`, lu par le pilote) : à 25 km/h, aucune rampe ne donne le temps d'un looping.
Mesuré sur la ligne est à 41 km/h : **1,5 s d'air, 3,4 m de haut, 16,6 m de long**.

| Fichier | Rôle |
| --- | --- |
| `maps/poilhes-skatepark.js` | Le parc entier : `profil(u, v)`, le maillage qui en découle, les plots |
| `maps/poilhes-scene.js` → `PARCS` | Où le poser, par village ; `walkableAt` l'inclut |

**Une seule fonction décrit le parc.** `profil(u, v)` rend la hauteur du béton au-dessus du
sol ; elle sert à fabriquer le maillage **et** à répondre sous les roues. Le décor et la
physique ne peuvent donc pas diverger, et régler un tremplin, c'est changer un chiffre.
Le parc est branché dans `walkableAt` et nulle part ailleurs : le village, le moteur des
Mondes et les pays interrogent tous cette fonction-là, donc les trois roulent dessus sans
qu'on ait touché à leur code.

À savoir :

- **L'emplacement se mesure, il ne se lit pas.** Le point OSM d'un terrain de sport est le
  centre du terrain, pas celui de la zone libre : à Poilhes il tombe à 18 m d'un talus. Le
  centre retenu (6,75 ; 133) a été trouvé en sondant `groundAt` et `blockedAt` — 0 %
  d'obstacle et 76 cm de dénivelé sur 52 × 56 m. Et un village absent de `PARCS` n'a **pas**
  de parc : Capestang compte sept terrains de sport, dont un à 450 m du centre.
- **Le parc suit le relief** au lieu de poser une dalle horizontale, qui aurait laissé une
  marche de 40 cm sur deux bords.
- **Les morceaux se combinent au maximum, jamais par addition** : deux pièces qui se
  touchent forment une masse continue, au lieu d'une bosse de la somme des deux.
- **Une chaîne `else if` sans borne basse déborde.** Le mur nord et le plongeoir rendaient
  la hauteur de leur deck pour tout le nord du parc : la ligne droite se retrouvait à
  +2,60 m. Les deux bornes en `v` comptent autant que les tests qui suivent.
- **Le sens d'une transition concave se vérifie.** Écrite `H·√(1 − w²)`, la face du
  plongeoir était plate en haut et à pic en bas — l'inverse d'un plongeoir. La bonne forme
  est celle du half-pipe, `R − √(R² − x²)` : verticale en haut, tangente au sol en bas.
- **Le béton est le seul matériau ordinaire du village.** Tout le reste est peint par des
  shaders maison qui font leur propre lumière ; une `MeshStandardMaterial` reçoit en plein
  les 2,2 de ciel et les 2,6 de soleil, et virait au blanc bleuté. Les couleurs des sommets
  restent lisibles, c'est la couleur du matériau (0x959595, soit 0,30 en linéaire) qui les
  ramène dans l'éclairage du village.
- Le parc compte comme de la chaussée dans la grille d'adhérence (`marquerAdherence`) :
  sinon on roule sur le béton avec l'adhérence de l'herbe (0,74 contre 1,0), et une
  trottinette qui patine au pied d'un tremplin ne le monte pas.
- Les plots de slalom ne comptent **pas** dans le profil : un cône de chantier se renverse,
  il n'arrête pas une trottinette.

### Ce qu'il a fallu corriger dans la physique pour que les tremplins servent

Trois défauts, tous dans `maps/voiture-pilote.js`, et tous invisibles tant qu'on roulait
seulement en ville :

1. **Le seuil d'envol était de 8 m/s pour tout le monde** — au-dessus de la vitesse de
   pointe de la trottinette (6,9 m/s). Elle ne pouvait *littéralement pas* décoller, et un
   tremplin n'était qu'une bosse dont on glissait. Le seuil appartient désormais à l'engin
   (4,0 m/s à deux roues) ; celui de la voiture ne bouge pas, elle ne doit pas s'envoler au
   moindre trottoir.
2. **On tombait du tremplin au lieu d'en être projeté** : la vitesse de départ était celle
   de la chute libre. On garde maintenant ce que la rampe a donné — et on le garde en
   mémoire, parce qu'au moment précis où la roue quitte le béton, la montée instantanée est
   déjà retombée (c'est justement parce que le sol se dérobe qu'on décolle). D'où `elan`,
   un souvenir de la meilleure montée récente, qui s'efface en une seconde, plafonné à
   6,5 m/s.
3. **La trottinette lisait le sol sur l'empattement d'une voiture** (2,66 × 1,60 m sous un
   engin de 1,15 m). Les « roues avant » quittaient la rampe 1,33 m avant que l'engin
   n'arrive au bord : mesuré, il retombait 75 cm **sous** la rampe qu'il était en train de
   monter. `ROUES`, `SONDES`, `EMPATTEMENT` et `VOIE` suivent maintenant l'engin ; le code
   de suspension n'a pas changé d'une ligne, il lit enfin les bonnes distances.

Mesuré après correction : **2,81 m d'air** sur une transition, là où l'engin ne décollait
jamais.

### Sauts et figures (24/09/2026)

Commandes en trottinette : **Espace** saute (coup de jambes, 2,6 m/s, qui s'ajoute à ce que
la rampe donne) ; en l'air, **F** looping (arrière ; avant si l'on tient la flèche bas),
**G** 360, flèches haut / bas inclinent ; tactile : SAUT, Flip, Vue. Une figure demandée
dans la demi-seconde avant le bord compte. Bannière `#figure` (Backflip, 360, Gros saut,
Chute !) mise à jour par `majAuto` depuis `telemetrie().figure`.

4. **On décolle quand la trajectoire libre passe au-dessus du sol** (`vaDecoller`) : lancée
   avec la vitesse verticale que la rampe a donnée (`elan`), la trottinette serait-elle à
   4 cm au-dessus du béton dans 0,16 s, **en quatre points le long du chemin** ? Alors elle
   y est déjà. Ça part au vrai point de séparation — sommet d'une bosse, bord d'une table —
   et non quand le sol a fui de 15 cm en une image (une falaise). Deux essais ratés avant :
   une comparaison d'accélérations (le sol fuit plus vite que g) partait trop tôt, envols
   d'une image à quelques millimètres ; et tester le seul point d'arrivée voyait le trou
   par-dessus la rampe, deux mètres avant le bord — le faux départ effaçait l'élan, et le
   vrai saut partait mou (0,5 s au lieu de 1,5). D'où aussi : un contact de moins de
   0,12 s ne remet pas l'élan à zéro.
5. **Une figure se calibre sur le temps de vol restant** (`tempsDeVolRestant`, en visant le
   sol *là où l'on retombe*, pas celui sous les roues, qui est le trou) : un tour par saut,
   plafonné à 13 rad/s. Sa vitesse (`figureVit`) n'est **pas** amortie — l'amortir la faisait
   retomber à 260°, chute à chaque looping. L'inclinaison libre (`tangageVit`) l'est.
6. **Une flèche déjà tenue au décollage ne compte pas** (`cabreTenu`) : plein gaz sur un
   tremplin donnait un double backflip involontaire. Elle ne compte qu'une fois relâchée.
7. En l'air, l'assiette n'est pas lissée : `tangage` = trajectoire (cabrée en montant, piquée
   en descendant) + figure, exactement ; le lissage reprend au sol. Réception à plus de 60°
   de tangage ou 57° de vrille = chute (vitesse ÷ 4, une seconde de tangage), sinon ce qui
   reste se résorbe au sol.

### Ce qui reste à faire

Pas de chronométrage : ni portes, ni temps au tour, ni record. Le moteur sait déjà le faire
(`updateRace` dans `world-game.js`, portiques de `maps/course-route.js`), mais `poilhes.html`
n'a pas de moteur de course — c'est le prochain morceau.

## La course Poilhes → Capestang

`mondes.html?map=pays-canal&mode=voiture` — **onze portes au sol, 3 561 m**, un S léger
entre les deux villages, quatre minutes imparties, chrono et record en mémoire locale.
Elle se court aussi en trottinette (qui a tout intérêt à couper au plus court).

| Fichier | Rôle |
| --- | --- |
| `maps/course-route.js` | Les portiques : deux montants, une traverse, des fanions, posés sur le relief |
| `world-catalog.js` → `courseRoute` | Le tracé, en coordonnées de carte (doublées au chargement comme le reste) |

**Rien n'a été réécrit.** Le moteur sait déjà chronométrer une course — portes, secteurs,
flèche de guidage, record (`updateRace` dans `world-game.js`) : il lui manquait seulement
des portes **au sol**, les siennes étant des anneaux suspendus dimensionnés pour un
chasseur à 300 km/h. Deux lignes ont suffi côté moteur : `raceEnabled` accepte le mode
`drive`, et le temps imparti vient du monde (`courseTemps`) au lieu d'être figé à 210 s.

À savoir :

- **Le tracé se vérifie avant de se poser.** Les altitudes ont été relevées dans
  `maps/pays-canal/pays.bin` : pentes inférieures à 3,6 %, donc courable au volant comme
  en trottinette. Une course tracée à vue passe par une falaise une fois sur deux.
- **Une matière par porte, pas une pour le parcours.** Le moteur colore la porte en cours,
  celles passées et celles manquées : avec une matière partagée, tout le tracé s'allume
  d'un coup.
- **Le moteur écrivait sur `gate.children[0].userData.raceGateRing`** — il supposait que
  toute porte est un anneau. Un portique n'en est pas un : la lecture est devenue
  facultative, sinon la course s'interrompt avant même de commencer.

## Le son : rien ne démarre tout seul

**Coupe-son général : Maj + M**, sur toutes les pages (`son-silence.js`, chargé en
**premier**). Il ne corrige pas un son à la fois : il enveloppe le constructeur
d'`AudioContext` et le `play()` des balises audio, si bien que tout ce qui veut faire
du son dans la page passe par lui — y compris les modules écrits plus tard. Couper
suspend les contextes existants, met les balises en pause, **refuse les `resume()` et
`play()` suivants**, et suspend d'office tout contexte créé après. Le choix est retenu
(`localStorage['raphael-silence']`) : une page rechargée reste muette.
Console : `RaphaelSilence.couper()`, `.remettre()`, `.etat()`.

**Le moteur de la voiture est muet tant qu'on ne l'a pas demandé** (`state.son = false`,
touche **M**). Il avait été passé à `true` en pensant que le vrai coupable était
l'onglet laissé en arrière-plan ; l'onglet a bien été corrigé, mais le bruit reproché
était bien celui-là — un moteur qui démarre tout seul dès qu'on entre dans la voiture
et qui tourne sans interruption tant qu'on y reste. Et quand on l'allume, il ne hurle
plus : **0,16 au ralenti et 0,39 à fond**, au lieu de 0,34 et 0,78 — un enregistrement
mp3 est déjà normalisé, le monter comme une synthèse le rend assourdissant.

Le « son horrible en fond » qu'on entendait sur le menu, pendant le chargement, en
voiture et en trottinette ne venait ni de la voiture ni du combat : c'était
`background-ambience.js`, qui lançait `assets/audio/background-ambience.ogg`
(**65 minutes, 15,7 Mo**) en boucle **au premier clic sur la page**, sur toute page qui
chargeait le script, sans que rien ne l'ait demandé.

Trois règles depuis, valables pour tout nouveau son :

1. **Aucun son ne s'allume sur un `pointerdown`/`keydown` global.** Un son se demande.
   L'ambiance est muette par défaut, sa préférence est retenue
   (`localStorage['raphael-ambiance']`), et se rallume par
   `RaphaelBackgroundAmbience.start()` ou `.basculer()`. Son `preload` est à `none` :
   tant qu'on ne la demande pas, les 15 Mo ne descendent même pas.
2. **`setTargetAtTime(0, …)` n'éteint rien.** C'est une approche exponentielle : elle
   n'atteint jamais zéro. Un réacteur à −60 dB reste un réacteur qui tourne, et il
   remonte au premier `update()`. D'où un vrai `stop()` — `cancelScheduledValues`,
   gain à zéro, sources arrêtées et détachées, `context.suspend()` — dans
   `fighter-engine-audio.js` et `boost-audio.js`. Les tampons décodés restent en
   mémoire : le redémarrage est immédiat et ne retélécharge rien.
3. **On coupe par événement, jamais par la boucle d'animation.**
   `requestAnimationFrame` s'arrête dans un onglet caché : la mise à jour du son n'est
   plus appelée, les gains restent à leur dernière valeur, et le moteur ronronne
   indéfiniment. D'où `visibilitychange` / `pagehide` / `blur` — la même leçon que pour
   la voiture.

Autre piège : `RaphaelFighterEngine.update(0)` **rallume** le réacteur, parce que le
module part d'un régime plancher de 0,12. Un chasseur détruit se mettait donc à
ronronner ; `destroyFighter()` appelle `stop()`.

Diagnostic : `RaphaelBackgroundAmbience.state()`, `RaphaelFighterEngine.state()`,
`auto.son.diagnostic()` pour la voiture.

## Vue cockpit

Touche **V** dans `mondes.html` : caméra large → caméra proche → cockpit.

La structure du poste est un vrai objet 3D (`assets/cockpit/eurofighter-cockpit.glb`,
CC BY-NC-SA 4.0, voir `assets/cockpit/LICENCE.md`), accroché à la caméra par
`maps/cockpit-view.js`. Trois points à connaître avant d'y toucher :

- La caméra doit rester dans la scène (`scene.add(camera)` dans `world-game.js`) :
  sans cela ses enfants ne sont jamais rendus.
- Le modèle est percé de trois découpes d'écran. Une plaque texturée les referme
  par l'arrière et porte les instruments — sans elle, on voit le paysage à
  travers la planche de bord.
- Réglage à vue depuis la console, sans rechargement :
  `RaphaelCockpit.tune({ y: .02, z: -.05, scale: .0125, pitch: -2 })`,
  `RaphaelCockpit.settings()`, `RaphaelCockpit.part('ldash', false)`.

Si le GLB ne charge pas, l'habillage CSS d'origine (`#cockpit-frame`) reste
affiché : la vue cockpit n'est jamais vide.

## Conventions et interdits

- Améliorer l'existant, **ne jamais repartir de zéro**. Conserver les systèmes qui marchent.
- Pas de régression, pas de code dupliqué.
- **Aucune allocation dans les boucles d'animation** (`requestAnimationFrame`, `update`).
  Réutiliser les vecteurs, pooler les particules et projectiles.
- Objets lourds chargés à la demande ; instances 3D pour arbres, rochers, bâtiments répétés.
- Particules plafonnées ; objets temporaires retirés et libérés à expiration.
- Trois.js reste dans `libs/` — pas de CDN, pas de nouvelle dépendance sans validation.
- Le mode Wargun réutilise le modèle OBJ Chasseur pour éviter un asset de ~200 Mo.
- Le chasseur doit garder **exactement** la même physique, les mêmes commandes, la même
  caméra, le même tir et la même apparence dans toutes les zones.
- Noms explicites, fonctions documentées, architecture modulaire.

## Méthode de travail attendue

1. Sur toute tâche non triviale : **proposer un plan et lister les fichiers à modifier
   avant d'écrire du code**.
2. Vérification syntaxique des scripts modifiés.
3. Vérification fonctionnelle réelle : chargement de la page concernée, console sans erreur.
4. Rapport des changements en fin d'étape.

Diagnostics disponibles : `RaphaelAirCombat.diagnostics()`.

---

## Feuille de route

Déjà livré (ne pas refaire) : canon continu ~13 coups/s et son procédural · tangage visuel,
roulis, lacet, inertie, caméra de poursuite · portail ville ↔ vallée · 5 chasseurs ennemis
(patrouille, interception, attaque, repli) · radar circulaire et verrouillage progressif ·
missiles guidés · dégâts localisés (moteur, ailes, coque) et conséquences de vol ·
VFX plafonnés · HUD moderne.

Chantiers restants : fusion et streaming des cartes · IA ennemie avancée · combat fondé sur
l'énergie et les trajectoires · radar ennemi et niveaux d'alerte · manœuvres de rupture de
verrouillage · audio spatialisé · apparition naturelle des ennemis · portail vers le mode
course dédié · optimisation globale.

---

## Docs de référence

`README.md` · `maps/README.md` · `DEVELOPMENT_REPORT.md` · `MULTIPLAYER_DEPLOYMENT.md` · `scripts/poilhes/README.md`

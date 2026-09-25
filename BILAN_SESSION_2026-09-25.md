# Bilan de session — 25/09/2026 — Glissières, berline à 85 %, R au milieu

## Demande

Arnaud : « sur l'ensemble des routes, des glissières toutes petites qui maintiennent
la voiture sur la route même si on se trompe — rendre la jouabilité accessible ».
Puis, après essai en direct : « les lames au bord de la route, petites, c'était
parfait », « les rebonds sont un peu trop forts », « le R doit vraiment remettre au
milieu de la route », et surtout « le vrai problème : la voiture est trop grosse,
15 % de moins, notamment en largeur ».

## Fait

- **`maps/glissieres.js`** (nouveau) : lit `routes_pos / routes_info / routes_fin`
  du village (9 sommets par section de 3 m, bords à u = ±1) et pose, 35 cm derrière
  le bord de chaussée, une lame en V de 13 cm culminant à 34 cm, sur des poteaux
  tous les 3 m. Un seul maillage indexé + un `InstancedMesh` : 31 000 triangles,
  8 200 poteaux sur Poilhes.
- **Bande de retenue** : grille au demi-mètre, 2,4 m derrière chaque lame, jamais
  sur une cellule de chaussée. `glissiereAt(x, z)` est lu par le pilote comme un mur
  (`obstacleAt = blockedAt || glissiereAt`) dans les collisions, le rappel et le
  placement — pas dans la caméra. Épaisse exprès : une voiture qui s'y retrouve est
  poussée vers la route, pas vers le jardin.
- **Pas de lame** : à moins de 2 m du bout d'un tronçon (les tronçons BD TOPO
  s'arrêtent aux carrefours), quand une autre chaussée ou le béton du skatepark est
  à 2 m derrière, quand la lame tomberait dans un mur ou l'eau.
- Branchement dans `poilhes-village.js` : grille d'adhérence et glissières
  construites **une fois**, au premier engin qui roule, partagées berline /
  trottinette. La berline est retenue (`state.glissieres`), la trottinette passe au
  travers (Arnaud la refait lui-même). Case « Glissières » dans le panneau T.
- **Berline à 85 %** : `ECHELLE = 0.85` exportée par `voiture-model.js`
  (`root.scale`, ombre, dimensions) et reprise par le pilote pour roues, empattement,
  voie, sondes de collision et vitesse de rotation des roues. 4,42 × 1,98 m →
  3,76 × 1,68 m.
- **Rebonds adoucis** : dégagement hors d'un mur 3 cm par sonde, 7 cm au plus (au
  lieu de 5,5 / 14) ; part de vitesse renvoyée le long du mur 0,5 (au lieu de 0,66) ;
  plus de sur-rebond (1,02 → 1,0) sans assistance. Les deux valeurs sont dans
  `reglagesAssistance` (`pousse`, `rail`).
- **R au milieu de la rue** : `placer()` trouvait le point de chaussée le plus proche,
  donc le bord. Il mesure maintenant la chaussée à gauche et à droite du cap choisi
  (pas de 25 cm, 12 m au plus) et se recentre. Vaut aussi pour l'entrée dans le mode.
- Corrigé au passage : `poilhes-village.js` importait `voiture-pilote.js` sous deux
  `?v=` différents → deux modules, le `TOUCHER` réglé par le panneau n'était pas celui
  du pilote. Une seule version désormais (`glissieres-20260925`, aussi sur
  `rouler.html`, `poilhes.html`, `world-game.js`, `reglages.js`).

## Vérifié (Chromium logiciel, port 8010)

- Chargement de `rouler.html?engin=berline&go=1` sans erreur de page ; groupe
  `glissieres` dans la scène, échelle 0,85 lue sur la racine de la voiture.
- Le banc A/B « plein gaz en travers de la rue » n'a rien mesuré : les touches
  simulées ne mettent pas la voiture en mouvement en tête sans fenêtre (vmax ≈ 0).
  Arnaud a testé en direct, c'est son retour qui compte.

## À voir

- Le débattement des roues est en mètres monde appliqué dans un root à 0,85 :
  15 % de course visuelle en moins, invisible — à reprendre si l'on change encore
  l'échelle.
- Bande de retenue et lame ne se voient qu'une fois un engin choisi (construites
  avec la grille d'adhérence) ; le mode Survol seul ne les affiche pas.
- Le moteur des Mondes (`world-game.js`) ne passe pas `glissiereAt` : pas de
  glissières dans `mondes.html?map=poilhes`.
- Non commité, non poussé : chaque push sur `main` redéploie le site.

## Reprise après coupure (3 h 30)

- La session s'est coupée après le changement de musique ; reprise par lecture de
  la transcription (`~/.claude/projects/.../716d5380-….jsonl`).
- **Playlist partout** : les cinq « Soul Run » jouent sur l'accueil, en trottinette
  et désormais en berline (décision d'Arnaud). « Nitro Boost » n'est plus jouée,
  fichier conservé ; `PROVENANCE.md` mis à jour.
- **Client Meshy** `scripts/meshy.py` (balance / make / get / status), clé dans
  `config/meshy.env` (ignoré par git). Registre `OUTILS.md` complété. Service
  payant : solde 1 211 crédits au départ.
- Premier objet demandé : un **quad rouge et noir avec son pilote à casquette**,
  sortie `perso/quad-pilote/`.
- Quad livré : `perso/quad-pilote/quad-pilote.glb` (9,6 Mo, textures PBR), vignette
  `apercu.png`. **Coût réel : 30 crédits** (1 211 → 1 181), pas 15 : l'affinage vaut
  25. Vignette : quad rouge/noir fidèle, pilote en veste noire à liserés rouges,
  couvre-chef rouge plutôt casque que casquette, pantalon gris. À valider par Arnaud ;
  reprompter (« baseball cap with a visor », « black trousers ») si on veut plus
  proche.
- Le premier quad avait la **tête du pilote tournée** sur tous les angles (rendu
  Blender 4 vues via `rendu_3d.py`), et tout est soudé : ni roues ni tête ne bougent.
  Décision d'Arnaud : refaire en **deux objets** (quad seul + pilote seul), comme la
  trottinette qui découpe ses roues et assoit un pilote riggé.
- `perso/quad-seul/` : quad rouge/noir sans pilote, très propre. `perso/pilote-quad/` :
  le pilote (casquette rouge, lunettes, veste noire à bandes rouges) mais Meshy lui a
  collé un **mini-quad sous les fesses** malgré le prompt négatif → inutilisable
  pour le rigging tel quel. Coût des deux : 60 crédits (1 181 → 1 121).
- Client `scripts/meshy.py` : commandes `rig` (5 crédits) et `anims` (gratuit)
  ajoutées ; pas d'animation « conduite » dans la bibliothèque Meshy, la pose
  se fera par rotation d'os comme pour la trottinette.

## Le quad, troisième engin de Poilhes City

- Objets Meshy : `perso/quad-seul` (le quad, très propre) ; pilote en quatre
  essais — assis (mini-quad collé sous lui), debout (mains dans les poches),
  T-pose (bras le long du corps + anneau rouge derrière la tête = la « capuche »
  du prompt), A-pose sans capuche : **le bon**, un ado casquette rouge, lunettes,
  veste noire à bandes rouges. Riggé par Meshy (`scripts/meshy.py rig`, 5 crédits,
  squelette Mixamo : Hips/Spine/Spine01/Spine02/neck/Head, Arm/ForeArm/Hand,
  UpLeg/Leg/Foot). Total de la soirée : 1 211 → 1 021 crédits.
- Compressés dans `assets/perso/quad.glb` (900 Ko) et `assets/perso/pilote-quad.glb`
  (meshopt + WebP 1024), comme la trottinette.
- `maps/quad.js` : voir le CLAUDE.md. Points durs rencontrés :
  - **le socle d'un pilote assis se règle par les hanches**, pas par les pieds :
    on mesure la hauteur des hanches en pose de repos et on descend le socle
    d'autant sous la selle (sinon il flottait 90 cm au-dessus du quad) ;
  - **sur une selle, les mains sont trop près du guidon**, pas trop loin : le
    pilote recule jusqu'à être à un bras (× 0,92) de la poignée, puis les bras
    visent (même mécanique que la trottinette) ;
  - **la découpe des roues se fait par essieu** (sommets repliés par |x|) : roue
    par roue, le côté droit sortait avec 0 triangle (densité de maillage
    différente d'un flanc à l'autre).
- Branché partout : `voiture-pilote.js` (engin `quad`, seuil d'envol 3 m/s,
  roues/sondes mesurées, clignotants automatiques au volant + X détresse),
  `voiture-physique.js` (`REGLAGES.quad` : 330 kg, 38 N·m, 5 rapports, banc :
  0-100 en 13,6 s, 116 km/h, 47 m de freinage), `poilhes-village.js` (mode
  `quad`, touches V/R/M/P, tactile MAIN, panneau T, feux à l'heure),
  `rouler.html` (bouton + choix d'engin + playlist aussi en quad), `poilhes.html`.
  Versions de cache `?v=quad-20260925`.
- Vérifié en Chromium sans fenêtre : chargement sans erreur, pilote assis mains aux
  poignées, phares/feux visibles de nuit (capture), mode quad dans le HUD.

## Musiques, foule, ponts, berline (fin de nuit)

- **Playlist à dix pistes** : cinq nouvelles versions complètes de « Soul Run »
  (`accueil-soul-run-6` à `-10`, 128 kbit/s), intercalées avec les cinq premières
  (ordre 5, 2, 6, 3, 8, 4, 7, 9, 1, 10). Jouée sur l'accueil, en trottinette, en
  berline et en quad.
- **Deuxième acclamation** : « Cris d'encouragements spectacle » (3,6 s) →
  `assets/sons/encouragements.mp3`, tirée au sort avec `acclamation.mp3` sur une
  figure réussie.
- **Ponts** (« sur les ponts c'était une catastrophe, on n'arrive pas à monter
  dessus ») : mesuré dans `village.bin` — le tablier était posé sur la ligne
  « Pont » de la BD TOPO, plus courte que le tronçon de route « au-dessus du
  sol » que `roads.py` saute ; entre le bout du ruban voisin et le tablier il
  restait 3 à 6 m de terrain creusé pour l'eau. Correction dans `extras.py` :
  le tablier suit le **tronçon de route** entier (+ 2 m), ses bouts se posent
  à terrain + 6 cm comme les rubans, jamais sous le terrain ; la ligne « Pont »
  ne sert plus qu'aux passerelles sans route. Nouveau tableau `ponts_axes`
  ([n, largeur, x, y, z, …] par tablier) → `glissieres.js` pose une lame de
  chaque côté devant le parapet + bande de retenue, et `creerAdherence` marque
  le tablier comme chaussée (sinon le rappel vers la route tirait vers le canal
  et R ne trouvait rien). Poilhes reconstruit (3 tabliers), Capestang aussi.
- **La berline ne saute plus** : le décollage à quatre roues est réservé au quad
  (`surQuad &&` dans `update`) ; la berline suit le sol par sa suspension.
- Versions de cache `?v=ponts-20260925` (pilote, village, glissières, quad).
- **Skatepark** : trois lots reçus (7 modules FreeCAD exportés en STL par
  FreeCADCmd, 28 obstacles STL dont 9 petits pieds identiques, un « Tech deck »),
  convertis en GLB dans `perso/skatepark-stl/glb/`, planche-contact
  `perso/skatepark-stl/planche-skatepark.png` (vignettes surexposées par
  `rendu_3d.py`, formes lisibles). Échelle proposée ×40 (tuile 100 mm = 4 m).
  **En attente du choix d'Arnaud** : quels éléments du parc virer, quels modèles
  poser où. Mécanique prévue : rastériser le dessus de chaque modèle posé dans une
  grille de hauteurs (`maps/poilhes/skatepark-obstacles.bin`) ajoutée à
  `profil(u, v)`, visuel = le GLB lui-même.

## Skatepark refait avec les modèles (décision d'Arnaud : « on enlève tout »)

- Ancien parc (half-pipe, murs, tremplins, table, bosses, slalom, copings) supprimé
  de `poilhes-skatepark.js`. Il reste la dalle, les bandes de lancement (désormais
  dans le plan) et la ligne de départ.
- `scripts/poilhes/skatepark_modeles.py` : `fiches` (relief ombré de chaque
  modèle, `perso/skatepark-stl/planche-reliefs.png` — bien plus lisible que les
  rendus Blender), `plan` (image du parc composé), `hauteurs` (le .bin du jeu).
  Z-buffer par triangle, 10 cm. Échelles : obstacles ×40 (tuile 100 mm = 4 m),
  FreeCAD ×30 (120 mm = 3,6 m), Tech deck ×15.
- Premier plan (`maps/poilhes/skatepark-plan.json`) : mur nord de trois quarters
  2,2 m + deux coins, trois quarters 1,4 m au sud, pyramide au centre, ligne
  de street à l'ouest (bank, deux pads, bank), spine de 8 m à l'est, deux bosses,
  un wallride de 3,6 m à l'est, une table et un quarter FreeCAD au nord ; deux
  bandes de lancement nord-sud. Rails écartés (une barre de 1,5 m rastérisée
  = un mur pour les roues), Tech deck écarté.
- `poilhes-scene.js` : `chargerParc(BASE)` avant `construireSkatepark` (le plan
  et la grille se lisent, la construction reste synchrone). Version
  `?v=parc-20260925`.


## Reprise (après-midi) — feux de jour, playlist au hasard, mise en ligne

Arnaud : « faut vraiment mettre ce chauffeur sur ce quad, faut lui mettre des feux,
feu arrière, feu de recul, phare » puis « à chaque fois on a la même musique qui
commence, c'est un peu lourd… ordre totalement aléatoire à chaque fois qu'on se
connecte, qu'on recommence, qu'on repasse par l'accueil ».

- **Constat** : en local, le quad avait déjà son pilote et ses feux (vérifié en
  Chromium sans fenêtre : pilote assis, 4 roues, 10 halos, 2 projecteurs). Mais
  **rien n'était poussé** : sur `raphael.crea-doc.fr`, `maps/quad.js` et
  `assets/perso/quad.glb` répondaient 404 — c'est ce qu'Arnaud voyait. Et de jour,
  phares et feux arrière étaient éteints (ils « suivaient l'heure »), et un feu
  rouge posé sur un garde-boue rouge ne se voyait pas.
- **Feux de jour** (`maps/quad.js`, `peindre`) : phares, barre à LED et feux
  arrière **toujours allumés** ; la nuit ajoute les faisceaux au sol et des halos
  plus francs ; feux stop plus vifs au freinage ; feu de recul en marche arrière ;
  clignotants inchangés. Chaque optique reçoit un **boîtier sombre** (plan noir
  1,28 × 1,35 derrière la lentille) ; feux arrière agrandis (17 × 7,5 cm).
  Vérifié de jour, à midi, vue arrière : deux feux rouges cerclés de noir + le feu
  blanc de recul en marche arrière.
- **Playlist au hasard** (`rouler.html`) : les dix « Soul Run » sont mélangées
  (Fisher-Yates) à **chaque chargement de la page** — connexion, Recommencer,
  retour à l'accueil passent tous par un rechargement. La dernière piste jouée
  est retenue (`localStorage`, `poilhes-city-derniere-piste`) pour ne jamais
  rouvrir sur la même. Six chargements d'essai : pistes 3, 8, 3, 6, 9, 5 en tête.
- Versions de cache de toute la chaîne du 25/09 → `?v=feux-20260925`.
- Chargement du quad en Chromium logiciel : 70 s (la « mesure de la machine »
  prend 60 s à 1,5 s par image). Pas un bug, juste le rendu sans GPU.

## « Toujours pas de conducteur » — le vrai bug, dépendant de la vitesse de la machine

- Arnaud : « toujours pas de conducteur », puis « pourquoi le pilote n'apparaît
  pas alors qu'il apparaît sur la trottinette ? montre-moi une vidéo où il
  apparaît ». Il avait raison de ne pas me croire : mes vérifications étaient en
  Chromium logiciel (1,5 s par image), et le bug ne se produit que sur une
  machine rapide.
- **Cause** : `separerRoues` appelle `root.updateMatrixWorld(true)`. Sur une
  machine rapide, le GLB du quad arrive **après** que le jeu a posé l'engin
  dans le village (root à z ≈ −394). Tout ce qui se mesurait ensuite avec
  `o.matrixWorld` ou `Box3.setFromObject` — feux, poignées, selle — sortait en
  coordonnées **monde** : poignées à y = 30, z = 31, selle introuvable. Le
  pilote glissait « vers le guidon » à 400 m du quad, les feux avec. En rendu
  lent, le quad se chargeait avant le placement, root était encore à l'origine,
  tout tombait juste par accident.
- **Correctif** (`maps/quad.js`) : `repereDe(root)` et `boiteDans(objet,
  repere)` — toute mesure passe par `inverse(root.matrixWorld) × matrixWorld`,
  donc dans le repère du quad, où que le jeu l'ait mis. Plus aucun
  `setFromObject`. La trottinette n'a pas ce bug : elle mesure autrement.
- **Preuve** : vrai Chrome, RTX 4070 Ti, qualité Élevé, 60 img/s — selle y 0,95,
  poignées y 1,21 z −0,27 (identiques au cas lent), pilote assis mains aux
  poignées, feux arrière rouges de jour, feu de recul, faisceaux de nuit.
  Vidéo `Downloads/quad-pilote-preuve.webm`, captures `quad-pilote-jour.png`,
  `quad-pilote-nuit.png`.
- Versions de cache → `?v=pilote-20260925`.
- Leçon : **vérifier sur la machine d'Arnaud, pas dans un rendu lent** —
  un bug de course se cache derrière un rendu à 1 img/s.

## Nuit du 25 au 26 — la liste d'Arnaud avant d'aller se coucher

Liste dictée : barrières partout, barrières des ponts aux limites du tablier, figures de la
trottinette sur le quad, son électrique de la trottinette, comportement plus arcade (freiner
droit, freiner et repartir plus vite, marche arrière beaucoup plus vite), place centrale /
mairie / Ostal à refaire, textures et fichiers non utilisés du skatepark ; puis : chaque engin
naît à sa place (trottinette sur le pump track, voiture à l'entrée, quad de l'autre côté),
une belle page d'accueil à trois choix illustrés, et des glissières qui recadrent en douceur
au lieu de renvoyer.

### Fait — premier lot (poussé)

- **Arcade** (`voiture-physique.js`, `ARCADE` + `arcade: true` sur gt, traction, quad) :
  frein appuyé sans volant → lacet et dérive s'éteignent (on freine droit) ; marche arrière
  engagée après 0,4 s au lieu de 0,75, sortie en 0,25 s, couple ×1,6 en arrière ; couples
  et freins relevés (GT 600 N·m / 5 200, quad 58 N·m / 1 200, adhérence quad 1,30).
  Banc : quad 0-100 en 7,6 s (13,6 avant), GT freine en 37 m (53 avant).
- **Ponts** (`glissieres.js`) : lame collée à la face intérieure du parapet (w/2 − 0,36),
  bande de retenue à partir de 50 cm derrière la lame (dans le mur) ; et partout, une
  cellule dont le centre est sur la chaussée n'est plus marquée (on perdait jusqu'à 50 cm
  de voie de chaque côté).
- **Glissières douces** (`voiture-pilote.js`, `reglagesAssistance.*Glissiere`) : quand
  toutes les sondes touchent une glissière (pas un mur), 95 % de la vitesse d'impact
  renvoyée le long du rail, 99,5 % du glissement gardé, poussée 3 cm, réalignement 1,8 rad/s,
  lacet à peine amorti. Les murs gardent l'ancienne réponse.
- **La trottinette est retenue aussi** par les glissières (case du panneau T pour couper).
- **Quad = trottinette** : `figures = surDeuxRoues || surQuad` ; Espace saute (plus de
  frein à main sur le quad), F looping, G 360, flèches haut/bas en l'air ; `SAUT_QUAD`
  (impulsion 2,3, envol 8, turbo 16 m/s). Aide clavier, bouton tactile SAUT/Flip.
- **Son électrique** (`SON_ELECTRIQUE`) : sinus grave 55 → 207 Hz + sifflement dent de
  scie filtrée 420 → 2 200 Hz qui s'ouvre aux gaz, souffle de gomme à 30 %. Trois variantes
  rendues en WAV pour choisir : `Downloads/trottinette-son-A|B|C.wav` (B câblée).
- **Départs** (`rouler.html`, `DEPARTS`) : berline avenue de Capestang (−249, −6), quad rue
  de la Porte d'Ensérune (212, 10) face au village (cap forcé après `placer`, qui préférait
  la campagne), trottinette au départ du pump track. `window.jeu` exposé pour les tests.
- Vérifié en vrai Chrome : les trois engins naissent au bon endroit et roulent ; quad
  0,3 m de saut sur le plat, marche arrière 35 km/h en 2,5 s, freinage droit (−0,6°).

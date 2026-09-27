
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

## 2e course de Poilhes (27/09/2026)

- Demande : « une deuxième course, ailleurs, de la même distance ». `maps/poilhes/boucle-2.json`,
  étapes `ETAPES_POILHES_2` dans `scripts/poilhes/boucle_village.py` (`PISTE=2 py …`).
- **Retenue** : la campagne de l'est, chemins des vignes, 836 m × **2 tours** (≈ 1,7 km ; la course 1
  fait 1 487 m). Nouveau champ `TOURS_PISTE` ; le bouton affiche « 2 tours ». Course 1 régénérée à l'identique.
- **Écartés** : plateau nord-est (sort de la zone détaillée ±500 m → sol cassé, route qui flotte, vu en jeu) ;
  tout le nord (culs-de-sac : le canal ne se passe qu'au gros pont, l'autre passage est une passerelle
  piétonne) ; une boucle de 1 554 m au sud du centre (zigzague dans les ruelles).
- Méthode qui a marché : chercher toutes les vraies boucles du graphe (cycles networkx, largeur ≥ 2,7 m,
  zone ±480 m, recouvrement avec la course 1) au lieu de deviner des étapes.

## La vie du village : trafic, passants, hélicoptères (27/09/2026)

- `maps/poilhes-trafic.js` + réseau `maps/<village>/trafic.json` (`scripts/poilhes/trafic_reseau.py`,
  rues ≥ 3 m dans ±470 m, raccords aux bouts).
- En Élevé : 10 voitures (la berline repeinte en 10 teintes), 4 motos (Motocross Meshy compressé
  6,6 → 1,2 Mo, `assets/fun/moto.glb`, couché car livré Z-haut, peint), 2 quads, 4 trottinettes,
  22 passants, 2 hélicoptères. Bas / Moyen : moins (`NOMBRES`).
- Interactions : les véhicules freinent devant le joueur et **klaxonnent** s'il reste planté devant ;
  les passants **sautent de côté** avec « uh-oh » quand on fonce sur eux ; phares la nuit.
- Piège : le pilote du quad est riggé (squelette) → un `clone()` le laisse au centre du monde. On
  construit un quad et on lui prend son pilote déjà assis (plus petit groupe peau + squelette).
- Vérifié en Chrome : 42 engins en mouvement à Poilhes et à Capestang, 60 img/s en Élevé, aucune erreur.
  Pas d'hélice qui tourne sur les hélicos du trafic (disque flou seulement) : poilhes-helico.js non touché.

## Quatre courses, quad refait, trottinette de fou, GT rouge (27/09/2026, suite)

- **Courses 3 et 4 de Poilhes** (`ETAPES_POILHES_3/4`) : sud (707 m × 2 tours), ouest (547 m × 3 tours).
  Tirées de la recherche de cycles. Accueil : Course 1 à 4 ; HUD : boutons 1 à 4 (une course absente = bouton caché).
- **GT rouge** : 4e carte d'accueil ; `'rouge-berline'` dans `VOITURES` (voiture-pilote.js) = peinture rouge +
  mécanique de la berline (`REGLAGES.traction`). `?engin=rouge`. Image : capture du jeu.
- **Trottinette** : vmax 6,9 → 10 m/s (36 km/h), accel 3,2 → 4,6, bandes 41 → 54 km/h. **La manette PS4 n'avait
  que ✕ depuis le 26/09** → ni looping ni 360 : ajouté R1 looping, L1 360, ○ tailwhip, croix ↑ superman, croix ↓ lâcher,
  stick gauche pour incliner. Figures de fou (H/J/K) : la planche (`kit.engin`) et le pilote (`kit.socle`) bougent
  séparément ; ratées = chute. trottinette.js pas touché.
- **Quad** : Meshy, 4 variantes (`perso/quad-agressif-1..4`, 150 crédits) + pilote debout riggé (35 crédits) —
  **155 crédits au total, solde 871**. `?quad=N` pour comparer (0 = l'ancien), défaut 1 **en attendant le choix
  d'Arnaud**. Orientation détectée (le guidon = sommets les plus hauts). Pilote debout (`POSE_DEBOUT`), il décolle
  du quad en l'air ; « youhou » à chaque vrai saut (vy > 2,2) : 6 voix XTTS locales (`assets/sons/youhou-1..6.mp3`,
  arnaud / fab / jarvis) tirées au sort **en attendant le choix d'Arnaud**.
- Vérifié en Chrome : 4 courses démarrent (2 tours / 3 tours affichés), GT rouge = rouge-berline, les 4 quads
  s'affichent dans le bon sens avec le pilote debout, figures H/J/K reconnues à la réception. Aucune erreur.
- **Choix d'Arnaud** : quad **noir et jaune (n° 2)** pour le joueur (`QUAD_PAR_DEFAUT = 2`), l'**orange (n° 3)** en
  deuxième → quads du trafic (`QUAD_TRAFIC`). Le 1 et le 4 retirés de `assets/perso/` (originaux dans `perso/`).
  Voix du « youhou » : **Jarvis** (sa propre voix robotisée) — prises 5 et 6 seulement.
- **Quad calmé** (réglages de la berline, 100 km/h, plus d'envol aux bosses, pilote qui ne saute plus) :
  essayé et **validé par Arnaud** (« c'est très bien »).

## Mission : la prise d'assaut de Capestang (27/09/2026, soir)

- Accueil de `rouler.html` : bandeau « Mission · Prise d'assaut de Capestang » → `rouler.html?mission=capestang`.
- `maps/mission-capestang.js` : monte le **pays** (`pays-scene.js`, Poilhes + Capestang à 4 km) avec son propre
  moteur, pose l'hélico du joueur (`createHelico`) dans une cour dégagée de Poilhes, tourné vers Capestang.
  Paliers : 1. rallier Capestang (flèche + distance) ; 2. abattre deux hélicos ennemis. Victoire / défaite,
  temps et record (localStorage), Rejouer / Accueil.
- Ennemis Meshy (60 crédits, solde 811) : `assets/fun/helico-ennemi-1.glb` « Faucon noir » (noir et rouge),
  `-2` « Ombre du désert » (beige furtif). Patrouille au-dessus de Capestang, combat en orbite autour du joueur
  à 190 m, rafales de traçantes rouges ; abattus : chute en vrille, fumée noire, explosion au sol.
- Armes (`helico-armes.js`, ajout seulement) : cibles en l'air + **verrouillage** (cône de 12° devant le nez,
  950 m) — balles droites sur la cible, **missiles à tête chercheuse**. Balle 4, missile 45 dégâts, ennemi 100 PV.
  `poilhes-helico.js` : trois lignes de passe-plat (`setCiblesAir`, `verrou`, `exploser`).
- Tir ennemi réglé après essai : 3 dégâts / dispersion 0,03 vidait la coque en 10 s → 2 / 0,055, pauses 3–4,8 s.
- Numéros de version des imports remis à neuf (`?v=20260927m`) pour tous les modules changés aujourd'hui : le
  « pousse » précédent avait gardé les anciens, un navigateur pouvait garder l'ancien code en cache.
- Vérifié (Chrome sans fenêtre) : chargement, verrou, dégâts, chute des deux ennemis, écran de victoire ;
  les modes du village (berline, quad, trottinette, hélico) sans erreur.

## Voitures d'Arnaud en 3MF (27/09/2026, nuit)

- **LaFerrari** (`Downloads/LaFerrari+Wheels+4.1.3mf`) : carrosserie d'un seul bloc → `scripts/poilhes/voiture_3mf.py`
  (peinture par zones : carrosserie, habitacle sombre, bas de caisse et passages de roue noirs, phares, feux ;
  ¼ des triangles) → `assets/fun/laferrari.glb` (161 Ko). Roues dessinées dans le jeu, aux centres mesurés.
  Une voiture du trafic sur trois, 6 couleurs. Pas encore poussée.
- **Mustang GTD** et **Aventador SVJ RC** : kits de dizaines de pièces posées à plat sur 4 et 14 plateaux ;
  la position d'assemblage n'est pas dans le fichier → pas automatisable. Proposé : Meshy (≈ 30 crédits chacune).
- **Mustang GTD et Aventador SVJ** : générées avec Meshy (60 crédits, solde 751), `assets/car/mustang-gtd.glb`
  et `aventador-svj.glb` (1,2–1,3 Mo, textures 2048). `construireVoiture` accepte désormais `modele` et
  `demiTour` (redresser trouve l'axe long, pas l'avant) — les deux arrivent dans le bon sens. Trafic : sur trois
  voitures, une berline repeinte, une LaFerrari, une Mustang ou une Aventador à tour de rôle. Pas encore poussé.
- **Roues du quad** (« il faut faire bouger ses roues, c'est très important ») : la découpe (`separerRoues`,
  quad.js) ajustait son cercle sur la jante (21 cm) → seuls la jante et le bas du pneu tournaient. Nouvelle mesure
  `flanc` : cercle passé par le **contour bas du pneu** (le sommet le plus bas par tranche de z, dans le plan de la
  roue), 31–33 cm ; découpe 7 % plus large pour les crampons. Écartés en cours de route : « le flanc le plus
  large » (prenait les garde-boue arrière), « l'étendue à hauteur d'essieu » (prenait les repose-pieds).
  Vérifié sur le noir et jaune et l'orange : pneus entiers qui tournent.

## Mission Capestang, version 2 — niveau facile (27/09/2026, nuit)

- Arnaud : « plus d'ennemis sur le trajet, sinon c'est trop long ; des objectifs au sol ; de la défense
  antiaérienne à l'entrée de la ville ; niveau facile ».
- Trois phases : 1. le trajet, deux vagues de 2 hélicos (à 28 % et 60 % du chemin, surgissent 650 m devant) ;
  2. l'entrée (520 m du centre, côté Poilhes) : 3 batteries DCA (tourelle qui suit, rafales), 2 dépôts de
  carburant, 2 camions — procéduraux, épaves noircies qui fument ; 3. les hélicos restants (la garde ne
  décolle qu'après la défense rasée).
- Facile : coque 150, hélicos 70 PV, tirs 1,5 dégât et moins précis, +35 de coque par vague abattue et après la
  défense ; missiles à dégâts de zone (14 m, `helico-armes.js`). Marqueurs par sorte, barre de vie.
- Vérifié (téléportation) : vagues, bascule des phases, 13 objectifs détruits → « Capestang est prise ! ».

# Bilan de session — 26/09/2026

## Demande d'Arnaud

1. « Enlever toutes les barrières des routes, finalement c'est pas du tout une bonne idée ;
   les laisser que sur la route entre Poilhes et Capestang, où il y a la course, et la faire très large. »
2. Le comportement des engins : l'arcade du 25/09 est « catastrophique, on comprend rien ;
   il faut que ce soit arcade, mais jouable ». Des fois la voiture tourne toute seule en tenant les gaz.

## Fait (local, NON poussé)

- **Loi arcade** (`maps/voiture-physique.js`, `integrerArcade`, `ARCADE_DEFAUT`) pour la berline,
  la GT, le quad et la trottinette (`loi: 'arcade'`). Plus de modèle de pneus : gaz, frein, volant
  (= vitesse de rotation), accroche qui remet la trajectoire dans l'axe sans perdre de vitesse,
  frein à main = glisse, herbe = vitesse de pointe réduite. Le modèle de pneus reste pour un engin
  sans `loi: 'arcade'`.
- En arcade, le pilote **ne tourne plus le volant à la place du joueur** (`rappelRoute` coupé) et
  l'herbe n'est plus adoucie par l'assistance.
- Toucher du volant plus direct (`TOUCHER` : montée 4 / 4,5, courbe 1,6 / 1,35).
- Panneau T : groupe « Arcade » (12 réglages). Réglages mémorisés : clé `nova.reglages.v2.*`
  (les anciens visaient le modèle de pneus, ils ne sont plus réappliqués).
- **Glissières** : coupées dans les villages (`VILLAGE_GLISSIERES = false`, `poilhes-village.js`) ;
  posées le long de la course Poilhes–Capestang dans la campagne (`course-route.js`,
  `COULOIR.demi = 14` → couloir de 28 m, portes comprises). L'intérieur du couloir compte comme
  chaussée (hors village il n'y avait pas de route dans les données : la course se roulait à
  l'adhérence de l'herbe).

## Bug trouvé en essai et corrigé

- Au contact d'une glissière, la berline est montée à **2 000 km/h** : la réponse « rail » ajoutait
  `rail × vitesse d'impact` à chaque image, et la loi arcade (qui ne perd rien en virage) ramenait la
  caisse contre la lame. Corrigé : un choc ne rend jamais plus de vitesse qu'avant ; garde-fou à
  2 × `vmax`.

## Mesures (Chrome réel, local)

- Banc berline : 0→100 en 4,4 s, pointe 137 km/h, 100→0… 137→0 en 40 m, herbe 75 km/h.
- Course, gaz tenus 6 s sans volant : cap **strictement constant** (0,785 → 0,785), aucune manette.
- Contre la glissière : ~130 km/h gardés, voiture restée dans le couloir (3,9 m de l'axe).

## Enseignement

- Un essai Playwright en fenêtre visible reçoit aussi le clavier d'Arnaud s'il joue en même temps :
  mesures faussées (frein « inopérant », dérive de cap). Prévenir avant un essai visible.

## À faire valider par Arnaud au volant

- La loi arcade sur les trois engins (village et course).
- Réalignement automatique contre les murs coupé en arcade (« à pleine vitesse elle tourne toute seule ») : on glisse le long du mur, cap inchangé.

## Suite — flèches au sol et boucle de Poilhes

Demande : « le truc vert au sol, c'est horrible ; les mêmes flèches mais sans le vert, bien voyantes » ;
« une petite boucle dans Poilhes : de l'entrée au gros pont, une boucle au-dessus d'environ 1 km,
retour au départ, deux tours, un classement ».

- `maps/fleches-sol.js` : flèches jaunes cernées de noir, posées à plat (elles prennent la pente),
  un seul maillage instancié. Course Poilhes–Capestang : la bande verte n'est plus construite
  (`construireRuban` gardé mais plus appelé), flèches 4 × 4,6 m tous les 20 m.
- `scripts/poilhes/boucle_village.py` → `maps/poilhes/boucle.json` : graphe des rues **du jeu**
  (ruban de chaussée + tabliers de pont), Dijkstra entre étapes imposées. Tracé retenu : entrée
  (départ de la berline, avenue de Capestang) → gros pont du canal (7,6 m, sud-ouest) → quartier est →
  pont du centre → retour. **1 052 m par tour**, impasses repliées.
- `maps/course-boucle.js` : flèches 2,6 × 3 m tous les 6 m, ligne en damier, 3-2-1 (engin tenu sur
  la ligne), 21 points de passage dans l'ordre, 2 tours, panneau d'arrivée + top 10 (localStorage
  `nova.boucle.poilhes`, le serveur de classement n'étant pas déployé). Bouton « 🏁 Course · 2 tours »
  dans le panneau de `rouler.html`, Échap pour abandonner.
- Vérifié en Chrome : décompte, deux tours comptés, arrivée, classement enregistré ; captures dans
  Downloads (`boucle-*.png`, `course-pays-fleches.png`).

### Boucle, 2e version (« très très serré »)

- La 1re boucle passait ~400 m sur 1 052 par des ruelles de 2–3 m (vieille ville, pont du centre de 3 m).
  Le graphe pèse maintenant chaque mètre selon la largeur de chaussée (`cout_largeur` : ×1 ≥ 5 m,
  ×1,6 ≥ 3,8 m, ×14 en dessous). Nouveau tracé : entrée → gros pont → route du canal → grand-rue vers
  l'est → rue parallèle vers l'ouest → gros pont → entrée. **1 487 m par tour, 35 m en rue étroite.**
- Aller et retour sur le même axe (entrée ↔ gros pont) : flèches décalées de 1,2 m à droite
  (`decalage` dans `fleches-sol.js`), chaque sens sur sa voie.
- **R en course** : retour au dernier point de passage validé, au milieu de la rue, dans le sens de la
  course, à l'arrêt ; le chrono continue (écouteur en capture : le R du pilote ne passe pas derrière).
- Vérifié en Chrome : perdu à 60 m du tracé → R → reposé au point 5 ; deux tours → arrivée.

## Suite — une course d'un tour, le classement, les enseignes, le Rafale

- **Un seul tour** (« trop longue ») : `tours: 1` ; classement repris à zéro (`nova.boucle.poilhes.1tour`).
- **Classement consultable à tout moment** : bouton 🏆 (affiche le record), top 10 avec meilleur tour,
  engin et date ; à l'arrivée, la place est dite en clair (« 🥇 Nouveau record ! », « 3ᵉ place »).
- Ostal Louis : le fichier `Downloads/Meshy_AI_Ostal_Louis_0925231101_texture.glb` est **le même
  modèle** que celui du jeu (même boîte au millimètre, même nombre de sommets) — non remplacé.
- **Enseignes** (`maps/poilhes-enseignes.js`) : bandeau peint sur la façade + enseigne drapeau
  à deux faces sur potence, légèrement émissives, pour Ostal Louis (drapeau seul, la devanture Meshy
  a sa façade), Vinauberge (panneau sur pied : aucune façade à portée), La Tour Sarrasine,
  Les Platanes, La Poste. Façades trouvées au rayon (`chercherFacade`).
- **Survol** (`maps/survol-rafale.js`, `startVillage({ survols: true })` dans `rouler.html` seulement) :
  un Rafale (le modèle léger des ennemis) traverse le ciel toutes les 40–85 s (premier à 18 s),
  110–160 m au-dessus du sol, à moins de 150 m du joueur, 170 m/s ; son synthétisé (souffle + grondement,
  aigu à l'approche, grave en s'éloignant), démarré seulement après un geste. `jeu.survol.passer()` en console.
- À venir : **un hélicoptère — Arnaud s'en occupe lui-même.**

## Suite — les figurants

Cinq modèles Meshy d'Arnaud (Téléchargements) → `assets/fun/` (70–900 Ko chacun après
`gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 1024 --simplify-ratio 0.1`),
posés par `maps/poilhes-figurants.js` (Poilhes City seulement) :
- **cycliste** : roule sans fin sur la boucle, bord droit, 25 km/h, cap lissé ;
- **policier de l'espace** : à droite de la ligne de départ, face à la piste ;
- **stégosaure** 9 m, peint en vert : angle nord-est du grand terrain (skatepark), vu depuis le parcours.
  Le modèle n'avait **ni texture ni normales** (silhouette noire) → `computeVertexNormals()`.
  1er essai au 1/3 du tour : caché par les arbres ; 2e sur l'autre « terrain de sport » OSM : derrière les maisons ;
- **Carole** + **les deux mafieux** : sur le trottoir devant l'Ostal Louis.
Tous sont du décor (on passe au travers).
- **Les deux mafieux, « il faut les voir souvent »** : 5 copies de plus le long du tour (8 %, 27 %, 46 %, 64 %, 83 %), sur le trottoir à 4 m de l'axe, tournées vers la route (clones : géométrie partagée).

## Suite — volant T150 et manette PS4

- `maps/volant.js` : volant (réglage guidé à son rythme : « Commencer », gestes tenus, pause « ✓ Bien reçu » ;
  repos des pédales mesuré **au relâché** — Chrome déclare une pédale à 0 tant qu'elle n'a pas bougé, ce faux
  repos faisait lire « frein enfoncé » donc marche arrière ; correction automatique si une pédale se lit
  enfoncée pieds levés ; jauges en direct + « Inverser » ; sensibilité 1,5 + courbe 1,6, « 3 » était « super dur »).
- **Manette classique** (PS4/Xbox, `mapping: 'standard'`) sans réglage : stick gauche, R2, L2, ✕ frein à main/saut,
  △ repartir, □ caméra. Sur la course Poilhes–Capestang, la lecture « avion » de world-game ne s'ajoute plus en voiture.
- `volant-enregistreur.html` : enregistre 25 s de gestes guidés → JSON dans Téléchargements (diagnostic).
- Vérifié avec volant et PS4 **simulés** (pas encore avec le vrai T150 : le problème décrit par Arnaud venait
  du site en ligne, qui n'avait pas encore ce code).

## Suite — départ lancé, GT retirée, Capestang, hélicoptère

- **« J'ai fait plusieurs tours, ça ne s'est pas arrêté, pas de classement »** : le chrono n'existait qu'après 🏁.
  Désormais **départ lancé** : franchir la ligne dans le sens de la course, en roulant, lance le chrono (6 s de
  répit après une arrivée). Points de passage plus tolérants (22 m, un point raté validé par l'un des 3 suivants).
- **GT rouge retirée** (« une catastrophe ») : plus dans les modes des mondes relevés, lien de l'accueil vers la
  berline, touche C inactive, un ancien lien `mode=voiture` mène à la berline.
- **Capestang** : même boucle (`VILLAGE=capestang py scripts/poilhes/boucle_village.py`), triangle de 1 470 m sur
  les grandes artères (avenue en diagonale, centre, boulevard sud), 84 m en rue étroite ; départ de la berline sur
  la ligne ; figurants aussi (sans l'Ostal Louis ni le terrain de foot).
- **Hélicoptère** (`maps/helicoptere.js`) construit en volumes (rouge et blanc, rotors, gyrophare), orbite de 170 m
  à 60 m au-dessus de la boucle, penché ; son de pales synthétisé.

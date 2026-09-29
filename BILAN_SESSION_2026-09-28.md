## Trottinette au skatepark : vitesse, figures, tremplins (27–28/09/2026)

Demande d'Arnaud : « sur le skatepark, qu'elle aille beaucoup plus vite, plus de figures à la
manette, plus fluide ; sur le pump park, qu'elle soit vraiment structurée : au tremplin elle saute
parfois du milieu, il faut qu'elle aille jusqu'au bout et qu'elle saute au bout, physico-réaliste ».

### Causes trouvées (mesurées dans Chrome + GPU, sonde image par image)

- **Chaque module du parc était posé sur sa plaque de base** : 30 cm (lot bois : Table, Cone_flat,
  Quarter_pipe…) ou 60 cm (lot fingerboard). Chaque rampe commençait donc par une marche verticale.
- La « montée » lissée gardait le pic de cette marche : faux élan, envol à mi-pente.
- La suspension lissée restait jusqu'à 75 cm sous une rampe prise vite.
- Les quarters sont des tuiles minces à face arrière verticale : la roue avant passait derrière le
  bord, la moyenne des deux roues plongeait dans la rampe, et l'engin s'envolait hors du parc.

### Ce qui est fait

- `skatepark-plan.json` : champ `enfoui` par pièce (0,3 / 0,6 m ; box N 1,0 m → box de 40 cm) ; les
  pads (60 cm) restent, ils forment la funbox avec les deux banks. Script `skatepark_modeles.py`
  (hauteurs) et `poilhes-skatepark.js` (GLB posés) lisent la même valeur.
- `voiture-pilote.js`, trottinette seulement (le quad garde sa loi validée) :
  - **décollage à la roue arrière** : on reste sur la rampe tant qu'elle y roule, on part avec la
    vitesse tangente (vitesse × pente), rien de lissé ; la vitesse se partage selon l'angle ;
  - pente lue sur deux fenêtres de 20 cm, montée régulière exigée, et la roue doit monter
    réellement d'une image à l'autre (une bordure, une arête de box, une face arrière ne lancent pas) ;
  - **quarter** (pente raide + plus de sol derrière le bord) : montée, demi-tour en l'air, retour
    dans la rampe (2 m au plus au-dessus du bord) ;
  - face verticale devant : jusqu'à 60 cm, petit saut automatique dessus ; au-delà, rebond ;
  - suivi exact du sol (plus de lissage), jamais sous le sol du milieu de l'engin, assiette 2× plus vive,
    raccord d'assiette au décollage.
- **Vitesse sur la dalle** : 54 km/h au moteur (36 ailleurs), bandes bleues 72 km/h, la pente pousse en
  descente et retient en montée (0,6 g, « pump »). Réglables touche T (`parcVmax`, `parcAccel`, `gravitePente`).
- **Figures** : U / croix ← **barrel roll**, L / croix → **nac-nac** (en plus de R1, L1, ○, croix ↑ ↓).
- Envol maxi 7,5 → 9 m/s.

### Mesures (Chrome réel, 60 img/s)

- Bosse (Cone_flat) : envol quand la roue arrière est sur l'arête (s = 7,2 m pour un bord à 7,3 m).
- Pyramide : envol au bord du plateau, vy = 6,7 m/s = 13,3 × 0,5 (sa pente).
- Mur nord et quarter sud : demi-tour, retour dans le parc, plus de sortie par-dessus.
- Rues du village : 6 s à 33 km/h, aucun envol parasite. Aucune erreur JS.

### À surveiller

- À 72 km/h, la bosse de la bande lance à 27 m : physiquement juste, peut-être trop pour le parc
  (baisser « Bande de lancement » avec T si besoin).
- Réglages mémorisés dans le navigateur (touche T) : ils écrasent les nouvelles valeurs par défaut.

## Hélico : le pilotage de l'avion, moins vite (28/09/2026)

- `poilhes-helico.js` : même loi de vol que `poilhes-jet.js` (`flight-model.js`, chargé à la demande
  car `rouler.html` ne l'a pas) — roulis, tangage, virage induit, ailes qui reviennent à plat.
  Vitesses 79 / 151 / 198 km/h (avion : 137 / 259 / 331). Garde de l'hélico : S ou L2 = arrêt en
  l'air, monter / descendre sur place, posé à plat sur ses patins, ne part pas tout seul au sol.
- Manette : stick gauche manche, R2 gaz, L2 frein, ✕ / ○ monter / descendre, **stick droit ↕ la visée**
  (plongée des tirs 0,31 → jusqu'à 1,25 rad, elle reste où on la laisse), ↔ pivoter ; molette au clavier.
- `helico-armes.js` : `plongee` variable (réticule, balles, missiles).
- Essai Chrome (manette simulée) : Z 151 km/h, → incline et vire, S = 0 km/h, stick droit bas
  0,31 → 0,97 rad en 0,6 s, E / Espace / Ctrl montent et descendent. Aucune erreur.

Imports passés en `?v=20260928a`. Non commité, non poussé.

## Hélico, retour d'Arnaud (28/09/2026)

« Pas mal ; un peu violent pour un hélico ; inverser l'axe monter/descendre ; un bouton pour la
vitesse ; plus proche des ennemis au départ de la mission. »
- Moins vif : roulis 0,55 et tangage 0,65 du taux de l'avion (`HELICO_PILOTE.vivacite`).
- Stick gauche inversé : poussé = piquer (les flèches ne changent pas).
- Vitesse réglée qui reste : croix ↑ / ↓ (ou + / − au clavier), 29 km/h par seconde de maintien ;
  R2, Z, Maj, S, L2 agissent par-dessus.
- Mission : départ à 55 % du chemin (1,8 km de Capestang), vagues à 4 % et 40 % du trajet restant.
- Vérifié : stick poussé → tangage −0,42 ; mission chargée, ennemis en vue au départ, aucune erreur.

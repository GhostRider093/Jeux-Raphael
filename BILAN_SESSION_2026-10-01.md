# Bilan — 01/10/2026 : courir à plusieurs (en ligne et contre l'ordinateur)

## Demande
« Un multijoueur… au moins deux joueurs sur la même course » (les boucles de Poilhes City),
« ça peut être un joueur physique, ça peut aussi être contre l'ordinateur, avec plusieurs niveaux ».

## En ligne (joueur physique)
- Déjà codé le 26/09 (`multiplayer/village.py`, `maps/multijoueur.js`), revérifié aujourd'hui en local :
  deux faux joueurs WebSocket se voient, le départ commun arrive aux deux.
- **Toujours pas en ligne** : `deploy/multijoueur-vps212.sh` est prêt (défaut `nginx -t | tail` corrigé),
  à lancer avec l'accord d'Arnaud (`! bash deploy/multijoueur-vps212.sh`), puis mettre SITES.html à jour.
- En ligne, la course part **sans** pilotes de l'ordinateur (`demarrer({ adversaires: false })`).

## Contre l'ordinateur — `maps/course-adversaires.js`
- Les pilotes suivent le tracé `boucle*.json` (rééchantillonné à 2 m) ; vitesse limite par la courbure avec
  la loi arcade de l'engin du joueur, freinage anticipé, accélération de l'engin. Niveau = part de la limite.
- Ils changent de file pour doubler, restent derrière sinon, repoussent doucement le joueur au contact,
  s'effacent après la ligne. Place en course dans le HUD (« 2ᵉ/3 »), classement de la manche à l'arrivée
  (temps estimé pour ceux qui n'ont pas fini).
- Choix du niveau : rangée « 🤖 Contre l'ordi » à l'accueil (étape Course ou mode libre), bouton 🤖 en jeu.

## Essais et retours
- 1re version : 3 pilotes en berlines repeintes, Facile 0,60 / Moyen 0,74 / Difficile 0,87 / Pilote 0,97.
  Mesuré : Pilote ≈ 75 s le tour de Poilhes 1 (1,5 km).
- **Arnaud** : « le premier niveau c'est un peu haut, faut que ça soit moins rapide » ; « deux voitures
  différentes, juste deux adversaires ». → 2 pilotes, LaFerrari (Turbo, rouge) + Aventador SVJ (Jarvis, vert),
  Facile 0,50 (attend dès 30 m d'avance) / Moyen 0,60 / Difficile 0,78 / Pilote 0,95 ; Facile par défaut.
- Vérifié dans le vrai Chrome : grille, départ, les deux voitures visibles, tour complet sans erreur.

## Les chocs entre engins (« blinder les collisions, avec chocs, bruitages et compagnie »)
- Avant : le trafic était un décor qu'on traversait ; les murs ne faisaient qu'un petit crissement.
- `maps/chocs.js` : boîtes orientées, pas de 60 cm pour le déplacement du joueur, impulsion (restitution 0,3,
  frottement 0,35, dvMax 22 m/s), pivot ≤ 2 rad/s, 2e passe de séparation. Étincelles, secousse, vibration manette,
  choc contre un mur détecté par la perte de vitesse.
- `maps/sons-chocs.js` : tout synthétisé (Web Audio), dosé par la force ; raclement continu en glissade.
- Trafic (`poilhes-trafic.js`) : `corps()`, véhicule bousculé (écart, travers, arrêt, klaxon, retour dans sa voie),
  jamais poussé dans une façade (`decor.blockedAt`). Adversaires : `corps()`, perte d'élan + écart + pivot, et ils
  **voient le trafic** (file libre ou freinage, regard 7 m + 0,7 s). En ligne : avatars = boîtes immobiles chez nous.
- Mesures (Chrome réel, son coupé) : face 90 km/h, côté 72, arrière 108, face 158, biais 126 → enfoncement max
  0 à 12 cm, jamais au travers, marche arrière dégage toujours. 1re version : la voiture percutée butait au bout de
  son écart (4 m) et le joueur s'y enfonçait → 2e passe + écart 6 m. Course Pilote dans le trafic : 79,5 / 84,1 s,
  personne de coincé.
- Pendant les essais, Arnaud jouait en même temps : deux essais ratés à cause de son clavier (les prévenir avant).

## Reste
- Arnaud doit rejouer en Facile pour valider le nouveau réglage, et essayer les chocs (le son n'a pas été écouté :
  essais en `--mute-audio`).
- À voir avec lui : la trottinette (110 kg) contre une voiture rebondit fort (jusqu'à 22 m/s de changement) —
  peut-être une chute plutôt qu'un rebond.
- Non commité, non poussé (attendre « pousse »).

## Accueil
- Carte « GT rouge » masquée (Arnaud : « ça sert à rien ») — `hidden`, rien de supprimé, `?engin=rouge` marche encore.

## Vue intérieure de la berline
- Photo d'habitacle fournie par Arnaud → `assets/car/interieur-berline.webp` (vitres transparentes, rétro assombri puis **retiré** à la demande d'Arnaud — « c'est un sauvage »,
  ×2 Lanczos — pas de Real-ESRGAN : GPU réservé à Jarvis). 4ᵉ vue (V), berline seulement, caisse masquée.
- 1er essai : l'habitacle passait par-dessus le panneau de gauche → calque inséré juste après `#scene`, z-index 0.
- Arnaud va générer le **volant avec les mains** : calque prévu (`assets/car/volant-berline.webp`), il tournera avec
  la direction. Il manque aussi un volant dans la photo (rien côté conducteur).
- **2e photo d'Arnaud** (« ça ne plaît pas la photo ») : planche carbone, compteurs, pas de rétroviseur, pare-brise
  qui montre un paysage sous la pluie → nouveau mode `--vitres clair` (luminosité, rangées pleines et bords lissés,
  coupure à 0,322 au-dessus des essuie-glaces ; 1er essai : le haut gris de la planche partait avec). Repères de
  `vue-interieure.js` réalignés (capot 0,322, horizon 0,25).

## 02/10 — rétroviseur
- Le miroir était déjà parti, mais son pied pendait encore sous la console de plafond : rendu transparent (zone 930–1110 × 200–275 px de l'image finale). Ancienne image dans git (c4aba1c). Non poussé.

## 02/10 — volant avec les mains
- Généré par Atlas (4 modèles, 0,314 $) sur fond vert : `Downloads/volant-berline/` ; détourés et recentrés sur le moyeu par `scripts/interieur/preparer_volant.py` (jante = moitié du côté).
- Posé devant les compteurs, côté conducteur (VOLANT_U 0,245 / V 0,50 / D 0,36 de la photo), recalé à chaque taille d'écran.
- Seedream (n° 2) mis par défaut, à valider par Arnaud. 1er essai Chrome : à -73° les bras partaient à l'horizontale → rotation affichée plafonnée à ±40°.
- Non poussé.

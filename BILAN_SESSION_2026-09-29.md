# Bilan — 29/09/2026 — Poilhes City plus légère (PC modestes, téléphone, tablette)

## Constat (mesuré avec Playwright + vrai Chrome, sonde de démarrage)
- PC : 64 Mo téléchargés, 18 s avant de jouer, puis gels de 5 à 7 s en jeu.
  « Auto » (défaut) construisait en Élevé et remesurait la machine à CHAQUE lancement.
- Gel principal : `getProgramInfoLog` = 24,5 s. Three vérifie chaque shader en attendant la carte.
- Téléphone simulé (844x390, DPR 3, CPU ×4) : 51 s, ~800 Mo de textures en mémoire graphique
  (Safari ferme l'onglet bien avant), panneau de réglages ouvert qui cachait tout le jeu.

## Changements
- Qualité **Bas par défaut**, message « passe en Moyen ou Élevé » (pas sur téléphone). Rien n'est
  mémorisé tant que le joueur n'a pas choisi. « Auto » mesure, abandonne dès 60 ms/image, retient le conseil.
- `renderer.debug.checkShaderErrors` seulement avec `?debug` (poilhes-village.js).
- L'écran de chargement reste jusqu'à ce que trafic, figurants, engin choisi (suivi des GLB via
  DefaultLoadingManager, par adresse) et programmes (`compileAsync`) soient prêts. Plafond 30 s.
- `maps/leger.js` : textures plafonnées (téléphone 512, tablette et Bas 1024), trafic « telephone ».
- Tactile : seulement l'engin choisi (ni hélico ni explosions), pas de Rafale, pas de trottinette garée,
  panneau replié d'office, compteur compact, mini-carte en haut sur tablette.

## Mesures après
| | avant | après |
|---|---|---|
| PC : après chargement | gels 5-7 s, 2-3 img/s | 60 img/s, aucun gel |
| Téléphone : textures | 800 Mo | 88 Mo |
| Téléphone : téléchargé | 63 Mo | 49 Mo |
| Téléphone : prêt (CPU ×4) | 51 s | 34 s |

## Reste
- 3,1 M de triangles même en Bas (feuillage instancié 520 k, terrain 680 k, voitures du trafic ~52 k
  chacune, berline 157 k) ; village.bin 15 Mo.
- À valider sur un VRAI téléphone et une vraie tablette (l'émulation ne reproduit ni la carte ni la mémoire).
- Non commité, non poussé (push sur main = mise en ligne).

# Étrier réglable pour scotcher 2 ventilateurs sur un radiateur

Fichier : [`etrier_ventilateurs_radiateur.scad`](./etrier_ventilateurs_radiateur.scad)

## Principe

- Un **socle central** fixe.
- Deux **bras plats coulissants** (droite / gauche), chacun terminé par une **patte en L** sur laquelle on colle le scotch double-face contre le ventilateur.
- Chaque bras a un **trou oblong** (course de 15 mm) traversé par **une seule vis centrale M5**, commune aux deux bras empilés au-dessus du socle.
- On règle l'écartement extérieur des deux pattes à la main — de **180 mm** (position ouverte) à **150 mm** (position resserrée, vers le centre) — puis on serre la vis centrale : elle plaque les deux bras l'un contre l'autre et contre le socle, et les bloque par friction, comme la vis de blocage d'une jambe de force / d'un support de carte graphique.

Toutes les dimensions sont paramétriques en haut du fichier (customizer OpenSCAD) : ajuste `ecart_max`, `ecart_min`, les dimensions des pattes, etc. à ton radiateur et tes ventilateurs.

## Impression

3 pièces à imprimer :

| Pièce                  | Variable `piece` | Quantité |
|-------------------------|:---:|:---:|
| Socle central            | `"socle"` | 1 |
| Bras + patte              | `"bras"`  | **2** (voir remarque) |

**Remarque** : la pièce `bras` est symétrique en largeur, donc il suffit d'imprimer **deux fois le même fichier** — pour le bras gauche, prendre la 2ᵉ pièce imprimée et la tourner de 180° autour de l'axe vertical avant montage (pas besoin de la mettre en miroir dans le slicer).

Les deux bras se posent à plat sur le plateau (aucun support nécessaire), le rebord en L imprime tout seul (paroi verticale pleine largeur).

## Visserie

- 1 vis **M5** (tête bombée ou fraisée) + 1 écrou **M5**.
- Longueur de vis conseillée : `hauteur_socle + 2*epaisseur_bras + 8mm` → avec les valeurs par défaut, **≥ 22 mm** (prendre du M5×25).
- Une **rondelle large** (Ø ≥ 23 mm) sous la tête de vis, pour qu'elle plaque bien sur toute la longueur du trou oblong quelle que soit la position choisie.

## Montage

1. Insérer l'écrou M5 dans l'empreinte hexagonale sous le socle.
2. Poser le bras gauche sur le socle, puis le bras droit par-dessus.
3. Passer la vis (avec sa rondelle) par le dessus, à travers les deux trous oblongs, et visser dans l'écrou sans serrer à fond.
4. Coller le scotch double-face sur les deux pattes, positionner les ventilateurs contre le radiateur en ajustant l'écartement (150 à 180 mm), puis serrer la vis centrale pour bloquer l'ensemble.

## Aperçu

Rendu OpenSCAD (`piece = "assemblage"`), position ouverte (180 mm) et resserrée (150 mm) :

le paramètre `position_apercu` bascule entre `"ouvert"` et `"ferme"` pour visualiser les deux extrêmes avant impression.

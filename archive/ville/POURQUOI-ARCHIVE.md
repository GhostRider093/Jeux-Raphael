# La ville — archivée le 08/09/2026

Ce dossier contient l'ancien jeu de la ville : `raphael2.html`, son moteur
`rzphzel.js`, et les deux décors qui n'existaient que pour lui.

## Pourquoi

Le jeu se joue dans **`mondes.html`**. La ville était une seconde page avec sa
propre loi de vol, son propre chasseur, son propre système d'explosion, son
propre HUD et son propre combat aérien — tous différents de ceux des Mondes.
C'est cette duplication qui a produit, en une seule session :

- un tangage inversé, corrigé deux fois au lieu d'une ;
- un chasseur affiché en nuage de segments blancs, invisible pendant des mois ;
- deux systèmes d'explosion de qualité très inégale ;
- des heures perdues à régler une page pendant qu'on en testait une autre.

## Ce qui a été gardé du travail fait ici

Rien n'est perdu : le modèle de vol, le chasseur, la jauge de vitesse et les
explosions sont devenus des modules partagés à la racine du projet
(`flight-model.js`, `chasseur-model.js`, `speed-gauge.js`,
`maps/world-explosion.js`). Ils servent maintenant aux Mondes.

## Ce qui n'est PAS ici

`chasseur.js`, `combat.js`, `escadrille.js`, `air-combat.js` et
`sector-streaming.js` restent à la racine : **`vallee.html` les charge aussi**,
et la Vallée est gardée.

## Pour revenir en arrière

    git mv archive/ville/*.html archive/ville/*.js .

Les deux liens « Jeu principal » de `mondes.html` ont été retirés en même
temps ; il faudra les remettre.

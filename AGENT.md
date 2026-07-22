# Mission du projet Raphael

## REGLE ABSOLUE - EMPLACEMENT DU PROJET

- Le seul workspace autorise est `E:\projet\raphael-online`.
- Si une session s'ouvre dans `C:\Users\icc34\Projet\raphael`, ne rien y lire, creer, modifier, lancer ni publier : basculer d'abord sur `E:\projet\raphael-online`.
- La presence eventuelle d'un dossier Raphael sur C: ne l'autorise jamais comme source, sauvegarde ou copie de travail.
- Avant toute commande ou modification, verifier que le repertoire de travail est bien `E:\projet\raphael-online`.

## Workspace de travail

- Travailler exclusivement dans `E:\projet\raphael-online`.
- `E:\projet\raphael-online` est l'unique copie active et la source de vérité du projet.
- Ne plus développer, corriger ni ajouter de contenu dans `C:\Users\icc34\Projet\raphael`.
- L'ancienne copie du disque C: est uniquement une source de récupération en lecture seule. Toute récupération doit être transférée sur E: avant de poursuivre le travail.
- Toutes les nouvelles maps, tous les systèmes de jeu et toutes les publications GitHub doivent partir de `E:\projet\raphael-online`.
- Améliorer le jeu HTML/JavaScript existant sans repartir de zéro.
- Conserver les systèmes fonctionnels et intégrer les nouveautés progressivement.
- Éviter les régressions, le code dupliqué et les allocations inutiles dans les boucles d'animation.
- Privilégier une architecture modulaire, des noms explicites et des fonctions documentées.
- Vérifier visuellement et fonctionnellement le jeu après chaque étape.

## Objectif général

Transformer progressivement le jeu actuel en simulateur de combat aérien moderne, fluide et extensible.

Les chantiers prévus sont :

1. Fusion et streaming des cartes existantes.
2. Intelligence artificielle avancée des chasseurs ennemis.
3. Combat aérien réaliste fondé sur les trajectoires et l'énergie.
4. Orientation réaliste des avions : roulis, tangage, lacet, inertie et amortissement.
5. Verrouillage radar progressif et autorisation de tir.
6. Radar ennemi et niveaux d'alerte du joueur.
7. Manœuvres permettant de casser progressivement un verrouillage.
8. Missiles guidés avec portée, vitesse, perte de cible et explosion.
9. Dégâts localisés et conséquences sur le comportement de l'avion.
10. Système audio amélioré et spatialisé.
11. Apparition naturelle des ennemis depuis le monde.
12. Effets visuels : fumée, flammes, particules, impacts, traînées et débris.
13. Interface inspirée des HUD modernes.
14. Optimisation du rendu, de l'IA, des collisions, de la physique, de l'audio, de la mémoire et du streaming.
15. Maintien d'une architecture claire et production d'un rapport des changements.

## Phase immédiate - étape 1

Pour l'instant, travailler uniquement sur le chasseur du mode principal :

1. Rendre le tir du canon beaucoup plus continu lorsque la commande de tir reste maintenue.
2. Améliorer très fortement le son du canon afin qu'il soit plus puissant, soutenu et crédible.
3. Orienter visuellement le chasseur selon sa trajectoire verticale :
   - en descente, le nez doit piquer vers le bas ;
   - en montée, le nez doit se lever ;
   - les transitions doivent rester fluides et ne pas casser les commandes existantes.

Ne pas élargir cette étape aux autres systèmes tant que ces trois comportements ne sont pas validés.

## Liaison des zones

- Relier la ville du jeu principal à la vallée.
- Placer un portail visuel au fond de la ville.
- Au passage du chasseur, afficher une courte transition de chargement.
- Ouvrir ensuite la vallée directement en mode chasseur.
- Le chasseur doit conserver la même physique, les mêmes commandes, la même caméra, le même tir et la même apparence dans les deux zones.
- Prévoir ultérieurement un autre portail vers un mode course distinct.

## Lanceur local à restaurer

À l'issue de la phase de développement et de validation, recréer `Lancer_jeu.bat` à la racine du projet.

Le lanceur devra :

- démarrer le serveur web local depuis `E:\projet\raphael-online` ;
- éviter de lancer plusieurs serveurs identiques si le jeu tourne déjà ;
- ouvrir directement la page principale du jeu dans le navigateur ;
- rester simple à utiliser par double-clic ;
- afficher un message compréhensible si Python ou le port local ne sont pas disponibles.

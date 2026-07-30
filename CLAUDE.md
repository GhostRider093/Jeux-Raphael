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

22 cartes reliées par un réseau de portails ; chaque monde contient un anneau énergétique
dans sa moitié nord.

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

`README.md` · `maps/README.md` · `DEVELOPMENT_REPORT.md` · `MULTIPLAYER_DEPLOYMENT.md`

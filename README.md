# Raphael — Nova Flight

Simulateur de combat aérien avec ville, vallée et premier mode multijoueur à deux pilotes.

## Pages

- `index.html` : menu public.
- `raphael2.html` : ville et jeu principal.
- `vallee.html` : vallée avec éditeur et mode vol.
- `puppet_animation_editor.html` : éditeur d'animation.
- `multiplayer.html` : échange de la connexion Ghost Chat et recherche automatique d'un adversaire.
- `mondes.html` : vol et duel synchronisé.

## Lancer sous Windows

Double-cliquez sur `Lancer_jeu.bat`. Le lanceur installe au besoin les dépendances, démarre le service sur le port `8010`, puis ouvre le jeu.

Lancement manuel :

```powershell
py -m pip install -r requirements.txt
py server_raphael.py
```

Puis ouvrir `http://127.0.0.1:8010/index.html`.

Le jeu solo peut encore être servi comme un site statique. Le multijoueur exige `app.py`, car l'authentification, le matchmaking et les WebSockets sont exécutés côté serveur.

## Ghost Chat et multijoueur

Ghost Chat reste l'unique point de connexion. Son bouton « Jouer à Nova Flight » émet un ticket à durée de vie courte. Nova Flight l'échange contre son propre cookie sécurisé, place le pilote dans un salon limité à deux joueurs et synchronise les deux chasseurs.

La configuration des ports, du secret partagé et du reverse proxy est détaillée dans [`MULTIPLAYER_DEPLOYMENT.md`](MULTIPLAYER_DEPLOYMENT.md).

Le mode chasseur partage le pilotage, le canon, les missiles, les dégâts, la destruction et le retour en jeu. Les salons sont actuellement conservés en mémoire : le service Nova doit donc fonctionner avec un seul worker pour cette première version.

Consultez également `DEVELOPMENT_REPORT.md` pour le détail du jeu existant. Les dépendances Three.js sont incluses dans `libs/`, et le mode Wargun réutilise le modèle OBJ Chasseur afin d'éviter un fichier source de près de 200 Mo.

# Raphael — simulateur de combat aérien

Version locale du projet Raphael avec ville, vallée et combat aérien partagé.

## Pages

- `index.html` : menu public.
- `raphael2.html` : ville et jeu principal.
- `vallee.html` : vallée avec éditeur et mode vol.
- `puppet_animation_editor.html` : éditeur d'animation.

## Lancer sous Windows

Double-cliquez sur `Lancer_jeu.bat`. Le lanceur démarre le serveur local si nécessaire et ouvre directement le jeu.

Lancement manuel possible :

```powershell
py -m http.server 8000
```

Puis ouvrir `http://127.0.0.1:8000/raphael2.html`.

Le mode chasseur relie la ville à la vallée et partage le pilotage, le canon, le radar, les missiles, les dégâts et le HUD entre les deux zones. Consultez `DEVELOPMENT_REPORT.md` pour les commandes et le détail des changements.

## Publication

Le dépôt reste compatible avec GitHub Pages ou tout hébergement statique. Les dépendances Three.js des pages principales sont incluses dans `libs/`.

Le mode Wargun réutilise le modèle OBJ Chasseur afin d'éviter un fichier source de près de 200 Mo refusé par GitHub en dépôt standard.

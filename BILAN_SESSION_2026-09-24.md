# Bilan de session — 24/09/2026 — Mise en ligne automatique

## Ce qui a change

- **Fin des envois tar/scp depuis le poste.** `raphael.crea-doc.fr` est desormais le
  miroir exact de la branche `main` du depot GitHub `GhostRider093/Jeux-Raphael`.
- Workflow `.github/workflows/deploy.yml` : a chaque push sur `main`, rsync vers
  `/opt/raphael-online-site` sur le VPS 212, puis controle HTTP de `index.html`.
- Cle SSH dediee `deploy@raphael-online` (privee dans les secrets GitHub, publique
  dans `authorized_keys` du VPS). Secrets : `VPS_HOST`, `VPS_USER`, `VPS_DEPLOY_PATH`,
  `VPS_SSH_KEY`.
- `main` a rattrape `editeur-cartes-et-circuits` (40 commits) : cockpit en image,
  flotte de dix chasseurs, sensibilite reglable en vol, apercu GLB.
- Lien « retour vers la ville » de `sector-streaming.js` corrige vers
  `archive/ville/raphael2.html` : la copie a la racine du serveur etait un reste
  d'un ancien envoi, supprime par le miroir.

## Ce que le miroir protege ou ignore

- `config/` (profils de manette, classements ecrits par `app.py`) et `__pycache__/`
  ne sont jamais touches sur le serveur.
- Ne partent pas : `scripts/`, `deploy/`, `*.md`, `*.3mf`, `*.bat`, `requirements.txt`.

## Pieges rencontres

- `gh secret set -b "/opt/..."` depuis Git Bash : MSYS a converti le chemin en
  `C:/Program Files/Git/opt/...`. Passer la valeur par `stdin` (`printf ... | gh secret set`).
- Le premier push contenant le workflow n'a pas declenche de run ; lancement manuel
  (`workflow_dispatch`), puis test du declenchement par push avec ce commit.
- GitHub signale `maps/capestang/village.bin` (56 Mo) au-dessus de sa limite conseillee.
  Il passe, mais un fichier de plus de 100 Mo serait refuse : penser a Git LFS si
  une maquette grossit.

## Toujours pas fait

- Le service FastAPI (SSO Ghost Chat + multijoueur) n'est deploye nulle part ;
  `/api/health` repond 404. `deploy/README.md` decrit un VPS 57 perime.

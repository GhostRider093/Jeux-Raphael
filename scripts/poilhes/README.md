# Villages en 3D — chaîne de construction

Reconstruit un village (Hérault) à partir des seules données publiques, puis écrit tout ce
que lit `poilhes.html` dans `maps/<village>/`. Le village se choisit dans `sites.py` :

```powershell
py scripts/poilhes/build_village.py
$env:VILLAGE="capestang"; py scripts/poilhes/build_village.py
```

Et pour réunir plusieurs villages voisins dans la même carte — un **pays** — le relief qui
les relie (8 km au pas de 20 m, ~5 Mo, une dizaine de secondes) :

```powershell
$env:PAYS="canal"; py scripts/poilhes/build_pays.py
```

Environ 40 s avec le cache (`scripts/poilhes/.cache/`, non versionné) ; au premier lancement,
compter une minute de téléchargement. Dépendances : `numpy`, `scipy`, `shapely>=2.1`, `Pillow`.

## Étapes

| Module | Ce qu'il fait | Données |
| --- | --- | --- |
| `sources.py` | Téléchargements avec cache disque | Géoplateforme IGN (WFS, WMS-R), Overpass OSM |
| `geo.py` | Repère local en mètres (x est, n nord), échantillonnage des rasters | — |
| `terrain.py` | Grille 2 m (1 km) + relief lointain 20 m (6 km), fond du canal creusé | LiDAR HD MNT, RGE ALTI |
| `ground.py` | Voirie → masque asphalte / gravier / pavés, tuiles d'orthophoto, plans d'eau | BD TOPO, BD ORTHO, OSM |
| `buildings.py` | Toits (pans RANSAC → niveaux → surface LiDAR → BD TOPO), murs, débords, cheminées | BD TOPO, LiDAR HD MNS, IRC |
| `vegetation.py` | Arbres : sommets de houppier, rayon, couleur réelle | MNS − MNT, IRC (NDVI), BD ORTHO |
| `vineyards.py` | Rangs de vigne réels, parcelle par parcelle | Cadastre, BD TOPO « Vigne », BD ORTHO |
| `extras.py` | Eau, piscines, ponts, murs de soutènement, lanternes, noms de rues et de lieux | BD TOPO, OSM |
| `pack.py` | Paquet binaire unique `village.bin` + index dans `village.json` | — |
| `build_pays.py` | Le relief commun à plusieurs villages et leur place dans un repère unique | RGE ALTI, BD ORTHO, villages déjà construits |

## Réglages utiles

- Zone et centre : `sites.py` — un autre village, c'est trois nombres (longitude, latitude,
  demi-côté) ; `geo.py` et tout le reste suivent. Un pays, c'est la liste de ses villages et
  le demi-côté de son relief (`PAYS`), son centre étant le milieu des leurs.
- Débord de toit, épaisseur de rive : `OVERHANG`, `FASCIA` dans `buildings.py`.
- Espacement des lanternes : `street_lamps(spacing=…)` dans `extras.py`.

## Licences

IGN : licence ouverte Etalab 2.0. OpenStreetMap : ODbL (© contributeurs OpenStreetMap).
Les façades (fenêtres, volets, couleurs d'enduit) sont **générées** d'après le style local :
aucune donnée publique ne décrit les façades bâtiment par bâtiment. Le reste (emprises,
hauteurs, formes de toit, cheminées, arbres, vignes, relief, eau, noms) vient des mesures.

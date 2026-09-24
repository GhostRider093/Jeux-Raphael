# ==========================================================================
#  CHASSEUR ENNEMI  -  Dassault Rafale
# --------------------------------------------------------------------------
#  Source : Rafale++support_.3mf, a la racine du projet. C'est un projet
#  d'impression Bambu : l'appareil (279 000 triangles) y voisine avec un socle
#  et son mat, qui ne nous interessent pas. Deux autres fichiers Rafale
#  trainent a la racine et ne conviennent PAS :
#    - Dassault+Rafale_AMS.3mf : une plaque murale PLATE (8 mm d'epaisseur),
#      un tableau tricolore, pas un avion ;
#    - RAFALE.3mf : le meme appareil coupe en deux morceaux pour le plateau.
#
#  Etape 1 (ce script) : extraire le seul appareil, l'orienter comme le jeu
#  l'attend, le recentrer, l'ecrire en STL.
#  Etape 2 : scripts/blender-rafale.py, lance par Blender, decime, lisse,
#  peint et exporte le GLB.
#
#    python scripts/convert-rafale.py
#    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b \
#        --factory-startup --python scripts/blender-rafale.py
#
#  ORIENTATION. Dans le 3MF le nez pointe vers -Y, le derive monte vers +Z,
#  l'envergure suit X (mesure : la tranche +73..+88 ne fait que 2,6 mm de
#  large et monte a 21,8 — c'est la derive, donc la queue). Le jeu attend le
#  nez vers -Z et le haut vers +Y, comme le chasseur du joueur. On compose
#  donc Rx(-90) puis Ry(180) : (x, y, z) -> (-x, z, y). C'est une rotation
#  propre, pas un miroir — un miroir retournerait les normales.
# ==========================================================================

import pathlib
import numpy as np
import trimesh

RACINE = pathlib.Path(__file__).resolve().parent.parent
SOURCE = RACINE / 'Rafale++support_.3mf'
SORTIE = RACINE / 'assets' / 'enemies' / 'rafale' / 'rafale-brut.stl'

scene = trimesh.load(SOURCE)
# Le socle et le mat comptent quelques milliers de triangles, l'appareil
# 279 000 : le plus lourd maillage est l'avion, sans ambiguite possible.
nom, avion = max(scene.geometry.items(), key=lambda item: len(item[1].faces))
print(f'[rafale] maillage retenu : objet {nom}, {len(avion.faces)} triangles')

rotation = np.array([
    [-1., 0., 0.],
    [0., 0., 1.],
    [0., 1., 0.],
])
assert abs(np.linalg.det(rotation) - 1) < 1e-9, 'la transformation doit rester une rotation'

avion = avion.copy()
avion.vertices = np.asarray(avion.vertices) @ rotation.T
avion.vertices -= avion.bounds.mean(axis=0)
avion.fix_normals()

taille = avion.bounds[1] - avion.bounds[0]
print(f'[rafale] envergure {taille[0]:.1f} · hauteur {taille[1]:.1f} · longueur {taille[2]:.1f}')
print(f'[rafale] nez a z={avion.bounds[0][2]:.1f}, queue a z={avion.bounds[1][2]:.1f}')

SORTIE.parent.mkdir(parents=True, exist_ok=True)
avion.export(SORTIE)
print(f'[rafale] ecrit : {SORTIE.relative_to(RACINE)} ({SORTIE.stat().st_size/1e6:.1f} Mo)')

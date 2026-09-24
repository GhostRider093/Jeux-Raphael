"""Cinq gobelins d'impression 3D -> cinq GLB jouables.

Entree  : scripts/goblins/.cache/*.npz (voir parse_3mf.py)
Sortie  : assets/goblins/<nom>.glb

Chaque figurine est une coquille STL de ~220 000 triangles posee sur une plinthe
d'exposition, en millimetres, axe Y vers le haut. On enleve la plinthe, on descend
a un budget jouable, on met a l'echelle du jeu et on pose les pieds sur y = 0.
"""
import pathlib

import numpy as np
import trimesh
from fast_simplification import simplify

RACINE = pathlib.Path(__file__).resolve().parents[2]
CACHE = pathlib.Path(__file__).parent / ".cache"
SORTIE = RACINE / "assets" / "goblins"

CIBLE = 9000          # triangles gardes par gobelin
HAUTEUR = 1.55        # taille finale en metres, socle enleve


def sans_plinthe(mesh):
    """Coupe la plinthe d'exposition : le disque plat sous la figurine.

    On lit le rayon tranche par tranche depuis le bas ; la plinthe est la zone
    ou il reste proche du maximum, la roche sculptee commence quand il decroche.
    """
    v = mesh.vertices
    bas = v[:, 1].min()
    y = v[:, 1] - bas
    cx, cz = np.median(v[:, 0]), np.median(v[:, 2])
    r = np.hypot(v[:, 0] - cx, v[:, 2] - cz)
    r0 = r[y < 0.4].max()
    coupe = 0.4
    for k in np.arange(0.4, 8.0, 0.2):
        m = (y >= k) & (y < k + 0.2)
        if not m.any():
            continue
        if r[m].max() < 0.93 * r0:
            coupe = k
            break
    garde = mesh.slice_plane([0, bas + coupe, 0], [0, 1, 0], cap=True)
    return garde if garde is not None and len(garde.faces) else mesh


def construire(npz):
    d = np.load(npz)
    mesh = trimesh.Trimesh(vertices=d["v"].astype(np.float64), faces=d["f"], process=True)
    mesh.remove_unreferenced_vertices()
    brut = len(mesh.faces)
    mesh = sans_plinthe(mesh)

    ratio = max(0.0, 1.0 - CIBLE / len(mesh.faces))
    v, f = simplify(np.asarray(mesh.vertices, np.float32), np.asarray(mesh.faces, np.uint32), ratio)
    mesh = trimesh.Trimesh(vertices=v, faces=f, process=True)

    lo, hi = mesh.bounds
    k = HAUTEUR / (hi[1] - lo[1])
    mesh.apply_scale(k)
    lo, hi = mesh.bounds
    pieds = mesh.vertices[mesh.vertices[:, 1] < lo[1] + 0.12]     # centrer sur l'appui, pas sur l'arme
    mesh.apply_translation([-np.median(pieds[:, 0]), -lo[1], -np.median(pieds[:, 2])])

    mesh.visual = trimesh.visual.ColorVisuals(mesh)
    SORTIE.mkdir(parents=True, exist_ok=True)
    nom = npz.stem.replace("goblin_", "").replace("2", "")
    mesh.export(SORTIE / f"{nom}.glb")
    lo, hi = mesh.bounds
    print(f"{nom:8s} {brut:7d} -> {len(mesh.faces):6d} faces   "
          f"{hi[0]-lo[0]:.2f} x {hi[1]-lo[1]:.2f} x {hi[2]-lo[2]:.2f} m   "
          f"{(SORTIE / f'{nom}.glb').stat().st_size/1024:.0f} Ko")


if __name__ == "__main__":
    for npz in sorted(CACHE.glob("*.npz")):
        construire(npz)

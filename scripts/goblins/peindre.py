"""Peinture des gobelins : couleur cuite dans les sommets, sans texture ni UV.

Le modele vient d'un STL d'impression : ni UV, ni matiere. Plutot que d'inventer
un depliage, on peint par sommet comme on peint une figurine :

  1. zones      — peau, cuir, metal, bois, deduites de la hauteur et de l'ecart
                  a l'axe du corps (a 10 m, c'est la lecture d'ensemble qui compte) ;
  2. occlusion  — grille d'occupation floutee : les creux s'assombrissent ;
  3. brossage   — les aretes convexes s'eclaircissent, comme au pinceau sec ;
  4. grain      — bruit doux pour casser l'aplat.

Sortie : le meme GLB, avec un attribut COLOR_0. Aucun cout de rendu supplementaire.
"""
import pathlib

import numpy as np
import trimesh
from scipy.ndimage import gaussian_filter

SORTIE = pathlib.Path(__file__).resolve().parents[2] / "assets" / "goblins"
GRILLE = 96

PEAU = np.array([0.36, 0.52, 0.24])       # vert gobelin
PEAU_SOMBRE = np.array([0.20, 0.30, 0.14])
CUIR = np.array([0.29, 0.21, 0.14])
TISSU = np.array([0.20, 0.22, 0.17])
PANTALON = np.array([0.24, 0.26, 0.22])
METAL = np.array([0.44, 0.46, 0.50])
BOIS = np.array([0.33, 0.24, 0.16])


def occlusion(mesh):
    """Occlusion ambiante approchee : densite de matiere autour de chaque sommet."""
    lo, hi = mesh.bounds
    pas = (hi - lo).max() / (GRILLE - 6)
    grille = np.zeros((GRILLE, GRILLE, GRILLE), np.float32)
    ech = mesh.sample(120000)
    idx = np.clip(((ech - lo) / pas + 3).astype(int), 0, GRILLE - 1)
    np.add.at(grille, (idx[:, 0], idx[:, 1], idx[:, 2]), 1.0)
    grille = np.minimum(grille, 1.0)
    large = gaussian_filter(grille, 3.5)
    serre = gaussian_filter(grille, 1.2)
    v = np.clip(((mesh.vertices - lo) / pas + 3).astype(int), 0, GRILLE - 1)
    ao = large[v[:, 0], v[:, 1], v[:, 2]]
    creux = serre[v[:, 0], v[:, 1], v[:, 2]]
    ao = (ao - ao.min()) / max(1e-6, ao.max() - ao.min())
    creux = (creux - creux.min()) / max(1e-6, creux.max() - creux.min())
    return np.clip(1.0 - 0.85 * ao - 0.35 * creux, 0.12, 1.0)


def convexite(mesh):
    """Positif sur une arete saillante, negatif dans un pli : le pinceau sec."""
    n = mesh.vertex_normals
    voisins = mesh.vertex_neighbors
    out = np.zeros(len(mesh.vertices))
    v = mesh.vertices
    for i, vs in enumerate(voisins):
        if not len(vs):
            continue
        d = v[vs] - v[i]
        out[i] = -np.mean(d @ n[i]) / (np.mean(np.linalg.norm(d, axis=1)) + 1e-9)
    return np.clip(out * 3.0, -1, 1)


def zones(mesh):
    """peau / cuir / tissu / metal / bois.

    Deux mesures suffisent : la hauteur relative et l'ecart a l'axe du corps
    rapporte a la demi-largeur du torse. Le torse tient dans q <= 1, les bras
    pendent vers 1,2-1,6, et ce qui depasse 1,7 est tenu a bout de bras.
    """
    v = mesh.vertices
    h = v[:, 1] / v[:, 1].max()
    tranches = np.linspace(0, 1, 24)
    axe = np.zeros((24, 2))
    for k, t in enumerate(tranches):
        m = np.abs(h - t) < 0.06
        axe[k] = np.median(v[m][:, [0, 2]], axis=0) if m.sum() > 20 else axe[max(0, k - 1)]
    axe[:, 0] = np.convolve(axe[:, 0], np.ones(5) / 5, "same")
    axe[:, 1] = np.convolve(axe[:, 1], np.ones(5) / 5, "same")
    cx = np.interp(h, tranches, axe[:, 0])
    cz = np.interp(h, tranches, axe[:, 1])
    r = np.hypot(v[:, 0] - cx, v[:, 2] - cz)

    tronc = (h > 0.25) & (h < 0.70)
    largeur = max(np.percentile(r[tronc], 55), 0.05)     # demi-largeur du torse
    q = r / largeur
    # Plusieurs gobelins brandissent leur arme au-dessus de la tete : la hauteur
    # utile se mesure sur le corps, sinon la tete tombe au milieu de l'echelle.
    corps = q < 1.35
    h = h / max(np.percentile(h[corps], 99.5), 0.5)

    z = np.full(len(v), 1)                       # cuir
    z[h < 0.19] = 2                              # bottes
    z[(h >= 0.19) & (h < 0.50) & (q < 1.15)] = 5  # pantalon
    z[(h > 0.45) & (h < 0.84) & (q > 1.15) & (q < 1.75)] = 0   # bras nus
    z[(h >= 0.845) & (h < 0.965)] = 0            # visage et oreilles
    z[(h >= 0.965) & (h < 1.06)] = 3             # calotte du casque
    loin = q >= 1.75
    z[loin] = np.where(h[loin] >= 0.80, 3, 4)    # lame en haut, manche en bas
    return z, h, q


def peindre(nom):
    mesh = trimesh.load(SORTIE / f"{nom}.glb", force="mesh")
    z, h, q = zones(mesh)
    ao = occlusion(mesh)
    cv = convexite(mesh)
    rng = np.random.default_rng(7)
    grain = gaussian_filter(rng.standard_normal(len(mesh.vertices)), 0)

    base = np.zeros((len(mesh.vertices), 3))
    base[z == 0] = PEAU
    base[z == 1] = CUIR
    base[z == 2] = TISSU
    base[z == 3] = METAL
    base[z == 4] = BOIS
    base[z == 5] = PANTALON
    # la peau fonce sur le dessus du crane et s'eclaire sur les joues
    peau = z == 0
    base[peau] = PEAU_SOMBRE + (PEAU - PEAU_SOMBRE) * np.clip(1.4 - h[peau], 0.25, 1)[:, None]

    couleur = base * (0.45 + 0.55 * ao)[:, None]
    sec = np.clip(cv, 0, 1)[:, None] * (0.30 + 0.25 * (z == 3)[:, None])
    couleur = couleur * (1 - sec) + np.minimum(1.0, base * 1.9 + 0.12) * sec
    couleur *= (1 + 0.05 * grain)[:, None]

    mesh.visual = trimesh.visual.ColorVisuals(
        mesh, vertex_colors=np.clip(couleur, 0, 1))
    mesh.export(SORTIE / f"{nom}.glb")
    print(f"{nom:8s} peau {100*(z==0).mean():4.1f}%  cuir {100*(z==1).mean():4.1f}%  "
          f"sombre {100*(z==2).mean():4.1f}%  metal {100*(z==3).mean():4.1f}%  "
          f"bois {100*(z==4).mean():4.1f}%  pantalon {100*(z==5).mean():4.1f}%   {(SORTIE/f'{nom}.glb').stat().st_size/1024:.0f} Ko")


if __name__ == "__main__":
    for n in ["axe", "bow", "club", "staff", "sword"]:
        peindre(n)

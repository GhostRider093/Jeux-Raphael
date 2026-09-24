"""Arbres réels : sommets de houppiers détectés dans le LiDAR HD (MNS - MNT) et l'infrarouge IGN.

Un pixel est végétal si sa hauteur au-dessus du sol dépasse 2 m, si son indice de
végétation (NDVI, orthophoto IRC) est positif, et s'il n'est pas sur un bâtiment.
Chaque maximum local de hauteur devient un arbre ; son rayon vient de la surface
de houppier qui lui est rattachée, sa couleur de l'orthophoto.
"""
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, maximum_filter, binary_dilation
from scipy.spatial import cKDTree

from geo import HALF


def building_mask(footprints, size):
    """Masque booléen (size x size) des emprises bâties sur la zone détaillée."""
    img = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(img)
    scale = size / (2 * HALF)
    for poly, _ in footprints:
        pts = [((x + HALF) * scale, (HALF - n) * scale) for x, n in poly.exterior.coords]
        draw.polygon(pts, fill=1)
    return np.array(img, dtype=bool)


def detect_trees(mns, mnt, irc, ortho, footprints, water_mask, terrain):
    size = mns.shape[0]
    px = 2 * HALF / size
    chm = np.nan_to_num(mns - mnt, nan=0.0)
    chm = np.clip(chm, 0, 40)

    irc = irc.astype(np.float32)
    nir, red = irc[..., 0], irc[..., 1]
    ndvi = (nir - red) / (nir + red + 1e-3)

    built = binary_dilation(building_mask(footprints, size), iterations=2)
    veg = (chm > 2.0) & (ndvi > 0.08) & ~built & ~water_mask
    smooth = gaussian_filter(np.where(veg, chm, 0), 1.2)

    peaks = (maximum_filter(smooth, size=7) == smooth) & veg & (smooth > 2.6)
    rows, cols = np.nonzero(peaks)
    heights = chm[rows, cols]
    order = np.argsort(-heights)
    rows, cols, heights = rows[order], cols[order], heights[order]

    # suppression des sommets trop proches d'un arbre plus grand
    xs = -HALF + (cols + 0.5) * px
    ns = HALF - (rows + 0.5) * px
    keep = np.ones(len(xs), bool)
    tree = cKDTree(np.c_[xs, ns])
    for k in range(len(xs)):
        if not keep[k]:
            continue
        radius = float(np.clip(0.22 * heights[k], 1.4, 4.5))
        for j in tree.query_ball_point((xs[k], ns[k]), radius):
            if j > k:
                keep[j] = False
    xs, ns, heights, rows, cols = xs[keep], ns[keep], heights[keep], rows[keep], cols[keep]

    # rayon du houppier : pixels végétaux rattachés au sommet le plus proche
    vr, vc = np.nonzero(veg)
    vx = -HALF + (vc + 0.5) * px
    vn = HALF - (vr + 0.5) * px
    kd = cKDTree(np.c_[xs, ns])
    dist, owner = kd.query(np.c_[vx, vn], distance_upper_bound=9.0)
    ok = np.isfinite(dist)
    counts = np.bincount(owner[ok], minlength=len(xs))
    radius = np.sqrt(counts * px * px / np.pi)
    radius = np.clip(radius, 0.9, np.maximum(1.2, heights * 0.75))

    # couleur moyenne du houppier sur l'orthophoto
    o = ortho.astype(np.float32)
    colors = []
    for r, c in zip(rows, cols):
        patch = o[max(r - 2, 0):r + 3, max(c - 2, 0):c + 3].reshape(-1, 3)
        colors.append(patch.mean(0))
    colors = np.clip(np.array(colors), 0, 255).astype(np.uint8) if colors else np.zeros((0, 3), np.uint8)

    ground = terrain.at(xs, ns)
    return {
        "x": xs.astype(np.float32), "n": ns.astype(np.float32), "sol": ground.astype(np.float32),
        "h": heights.astype(np.float32), "r": radius.astype(np.float32), "rgb": colors,
    }

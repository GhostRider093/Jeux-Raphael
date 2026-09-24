"""Terrain : grille LiDAR HD (MNT) de la zone détaillée et relief lointain RGE ALTI."""
import numpy as np
import shapely
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates

from geo import HALF, FAR_HALF, Raster

STEP = 2.0                        # pas de la grille détaillée (m)
N = int(2 * HALF / STEP) + 1      # 501 sommets par côté
FAR_STEP = 20.0
FAR_N = int(2 * FAR_HALF / FAR_STEP) + 1


def fill_nan(a):
    """Remplace les trous (NaN) par la valeur valide la plus proche."""
    bad = np.isnan(a)
    if not bad.any():
        return a
    idx = distance_transform_edt(bad, return_distances=False, return_indices=True)
    return a[tuple(idx)]


class Terrain:
    """Grille régulière : sommet (i, j) en x = -HALF + i*STEP, nord = HALF - j*STEP."""

    def __init__(self, mnt):
        smooth = gaussian_filter(fill_nan(mnt), 1.0)
        self.src = Raster(smooth, HALF)
        coords = -HALF + np.arange(N) * STEP
        xs, ns = np.meshgrid(coords, coords[::-1])
        self.h = self.src.sample(xs.ravel(), ns.ravel()).reshape(N, N).astype(np.float32)

    def at(self, x, n):
        """Altitude (bilinéaire sur la grille rendue) en coordonnées locales."""
        col = (np.asarray(x, dtype=np.float64) + HALF) / STEP
        row = (HALF - np.asarray(n, dtype=np.float64)) / STEP
        out = map_coordinates(self.h, [np.atleast_1d(row), np.atleast_1d(col)], order=1, mode="nearest")
        return out if np.ndim(x) else float(out[0])

    def flatten_roads(self, road_polys, radius=3.0):
        """Aplanit le terrain sous la chaussée : une route ne gondole pas tous les 2 m.

        On mélange vers une version lissée du relief, proportionnellement à la présence
        de voirie, en élargissant un peu pour raccorder les accotements sans marche.
        """
        coords = -HALF + np.arange(N) * STEP
        xs, ns = np.meshgrid(coords, coords[::-1])
        cover = np.zeros((N, N), np.float32)
        for poly in road_polys:
            if poly.is_empty:
                continue
            inside = shapely.contains_xy(poly.buffer(radius), xs, ns)
            cover[inside] = np.maximum(cover[inside], 0.55)
            inside = shapely.contains_xy(poly, xs, ns)
            cover[inside] = 1.0
        smooth = gaussian_filter(self.h, 1.6)
        self.h = (self.h * (1 - cover) + smooth * cover).astype(np.float32)

    def carve_water(self, water_polys, depth=1.6):
        """Creuse le fond sous les plans d'eau pour donner de la profondeur."""
        coords = -HALF + np.arange(N) * STEP
        xs, ns = np.meshgrid(coords, coords[::-1])
        for poly, level in water_polys:
            inner = poly.buffer(-1.2)
            if inner.is_empty:
                continue
            inside = shapely.contains_xy(inner, xs, ns)
            self.h[inside] = np.minimum(self.h[inside], level - depth)


def far_terrain(far_raw, terrain):
    """Relief lointain à 20 m. La zone détaillée y est abaissée pour ne jamais la traverser."""
    a = fill_nan(far_raw)
    src = Raster(a, FAR_HALF)
    coords = -FAR_HALF + np.arange(FAR_N) * FAR_STEP
    xs, ns = np.meshgrid(coords, coords[::-1])
    h = src.sample(xs.ravel(), ns.ravel()).reshape(FAR_N, FAR_N)
    inside = (np.abs(xs) < HALF - 1) & (np.abs(ns) < HALF - 1)
    edge = (np.abs(xs) <= HALF + 1) & (np.abs(ns) <= HALF + 1) & ~inside
    h[edge] = terrain.at(np.clip(xs[edge], -HALF, HALF), np.clip(ns[edge], -HALF, HALF))
    h[inside] -= 6.0
    return h.astype(np.float32)

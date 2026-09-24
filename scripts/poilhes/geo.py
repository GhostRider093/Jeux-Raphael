"""Repère local du village courant et échantillonnage de rasters géoréférencés.

Repère : x = est (m), n = nord (m), origine au centre de la zone.
Dans Three.js : X = x, Y = altitude - ALT_BASE, Z = -n.
"""
import math

import numpy as np
from scipy.ndimage import map_coordinates

# Centre du village et demi-côté de la zone détaillée : voir sites.py, qui tient
# la liste des villages reconstructibles (VILLAGE=capestang pour changer).
from sites import SITE, NOM as VILLAGE  # noqa: E402

LON0 = SITE["lon"]
LAT0 = SITE["lat"]
HALF = SITE["half"]        # zone détaillée : 2*HALF de côté
FAR_HALF = SITE["far"]     # relief lointain : 6 km x 6 km

M_LAT = 111132.95 - 559.82 * math.cos(2 * math.radians(LAT0))
M_LON = 111412.84 * math.cos(math.radians(LAT0))


def to_local(lon, lat):
    return (lon - LON0) * M_LON, (lat - LAT0) * M_LAT


def to_geo(x, n):
    return LON0 + x / M_LON, LAT0 + n / M_LAT


def bbox_geo(half):
    """Emprise (lon_min, lat_min, lon_max, lat_max) d'un carré centré de demi-côté `half` mètres."""
    lon_a, lat_a = to_geo(-half, -half)
    lon_b, lat_b = to_geo(half, half)
    return lon_a, lat_a, lon_b, lat_b


class Raster:
    """Raster carré couvrant [-half, half]² en mètres locaux, ligne 0 au nord."""

    def __init__(self, data, half):
        self.a = np.asarray(data, dtype=np.float32)
        self.half = half
        self.h, self.w = self.a.shape[:2]
        self.px = 2 * half / self.w  # taille d'un pixel en mètres

    def to_pixel(self, x, n):
        col = (np.asarray(x) + self.half) / self.px - 0.5
        row = (self.half - np.asarray(n)) / self.px - 0.5
        return col, row

    def sample(self, x, n, order=1):
        col, row = self.to_pixel(x, n)
        return map_coordinates(self.a, [np.atleast_1d(row), np.atleast_1d(col)], order=order, mode="nearest")

    def centers(self):
        """Coordonnées locales (x, n) des centres de pixels."""
        xs = -self.half + (np.arange(self.w) + 0.5) * self.px
        ns = self.half - (np.arange(self.h) + 0.5) * self.px
        return np.meshgrid(xs, ns)

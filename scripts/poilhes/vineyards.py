"""Vignes : rangs réels, parcelle par parcelle.

Les zones « Vigne » de la BD TOPO sont découpées par les parcelles cadastrales. Dans
chaque parcelle, la photo aérienne montre les rangs (ceps sombres, inter-rangs clairs) :
leur orientation vient du tenseur de structure de l'image, leur écartement et leur
position (phase) d'une analyse de Fourier du signal perpendiculaire aux rangs. Une parcelle sans rangs nets
(friche, jeune plantation arrachée) est laissée nue.
"""
import math

import numpy as np
import shapely
from scipy.ndimage import gaussian_filter, sobel
from shapely.geometry import LineString, box
from shapely.ops import unary_union

from geo import HALF
from ground import local_polygons

SEGMENT = 14.0      # longueur maximale d'un tronçon de rang (suit le relief)


def vine_rows(parcel_feats, vigne_feats, lum, terrain):
    """Retourne un tableau (N, 6) de tronçons de rangs : x0, y0, z0, x1, y1, z1 (repère Three.js)."""
    size = lum.shape[0]
    px = 2 * HALF / size
    zone = box(-HALF + 2, -HALF + 2, HALF - 2, HALF - 2)
    vigne = unary_union([p for f in vigne_feats if f["properties"].get("nature") == "Vigne"
                         for p in local_polygons(f["geometry"])]).intersection(zone)
    smooth = gaussian_filter(lum, 0.6)
    g_col = sobel(smooth, axis=1)
    g_row = sobel(smooth, axis=0)
    rows_out = []
    stats = {"parcelles": 0, "rangs": 0}
    for f in parcel_feats:
        for parcel in local_polygons(f["geometry"]):
            field = parcel.intersection(vigne)
            if field.area < 250:
                continue
            inner = field.buffer(-1.2)
            if inner.is_empty:
                continue
            minx, minn, maxx, maxn = inner.bounds
            c0, c1 = max(int((minx + HALF) / px), 0), min(int((maxx + HALF) / px) + 1, size - 1)
            r0, r1 = max(int((HALF - maxn) / px), 0), min(int((HALF - minn) / px) + 1, size - 1)
            cols, rws = np.meshgrid(np.arange(c0, c1), np.arange(r0, r1))
            xs = -HALF + (cols + 0.5) * px
            ns = HALF - (rws + 0.5) * px
            sel = shapely.contains_xy(inner, xs, ns)
            if sel.sum() < 150:
                continue
            xs, ns = xs[sel], ns[sel]
            sig = smooth[rws[sel], cols[sel]]
            gx = g_col[rws[sel], cols[sel]]
            gn = -g_row[rws[sel], cols[sel]]           # les lignes d'image descendent vers le sud
            jxx, jnn, jxn = (gx * gx).sum(), (gn * gn).sum(), (gx * gn).sum()
            coherence = math.hypot(jxx - jnn, 2 * jxn) / (jxx + jnn + 1e-9)
            if coherence < 0.7:
                continue
            theta = 0.5 * math.atan2(2 * jxn, jxx - jnn)   # direction du gradient = normale aux rangs
            nv = np.array([math.cos(theta), math.sin(theta)])
            s = xs * nv[0] + ns * nv[1]
            sig = sig - sig.mean()
            best = (0.0, 2.2, 0.0)
            for T in np.arange(1.6, 3.3, 0.02):
                w = 2 * math.pi / T
                z = (sig * np.exp(-1j * w * s)).sum()
                a = abs(z)
                if a > best[0]:
                    best = (a, T, math.atan2(z.imag, z.real))
            amp, T, phi = best
            rel = 2 * amp / len(sig) / (sig.std() + 1e-9)
            if rel < 0.08:
                continue
            # maxima de luminosité = inter-rangs ; les ceps sont une demi-période plus loin
            s0 = -phi / (2 * math.pi / T) + T / 2
            tv = np.array([-nv[1], nv[0]])               # direction des rangs
            smin, smax = s.min(), s.max()
            k0 = math.ceil((smin - s0) / T)
            c = np.array(inner.centroid.coords[0])
            c_s = c @ nv
            span = max(maxx - minx, maxn - minn) * 1.5
            stats["parcelles"] += 1
            for k in range(k0, int((smax - s0) / T) + 1):
                sk = s0 + k * T
                base = c + nv * (sk - c_s)
                line = LineString([base - tv * span, base + tv * span]).intersection(inner)
                for seg in getattr(line, "geoms", [line]):
                    if seg.geom_type != "LineString" or seg.length < 3:
                        continue
                    n_parts = max(1, math.ceil(seg.length / SEGMENT))
                    for q in range(n_parts):
                        a = seg.interpolate(q / n_parts, normalized=True)
                        b = seg.interpolate((q + 1) / n_parts, normalized=True)
                        ya, yb = terrain.at(a.x, a.y), terrain.at(b.x, b.y)
                        rows_out.append((a.x, ya, -a.y, b.x, yb, -b.y))
                    stats["rangs"] += 1
    return np.array(rows_out, np.float32).reshape(-1, 6), stats

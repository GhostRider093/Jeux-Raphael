"""Bâtiments : emprises BD TOPO, toits reconstruits depuis le LiDAR HD (MNS), façades paramétrées.

Toits, par ordre de préférence :
1. « pans »    : les pans (plans) trouvés par RANSAC dans le nuage LiDAR expliquent la
                 surface comme leur minimum (deux pans, croupe, appentis, terrasse) :
                 intersection exacte, faîtages et arêtiers nets.
2. « niveaux » : chaque point LiDAR est rattaché à son pan ; les régions obtenues sont
                 polygonisées et raccordées par des marches verticales (toits en L,
                 maisons de village à plusieurs hauteurs).
3. « lidar »   : maillage direct de la surface LiDAR lissée (formes atypiques).
4. « bdtopo »  : pas de LiDAR exploitable (maison construite après le relevé) :
                 deux pans d'après les hauteurs BD TOPO.

Le toit déborde de 30 cm hors mitoyenneté et porte une rive de 16 cm d'épaisseur.
Les murs montent de sous le sol jusqu'à la sous-face exacte du toit (pignons compris),
et chaque sommet porte ce dont le shader de façade a besoin (fenêtres, volets, portes,
génoise) sans aucune texture.
"""
import math

import numpy as np
import shapely
from scipy.ndimage import distance_transform_edt, gaussian_filter, label, map_coordinates, uniform_filter
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.strtree import STRtree

from geo import HALF
from ground import local_polygons

RNG = np.random.default_rng(34310)

# Styles de façade (lus par le shader)
STUCCO, RUBBLE, ASHLAR, INDUSTRIAL, ANNEX, MODERN = range(6)
# Types de surface de toit (lus par le shader)
TILE, TERRACE, METAL, EDGE, STEP = range(5)
# Drapeaux de mur
SHARED, STREET = 1, 2

OVERHANG = 0.30     # débord de toit (m)
FASCIA = 0.16       # épaisseur de la rive (m)


# ----------------------------------------------------------------------------- outils

def _plane_eval(pl, x, n):
    return pl[0] * x + pl[1] * n + pl[2]


def _halfplane(A, B, C, extent=5000.0):
    """Polygone {A x + B n + C <= 0} borné par un grand carré."""
    sq = [(-extent, -extent), (extent, -extent), (extent, extent), (-extent, extent)]
    out = []
    for k in range(4):
        p, q = sq[k], sq[(k + 1) % 4]
        fp, fq = A * p[0] + B * p[1] + C, A * q[0] + B * q[1] + C
        if fp <= 0:
            out.append(p)
        if (fp < 0) != (fq < 0) and fp != fq:
            t = fp / (fp - fq)
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return Polygon(out) if len(out) >= 3 else Polygon()


def _polys(geom):
    """Polygones non vides d'une géométrie quelconque."""
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom] if geom.area > 1e-4 else []
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon) and g.area > 1e-4]


def _triangulate(poly):
    """Triangles (liste de 3 points (x, n)) d'un polygone ou multipolygone."""
    tris = []
    for g in _polys(poly):
        for t in shapely.constrained_delaunay_triangles(g).geoms:
            tris.append(list(t.exterior.coords)[:3])
    return tris


def _insert_points(ring, pts):
    """Insère dans l'anneau les points `pts` (N, 2) situés sur ses segments."""
    out = []
    for k in range(len(ring) - 1):
        p, q = np.array(ring[k]), np.array(ring[k + 1])
        d = q - p
        L2 = float(d @ d)
        out.append(tuple(p))
        if L2 < 1e-10 or not len(pts):
            continue
        t = ((pts - p) @ d) / L2
        proj = p + t[:, None] * d
        dist = np.hypot(*(pts - proj).T)
        on = (t > 1e-4) & (t < 1 - 1e-4) & (dist < 2e-3)
        for tt in np.unique(np.round(t[on], 6)):
            out.append(tuple(p + tt * d))
    out.append(tuple(ring[-1]))
    return out


def _espacer(pts, mini):
    """Retire les points trop rapprochés d'un contour, en gardant les extrémités.

    La rive suit le bord du toit, et les contours de régions issus du LiDAR sont
    en escalier au demi-mètre : insérés tels quels, ils faisaient de la rive 43 %
    de tous les sommets de toit du village. À 35 cm près, l'œil ne voit rien,
    et le fichier fond de moitié.
    """
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    for q in pts[1:-1]:
        p0 = out[-1]
        if (q[0] - p0[0]) ** 2 + (q[1] - p0[1]) ** 2 >= mini * mini:
            out.append(q)
    out.append(pts[-1])
    return out


def _densify(pts, step):
    out = []
    for k in range(len(pts) - 1):
        p, q = np.array(pts[k]), np.array(pts[k + 1])
        L = np.hypot(*(q - p))
        m = max(1, int(L // step))
        for s in range(m):
            out.append(tuple(p + (q - p) * s / m))
    out.append(tuple(pts[-1]))
    return out


# ----------------------------------------------------------------------------- toits

def _planes_ransac(P, max_planes=8, thr=0.13, iters=300):
    """Détecte jusqu'à `max_planes` plans z = a x + b n + c dans le nuage P (m, 3)."""
    m = len(P)
    remaining = np.ones(m, bool)
    planes = []
    min_support = max(5, int(0.04 * m))
    for _ in range(max_planes):
        idx = np.flatnonzero(remaining)
        if len(idx) < min_support:
            break
        tri = idx[RNG.integers(0, len(idx), size=(iters, 3))]
        A, B, C = P[tri[:, 0]], P[tri[:, 1]], P[tri[:, 2]]
        nrm = np.cross(B - A, C - A)
        ok = np.abs(nrm[:, 2]) > 1e-6
        nrm, A = nrm[ok], A[ok]
        if not len(nrm):
            break
        a = -nrm[:, 0] / nrm[:, 2]
        b = -nrm[:, 1] / nrm[:, 2]
        c = A[:, 2] - a * A[:, 0] - b * A[:, 1]
        steep = np.hypot(a, b) < 2.2           # pentes > 65° : pas un toit
        a, b, c = a[steep], b[steep], c[steep]
        if not len(a):
            break
        Q = P[idx]
        res = np.abs(Q[:, 2][None, :] - (a[:, None] * Q[:, 0][None, :] + b[:, None] * Q[:, 1][None, :] + c[:, None]))
        counts = (res < thr).sum(1)
        best = int(np.argmax(counts))
        if counts[best] < min_support:
            break
        inl = idx[res[best] < thr]
        abc = None
        for _ in range(3):  # affinage aux moindres carrés
            M = np.c_[P[inl, 0], P[inl, 1], np.ones(len(inl))]
            abc, *_ = np.linalg.lstsq(M, P[inl, 2], rcond=None)
            r = np.abs(P[idx, 2] - (abc[0] * P[idx, 0] + abc[1] * P[idx, 1] + abc[2]))
            inl = idx[r < thr]
            if len(inl) < 3:
                break
        if abc is None or len(inl) < min_support:
            break
        planes.append(tuple(abc))
        r_all = np.abs(P[:, 2] - (abc[0] * P[:, 0] + abc[1] * P[:, 1] + abc[2]))
        remaining &= r_all > thr * 1.6
    return planes


class Roof:
    """Toit : régions planes (polygone, plan) ou surface libre (polygone, None) + fonction h."""

    def __init__(self, regions, method, height_fn=None, steps=()):
        self.regions = regions
        self.method = method
        self.steps = list(steps)
        self._h = height_fn
        # Altitude plancher : l'égout. Les pans ajustés sur le LiDAR peuvent
        # plonger sous la gouttière quand le nuage de points déborde sur le sol
        # ou sur un arbre voisin — et l'on voyait alors des toits qui descendent
        # jusqu'à terre. Un toit ne passe pas sous son propre égout.
        self.plancher = None

    def h(self, x, n):
        """Hauteur du toit ; aux limites entre régions, la plus haute (fermeture des marches)."""
        x = np.atleast_1d(np.asarray(x, float))
        n = np.atleast_1d(np.asarray(n, float))
        if self._h is not None:
            out = np.asarray(self._h(x, n), float)
            return out if self.plancher is None else np.maximum(out, self.plancher)
        out = np.full(x.shape, -np.inf)
        for reg, pl in self.regions:
            inside = shapely.intersects_xy(reg, x, n)
            if inside.any():
                out[inside] = np.maximum(out[inside], _plane_eval(pl, x[inside], n[inside]))
        miss = ~np.isfinite(out)
        for k in np.flatnonzero(miss):
            pt = Point(x[k], n[k])
            reg, pl = min(self.regions, key=lambda r: r[0].distance(pt))
            out[k] = _plane_eval(pl, x[k], n[k])
        if self.plancher is not None:
            np.maximum(out, self.plancher, out=out)
        return out

    def plane_at(self, x, n):
        """Plan de la région qui porte le point (x, n) ; None pour une surface libre."""
        pt = Point(x, n)
        best, dist = None, 1e9
        for reg, pl in self.regions:
            if pl is None:
                return None
            d = reg.distance(pt)
            if d < dist:
                best, dist = pl, d
            if d == 0 and reg.contains(pt):
                return pl
        return best

    def boundaries(self):
        return shapely.union_all([r.boundary for r, _ in self.regions]) if self.regions else None


def roof_envelope(roof_poly, planes):
    """Toit convexe : minimum des pans, découpé en régions exactes."""
    P = np.array(planes)

    def h(x, n):
        return np.min(P[:, 0][:, None] * x[None] + P[:, 1][:, None] * n[None] + P[:, 2][:, None], 0)

    regions = []
    for i, pl in enumerate(planes):
        region = roof_poly
        for j, pl2 in enumerate(planes):
            if i == j:
                continue
            region = region.intersection(_halfplane(pl[0] - pl2[0], pl[1] - pl2[1], pl[2] - pl2[2]))
            if region.is_empty:
                break
        for g in _polys(region):
            regions.append((g, pl))
    return Roof(regions, "pans", height_fn=h)


def roof_levels(roof_poly, xs, ns, zs, planes, px):
    """Toit à plusieurs pans et niveaux : rattachement de chaque point à son pan."""
    Pm = np.array(planes)
    pred = Pm[:, 0][:, None] * xs[None] + Pm[:, 1][:, None] * ns[None] + Pm[:, 2][:, None]
    res = np.abs(zs[None] - pred)
    best = res.min(0)
    if np.median(best) > 0.2 or np.percentile(best, 85) > 0.5:
        return None
    lab = res.argmin(0)
    ok = best < 0.35

    # raster local aligné sur les pixels LiDAR, élargi à l'emprise du toit (débord compris)
    minx, minn, maxx, maxn = roof_poly.bounds
    x0 = xs.min() - math.ceil((xs.min() - minx) / px + 2) * px
    n0 = ns.max() + math.ceil((maxn - ns.max()) / px + 2) * px
    w = int(math.ceil((maxx - x0) / px)) + 3
    hgt = int(math.ceil((n0 - minn) / px)) + 3
    grid = np.full((hgt, w), -1, np.int32)
    ci = np.round((xs - x0) / px).astype(int)
    ri = np.round((n0 - ns) / px).astype(int)
    grid[ri[ok], ci[ok]] = lab[ok]
    if (grid >= 0).sum() == 0:
        return None
    idx = distance_transform_edt(grid < 0, return_distances=False, return_indices=True)
    grid = grid[tuple(idx)]
    k = len(planes)
    votes = np.stack([uniform_filter((grid == i).astype(np.float32), 3) for i in range(k)])
    grid = votes.argmax(0)

    def label_at(x, n):
        c = np.clip(np.round((np.asarray(x) - x0) / px).astype(int), 0, w - 1)
        r = np.clip(np.round((n0 - np.asarray(n)) / px).astype(int), 0, hgt - 1)
        return grid[r, c]

    # polygonisation : union des cellules de chaque pan, simplifiée
    raw = []
    for i in range(k):
        rr, cc = np.nonzero(grid == i)
        if not len(rr):
            continue
        cells = [box(x0 + c * px - px / 2, n0 - r * px - px / 2, x0 + c * px + px / 2, n0 - r * px + px / 2)
                 for r, c in zip(rr, cc)]
        # Simplification plus franche : les contours de pans issus du LiDAR sont
        # en escalier au demi-mètre, et chaque marche coûte des sommets partout —
        # dans le pan, puis une deuxième fois dans la rive qui le borde.
        g = shapely.union_all(cells).simplify(px * 1.4).buffer(0)
        g = g.intersection(roof_poly)
        if not g.is_empty:
            raw.append((i, g))
    raw.sort(key=lambda t: -t[1].area)
    covered = Polygon()
    parts = {}
    for i, g in raw:
        g = g.difference(covered)
        if g.is_empty:
            continue
        covered = covered.union(g)
        parts[i] = parts.get(i, Polygon()).union(g)
    for piece in _polys(roof_poly.difference(covered)):          # trous laissés par la simplification
        rp = piece.representative_point()
        i = int(label_at(rp.x, rp.y))
        parts[i] = parts.get(i, Polygon()).union(piece)
    regions = [(g, planes[i]) for i, geom in parts.items() for g in _polys(geom.buffer(0))]
    if not regions:
        return None

    # marches verticales entre régions voisines de hauteurs différentes
    steps = []
    for a in range(len(regions)):
        for b in range(a + 1, len(regions)):
            ga, pa = regions[a]
            gb, pb = regions[b]
            if pa is pb or not ga.buffer(0.01).intersects(gb):
                continue
            shared = ga.boundary.intersection(gb.boundary)
            for line in getattr(shared, "geoms", [shared]):
                if line.geom_type != "LineString" or line.length < 0.05:
                    continue
                cs = np.array(line.coords)
                for s in range(len(cs) - 1):
                    p, q = cs[s], cs[s + 1]
                    ha = _plane_eval(pa, np.array([p[0], q[0]]), np.array([p[1], q[1]]))
                    hb = _plane_eval(pb, np.array([p[0], q[0]]), np.array([p[1], q[1]]))
                    lo, hi = np.minimum(ha, hb), np.maximum(ha, hb)
                    if (hi - lo).max() > 0.04:
                        steps.append((p, q, lo, hi))
    return Roof(regions, "niveaux", steps=steps)


def roof_grid(roof_poly, xs, ns, zs, px):
    """Maillage direct de la surface LiDAR (lissée) à 1 m, découpé sur l'emprise exacte."""
    minx, minn, maxx, maxn = roof_poly.bounds
    x0 = xs.min() - math.ceil((xs.min() - minx) / px + 2) * px
    n0 = ns.max() + math.ceil((maxn - ns.max()) / px + 2) * px
    w = int(math.ceil((maxx - x0) / px)) + 3
    hgt = int(math.ceil((n0 - minn) / px)) + 3
    grid = np.full((hgt, w), np.nan, np.float32)
    grid[np.round((n0 - ns) / px).astype(int), np.round((xs - x0) / px).astype(int)] = zs
    idx = distance_transform_edt(np.isnan(grid), return_distances=False, return_indices=True)
    grid = gaussian_filter(grid[tuple(idx)], 1.1)

    def h(x, n):
        return map_coordinates(grid, [(n0 - n) / px, (x - x0) / px], order=1, mode="nearest")

    roof = Roof([(roof_poly, None)], "lidar", height_fn=h)
    cell = 1.0
    cells = [box(x, n, x + cell, n + cell) for x in np.arange(minx, maxx, cell) for n in np.arange(minn, maxn, cell)]
    roof.cells = [pc for pc in shapely.intersection(np.array(cells, dtype=object), roof_poly) if not pc.is_empty]
    return roof


def roof_synthetic(roof_poly, poly, eave, ridge):
    """Toit à deux pans sur l'axe long du rectangle englobant minimal (hauteurs BD TOPO)."""
    mrr = poly.minimum_rotated_rectangle
    rect = list(mrr.exterior.coords)[:4]
    e0 = np.subtract(rect[1], rect[0])
    e1 = np.subtract(rect[2], rect[1])
    long_e, short_e = (e0, e1) if np.hypot(*e0) >= np.hypot(*e1) else (e1, e0)
    half = max(np.hypot(*short_e) / 2, 0.5)
    u = long_e / np.hypot(*long_e)
    c = mrr.centroid
    slope = min((ridge - eave) / half, 0.6)
    nx, nn = -u[1], u[0]
    k = nx * c.x + nn * c.y
    p1 = (-slope * nx, -slope * nn, ridge + slope * k)
    p2 = (slope * nx, slope * nn, ridge - slope * k)
    roof = roof_envelope(roof_poly, [p1, p2])
    roof.method = "bdtopo"
    return roof


def build_roof(poly, roof_poly, mns, ground_ref, props):
    """Choisit la meilleure reconstruction de toit pour une emprise."""
    eave_bd, ridge_bd = props["eave"], props["ridge"]
    if props.get("simple"):
        return roof_synthetic(roof_poly, poly, eave_bd, max(ridge_bd or 0, eave_bd + 2.2))
    inner = poly.buffer(-0.35)
    if inner.is_empty or inner.area < 2:
        inner = poly
    minx, minn, maxx, maxn = inner.bounds
    c0, r0 = mns.to_pixel(minx, maxn)
    c1, r1 = mns.to_pixel(maxx, minn)
    c0, r0 = max(int(c0) - 1, 0), max(int(r0) - 1, 0)
    c1, r1 = min(int(c1) + 2, mns.w - 1), min(int(r1) + 2, mns.h - 1)
    cols, rows = np.meshgrid(np.arange(c0, c1 + 1), np.arange(r0, r1 + 1))
    xs = -HALF + (cols + 0.5) * mns.px
    ns = HALF - (rows + 0.5) * mns.px
    sel = shapely.contains_xy(inner, xs, ns)
    xs, ns, zs = xs[sel], ns[sel], mns.a[rows[sel], cols[sel]]

    usable = zs.size >= 8 and np.median(zs - ground_ref) > 1.9
    if not usable:
        return roof_synthetic(roof_poly, poly, eave_bd, max(ridge_bd or 0, eave_bd + 0.9))
    if ridge_bd is not None:
        zs = np.minimum(zs, ridge_bd + 0.9)       # branches d'arbres au-dessus du toit

    planes = _planes_ransac(np.c_[xs, ns, zs])
    if planes:
        Pm = np.array(planes)
        env = np.min(Pm[:, 0][:, None] * xs[None] + Pm[:, 1][:, None] * ns[None] + Pm[:, 2][:, None], 0)
        err = np.abs(zs - env)
        corners = np.array(poly.exterior.coords)
        env_c = np.min(Pm[:, 0][:, None] * corners[:, 0][None] + Pm[:, 1][:, None] * corners[:, 1][None]
                       + Pm[:, 2][:, None], 0)
        sane = env_c.min() > ground_ref + 1.6 and env_c.max() < zs.max() + 1.5
        if np.median(err) < 0.18 and np.percentile(err, 85) < 0.45 and sane:
            return roof_envelope(roof_poly, planes)
        levels = roof_levels(roof_poly, xs, ns, zs, planes, mns.px)
        if levels is not None:
            hb = levels.h(corners[:, 0], corners[:, 1])
            if hb.min() > ground_ref + 1.6:
                return levels
    return roof_grid(roof_poly, xs, ns, zs, mns.px)


def detect_chimneys(poly, roof, mns, ndvi, axis):
    """Cheminées réelles : petites bosses du LiDAR au-dessus du pan (0,5 à 3,5 m), non végétales.

    Retourne une liste (x, n, base, sommet, largeur, profondeur, angle).
    """
    inner = poly.buffer(-0.4)
    if inner.is_empty or roof.method == "bdtopo":
        return []
    minx, minn, maxx, maxn = inner.bounds
    c0, r0 = mns.to_pixel(minx, maxn)
    c1, r1 = mns.to_pixel(maxx, minn)
    c0, r0 = max(int(c0) - 1, 0), max(int(r0) - 1, 0)
    c1, r1 = min(int(c1) + 2, mns.w - 1), min(int(r1) + 2, mns.h - 1)
    cols, rows = np.meshgrid(np.arange(c0, c1 + 1), np.arange(r0, r1 + 1))
    xs = -HALF + (cols + 0.5) * mns.px
    ns = HALF - (rows + 0.5) * mns.px
    inside = shapely.contains_xy(inner, xs, ns)
    if inside.sum() < 8:
        return []
    z = mns.a[rows, cols]
    base = np.full(z.shape, np.nan)
    base[inside] = roof.h(xs[inside], ns[inside])
    resid = z - base
    green = ndvi[rows, cols] > 0.12
    cand = inside & ~green & (resid > 0.5) & (resid < 3.5)
    lab, count = label(cand)
    out = []
    for k in range(1, count + 1):
        m = lab == k
        npx = int(m.sum())
        if npx < 1 or npx > 8:          # au-delà : lucarne, étage, arbre
            continue
        x, n = float(xs[m].mean()), float(ns[m].mean())
        top = float(z[m].max())
        foot = float(roof.h(np.array([x]), np.array([n]))[0])
        side = max(0.42, min(0.9, math.sqrt(npx) * 0.5 * 0.85))
        out.append((x, n, foot - 0.4, top, side, side * 0.8, axis))
    return out[:4]


# ----------------------------------------------------------------------------- géométrie

class BuildingSet:
    """Accumule la géométrie de tous les bâtiments dans des tableaux plats."""

    def __init__(self):
        self.wall_pos, self.wall_fac, self.wall_info = [], [], []
        self.roof_pos, self.roof_uv, self.roof_tint = [], [], []
        self.meta = []
        self.chimneys = []
        self.stats = {"pans": 0, "niveaux": 0, "lidar": 0, "bdtopo": 0}

    # -- murs ---------------------------------------------------------------
    def add_walls(self, poly, roof, terrain, bottom, seed, style, shared_geom, street_geom):
        """Murs par « façades » : les côtés presque alignés sont regroupés pour que les
        travées de fenêtres se répartissent sur toute la façade, pas sur chaque segment."""
        bounds = roof.boundaries()
        step = 0.5 if roof.method == "lidar" else 3.0
        rings = [poly.exterior] + list(poly.interiors)
        for ri, ring in enumerate(rings):
            coords = list(ring.coords)
            # extérieur anti-horaire, cours intérieures horaires : la normale extérieure est à droite
            if (ri == 0) != shapely.LinearRing(coords).is_ccw:
                coords = coords[::-1]
            edges = []
            for k in range(len(coords) - 1):
                p, q = np.array(coords[k]), np.array(coords[k + 1])
                L = float(np.hypot(*(q - p)))
                if L >= 0.05:
                    edges.append((p, q, L))
            if not edges:
                continue
            # regroupement des côtés dont la direction dévie de moins de 12° de celle de la façade
            runs, cur = [], [edges[0]]
            for e in edges[1:]:
                d0 = cur[0][1] - cur[0][0]
                d1 = e[1] - e[0]
                cosang = float(d0 @ d1) / (np.hypot(*d0) * np.hypot(*d1))
                if cosang > math.cos(math.radians(12)):
                    cur.append(e)
                else:
                    runs.append(cur)
                    cur = [e]
            runs.append(cur)
            if len(runs) > 1:     # l'anneau est fermé : la dernière façade peut continuer la première
                d0 = runs[0][0][1] - runs[0][0][0]
                d1 = runs[-1][-1][1] - runs[-1][-1][0]
                if float(d0 @ d1) / (np.hypot(*d0) * np.hypot(*d1)) > math.cos(math.radians(12)):
                    runs[0] = runs.pop() + runs[0]
            for run in runs:
                self._facade(run, roof, bounds, terrain, bottom, seed, style, shared_geom, street_geom, step)

    def _facade(self, run, roof, bounds, terrain, bottom, seed, style, shared_geom, street_geom, step):
        total = sum(L for _, _, L in run)
        pieces, offset, street_len = [], 0.0, 0.0
        for p, q, L in run:
            dirv = (q - p) / L
            nrm = np.array([dirv[1], -dirv[0]])          # normale extérieure
            mid = (p + q) / 2
            shared = shared_geom is not None and shared_geom.contains(Point(*(mid + nrm * 0.3)))
            if street_geom is not None and street_geom.contains(Point(*(mid + nrm * 2.5))):
                street_len += L
            # points de rupture du toit le long du mur (faîtages, marches), doublés pour des marches nettes
            ts = [0.0, L]
            if bounds is not None:
                cross = LineString([p, q]).intersection(bounds)
                for g in getattr(cross, "geoms", [cross]):
                    for c in (list(g.coords) if not g.is_empty else []):
                        t = float((np.array(c) - p) @ dirv)
                        if 0.02 < t < L - 0.02:
                            ts += [t - 0.01, t + 0.01]
            ts = sorted(set(round(t, 4) for t in ts))
            seg = np.array(_densify([tuple(p + dirv * t) for t in ts], step))
            g = terrain.at(seg[:, 0], seg[:, 1])
            top = roof.h(seg[:, 0], seg[:, 1])
            us = offset + (seg - p) @ dirv
            pieces.append((seg, g, top, us, shared))
            offset += L
        ref = float(max(pieces[0][1][0], pieces[-1][1][-1]))
        eave_rel = float(min(pc[2].min() for pc in pieces) - ref)
        street = street_len > 0.5 * total
        for seg, g, top, us, shared in pieces:
            flags = (SHARED if shared else 0) | (STREET if street else 0)
            for s in range(len(seg) - 1):
                a, b = seg[s], seg[s + 1]
                quad = [(a, bottom, us[s], g[s], top[s]), (b, bottom, us[s + 1], g[s + 1], top[s + 1]),
                        (b, float(top[s + 1]), us[s + 1], g[s + 1], top[s + 1]), (a, float(top[s]), us[s], g[s], top[s])]
                for vi in (0, 1, 2, 0, 2, 3):
                    (x, n), y, u, gg, tt = quad[vi]
                    self.wall_pos += [x, y, -n]
                    self.wall_fac += [u, y - ref, total, eave_rel]
                    self.wall_info += [gg - ref, tt - ref, seed, style * 8 + flags]

    # -- toit ---------------------------------------------------------------
    def _roof_tri(self, pts, ys, grad, seed, tint, kind_hint, axes):
        (x0, n0), (x1, n1), (x2, n2) = pts
        if (x1 - x0) * (n2 - n0) - (n1 - n0) * (x2 - x0) < 0:      # face vers le haut
            pts, ys = pts[[0, 2, 1]], ys[[0, 2, 1]]
        if grad is None:
            # gradient du triangle, recalé sur les axes principaux du bâtiment (rangs de tuiles droits)
            try:
                ga, gb, _ = np.linalg.solve(np.c_[pts, np.ones(3)], ys)
            except np.linalg.LinAlgError:
                ga, gb = 0.0, 0.0
            g = np.array([ga, gb])
            if np.hypot(*g) > 0.08:
                cand = [axes[0], -axes[0], axes[1], -axes[1]]
                g = max(cand, key=lambda v: float(v @ g)) * np.hypot(*g)
        else:
            g = np.array(grad)
        slope = float(np.hypot(*g))
        kind = kind_hint if slope > 0.08 else TERRACE
        if slope > 0.08:
            dn = -g / slope                        # direction de la pente descendante
            across = np.array([-dn[1], dn[0]])
            stretch = math.sqrt(1 + slope * slope)
            uv = [(float(pt @ across), float(pt @ dn) * stretch) for pt in pts]
        else:
            uv = [(float(pt[0]), float(pt[1])) for pt in pts]
        for vi in (0, 1, 2):     # (x, n, haut) -> (x, haut, -n) conserve l'orientation
            self.roof_pos += [pts[vi][0], ys[vi], -pts[vi][1]]
            self.roof_uv += [uv[vi][0], uv[vi][1], seed, kind]
            self.roof_tint += tint

    def _vertical(self, p, q, lo, hi, seed, tint, kind):
        """Quadrilatère vertical (rive, marche) de p à q, entre lo et hi."""
        L = float(np.hypot(*(np.array(q) - np.array(p))))
        quad = [(p, lo[0], 0.0), (q, lo[1], L), (q, hi[1], L), (p, hi[0], 0.0)]
        for vi in (0, 1, 2, 0, 2, 3):
            (x, n), y, u = quad[vi]
            self.roof_pos += [x, float(y), -n]
            self.roof_uv += [u, float(y), seed, kind]
            self.roof_tint += tint

    def add_roof(self, roof, roof_poly, seed, tint, axes, material):
        if roof.method == "lidar":
            for pc in roof.cells:
                for t in _triangulate(pc):
                    pts = np.array(t)
                    self._roof_tri(pts, roof.h(pts[:, 0], pts[:, 1]), None, seed, tint, material, axes)
        else:
            for reg, pl in roof.regions:
                for t in _triangulate(reg):
                    pts = np.array(t)
                    self._roof_tri(pts, _plane_eval(pl, pts[:, 0], pts[:, 1]), (pl[0], pl[1]), seed, tint, material, axes)
        for p, q, lo, hi in roof.steps:
            self._vertical(p, q, lo, hi, seed, tint, STEP)
        # rive : bande verticale sous le bord du toit, points de rupture compris
        region_pts = np.array([c for reg, _ in roof.regions for c in reg.exterior.coords]) \
            if roof.method != "lidar" else np.zeros((0, 2))
        for ring in [roof_poly.exterior] + list(roof_poly.interiors):
            pts = _insert_points(list(ring.coords), region_pts)
            if roof.method == "lidar":
                pts = _densify(pts, 1.2)
            pts = _espacer(pts, 0.35)
            pts = np.array(pts)
            hs = roof.h(pts[:, 0], pts[:, 1])
            for s in range(len(pts) - 1):
                ha, hb = hs[s], hs[s + 1]
                if roof.method == "niveaux":
                    # chaque morceau de rive suit le pan qui le porte (pas de rive en biais entre deux niveaux)
                    mid = (pts[s] + pts[s + 1]) / 2
                    pl = roof.plane_at(mid[0], mid[1])
                    ha = _plane_eval(pl, pts[s][0], pts[s][1])
                    hb = _plane_eval(pl, pts[s + 1][0], pts[s + 1][1])
                self._vertical(pts[s], pts[s + 1], (ha - FASCIA, hb - FASCIA), (ha, hb), seed, tint, EDGE)


def roof_tint(poly, ortho, px_half):
    """Couleur médiane du toit sur l'orthophoto (zone intérieure), ou tuile par défaut."""
    inner = poly.buffer(-1.0)
    if inner.is_empty:
        inner = poly
    minx, minn, maxx, maxn = inner.bounds
    w, h = ortho.shape[1], ortho.shape[0]
    px = 2 * px_half / w
    c0, c1 = int((minx + px_half) / px), int((maxx + px_half) / px) + 1
    r0, r1 = int((px_half - maxn) / px), int((px_half - minn) / px) + 1
    c0, r0 = max(c0, 0), max(r0, 0)
    c1, r1 = min(c1, w - 1), min(r1, h - 1)
    if c1 <= c0 or r1 <= r0:
        return [178, 96, 70]
    cols, rows = np.meshgrid(np.arange(c0, c1), np.arange(r0, r1))
    xs = -px_half + (cols + 0.5) * px
    ns = px_half - (rows + 0.5) * px
    sel = shapely.contains_xy(inner, xs, ns)
    if sel.sum() < 4:
        return [178, 96, 70]
    rgb = np.median(ortho[rows[sel], cols[sel]], axis=0)
    r, g, b = rgb
    if g > r * 0.98 and g > b:            # arbre qui masque le toit
        return [178, 96, 70]
    return [int(v) for v in rgb]


def _debord(pg, neighbours):
    """Débord de toit qui ne mord pas chez le voisin, quoi que dise la BD TOPO.

    Certaines emprises sont dégénérées — anneau non fermé, sommets doublés — et
    GEOS refuse la différence (« Ring edge missing »). Capestang en avait une ;
    Poilhes non. Une chaîne qui doit avaler n'importe quel village ne peut pas
    s'arrêter là : on recale sur une grille au millimètre, et si GEOS s'obstine
    on renonce au débord pour ce bâtiment-là, pas pour le village entier.
    """
    large = pg.buffer(OVERHANG, join_style="mitre", mitre_limit=2.0)
    if neighbours.is_empty:
        return large
    try:
        return large.difference(neighbours.buffer(0.02))
    except shapely.errors.GEOSException:
        pass
    try:
        a = shapely.set_precision(large, 0.001)
        b = shapely.set_precision(neighbours.buffer(0.02), 0.001)
        return a.difference(b)
    except shapely.errors.GEOSException:
        return Polygon()


def build_all(features, terrain, mns, ndvi, ortho, road_surface, osm_buildings, core_center, footprints_out):
    """Construit tous les bâtiments. `footprints_out` reçoit (poly, meta) pour les collisions."""
    parts = []
    for f in features:
        p = f["properties"]
        geom = f["geometry"]
        ring0 = geom["coordinates"][0][0] if geom["type"] == "MultiPolygon" else geom["coordinates"][0]
        zs = [c[2] for c in ring0 if len(c) > 2 and c[2] > -500]
        for poly in local_polygons(geom):
            for pg in (poly.geoms if isinstance(poly, MultiPolygon) else [poly]):
                if pg.area < 4:
                    continue
                # 30 cm : supprime les décrochements de numérisation qui feraient des lamelles de mur
                pg = shapely.set_precision(pg.simplify(0.3), 0.001)
                if pg.is_empty or not isinstance(pg, Polygon):
                    continue
                if max(abs(v) for v in pg.bounds) > HALF - 2:
                    continue
                parts.append((pg, p, (sum(zs) / len(zs)) if zs else None))

    # doublons de la BD TOPO (même emprise saisie deux fois) : on garde celui qui a une hauteur
    parts.sort(key=lambda t: t[1].get("hauteur") is None)
    kept = []
    index = STRtree([pg for pg, _, _ in parts])
    for i, (pg, p, z) in enumerate(parts):
        if any(j < i and pg.intersection(parts[j][0]).area > 0.6 * min(pg.area, parts[j][0].area)
               for j in index.query(pg)):
            continue
        kept.append((pg, p, z))
    parts = kept

    tree = STRtree([pg for pg, _, _ in parts])
    street = road_surface.buffer(1.5) if not road_surface.is_empty else None
    out = BuildingSet()
    for k, (pg, p, eave_geom) in enumerate(parts):
        ring = np.array(pg.exterior.coords)
        g = terrain.at(ring[:, 0], ring[:, 1])
        ground_min, ground_max = float(g.min()), float(g.max())
        height = p.get("hauteur") or 6.0
        eave = eave_geom if eave_geom else (p.get("altitude_minimale_sol") or ground_min) + height
        eave = max(eave, ground_max + 2.2)
        ridge = p.get("altitude_maximale_toit")
        if ridge is not None and ridge < eave:
            ridge = None

        # voisins : murs mitoyens, et le débord de toit ne mord pas chez le voisin
        near = [parts[i][0] for i in tree.query(pg.buffer(0.6)) if i != k]
        neighbours = shapely.union_all(near) if near else Polygon()
        shared = neighbours.buffer(0.35) if near else None
        overhang = _debord(pg, neighbours)
        roof_poly = max(_polys(pg.union(overhang).buffer(0)), key=lambda q: q.area)
        roof_poly = shapely.set_precision(roof_poly, 0.001)

        # Monuments : on ne laisse pas le LiDAR reconstruire une nef gothique.
        # Sur la collégiale de Capestang, les pans ajustés donnaient une crête de
        # pics ; un toit à deux pentes, lui, est au pire modeste, jamais absurde.
        osm_ici = next((o for o in osm_buildings if pg.buffer(0.5).contains(Point(o["x"], o["n"]))), None)
        monument = bool(osm_ici and osm_ici["type"] in ("church", "castle"))
        roof = build_roof(pg, roof_poly, mns, ground_min,
                          {"eave": eave, "ridge": ridge, "simple": monument})
        roof.plancher = eave - FASCIA - 0.05          # le toit ne descend pas sous l'égout
        out.stats[roof.method] += 1

        # nature et style
        osm = osm_ici
        usage = p.get("usage_1") or ""
        nature = p.get("nature") or ""
        area = pg.area
        seed = float(RNG.random())
        style = STUCCO
        if osm and osm["type"] in ("church", "castle", "lavoir"):
            style = ASHLAR
        elif osm and osm["type"] == "water_tower":
            style = INDUSTRIAL
        elif nature.startswith("Industriel") or (area > 450 and usage != "Résidentiel"):
            style = INDUSTRIAL
        elif usage == "Annexe" or height < 3.2 or area < 18:
            style = ANNEX
        else:
            core = math.hypot(pg.centroid.x - core_center[0], pg.centroid.y - core_center[1]) < 170
            if core and seed < 0.22:
                style = RUBBLE
            elif not core and seed < 0.55:
                style = MODERN

        out.add_walls(pg, roof, terrain, ground_min - 0.6, seed, style, shared, street)

        # axes principaux (pour caler les rangs de tuiles des toits LiDAR)
        rect = list(pg.minimum_rotated_rectangle.exterior.coords)[:3]
        a0 = np.subtract(rect[1], rect[0])
        a0 = a0 / (np.hypot(*a0) or 1)
        axes = (a0, np.array([-a0[1], a0[0]]))
        tint = roof_tint(pg, ortho, HALF)
        material = METAL if style == INDUSTRIAL else TILE
        out.add_roof(roof, roof_poly, seed, tint, axes, material)
        if style in (STUCCO, RUBBLE, MODERN):
            out.chimneys += detect_chimneys(pg, roof, mns, ndvi, math.atan2(a0[1], a0[0]))

        c = pg.representative_point()
        top = float(roof.h(np.array([c.x]), np.array([c.y]))[0])
        meta = {"x": round(pg.centroid.x, 2), "n": round(pg.centroid.y, 2), "sol": round(ground_min, 2),
                "toit": round(top, 2), "style": style, "usage": usage, "rnb": p.get("identifiants_rnb"),
                "nom": osm["nom"] if osm else None, "methode": roof.method}
        out.meta.append(meta)
        footprints_out.append((pg, meta))
    return out

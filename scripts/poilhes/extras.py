"""Éléments complémentaires : eau, piscines, ponts, murs de soutènement, noms de rues et lieux."""
import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import linemerge, unary_union

from buildings import _triangulate
from geo import HALF, to_local


class Mesh:
    """Maillage simple : positions (x, y, z Three.js) et couleurs par sommet."""

    def __init__(self):
        self.pos, self.col = [], []

    def tri(self, a, b, c, rgb):
        for p in (a, b, c):
            self.pos += [p[0], p[1], p[2]]
            self.col += rgb

    def quad(self, a, b, c, d, rgb):
        self.tri(a, b, c, rgb)
        self.tri(a, c, d, rgb)


def flat_polygon(poly, y, mesh, rgb):
    """Surface horizontale (face vers le haut)."""
    for t in _triangulate(poly):
        (x0, n0), (x1, n1), (x2, n2) = t
        if (x1 - x0) * (n2 - n0) - (n1 - n0) * (x2 - x0) < 0:
            t = [t[0], t[2], t[1]]
        mesh.tri(*[(x, y, -n) for x, n in t], rgb)


def water_mesh(bodies):
    """Plans d'eau à leur niveau mesuré. Retourne (mesh, [niveaux])."""
    m = Mesh()
    for poly, level in bodies:
        flat_polygon(poly, level, m, [0, 0, 0])
    return m


def pools_mesh(pools, terrain):
    """Piscines : margelle claire et eau turquoise, calées sur le terrain."""
    water, coping = Mesh(), Mesh()
    for p in pools:
        if p.area < 4 or p.area > 400:
            continue
        ring = np.array(p.exterior.coords)
        y = float(np.max(terrain.at(ring[:, 0], ring[:, 1]))) + 0.12
        flat_polygon(p.buffer(-0.05), y, water, [0, 0, 0])
        rim = p.buffer(0.45, join_style="mitre").difference(p)
        flat_polygon(rim, y + 0.06, coping, [226, 220, 205])
        outer = np.array(p.buffer(0.45, join_style="mitre").exterior.coords)
        for k in range(len(outer) - 1):
            (x0, n0), (x1, n1) = outer[k], outer[k + 1]
            g0, g1 = terrain.at(x0, n0) - 0.3, terrain.at(x1, n1) - 0.3
            coping.quad((x0, g0, -n0), (x1, g1, -n1), (x1, y + 0.06, -n1), (x0, y + 0.06, -n0), [210, 204, 190])
    return water, coping


def _ribbon(line, width, ys, mesh, rgb, thickness=0.7, parapet=0.9, wall=0.35):
    """Tablier de pont : dalle, sous-face et parapets le long d'une ligne 3D."""
    pts = np.array(line.coords)
    if len(pts) < 2:
        return
    for k in range(len(pts) - 1):
        p, q = pts[k], pts[k + 1]
        d = q - p
        L = np.hypot(*d)
        if L < 1e-3:
            continue
        nrm = np.array([-d[1], d[0]]) / L * width / 2
        yp, yq = ys[k], ys[k + 1]
        lp, rp, lq, rq = p + nrm, p - nrm, q + nrm, q - nrm
        V = lambda xy, y: (xy[0], y, -xy[1])
        mesh.quad(V(rp, yp), V(rq, yq), V(lq, yq), V(lp, yp), rgb)                                  # dessus
        mesh.quad(V(lp, yp - thickness), V(lq, yq - thickness), V(rq, yq - thickness), V(rp, yp - thickness), rgb)
        for side, sgn in ((lp, 1), (rp, -1)):
            other = lq if sgn > 0 else rq
            inner = nrm / (width / 2) * wall * sgn
            o0, o1 = side, other
            i0, i1 = side - inner, other - inner
            top0, top1 = yp + parapet, yq + parapet
            mesh.quad(V(o0, yp - thickness), V(o1, yq - thickness), V(o1, top1), V(o0, top0), rgb)
            mesh.quad(V(i1, yq), V(i0, yp), V(i0, top0), V(i1, top1), rgb)
            mesh.quad(V(o0, top0), V(o1, top1), V(i1, top1), V(i0, top0), rgb)


def bridges_mesh(construction_lineaire, axes, terrain):
    """Ponts : lignes « Pont » de la BD TOPO et tronçons de route au-dessus du sol.

    Retourne (mesh, emprises) ; les emprises servent à rendre le tablier praticable à pied.
    """
    m = Mesh()
    decks = []
    stone = [196, 170, 132]
    lines = []
    for f in construction_lineaire:
        if f["properties"].get("nature") != "Pont":
            continue
        cs = f["geometry"]["coordinates"]
        line = LineString([to_local(c[0], c[1]) for c in cs])
        zs = [c[2] for c in cs]
        near = [a for a in axes if a["ligne"].distance(line) < 3]
        width = (max(a["largeur"] for a in near) + 1.6) if near else 3.0
        lines.append(line)
        decks.append(_bridge(line, zs, width, terrain, m, stone))
    for a in axes:
        if not a["pont"] or any(a["ligne"].distance(l) < 3 for l in lines):
            continue
        decks.append(_bridge(a["ligne"], a["z"], a["largeur"] + 1.6, terrain, m, stone))
    return m, decks


def _bridge(line, zs, width, terrain, mesh, rgb):
    coords = np.array(line.coords)
    zs = np.array(zs, float)
    bad = zs < -500
    if bad.all():
        zs = terrain.at(coords[:, 0], coords[:, 1]) + 0.3
    elif bad.any():
        zs[bad] = zs[~bad].mean()
    # prolonge de 2 m de chaque côté pour ancrer le tablier dans les berges
    d0 = coords[1] - coords[0]
    d1 = coords[-1] - coords[-2]
    coords = np.vstack([coords[0] - d0 / np.hypot(*d0) * 2, coords, coords[-1] + d1 / np.hypot(*d1) * 2])
    zs = np.r_[zs[0], zs, zs[-1]]
    _ribbon(LineString(coords), width, zs + 0.05, mesh, rgb)
    return LineString(coords).buffer(width / 2, cap_style="flat")


def retaining_walls_mesh(construction_lineaire, terrain):
    """Murs de soutènement en pierre, de la base du talus au-dessus du terrain haut."""
    m = Mesh()
    rgb = [176, 158, 128]
    for f in construction_lineaire:
        if f["properties"].get("nature") != "Mur de soutènement":
            continue
        line = LineString([to_local(c[0], c[1]) for c in f["geometry"]["coordinates"]])
        if line.length < 1:
            continue
        pts = [line.interpolate(s) for s in np.arange(0, line.length + 0.01, 1.5)]
        pts = np.array([(p.x, p.y) for p in pts])
        for k in range(len(pts) - 1):
            p, q = pts[k], pts[k + 1]
            d = q - p
            nrm = np.array([-d[1], d[0]]) / (np.hypot(*d) or 1)
            hi = max(terrain.at(*(p + nrm * 1.5)), terrain.at(*(p - nrm * 1.5)))
            lo = min(terrain.at(*(p + nrm * 1.5)), terrain.at(*(p - nrm * 1.5)))
            hi2 = max(terrain.at(*(q + nrm * 1.5)), terrain.at(*(q - nrm * 1.5)))
            lo2 = min(terrain.at(*(q + nrm * 1.5)), terrain.at(*(q - nrm * 1.5)))
            a, b = p + nrm * 0.25, q + nrm * 0.25
            c, e = p - nrm * 0.25, q - nrm * 0.25
            V = lambda xy, y: (xy[0], y, -xy[1])
            top0, top1 = hi + 0.5, hi2 + 0.5
            m.quad(V(a, lo - 0.3), V(b, lo2 - 0.3), V(b, top1), V(a, top0), rgb)
            m.quad(V(e, lo2 - 0.3), V(c, lo - 0.3), V(c, top0), V(e, top1), rgb)
            m.quad(V(a, top0), V(b, top1), V(e, top1), V(c, top0), [190, 175, 150])
    return m


def _osm_name(line, osm_lines):
    """Nom OSM de la voie qui suit ce tronçon (milieu à moins de 8 m), sinon None."""
    mid = line.interpolate(0.5, normalized=True)
    best = min(osm_lines, key=lambda o: o[0].distance(mid), default=None)
    if best is not None and best[0].distance(mid) < 8:
        return best[1]
    return None


def _tidy(name):
    """Nom BAN en capitales abrégées -> forme lisible."""
    abbrev = {"IMP": "Impasse", "CHE": "Chemin", "PAS": "Passage", "RTE": "Route", "PL": "Place", "AV": "Avenue"}
    if name.isupper():
        words = name.split()
        words = [abbrev.get(w, w.capitalize() if w not in ("DE", "DU", "DES", "LA", "LE", "L") else w.lower())
                 for w in words]
        name = " ".join(words)
    return name


def street_labels(axes, terrain, osm):
    """Une étiquette par rue nommée, au milieu de son plus long tronçon continu."""
    osm_lines = []
    for e in osm:
        t = e.get("tags", {})
        if e["type"] == "way" and "highway" in t and t.get("name") and "geometry" in e:
            osm_lines.append((LineString([to_local(g["lon"], g["lat"]) for g in e["geometry"]]), t["name"]))
    by_name = {}
    for a in axes:
        if a["nom"]:
            name = _osm_name(a["ligne"], osm_lines) or _tidy(a["nom"])
            by_name.setdefault(name, []).append(a["ligne"])
    out = []
    for name, lines in sorted(by_name.items()):
        union = unary_union(lines)
        merged = linemerge(union) if union.geom_type == "MultiLineString" else union
        parts = [g for g in getattr(merged, "geoms", [merged]) if g.geom_type == "LineString"]
        if not parts:
            continue
        best = max(parts, key=lambda l: l.length)
        mid = best.interpolate(0.5, normalized=True)
        p0 = best.interpolate(max(0.0, 0.5 * best.length - 2))
        p1 = best.interpolate(min(best.length, 0.5 * best.length + 2))
        ang = float(np.degrees(np.arctan2(p1.y - p0.y, p1.x - p0.x)))
        length = sum(l.length for l in lines)
        if abs(mid.x) > HALF or abs(mid.y) > HALF:
            continue
        out.append({"nom": name, "x": round(mid.x, 1), "y": round(float(terrain.at(mid.x, mid.y)), 2),
                    "z": round(-mid.y, 1), "angle": round(ang, 1), "longueur": round(length)})
    return out


POI_KINDS = {
    "townhall": "Mairie", "place_of_worship": "Église", "school": "École", "library": "Bibliothèque",
    "restaurant": "Restaurant", "post_office": "Poste", "lavoir": "Lavoir", "castle": "Château",
    "water_tower": "Château d'eau", "hotel": "Hôtel", "convenience": "Épicerie", "playground": "Aire de jeux",
    "memorial": "Monument", "pitch": "Terrain de sport",
}


def points_of_interest(osm):
    """Lieux notables d'OSM (nom, type, position locale)."""
    pois = []
    for e in osm:
        t = e.get("tags", {})
        kind = (t.get("amenity") or t.get("historic") or t.get("man_made") or t.get("shop")
                or t.get("tourism") or t.get("leisure"))
        if kind not in POI_KINDS:
            continue
        if e["type"] == "node":
            x, n = to_local(e["lon"], e["lat"])
        elif "geometry" in e:
            pts = [to_local(g["lon"], g["lat"]) for g in e["geometry"]]
            c = Polygon(pts).centroid if len(pts) >= 4 else LineString(pts).centroid
            x, n = c.x, c.y
        else:
            continue
        if abs(x) > HALF or abs(n) > HALF:
            continue
        name = t.get("name") or POI_KINDS[kind]
        pois.append({"nom": name, "type": kind, "genre": POI_KINDS[kind], "x": x, "n": n,
                     "batiment": e["type"] == "way" and "building" in t})
    # dédoublonne les nœuds « Église » posés sur le bâtiment déjà nommé
    out = []
    for p in pois:
        if any(q["genre"] == p["genre"] and np.hypot(q["x"] - p["x"], q["n"] - p["n"]) < 40 for q in out):
            continue
        out.append(p)
    return out


def street_lamps(axes, footprints, terrain, spacing=26.0):
    """Lanternes murales le long des rues, accrochées à la façade la plus proche.

    Retourne (lanternes, carte) : lanternes = [(x, y, z, dx, dz)] (repère Three.js, dx/dz vers la rue),
    carte = image 1024 x 1024 (1 m / px) de la lumière qu'elles projettent au sol, pour la nuit.
    """
    from shapely.strtree import STRtree
    from shapely.ops import nearest_points
    walls = [p.exterior for p, _ in footprints]
    tree = STRtree(walls)
    lamps = []
    for a in axes:
        if a["pont"] or not a["nature"].startswith("Route"):
            continue
        line = a["ligne"]
        for d in np.arange(6.0, line.length, spacing):
            pt = line.interpolate(d)
            if abs(pt.x) > HALF - 5 or abs(pt.y) > HALF - 5:
                continue
            k = tree.nearest(pt)
            wall = walls[k]
            if wall.distance(pt) > 7.0:
                continue
            wp = nearest_points(wall, pt)[0]
            dx, dn = pt.x - wp.x, pt.y - wp.y
            L = float(np.hypot(dx, dn)) or 1.0
            x, n = wp.x + dx / L * 0.35, wp.y + dn / L * 0.35
            if any(np.hypot(x - q[0], -n - q[2]) < 18 for q in lamps):
                continue
            y = float(terrain.at(wp.x, wp.y)) + 4.3
            lamps.append((x, y, -n, dx / L, -dn / L))
    size = 1024
    img = np.zeros((size, size), np.float32)
    yy, xx = np.mgrid[0:size, 0:size]
    for x, y, z, dx, dz in lamps:
        cx = (x + dx * 1.5 + HALF) / (2 * HALF) * size
        cz = (z + dz * 1.5 + HALF) / (2 * HALF) * size
        r0, r1 = int(max(cz - 20, 0)), int(min(cz + 21, size))
        c0, c1 = int(max(cx - 20, 0)), int(min(cx + 21, size))
        d2 = (xx[r0:r1, c0:c1] - cx) ** 2 + (yy[r0:r1, c0:c1] - cz) ** 2
        img[r0:r1, c0:c1] += np.exp(-d2 / (2 * 5.0 ** 2))
    light = (np.clip(img, 0, 1) ** 0.8 * 255).astype(np.uint8)
    return np.array(lamps, np.float32).reshape(-1, 5), light

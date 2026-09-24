"""Sol : voirie (BD TOPO + OSM), plans d'eau, piscines, masques de revêtement et tuiles d'orthophoto."""
import numpy as np
import shapely
from PIL import Image, ImageDraw, ImageFilter
from shapely.geometry import LineString, Polygon, MultiPolygon, box
from shapely.ops import unary_union

import sources
from geo import HALF, to_local, bbox_geo, to_geo

TILES = 2          # 2 x 2 tuiles de 500 m
TILE_PX = 2048     # ~24 cm par pixel

# Revêtement par nature de tronçon : (canal du masque, largeur par défaut)
#   0 = asphalte, 1 = gravier / terre, 2 = pavés / dalles
SURFACE = {
    "Route à 1 chaussée": (0, 4.0),
    "Route à 2 chaussées": (0, 3.5),
    "Bretelle": (0, 4.0),
    "Rond-point": (0, 6.0),
    "Route empierrée": (1, 3.2),
    "Chemin": (1, 2.8),
    "Sentier": (1, 1.4),
    "Escalier": (2, 2.0),
}


def local_polygons(geom):
    """Polygones locaux (x, nord) d'une géométrie GeoJSON Polygon / MultiPolygon."""
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    out = []
    for rings in polys:
        shell = [to_local(c[0], c[1]) for c in rings[0]]
        holes = [[to_local(c[0], c[1]) for c in r] for r in rings[1:]]
        p = Polygon(shell, holes).buffer(0)
        if not p.is_empty:
            out.append(p)
    return out


def road_network(features):
    """Axes et surfaces de voirie.

    Retourne (surfaces, axes) : surfaces[k] = union des emprises du revêtement k,
    axes = liste de dict {nom, ligne, largeur, pont, z} pour les étiquettes et les ponts.
    """
    shapes = {0: [], 1: [], 2: []}
    axes = []
    for f in features:
        p = f["properties"]
        kind, default_w = SURFACE.get(p["nature"], (0, 4.0))
        width = p.get("largeur_de_chaussee") or default_w
        coords = f["geometry"]["coordinates"]
        line = LineString([to_local(c[0], c[1]) for c in coords])
        zs = [c[2] for c in coords]
        on_bridge = str(p.get("position_par_rapport_au_sol")) not in ("0", "None")
        name = p.get("nom_voie_ban_gauche") or p.get("nom_voie_ban_droite") or p.get("nom_collaboratif_gauche")
        axes.append({"nom": name, "ligne": line, "largeur": width, "pont": on_bridge, "z": zs, "nature": p["nature"]})
        if on_bridge:
            continue
        pad = 0.8 if kind == 0 else 0.3   # bas-côtés, accotements, bordures
        shapes[kind].append(line.buffer((width + pad) / 2, cap_style="round", join_style="round"))
    surfaces = {k: unary_union(v) if v else Polygon() for k, v in shapes.items()}
    # les pavés et l'asphalte l'emportent sur le gravier
    surfaces[1] = surfaces[1].difference(surfaces[0].union(surfaces[2]))
    return surfaces, axes


def osm_areas(osm):
    """Places piétonnes, parkings, piscines et plans d'eau issus d'OSM."""
    paved, parking, pools, water = [], [], [], []
    for e in osm:
        if e["type"] != "way" or "geometry" not in e:
            continue
        t = e.get("tags", {})
        pts = [to_local(g["lon"], g["lat"]) for g in e["geometry"]]
        if len(pts) < 4 or pts[0] != pts[-1]:
            continue
        poly = Polygon(pts).buffer(0)
        if poly.is_empty:
            continue
        if t.get("highway") == "pedestrian" or t.get("place") == "square":
            paved.append(poly)
        elif t.get("amenity") == "parking":
            parking.append(poly)
        elif t.get("leisure") == "swimming_pool":
            pools.append(poly)
        elif t.get("natural") == "water":
            water.append((poly, t.get("name")))
    return paved, parking, pools, water


def water_bodies(hydro_features, osm_water, terrain_src):
    """Plans d'eau (polygone, niveau) : canal du Midi, port, bassins."""
    zone = box(-HALF, -HALF, HALF, HALF)
    polys = []
    for f in hydro_features:
        for p in local_polygons(f["geometry"]):
            polys.append(p.intersection(zone))
    for p, _ in osm_water:
        polys.append(p.intersection(zone))
    merged = unary_union([p for p in polys if not p.is_empty])
    parts = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    out = []
    for p in parts:
        if p.area < 20:
            continue
        inner = p.buffer(-2.0)
        probe = inner if not inner.is_empty else p
        xs, ns = terrain_src.centers()
        sel = shapely.contains_xy(probe, xs, ns)
        vals = terrain_src.a[sel]
        level = float(np.percentile(vals, 30)) if vals.size else float(terrain_src.sample([p.centroid.x], [p.centroid.y])[0])
        out.append((p, level))
    return out


def _draw(draw, geom, x0, n0, size_m, fill):
    """Dessine une (multi)surface locale dans une tuile image."""
    scale = TILE_PX / size_m
    if geom.is_empty:
        return
    for g in getattr(geom, "geoms", [geom]):
        if not isinstance(g, Polygon):
            continue
        def px(coords):
            return [((x - x0) * scale, (n0 - n) * scale) for x, n in coords]
        draw.polygon(px(g.exterior.coords), fill=fill)
        for hole in g.interiors:
            draw.polygon(px(hole.coords), fill=0)


def clean_photo(photo, cover, box):
    """Efface de la photo ce qui n'est pas le sol (arbres, toits) en prolongeant le sol voisin.

    Vue d'avion, un arbre peint son feuillage — et l'ombre de midi — sur la rue qui passe
    dessous. Comme le feuillage et les bâtiments sont modélisés en 3D, on les retire de la
    texture : le sol reprend la couleur du sol le plus proche, et les ombres redeviennent
    celles calculées par le moteur.
    """
    from scipy.ndimage import distance_transform_edt
    x0, n0, size_m = box
    h, w = cover.shape
    s = h / (2 * HALF)
    c0, r0 = int((x0 + HALF) * s), int((HALF - n0) * s)
    c1, r1 = int((x0 + size_m + HALF) * s), int((HALF - n0 + size_m) * s)
    sub = cover[r0:r1, c0:c1]
    if not sub.any():
        return photo
    a = np.array(photo)
    mask = np.array(Image.fromarray((sub * 255).astype(np.uint8)).resize(photo.size, Image.NEAREST)) > 127
    idx = distance_transform_edt(mask, return_distances=False, return_indices=True)
    filled = a[tuple(idx)]
    soft = np.array(Image.fromarray(filled).filter(ImageFilter.GaussianBlur(1.5)))
    a[mask] = soft[mask]
    return Image.fromarray(a)


def _sous_masque(cover, box, taille):
    """Découpe du masque « photo inventée » pour une tuile, à la résolution voulue."""
    x0, n0, size_m = box
    h, _ = cover.shape
    s = h / (2 * HALF)
    c0, r0 = int((x0 + HALF) * s), int((HALF - n0) * s)
    c1, r1 = int((x0 + size_m + HALF) * s), int((HALF - n0 + size_m) * s)
    sub = cover[r0:r1, c0:c1]
    img = Image.fromarray((sub * 255).astype(np.uint8)).resize((taille, taille), Image.BILINEAR)
    return img.filter(ImageFilter.GaussianBlur(1.5))


def build_tiles(out_dir, surfaces, paved, parking, cover=None):
    """Écrit ortho_i_j.jpg (photo nettoyée) et sol_i_j.png.

    Le masque de sol porte quatre canaux :
      R asphalte · G gravier · B pavés · **A « photo inventée »**

    Le canal alpha est la nouveauté : là où `clean_photo` a effacé un arbre ou un
    toit, la photo ne montre plus le sol réel mais une moyenne étalée du voisinage
    — une tache pâle, sans matière. Le shader s'en sert pour y reprendre la main et
    peindre de l'herbe et de la terre plutôt que d'afficher cette invention.
    """
    size_m = 2 * HALF / TILES
    asphalt = unary_union([surfaces[0]] + parking)
    paving = unary_union([surfaces[2]] + paved)
    gravel = surfaces[1].difference(unary_union([asphalt, paving]))
    tiles = []
    for j in range(TILES):
        for i in range(TILES):
            x0 = -HALF + i * size_m
            n0 = HALF - j * size_m
            lon_a, lat_a = to_geo(x0, n0 - size_m)
            lon_b, lat_b = to_geo(x0 + size_m, n0)
            photo = sources.image_tile("HR.ORTHOIMAGERY.ORTHOPHOTOS", (lon_a, lat_a, lon_b, lat_b), TILE_PX)
            if cover is not None:
                photo = clean_photo(photo, cover, (x0, n0, size_m))
            photo.save(out_dir / f"ortho_{i}_{j}.jpg", quality=86, optimize=True)
            chans = []
            for geom in (asphalt, gravel, paving):
                img = Image.new("L", (TILE_PX, TILE_PX), 0)
                _draw(ImageDraw.Draw(img), geom, x0, n0, size_m, 255)
                chans.append(img.filter(ImageFilter.GaussianBlur(2.6)))   # bords fondus : accotements
            invente = (_sous_masque(cover, (x0, n0, size_m), TILE_PX) if cover is not None
                       else Image.new("L", (TILE_PX, TILE_PX), 0))
            chans.append(invente)
            Image.merge("RGBA", chans).save(out_dir / f"sol_{i}_{j}.png", optimize=True)
            tiles.append({"i": i, "j": j, "x0": x0, "n0": n0, "taille": size_m})
    return tiles


def far_ortho(out_dir, far_half):
    """Photo du relief lointain : même couche que la zone détaillée, pour des teintes raccord."""
    photo = sources.image("HR.ORTHOIMAGERY.ORTHOPHOTOS", far_half, 3072)
    photo.save(out_dir / "ortho_lointain.jpg", quality=82, optimize=True)

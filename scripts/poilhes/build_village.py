"""Construit la maquette 3D du village de Poilhes (Hérault) à partir des données publiques.

    python scripts/poilhes/build_village.py

Sorties dans maps/poilhes/ (lues par poilhes.html) :
    village.json     index, métadonnées, noms de rues et de lieux
    village.bin      géométrie (terrain, bâtiments, toits, arbres, eau, ponts, collisions)
    ortho_i_j.jpg    photo aérienne IGN par tuile de 500 m
    sol_i_j.png      masque de revêtement (asphalte, gravier, pavés)
    ortho_lointain.jpg   photo du relief lointain (6 km)
"""
import json
import pathlib
import sys
import time

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import median_filter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import sources                                           # noqa: E402
from buildings import build_all                          # noqa: E402
from extras import (water_mesh, pools_mesh, bridges_mesh, retaining_walls_mesh,   # noqa: E402
                    street_labels, points_of_interest, street_lamps)
from geo import HALF, FAR_HALF, LON0, LAT0, Raster       # noqa: E402
from ground import road_network, osm_areas, water_bodies, build_tiles, far_ortho, TILES, SURFACE  # noqa: E402
from roads import build_roads  # noqa: E402
from pack import Packer                                  # noqa: E402
from terrain import Terrain, far_terrain, N, STEP, FAR_N, FAR_STEP, fill_nan  # noqa: E402
from vegetation import detect_trees                      # noqa: E402
from vineyards import vine_rows                          # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
from sites import SITE, NOM as VILLAGE  # noqa: E402

OUT = ROOT / "maps" / VILLAGE
LIDAR_PX = 2000   # 0,5 m par pixel sur 1 km

BUILDING_TYPES = {"place_of_worship": "church", "castle": "castle", "lavoir": "lavoir",
                  "water_tower": "water_tower", "townhall": "townhall", "school": "school", "library": "library"}


def log(t0, msg):
    print(f"[{time.time() - t0:6.1f} s] {msg}", flush=True)


def mask_from(polys, size):
    img = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(img)
    s = size / (2 * HALF)
    for p in polys:
        for g in getattr(p, "geoms", [p]):
            if g.is_empty:
                continue
            d.polygon([((x + HALF) * s, (HALF - n) * s) for x, n in g.exterior.coords], fill=1)
            for hole in g.interiors:
                d.polygon([((x + HALF) * s, (HALF - n) * s) for x, n in hole.coords], fill=0)
    return np.array(img, dtype=np.uint8)


def main():
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)

    log(t0, "données IGN et OSM")
    feats = {k: sources.wfs(k, HALF) for k in
             ("batiment", "troncon_de_route", "surface_hydrographique", "construction_lineaire")}
    mnt = sources.elevation("IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G", HALF, LIDAR_PX)
    mns = sources.elevation("IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G", HALF, LIDAR_PX)
    far_raw = sources.elevation("ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES", FAR_HALF, FAR_N)
    irc = np.array(sources.image("ORTHOIMAGERY.ORTHOPHOTOS.IRC", HALF, LIDAR_PX))
    ortho = np.array(sources.image("HR.ORTHOIMAGERY.ORTHOPHOTOS", HALF, LIDAR_PX))
    osm = sources.overpass(HALF)

    log(t0, "terrain")
    terrain = Terrain(mnt)
    paved, parking, pools, osm_water = osm_areas(osm)
    surfaces, axes = road_network(feats["troncon_de_route"])
    terrain.flatten_roads([surfaces[0], surfaces[2]])
    bodies = water_bodies(feats["surface_hydrographique"], osm_water, terrain.src)
    terrain.carve_water(bodies)
    far = far_terrain(far_raw, terrain)

    log(t0, "chaussée en volume")
    # La photo aérienne ne sait pas ce qu'est un bord de route : les rubans, si.
    revet = {nom: k for nom, (k, _) in SURFACE.items()}
    route_pos, route_nor, route_info, route_fin, route_idx = build_roads(axes, terrain, revet)
    log(t0, f"  {len(route_pos)} sommets, {len(route_idx) // 3} triangles")

    log(t0, "lieux")
    pois = points_of_interest(osm)
    osm_buildings = [{"type": BUILDING_TYPES[p["type"]], "x": p["x"], "n": p["n"], "nom": p["nom"]}
                     for p in pois if p["type"] in BUILDING_TYPES]
    church = next((b for b in osm_buildings if b["type"] == "church"), {"x": 0.0, "n": 0.0})

    log(t0, "bâtiments (toits LiDAR)")
    footprints = []
    mns_clean = Raster(median_filter(fill_nan(mns.copy()), size=3), HALF)
    road_all = surfaces[0].union(surfaces[2])
    irc_f = irc.astype(np.float32)
    ndvi = (irc_f[..., 0] - irc_f[..., 1]) / (irc_f[..., 0] + irc_f[..., 1] + 1e-3)
    bset = build_all(feats["batiment"], terrain, mns_clean, ndvi, ortho, road_all, osm_buildings,
                     (church["x"], church["n"]), footprints)
    log(t0, f"  {len(bset.meta)} volumes — toits : {bset.stats} — {len(bset.chimneys)} cheminées")

    log(t0, "vignes (cadastre + infrarouge)")
    vines, vstats = vine_rows(sources.wfs_layer("CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle", HALF),
                              sources.wfs("zone_de_vegetation", HALF), ortho.mean(axis=2) / 255.0, terrain)
    log(t0, f"  {vstats['parcelles']} parcelles plantées, {vstats['rangs']} rangs, {len(vines)} tronçons")

    log(t0, "arbres")
    water_mask = mask_from([p for p, _ in bodies] + pools, LIDAR_PX).astype(bool)
    trees = detect_trees(fill_nan(mns.copy()), fill_nan(mnt.copy()), irc, ortho, footprints, water_mask, terrain)
    log(t0, f"  {len(trees['x'])} arbres")

    log(t0, "tuiles d'orthophoto (arbres et toits effacés) et masques de sol")
    from scipy.ndimage import binary_dilation
    irc_f2 = irc.astype(np.float32)
    ndvi_full = (irc_f2[..., 0] - irc_f2[..., 1]) / (irc_f2[..., 0] + irc_f2[..., 1] + 1e-3)
    chm = np.nan_to_num(fill_nan(mns.copy()) - fill_nan(mnt.copy()))
    cover = binary_dilation((chm > 1.6) & (ndvi_full > 0.06), iterations=3)          # houppiers
    cover |= binary_dilation(mask_from([p for p, _ in footprints], LIDAR_PX) > 0, iterations=4)   # toits
    tiles = build_tiles(OUT, surfaces, paved, parking, cover)
    far_ortho(OUT, FAR_HALF)
    Image.fromarray(ortho).resize((1024, 1024), Image.LANCZOS).save(OUT / "plan.jpg", quality=84)

    log(t0, "eau, piscines, ponts, murs")
    water = water_mesh(bodies)
    pool_water, pool_rim = pools_mesh(pools, terrain)
    bridges, decks = bridges_mesh(feats["construction_lineaire"], axes, terrain)
    walls = retaining_walls_mesh(feats["construction_lineaire"], terrain)

    log(t0, "éclairage public (nuit)")
    lamps, night_light = street_lamps(axes, footprints, terrain)
    Image.fromarray(night_light).save(OUT / "nuit.png", optimize=True)
    log(t0, f"  {len(lamps)} lanternes")

    log(t0, "collisions")
    blocked = mask_from([p for p, _ in footprints], LIDAR_PX)
    wet = mask_from([p for p, _ in bodies], LIDAR_PX) & (1 - mask_from(decks, LIDAR_PX))
    collision = np.packbits(blocked, axis=None)
    water_bits = np.packbits(wet.astype(np.uint8), axis=None)

    log(t0, "écriture")
    pk = Packer()
    pk.add("terrain", terrain.h, "f32")
    pk.add("lointain", far, "f32")
    pk.add("routes_pos", route_pos, "f32", 3)
    pk.add("routes_nor", route_nor, "f32", 3)
    pk.add("routes_info", route_info, "f32", 4)
    pk.add("routes_fin", route_fin, "f32")
    pk.add("routes_idx", route_idx, "u32")
    pk.add("murs_pos", bset.wall_pos, "f32", 3)
    pk.add("murs_fac", bset.wall_fac, "f16", 4)
    pk.add("murs_info", bset.wall_info, "f16", 4)
    pk.add("toits_pos", bset.roof_pos, "f32", 3)
    pk.add("toits_uv", bset.roof_uv, "f16", 4)
    pk.add("toits_teinte", bset.roof_tint, "u8", 3)
    tree_arr = np.c_[trees["x"], trees["sol"], -trees["n"], trees["h"], trees["r"]].astype(np.float32)
    pk.add("arbres", tree_arr, "f32", 5)
    pk.add("arbres_rgb", trees["rgb"], "u8", 3)
    pk.add("cheminees", np.array(bset.chimneys, np.float32).reshape(-1, 7), "f32", 7)
    pk.add("vignes", vines, "f32", 6)
    pk.add("lanternes", lamps, "f32", 5)
    for name, m in (("eau", water), ("piscines", pool_water), ("margelles", pool_rim),
                    ("ponts", bridges), ("soutenements", walls)):
        pk.add(name + "_pos", m.pos, "f32", 3)
        pk.add(name + "_rgb", m.col, "u8", 3)
    # surface (toits, arbres) à 2 m, en décimètres : masquage des étiquettes, plancher du drone
    surf = np.nan_to_num(fill_nan(mns.copy())).reshape(LIDAR_PX // 4, 4, LIDAR_PX // 4, 4).max(axis=(1, 3))
    pk.add("surface", np.clip(np.round(surf * 10), 0, 65535), "u16")
    pk.add("collision_bati", collision, "u8")
    pk.add("collision_eau", water_bits, "u8")
    index = pk.write(OUT / "village.bin")

    for p in pois:
        p["y"] = round(float(terrain.at(p["x"], p["n"])), 2)
        p["z"] = round(-p["n"], 2)
        p["x"] = round(p["x"], 2)
        del p["n"]
    meta = {
        "nom": SITE["nom"],
        "village": VILLAGE,
        # estampille de génération : les images sont demandées avec ?v=…, sinon le
        # navigateur ressert d'anciennes tuiles avec une géométrie neuve
        "version": int(time.time()),
        "sources": [
            "IGN — BD TOPO V3, LiDAR HD (MNT/MNS), RGE ALTI, BD ORTHO RVB et IRC — licence ouverte Etalab 2.0",
            "© contributeurs OpenStreetMap — ODbL",
        ],
        "origine": {"lon": LON0, "lat": LAT0},
        "zone": {"demi_cote": HALF, "pas": STEP, "n": N},
        "lointain": {"demi_cote": FAR_HALF, "pas": FAR_STEP, "n": FAR_N},
        "tuiles": tiles, "tuiles_par_cote": TILES,
        "collision": {"taille": LIDAR_PX, "px": 2 * HALF / LIDAR_PX},
        "surface": {"n": LIDAR_PX // 4, "px": 2 * HALF / (LIDAR_PX // 4)},
        "eau": [{"niveau": round(l, 2), "surface": round(p.area)} for p, l in bodies],
        "rues": street_labels(axes, terrain, osm),
        "lieux": pois,
        "batiments": bset.meta,
        "stats": {"batiments": len(bset.meta), "arbres": int(len(trees["x"])), "toits": bset.stats,
                  "piscines": len(pools), "cheminees": len(bset.chimneys), "rangs_de_vigne": vstats["rangs"]},
        "tableaux": index,
    }
    (OUT / "village.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    size = sum(f.stat().st_size for f in OUT.iterdir()) / 1e6
    log(t0, f"terminé — {size:.1f} Mo dans {OUT}")


if __name__ == "__main__":
    main()

"""Téléchargement (avec cache disque) des données publiques utilisées pour Poilhes.

- IGN Géoplateforme WFS (BD TOPO V3) : bâtiments, routes, eau, murs, ponts…
- IGN Géoplateforme WMS-R : LiDAR HD (MNT, MNS), RGE ALTI, BD ORTHO (RVB et IRC).
- OpenStreetMap (Overpass) : noms des lieux, places piétonnes, parkings.

Licences : IGN — licence ouverte Etalab 2.0 ; OSM — ODbL (© contributeurs OpenStreetMap).
"""
import hashlib
import io
import json
import pathlib
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

from geo import bbox_geo

from sites import NOM as VILLAGE  # noqa: E402

# Un cache par village : les téléchargements IGN ne se mélangent pas.
CACHE = pathlib.Path(__file__).resolve().parent / ".cache" / VILLAGE
UA = {"User-Agent": "NovaFlight-Poilhes/1.0 (maquette 3D du village)", "Accept": "*/*"}
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


def _get(url, data=None, tries=4):
    key = hashlib.sha1((url + (data.decode() if data else "")).encode()).hexdigest()[:20]
    path = CACHE / key
    if path.exists():
        return path.read_bytes()
    CACHE.mkdir(parents=True, exist_ok=True)
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            body = urllib.request.urlopen(req, timeout=240).read()
            path.write_bytes(body)
            return body
        except Exception as exc:  # réseau capricieux : on réessaie
            last = exc
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"échec du téléchargement {url[:120]} : {last}")


def wfs(layer, half):
    """Toutes les entités BD TOPO d'une couche dans le carré de demi-côté `half`."""
    return wfs_layer(f"BDTOPO_V3:{layer}", half)


def wfs_layer(typename, half):
    """Toutes les entités d'une couche WFS de la Géoplateforme (nom complet) dans le carré."""
    lon_a, lat_a, lon_b, lat_b = bbox_geo(half)
    q = urllib.parse.urlencode({
        "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature",
        "TYPENAMES": typename, "outputFormat": "application/json",
        "srsName": "EPSG:4326", "count": 10000,
        "BBOX": f"{lat_a},{lon_a},{lat_b},{lon_b},urn:ogc:def:crs:EPSG::4326",
    })
    return json.loads(_get("https://data.geopf.fr/wfs/ows?" + q))["features"]


def _wms(layer, half, size, fmt):
    lon_a, lat_a, lon_b, lat_b = bbox_geo(half)
    q = urllib.parse.urlencode({
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": layer,
        "STYLES": "", "CRS": "EPSG:4326", "BBOX": f"{lat_a},{lon_a},{lat_b},{lon_b}",
        "WIDTH": size, "HEIGHT": size, "FORMAT": fmt,
    })
    return _get("https://data.geopf.fr/wms-r?" + q)


def elevation(layer, half, size):
    """Raster d'altitude float32 (size x size), ligne 0 au nord ; nodata → NaN."""
    raw = _wms(layer, half, size, "image/x-bil;bits=32")
    a = np.frombuffer(raw, dtype="<f4").reshape(size, size).copy()
    a[(a < -500) | (a > 5000)] = np.nan
    return a


def image(layer, half, size, fmt="image/jpeg"):
    return Image.open(io.BytesIO(_wms(layer, half, size, fmt))).convert("RGB")


def image_tile(layer, bbox, size):
    """Image WMS sur une emprise géographique quelconque (lon_a, lat_a, lon_b, lat_b)."""
    lon_a, lat_a, lon_b, lat_b = bbox
    q = urllib.parse.urlencode({
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": layer,
        "STYLES": "", "CRS": "EPSG:4326", "BBOX": f"{lat_a},{lon_a},{lat_b},{lon_b}",
        "WIDTH": size, "HEIGHT": size, "FORMAT": "image/jpeg",
    })
    return Image.open(io.BytesIO(_get("https://data.geopf.fr/wms-r?" + q))).convert("RGB")


def overpass(half):
    """Éléments OSM utiles (noms, places, parkings, équipements) avec géométrie."""
    lon_a, lat_a, lon_b, lat_b = bbox_geo(half)
    bb = f"{lat_a},{lon_a},{lat_b},{lon_b}"
    q = f"""[out:json][timeout:120];
(
  nwr["name"]({bb});
  nwr["amenity"]({bb});
  nwr["highway"="pedestrian"]({bb});
  nwr["place"="square"]({bb});
  nwr["leisure"]({bb});
  nwr["man_made"]({bb});
  nwr["historic"]({bb});
  node["natural"="tree"]({bb});
);
out geom tags;"""
    data = urllib.parse.urlencode({"data": q}).encode()
    for url in OVERPASS:
        try:
            body = _get(url, data=data, tries=2)
            return json.loads(body)["elements"]
        except Exception:
            continue
    return []

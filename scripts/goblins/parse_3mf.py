"""Lecture du 3MF d'impression : cinq maillages bruts mis en cache au format npz.

Le fichier fait 88 Mo de XML (1,1 million de triangles) : on le lit en flux et on
garde le resultat sur disque, le reste du pipeline travaille sur le cache.
"""
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np

NS = "{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}"
CACHE = Path(__file__).parent / ".cache"


def noms(z):
    """id d'objet -> nom lisible, lu dans les reglages Bambu Studio."""
    txt = z.read("Metadata/model_settings.config").decode("utf8", "replace")
    out = {}
    for bloc in re.findall(r'<object id="(\d+)">(.*?)</object>', txt, re.S):
        m = re.search(r'name" value="([^"]+)"', bloc[1])
        if m:
            out[bloc[0]] = m.group(1).replace(".stl", "")
    return out


def lire(chemin):
    z = zipfile.ZipFile(chemin)
    titres = noms(z)
    CACHE.mkdir(exist_ok=True)
    with z.open("3D/3dmodel.model") as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag != NS + "object":
                continue
            maille = el.find(NS + "mesh")
            if maille is None:
                el.clear()
                continue
            oid = el.get("id")
            v = maille.find(NS + "vertices")
            t = maille.find(NS + "triangles")
            sommets = np.array([[s.get("x"), s.get("y"), s.get("z")] for s in v], np.float64)
            faces = np.array([[s.get("v1"), s.get("v2"), s.get("v3")] for s in t], np.int64)
            nom = titres.get(oid, "objet_" + oid)
            np.savez_compressed(CACHE / (nom + ".npz"), v=sommets.astype(np.float32), f=faces.astype(np.int32))
            print(f"{nom:16s} {len(sommets):7d} sommets {len(faces):7d} faces", flush=True)
            el.clear()


if __name__ == "__main__":
    lire(sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\icc34\Downloads\Set_of_5_goblins.3mf")

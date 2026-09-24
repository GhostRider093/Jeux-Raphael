"""Relief commun à plusieurs villages voisins : ce qui les relie.

    PAYS=canal py scripts/poilhes/build_pays.py

Un pays ne reconstruit aucun village : Poilhes et Capestang existent déjà dans
`maps/poilhes/` et `maps/capestang/`, chacun centré sur son origine. Ce script
ne fabrique que les 8 km de campagne qui les séparent — le relief au pas de 20 m
et la photo aérienne qui l'habille — et note où poser chaque village dans ce
repère commun.

Sans lui, on superposerait les deux reliefs lointains de 6 km livrés avec les
villages : deux plans à la même altitude se battent pixel par pixel, et leurs
deux photos n'ont ni la même exposition ni la même date de prise de vue.

Sorties dans maps/pays-<nom>/ :
    pays.json            index, origine, emplacement de chaque village
    pays.bin             grille d'altitudes (float32)
    ortho_lointain.jpg   photo aérienne du pays
"""
import json
import os
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

# Le repère local est celui du pays : il faut le dire avant d'importer `geo`,
# qui lit le site courant à son chargement.
PAYS_NOM = os.environ.get("PAYS", "canal").strip().lower()
os.environ["VILLAGE"] = "pays-" + PAYS_NOM

import numpy as np                                        # noqa: E402
from PIL import Image                                     # noqa: E402
from scipy.ndimage import map_coordinates                 # noqa: E402

import sources                                            # noqa: E402
from geo import LON0, LAT0, FAR_HALF, to_local            # noqa: E402
from pack import Packer                                   # noqa: E402
from sites import PAYS, SITES                             # noqa: E402
from terrain import fill_nan, Raster                      # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
if PAYS_NOM not in PAYS:
    raise SystemExit(f"Pays inconnu : {PAYS_NOM}. Connus : {', '.join(PAYS)}")
PAYS_DEF = PAYS[PAYS_NOM]
OUT = ROOT / "maps" / ("pays-" + PAYS_NOM)

STEP = 20.0                            # pas du relief commun (m) — celui des reliefs lointains
N = int(2 * FAR_HALF / STEP) + 1
ORTHO_PX = 4096
CREUX = 6.0                            # abaissement sous une zone détaillée (m)
TYPES_NP = {"f32": "<f4", "u32": "<u4", "u16": "<u2", "u8": "u1", "f16": "<f2", "i16": "<i2"}


def log(t0, msg):
    print(f"[{time.time() - t0:6.1f} s] {msg}", flush=True)


class Village:
    """Un village déjà construit, relu depuis `maps/<nom>/`, placé dans le pays."""

    def __init__(self, nom):
        self.nom = nom
        dossier = ROOT / "maps" / nom
        self.meta = json.loads((dossier / "village.json").read_text(encoding="utf-8"))
        zone = self.meta["zone"]
        self.half, self.pas, self.n = zone["demi_cote"], zone["pas"], zone["n"]
        e = self.meta["tableaux"]["terrain"]
        brut = np.fromfile(dossier / "village.bin", dtype=TYPES_NP[e["type"]],
                           count=e["count"], offset=e["offset"])
        self.h = brut.reshape(self.n, self.n).astype(np.float32)
        # Position du village dans le repère du pays, en mètres est / nord.
        self.x, self.nord = to_local(self.meta["origine"]["lon"], self.meta["origine"]["lat"])

    def at(self, x, nord):
        """Altitude du terrain détaillé, en coordonnées locales au village."""
        col = (np.asarray(x) + self.half) / self.pas
        row = (self.half - np.asarray(nord)) / self.pas
        return map_coordinates(self.h, [np.atleast_1d(row), np.atleast_1d(col)], order=1, mode="nearest")


def relief(villages, t0):
    """Grille d'altitudes du pays, recousue au bord de chaque village."""
    brut = sources.elevation("ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES", FAR_HALF, N)
    src = Raster(fill_nan(brut), FAR_HALF)
    coords = -FAR_HALF + np.arange(N) * STEP
    xs, ns = np.meshgrid(coords, coords[::-1])
    h = src.sample(xs.ravel(), ns.ravel()).reshape(N, N).astype(np.float32)

    for v in villages:
        lx, ln = xs - v.x, ns - v.nord
        # Une maille au-delà du bord : le relief du pays y prend l'altitude du
        # village, pour que les deux surfaces se rejoignent sans marche. Les
        # bords des villages ne tombent pas sur la grille du pays (ils sont à
        # 4 022 m l'un de l'autre, pas à un multiple de 20 m du centre) : on ne
        # peut donc pas recopier une ligne de sommets, on échantillonne.
        bord = (np.abs(lx) <= v.half + STEP) & (np.abs(ln) <= v.half + STEP)
        h[bord] = v.at(np.clip(lx[bord], -v.half, v.half), np.clip(ln[bord], -v.half, v.half))
        # Sous la zone détaillée, on s'efface : le relief du pays passe dessous.
        # La marche de 6 m est reculée d'une maille à l'intérieur du village —
        # sinon elle tombe dans la maille à cheval sur la limite, et on voit un
        # fossé de 6 m courir tout autour du village, là où la tuile détaillée
        # ne le couvre plus.
        dedans = (np.abs(lx) < v.half - STEP) & (np.abs(ln) < v.half - STEP)
        h[dedans] -= CREUX
        log(t0, f"  {v.nom} : posé en x={v.x:+.0f} n={v.nord:+.0f}, "
                f"{int(dedans.sum())} sommets abaissés, {int(bord.sum() - dedans.sum())} recousus")
    return h


def main():
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    villages = [Village(nom) for nom in PAYS_DEF["villages"]]

    log(t0, f"relief du pays — {2 * FAR_HALF / 1000:.0f} km de côté au pas de {STEP:.0f} m")
    h = relief(villages, t0)

    log(t0, "photo aérienne")
    photo = sources.image("HR.ORTHOIMAGERY.ORTHOPHOTOS", FAR_HALF, ORTHO_PX)
    photo.save(OUT / "ortho_lointain.jpg", quality=82, optimize=True)
    Image.fromarray(np.asarray(photo)).resize((1024, 1024), Image.LANCZOS).save(OUT / "plan.jpg", quality=84)

    log(t0, "écriture")
    pk = Packer()
    pk.add("lointain", h, "f32")
    index = pk.write(OUT / "pays.bin")
    meta = {
        "nom": PAYS_DEF["nom"],
        "pays": PAYS_NOM,
        "version": int(time.time()),
        "sources": [
            "IGN — RGE ALTI, BD ORTHO RVB — licence ouverte Etalab 2.0",
            "© contributeurs OpenStreetMap — ODbL",
        ],
        "origine": {"lon": LON0, "lat": LAT0},
        "lointain": {"demi_cote": FAR_HALF, "pas": STEP, "n": N},
        "villages": [{
            "village": v.nom,
            "nom": SITES[v.nom]["nom"],
            # Repère Three.js : X = est, Z = -nord.
            "x": round(float(v.x), 2), "z": round(float(-v.nord), 2),
            "demi_cote": v.half,
        } for v in villages],
        "tableaux": index,
    }
    (OUT / "pays.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    size = sum(f.stat().st_size for f in OUT.iterdir()) / 1e6
    log(t0, f"terminé — {size:.1f} Mo dans {OUT}")


if __name__ == "__main__":
    main()

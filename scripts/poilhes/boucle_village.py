"""La boucle de course dans un village — tracée sur les rues du jeu lui-même.

Demande d'Arnaud (26/09/2026) : « une petite boucle dans Poilhes : on part de
l'entrée, on va jusqu'au pont, le gros pont, on fait une boucle au-dessus, à peu
près un kilomètre, et on revient au point de départ ; deux tours, un classement ».

Pas d'OpenStreetMap ici : le graphe vient du **ruban de chaussée du village**
(`routes_pos` / `routes_info` dans village.bin, ce sur quoi on roule vraiment),
plus les tabliers de pont (`ponts_axes`), qui n'ont pas de ruban. Les bouts de
tronçon proches de moins de `SOUDURE` mètres sont des carrefours.

On passe par des points imposés (`ETAPES`), dans l'ordre, et l'on relie chaque
paire par le plus court chemin (Dijkstra). Sortie : `maps/<village>/boucle.json`
— la polyligne fermée (x, z), sa longueur, le départ et son cap.

    py scripts/poilhes/boucle_village.py
"""
import heapq
import json
import math
import os
import pathlib

import numpy as np

RACINE = pathlib.Path(__file__).resolve().parent.parent.parent
VILLAGE = os.environ.get("VILLAGE", "poilhes").strip().lower()   # VILLAGE=capestang py …
DOSSIER = RACINE / "maps" / VILLAGE

# Les étapes, dans l'ordre (repère Three.js du village : x à l'est, z au sud).
# 26/09/2026, 2e version : la 1re passait par des ruelles de 2 à 3 m (« un truc
# très très serré ») ; celle-ci ne prend que les rues larges (voir `LARGEUR`) et
# repasse le gros pont au retour — le pont du centre fait 3 m.
ETAPES_POILHES = [
    (-249.4, -6.4),     # l'entrée du village (départ de la berline, avenue de Capestang)
    (-151.0, 83.0),     # le gros pont du canal, rive ouest…
    (-129.0, 103.0),    # … rive est
    (-40.0, -12.0),     # la route du canal, jusqu'à la grand-rue
    (220.0, 15.0),      # la grand-rue vers l'est
    (135.0, 105.0),     # on redescend, et la rue parallèle ramène vers l'ouest
    (40.0, 60.0),
    (-129.0, 103.0),    # le gros pont, dans l'autre sens
    (-151.0, 83.0),
]
# Capestang (26/09/2026, « les mêmes lignes, les mêmes croix ») : les grandes
# artères seulement — l'avenue en diagonale, une traversée du centre vers l'est,
# le boulevard du sud, et retour par l'avenue.
ETAPES_CAPESTANG = [
    (-46.0, 206.0),     # le départ, sur l'avenue en diagonale
    (140.0, -35.0),     # on la remonte vers le nord-est
    (293.0, -24.0),     # la rue du centre, vers l'est
    (337.0, 304.0),     # on descend jusqu'au boulevard
    (53.0, 299.0),      # le boulevard vers l'ouest
    (-106.0, 293.0),    # le carrefour de l'avenue
]
ETAPES = {"poilhes": ETAPES_POILHES, "capestang": ETAPES_CAPESTANG}[VILLAGE]
# Coût d'un mètre selon la largeur de la chaussée : une ruelle de 3 m n'est
# prise que si elle évite un très long détour.
def cout_largeur(w):
    return 1.0 if w >= 5 else 1.6 if w >= 3.8 else 14.0
SOUDURE = 7.0           # m : deux bouts de tronçon plus proches sont un carrefour
COLS, AXE = 9, 4


def tableau(meta, binaire, nom):
    t = meta["tableaux"][nom]
    return np.frombuffer(binaire, dtype="<f4", count=t["count"], offset=t["offset"])


def main():
    meta = json.loads((DOSSIER / "village.json").read_text(encoding="utf-8"))
    binaire = (DOSSIER / "village.bin").read_bytes()
    pos = tableau(meta, binaire, "routes_pos").reshape(-1, COLS, 3)
    info = tableau(meta, binaire, "routes_info").reshape(-1, COLS, 4)

    # ── les tronçons : l'axe du ruban, coupé quand l'abscisse repart ─────────
    troncons, courant = [], []
    largeurs = np.hypot(pos[:, 2, 0] - pos[:, 6, 0], pos[:, 2, 2] - pos[:, 6, 2])
    for r in range(len(pos)):
        s = info[r, 0, 1]
        if courant and s <= info[r - 1, 0, 1]:
            troncons.append(courant)
            courant = []
        courant.append((float(pos[r, AXE, 0]), float(pos[r, AXE, 2]), float(largeurs[r])))
    if courant:
        troncons.append(courant)

    # ── les ponts : leur axe est un tronçon de plus ──────────────────────────
    axes = tableau(meta, binaire, "ponts_axes")
    k = 0
    while k + 2 <= len(axes):
        n = int(axes[k]); w = float(axes[k + 1]); k += 2
        pts = axes[k:k + 3 * n].reshape(-1, 3); k += 3 * n
        troncons.append([(float(p[0]), float(p[2]), w) for p in pts])

    # ── le graphe : chaque point d'axe est un nœud ───────────────────────────
    noeuds, voisins, larg = [], {}, []

    def lier(a, b):
        d = math.dist(noeuds[a], noeuds[b]) * cout_largeur(min(larg[a], larg[b]))
        voisins.setdefault(a, []).append((b, d))
        voisins.setdefault(b, []).append((a, d))

    bouts = []
    for t in troncons:
        base = len(noeuds)
        noeuds.extend((x, z) for x, z, _ in t)
        larg.extend(w for _, _, w in t)
        for i in range(len(t) - 1):
            lier(base + i, base + i + 1)
        bouts += [base, base + len(t) - 1]
    # carrefours : un bout se soude à tout point d'axe proche (les rues qui
    # débouchent au milieu d'une autre comptent aussi)
    arr = np.array(noeuds)
    for b in bouts:
        d = np.hypot(arr[:, 0] - arr[b, 0], arr[:, 1] - arr[b, 1])
        for j in np.nonzero(d < SOUDURE)[0]:
            if j != b:
                lier(b, int(j))

    def proche(x, z):
        return int(np.argmin(np.hypot(arr[:, 0] - x, arr[:, 1] - z)))

    def chemin(a, b):
        dist, prec, file = {a: 0.0}, {}, [(0.0, a)]
        while file:
            d, u = heapq.heappop(file)
            if u == b:
                break
            if d > dist[u]:
                continue
            for v, w in voisins.get(u, []):
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v], prec[v] = nd, u
                    heapq.heappush(file, (nd, v))
        if b not in dist:
            raise SystemExit(f"pas de chemin entre {noeuds[a]} et {noeuds[b]}")
        out = [b]
        while out[-1] != a:
            out.append(prec[out[-1]])
        return out[::-1]

    etapes = [proche(x, z) for x, z in ETAPES]
    for (x, z), e in zip(ETAPES, etapes):
        print(f"étape ({x:7.1f}, {z:7.1f}) → nœud à {math.dist((x, z), noeuds[e]):.1f} m")
    tour = []
    for i in range(len(etapes)):
        morceau = chemin(etapes[i], etapes[(i + 1) % len(etapes)])
        tour += morceau if not tour else morceau[1:]
    points = [noeuds[i] for i in tour]
    # doublons et allers-retours d'un point (soudures)
    propre = [points[0]]
    for p in points[1:]:
        if math.dist(p, propre[-1]) > 0.5:
            propre.append(p)
    # impasses : un aller-retour (A → B → A) se replie sur A
    repli = True
    while repli:
        repli = False
        for i in range(1, len(propre) - 1):
            if math.dist(propre[i - 1], propre[i + 1]) < 1.0:
                del propre[i:i + 2]
                repli = True
                break
    longueur = sum(math.dist(propre[i], propre[i + 1]) for i in range(len(propre) - 1))
    x0, z0 = propre[0]
    x1, z1 = propre[min(3, len(propre) - 1)]
    cap = math.atan2(-(x1 - x0), -(z1 - z0))        # yaw Three.js : avant = −z
    sortie = {
        "village": VILLAGE,
        "tours": 1,
        "longueur": round(longueur, 1),
        "depart": {"x": round(x0, 2), "z": round(z0, 2), "cap": round(cap, 4)},
        "points": [[round(x, 2), round(z, 2)] for x, z in propre],
    }
    (DOSSIER / "boucle.json").write_text(json.dumps(sortie), encoding="utf-8")
    print(f"boucle : {len(propre)} points, {longueur:.0f} m par tour")


if __name__ == "__main__":
    main()

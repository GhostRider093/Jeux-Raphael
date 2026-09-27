"""Le réseau du trafic — les rues où circulent voitures, motos, trottinettes
et piétons de Poilhes City (27/09/2026, Arnaud : « beaucoup plus d'interactions
avec la carte, plus de personnages, d'hélicoptères, de voitures, de motos, de
trottinettes »).

Même source que la boucle de course (`boucle_village.py`) : l'axe du ruban de
chaussée de `village.bin` et les tabliers de pont. On garde les rues d'au moins
`LARGEUR_MIN` mètres dans la zone détaillée, et l'on note pour chaque bout de
rue les rues qui s'y raccordent (bouts à moins de `SOUDURE` m, ou point d'axe
proche : une rue qui débouche au milieu d'une autre).

Sortie : `maps/<village>/trafic.json`
  { rues: [{ p: [[x, z]…], l: largeur }], liens: [[[rue, bout]…] (bout 0), [...] (bout 1)]… }
  — `bout` 0 = premier point, 1 = dernier ; un lien vers le milieu d'une rue
  est noté par l'indice du point le plus proche, `[rue, 'i', k]`.

    py scripts/poilhes/trafic_reseau.py            (VILLAGE=capestang py … pour l'autre)
"""
import json
import math
import os
import pathlib

import numpy as np

RACINE = pathlib.Path(__file__).resolve().parent.parent.parent
VILLAGE = os.environ.get("VILLAGE", "poilhes").strip().lower()
DOSSIER = RACINE / "maps" / VILLAGE
LARGEUR_MIN = 3.0       # m : en dessous, une ruelle — pas de voiture
ZONE = 470.0            # m : la zone détaillée fait ±500 m, le sol est cassé au-delà
SOUDURE = 7.0
COLS, AXE = 9, 4


def tableau(meta, binaire, nom):
    t = meta["tableaux"][nom]
    return np.frombuffer(binaire, dtype="<f4", count=t["count"], offset=t["offset"])


def main():
    meta = json.loads((DOSSIER / "village.json").read_text(encoding="utf-8"))
    binaire = (DOSSIER / "village.bin").read_bytes()
    pos = tableau(meta, binaire, "routes_pos").reshape(-1, COLS, 3)
    info = tableau(meta, binaire, "routes_info").reshape(-1, COLS, 4)
    largeurs = np.hypot(pos[:, 2, 0] - pos[:, 6, 0], pos[:, 2, 2] - pos[:, 6, 2])

    troncons, courant = [], []
    for r in range(len(pos)):
        if courant and info[r, 0, 1] <= info[r - 1, 0, 1]:
            troncons.append(courant)
            courant = []
        courant.append((float(pos[r, AXE, 0]), float(pos[r, AXE, 2]), float(largeurs[r])))
    if courant:
        troncons.append(courant)
    axes = tableau(meta, binaire, "ponts_axes")
    k = 0
    while k + 2 <= len(axes):
        n = int(axes[k]); w = float(axes[k + 1]); k += 2
        pts = axes[k:k + 3 * n].reshape(-1, 3); k += 3 * n
        troncons.append([(float(p[0]), float(p[2]), w) for p in pts])

    # Une rue = un morceau continu d'un tronçon assez large et dans la zone.
    rues = []
    for t in troncons:
        morceau = []
        for x, z, w in t:
            if w >= LARGEUR_MIN and abs(x) < ZONE and abs(z) < ZONE:
                morceau.append((x, z, w))
            else:
                if len(morceau) >= 2:
                    rues.append(morceau)
                morceau = []
        if len(morceau) >= 2:
            rues.append(morceau)
    rues = [r for r in rues if sum(math.dist(r[i][:2], r[i + 1][:2]) for i in range(len(r) - 1)) > 12]

    tous = [(i, j, x, z) for i, r in enumerate(rues) for j, (x, z, _) in enumerate(r)]
    arr = np.array([[x, z] for _, _, x, z in tous])
    liens = []
    for i, r in enumerate(rues):
        paire = []
        for bout, j in ((0, 0), (1, len(r) - 1)):
            x, z = r[j][:2]
            d = np.hypot(arr[:, 0] - x, arr[:, 1] - z)
            vus, out = set(), []
            for q in np.argsort(d):
                if d[q] >= SOUDURE:
                    break
                ri, rj = tous[q][0], tous[q][1]
                if ri == i or ri in vus:
                    continue
                vus.add(ri)
                n = len(rues[ri])
                out.append([ri, 0] if rj == 0 else [ri, 1] if rj == n - 1 else [ri, "i", rj])
            paire.append(out)
        liens.append(paire)

    sortie = {
        "village": VILLAGE,
        "rues": [{"p": [[round(x, 2), round(z, 2)] for x, z, _ in r],
                  "l": round(float(np.median([w for _, _, w in r])), 1)} for r in rues],
        "liens": liens,
    }
    (DOSSIER / "trafic.json").write_text(json.dumps(sortie, separators=(",", ":")), encoding="utf-8")
    long = sum(sum(math.dist(r[i][:2], r[i + 1][:2]) for i in range(len(r) - 1)) for r in rues)
    culs = sum(1 for p in liens for b in p if not b)
    print(f"{VILLAGE} : {len(rues)} rues, {long / 1000:.1f} km, {culs} culs-de-sac")


if __name__ == "__main__":
    main()

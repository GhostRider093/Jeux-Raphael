"""L'itinéraire routier d'un village à l'autre, tiré de la carte OpenStreetMap.

Une course entre deux villages ne se trace pas à la règle : entre Poilhes et
Capestang il y a **une route**, celle qui longe le canal, et c'est elle qu'on
suit. Ce script la calcule une fois pour toutes :

1. il demande à OpenStreetMap toutes les voies carrossables de l'emprise du
   pays (la même requête Overpass que le reste de la chaîne, avec le même
   cache) ;
2. il en fait un graphe — les nœuds partagés entre deux voies sont les
   carrefours — et pondère chaque tronçon par sa longueur, majorée sur les
   chemins de terre et les voies de service : à longueur égale, on préfère une
   départementale ;
3. il cherche le plus court chemin (Dijkstra) entre le point le plus proche de
   chaque village ;
4. il écrit `maps/pays-<nom>/route.json` : la polyligne dans le repère local du
   pays (celui de `geo.py`, converti en coordonnées Three.js), simplifiée, avec
   sa longueur.

Le jeu n'a plus qu'à poser ses portes dessus et à dessiner le tracé au sol.

    PAYS=canal py scripts/poilhes/route_pays.py
"""
import heapq
import json
import math
import os
import pathlib
import sys

# On se place dans le repère du pays : `VILLAGE=pays-<nom>` fait exactement cela
# (voir la fin de sites.py), donc on le pose avant d'importer le reste.
PAYS = os.environ.get("PAYS", "canal").strip().lower()
os.environ.setdefault("VILLAGE", f"pays-{PAYS}")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import sources  # noqa: E402
from geo import to_local  # noqa: E402
from sites import PAYS as PAYS_DEF, SITES  # noqa: E402

RACINE = pathlib.Path(__file__).resolve().parent.parent.parent
SORTIE = RACINE / "maps" / f"pays-{PAYS}"

# Voies retenues, et ce qu'elles coûtent par rapport à leur longueur réelle.
# Une piste fait le même mètre qu'une départementale, mais on ne la prend que si
# elle épargne un vrai détour.
COUT = {
    "trunk": 1.0, "primary": 1.0, "secondary": 1.05, "tertiary": 1.1,
    "unclassified": 1.25, "residential": 1.3, "living_street": 1.5,
    "service": 1.9, "track": 2.4,
}


def voies(half):
    """Toutes les voies carrossables de l'emprise, avec leur géométrie."""
    lon_a, lat_a, lon_b, lat_b = sources.bbox_geo(half)
    bb = f"{lat_a},{lon_a},{lat_b},{lon_b}"
    types = "|".join(COUT)
    requete = f"""[out:json][timeout:180];
way["highway"~"^({types})$"]({bb});
out geom tags;"""
    import urllib.parse
    data = urllib.parse.urlencode({"data": requete}).encode()
    for url in sources.OVERPASS:
        try:
            return json.loads(sources._get(url, data=data, tries=2))["elements"]
        except Exception:
            continue
    return []


def construire_graphe(elements):
    """Graphe {nœud: [(voisin, coût, distance)]}, les nœuds étant des points arrondis.

    Arrondir au mètre est ce qui **soude** le réseau : deux voies qui se croisent
    partagent alors le même nœud, sans quoi le graphe n'est qu'un tas de rubans
    parallèles et aucun chemin ne traverse jamais un carrefour.
    """
    graphe = {}
    for e in elements:
        geometrie = e.get("geometry")
        if not geometrie or len(geometrie) < 2:
            continue
        poids = COUT.get(e.get("tags", {}).get("highway"), 1.5)
        points = [to_local(g["lon"], g["lat"]) for g in geometrie]
        for a, b in zip(points, points[1:]):
            na, nb = (round(a[0]), round(a[1])), (round(b[0]), round(b[1]))
            if na == nb:
                continue
            d = math.dist(a, b)
            graphe.setdefault(na, []).append((nb, d * poids, d))
            graphe.setdefault(nb, []).append((na, d * poids, d))
    return graphe


def plus_proche(graphe, cible):
    return min(graphe, key=lambda n: (n[0] - cible[0]) ** 2 + (n[1] - cible[1]) ** 2)


def chemin(graphe, depart, arrivee):
    """Dijkstra classique ; renvoie la suite de nœuds, ou None."""
    dist = {depart: 0.0}
    precedent = {}
    file = [(0.0, depart)]
    vus = set()
    while file:
        cout, noeud = heapq.heappop(file)
        if noeud in vus:
            continue
        vus.add(noeud)
        if noeud == arrivee:
            break
        for voisin, poids, _ in graphe.get(noeud, ()):
            nouveau = cout + poids
            if nouveau < dist.get(voisin, math.inf):
                dist[voisin] = nouveau
                precedent[voisin] = noeud
                heapq.heappush(file, (nouveau, voisin))
    if arrivee not in dist:
        return None
    suite = [arrivee]
    while suite[-1] != depart:
        suite.append(precedent[suite[-1]])
    return suite[::-1]


def simplifier(points, tolerance=6.0):
    """Douglas-Peucker : on garde la forme, on jette les sommets inutiles."""
    if len(points) < 3:
        return points
    ax, an = points[0]
    bx, bn = points[-1]
    dx, dn = bx - ax, bn - an
    long = math.hypot(dx, dn) or 1.0
    pire, index = 0.0, 0
    for i, (x, n) in enumerate(points[1:-1], 1):
        ecart = abs(dn * x - dx * n + bx * an - bn * ax) / long
        if ecart > pire:
            pire, index = ecart, i
    if pire <= tolerance:
        return [points[0], points[-1]]
    return simplifier(points[:index + 1], tolerance)[:-1] + simplifier(points[index:], tolerance)


def main() -> int:
    definition = PAYS_DEF.get(PAYS)
    if not definition:
        print(f"Pays inconnu : {PAYS}")
        return 1
    half = SITES[f"pays-{PAYS}"]["half"]
    print(f"Pays {definition['nom']} - emprise {half:.0f} m")

    elements = voies(half)
    print(f"  {len(elements)} voies recues d'OpenStreetMap")
    graphe = construire_graphe(elements)
    print(f"  {len(graphe)} noeuds dans le graphe routier")
    if not graphe:
        return 1

    # Départ et arrivée : le point du réseau le plus proche de chaque village.
    membres = definition["villages"]
    centres = []
    for nom in membres:
        v = SITES[nom]
        centres.append((to_local(v["lon"], v["lat"]), nom))
    (depart, nom_a), (arrivee, nom_b) = centres[0], centres[-1]
    na, nb = plus_proche(graphe, depart), plus_proche(graphe, arrivee)
    print(f"  {nom_a} -> {nom_b} : accroche à {math.dist(na, depart):.0f} m et {math.dist(nb, arrivee):.0f} m du centre")

    suite = chemin(graphe, na, nb)
    if not suite:
        print("  aucun itineraire : le reseau est coupe dans cette emprise")
        return 1
    longueur = sum(math.dist(a, b) for a, b in zip(suite, suite[1:]))
    points = simplifier([(float(x), float(n)) for x, n in suite])
    print(f"  itineraire : {longueur:.0f} m, {len(suite)} points -> {len(points)} apres simplification")

    SORTIE.mkdir(parents=True, exist_ok=True)
    fichier = SORTIE / "route.json"
    fichier.write_text(json.dumps({
        "pays": PAYS,
        "de": nom_a, "vers": nom_b,
        "longueur": round(longueur, 1),
        # Repère Three.js du jeu : x = est, z = -nord.
        "points": [[round(x, 1), round(-n, 1)] for x, n in points],
    }, ensure_ascii=False), encoding="utf-8")
    print(f"  ecrit : {fichier.relative_to(RACINE)} ({fichier.stat().st_size // 1024} Ko)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

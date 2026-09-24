"""Villages que la chaîne sait reconstruire, et pays qui en rassemblent plusieurs.

La chaîne n'a rien de propre à Poilhes : elle lit l'IGN et OpenStreetMap autour
d'un point. Changer de village, c'est changer trois nombres. Ce fichier les tient,
pour qu'ils ne soient pas éparpillés dans le code.

    VILLAGE=capestang py scripts/poilhes/build_village.py
    PAYS=canal py scripts/poilhes/build_pays.py

`half` : demi-côté de la zone détaillée, en mètres. À choisir sur l'étendue bâtie
— trop grand, la photo aérienne perd en définition (deux tuiles de 2048 px) ;
trop petit, le village est coupé.
"""
import os

SITES = {
    "poilhes": {
        "nom": "Poilhes (Hérault)",
        "lon": 3.0797, "lat": 43.3077,
        "half": 500.0, "far": 3000.0,
    },
    "capestang": {
        "nom": "Capestang (Hérault)",
        # Centre pris sur la collégiale Saint-Étienne, qui domine le village.
        "lon": 3.0389, "lat": 43.3283,
        # Capestang est quatre fois plus peuplé que Poilhes : il lui faut de la place.
        "half": 560.0, "far": 3000.0,
    },
}

# ---------------------------------------------------------------------------- pays
# Un pays réunit plusieurs villages voisins dans une seule carte, à leur écart
# réel. Il n'a pas de zone détaillée à lui : il emprunte celles de ses villages
# et ne fabrique que le relief qui les relie — sans quoi deux plans lointains de
# 6 km se superposeraient, avec deux expositions différentes.
#
# `far` : demi-côté du relief commun. À choisir sur l'écart entre les villages,
# plus la campagne qu'on veut voir au-delà (ici 4 km : les deux villages sont à
# 4 022 m l'un de l'autre, il reste 1,8 km d'horizon derrière chacun).
PAYS = {
    "canal": {
        "nom": "Poilhes et Capestang",
        "villages": ["poilhes", "capestang"],
        "far": 4000.0,
    },
}


def centre_pays(nom):
    """Centre géographique d'un pays : le milieu des centres de ses villages."""
    membres = [SITES[v] for v in PAYS[nom]["villages"]]
    return (sum(s["lon"] for s in membres) / len(membres),
            sum(s["lat"] for s in membres) / len(membres))


# Les pays entrent dans SITES comme des sites ordinaires (`pays-canal`) : le
# repère local, l'emprise et le cache de téléchargement se construisent alors
# exactement comme pour un village, sans un cas particulier de plus.
for _nom, _pays in PAYS.items():
    _lon, _lat = centre_pays(_nom)
    SITES["pays-" + _nom] = {"nom": _pays["nom"], "lon": _lon, "lat": _lat,
                             "half": _pays["far"], "far": _pays["far"]}

NOM = os.environ.get("VILLAGE", "poilhes").strip().lower()
if NOM not in SITES:
    raise SystemExit(f"Village inconnu : {NOM}. Connus : {', '.join(SITES)}")
SITE = SITES[NOM]

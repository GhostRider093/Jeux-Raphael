"""Chaussée en volume : des rubans de bitume, au lieu de la photo aérienne.

La BD TOPO donne l'axe de chaque tronçon, sa largeur et sa nature. On en tire un
ruban posé sur le relief, avec son profil en travers : bombement au milieu,
caniveau et accotement sur les côtés. C'est ce profil qui fait qu'une rue se lit
comme une rue — la photo prise au zénith, elle, n'a ni bord ni relief, et dans les
ruelles étroites elle n'est qu'une tache d'ombre.

Le maillage est **indexé** : un ruban de 3 m de pas coûte neuf sommets par section
et rien de plus. Sans index, les mêmes routes pesaient quatre fois plus lourd.

Attributs par sommet :
  position (x, y, -nord)
  normale
  info = (u, s, revêtement, graine)
    u : écart à l'axe, -1 au bord gauche de la chaussée, +1 au bord droit,
        au-delà de 1 c'est l'accotement ;
    s : distance parcourue depuis le début du tronçon (m), pour les marquages ;
    revêtement : 0 enrobé, 1 empierré, 2 pavé ;
    demi : demi-largeur réelle de la chaussée (m). C'est elle qui décide du
      marquage : une ruelle de 3 m n'a pas de bande axiale, une départementale si.
  fin = distance au bout le plus proche du tronçon (m). Les tronçons se terminent
      aux carrefours : c'est ce qui permet d'y effacer les bandes blanches, comme
      dans la réalité où l'on ne peint pas une ligne au milieu d'un croisement.
"""
import numpy as np

# Profil en travers, en fraction de la demi-chaussée et en mètres de dénivelé.
# Le bombement (5 cm au centre) est ce qui attrape la lumière rasante du soir.
PROFIL = [
    (-1.34, -0.075),   # accotement, terre et gravier
    (-1.06, -0.055),   # caniveau
    (-1.00, 0.000),    # bord de chaussée
    (-0.55, 0.036),
    (0.00, 0.055),     # axe
    (0.55, 0.036),
    (1.00, 0.000),
    (1.06, -0.055),
    (1.34, -0.075),
]
PAS = 3.0              # pas d'échantillonnage le long de l'axe (m)
LEVEE = 0.05           # décollement du terrain, pour ne pas clignoter avec le sol


def _echantillons(ligne, pas):
    """Points régulièrement espacés le long d'une polyligne, extrémités comprises."""
    longueur = ligne.length
    if longueur < pas:
        return np.array([0.0, longueur])
    n = max(1, int(round(longueur / pas)))
    return np.linspace(0.0, longueur, n + 1)


def build_roads(axes, terrain, surfaces_kind):
    """Rubans de chaussée. Renvoie (positions, normales, infos, fins, indices)."""
    pos, nor, info, fins, idx = [], [], [], [], []
    base = 0
    for rang, a in enumerate(axes):
        if a["pont"]:
            continue                      # les ponts ont déjà leur tablier
        ligne = a["ligne"].simplify(0.2)
        if ligne.length < 4.0:
            continue
        demi = max(1.0, (a["largeur"] or 4.0) / 2)
        revet = float(surfaces_kind.get(a["nature"], 0))
        # Les rues larges passent légèrement au-dessus des étroites : à un
        # carrefour, deux rubans à la même altitude se battraient pixel par pixel.
        levee = LEVEE + demi * 0.004

        ss = _echantillons(ligne, PAS)
        sections = []
        for s in ss:
            p = ligne.interpolate(s)
            q = ligne.interpolate(min(ligne.length, s + 0.5))
            r = ligne.interpolate(max(0.0, s - 0.5))
            tx, tn = q.x - r.x, q.y - r.y
            norme = np.hypot(tx, tn) or 1.0
            tx, tn = tx / norme, tn / norme
            nx, nn = -tn, tx                      # normale horizontale à l'axe
            sections.append((p.x, p.y, nx, nn, s))

        rangee = []
        for (px, pn, nx, nn, s) in sections:
            ligne_pts = []
            for (u, dz) in PROFIL:
                x = px + nx * u * demi
                n = pn + nn * u * demi
                y = float(terrain.at(x, n)) + dz + levee
                ligne_pts.append((x, y, -n, u, s))
            rangee.append(ligne_pts)

        cols = len(PROFIL)
        for r_i, ligne_pts in enumerate(rangee):
            for (x, y, z, u, s) in ligne_pts:
                pos.append((x, y, z))
                info.append((u, s, revet, demi))
                fins.append(min(s, ligne.length - s))
            nor.extend([(0.0, 1.0, 0.0)] * cols)
        for r_i in range(len(rangee) - 1):
            for c in range(cols - 1):
                a0 = base + r_i * cols + c
                b0 = a0 + 1
                a1 = a0 + cols
                b1 = a1 + 1
                idx.extend([a0, a1, b0, b0, a1, b1])
        base += len(rangee) * cols

    if not pos:
        vide = np.zeros((0, 3), np.float32)
        return vide, vide, np.zeros((0, 4), np.float32), np.zeros(0, np.float32), np.zeros(0, np.uint32)

    pos = np.array(pos, np.float32)
    info = np.array(info, np.float32)
    fins = np.array(fins, np.float32)
    idx = np.array(idx, np.uint32)
    nor = _normales(pos, idx)
    return pos, nor, info, fins, idx


def _normales(pos, idx):
    """Normales par sommet, moyennées sur les faces : le bombement doit s'éclairer."""
    nor = np.zeros_like(pos)
    tri = idx.reshape(-1, 3)
    p0, p1, p2 = pos[tri[:, 0]], pos[tri[:, 1]], pos[tri[:, 2]]
    face = np.cross(p1 - p0, p2 - p0)
    for k in range(3):
        np.add.at(nor, tri[:, k], face)
    longueur = np.linalg.norm(nor, axis=1)
    longueur[longueur == 0] = 1.0
    nor /= longueur[:, None]
    nor[nor[:, 1] < 0] *= -1
    return nor.astype(np.float32)

"""Les modèles du skatepark : du STL au relief que les roues sentent.

Le parc est une fonction de hauteur (`poilhes-skatepark.js`, `profil(u, v)`).
Un modèle 3D posé dessus doit donc exister deux fois : comme maillage à
regarder (le GLB) et comme hauteurs à rouler. Ce script fait la seconde
moitié : il **rastérise le dessus** de chaque modèle (z-buffer par triangle,
vu du ciel) dans une grille au pas de 10 cm. La même grille sert à dessiner le
plan du parc et, une fois les modèles placés, le fichier de hauteurs du jeu.

    py scripts/poilhes/skatepark_modeles.py fiches      # une image ombrée par modèle + planche
    py scripts/poilhes/skatepark_modeles.py plan        # le plan du parc d'après skatepark-plan.json
    py scripts/poilhes/skatepark_modeles.py hauteurs    # maps/poilhes/skatepark-hauteurs.bin + GLB placés

Échelles : les lots sont des jouets (fingerboard). Une tuile d'obstacle fait
100 mm, un module FreeCAD 120 mm. `ECHELLES` dit en mètres par mm de modèle.
"""
import glob
import json
import os
import struct
import sys

import numpy as np
import trimesh

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(RACINE, 'perso', 'skatepark-stl', 'glb')
FICHES = os.path.join(RACINE, 'perso', 'skatepark-stl', 'fiches')
PLAN = os.path.join(RACINE, 'maps', 'poilhes', 'skatepark-plan.json')
PAS = 0.1                      # m par cellule de la grille de hauteurs

# m par mm de modèle : les obstacles (tuiles de 100 mm) à 4 m la tuile,
# le lot FreeCAD (120 mm) à 3,6 m, le Tech deck (220 mm de haut) ramené à 3,3 m.
ECHELLES = {'obj_': 0.040, 'Tech': 0.015}
ECHELLE_DEFAUT = 0.030


def echelle_de(nom):
    for prefixe, e in ECHELLES.items():
        if nom.startswith(prefixe):
            return e
    return ECHELLE_DEFAUT


def charger(nom, echelle=None):
    """Le maillage en mètres, posé au sol (z min = 0), centré en x/y, z vers le haut (repère STL)."""
    m = trimesh.load(os.path.join(SRC, nom + '.glb'), force='mesh')
    e = echelle or echelle_de(nom)
    v = m.vertices * e
    # les STL ont z vers le haut ; le GLB exporté par trimesh aussi (pas de conversion y-up)
    v = v - [v[:, 0].min() + (v[:, 0].max() - v[:, 0].min()) / 2, v[:, 1].min() + (v[:, 1].max() - v[:, 1].min()) / 2, v[:, 2].min()]
    return trimesh.Trimesh(vertices=v, faces=m.faces, process=False)


def raster(mesh, pas=PAS, marge=0.0, rot=0.0):
    """Hauteur du dessus (m) sur une grille (lignes = y, colonnes = x) ; -1 hors du modèle.

    Z-buffer par triangle : pour chaque face, les cellules dont le centre tombe
    dans sa projection prennent le max du z interpolé. Le dessous et les faces
    verticales ne comptent pas (ils ne dépassent jamais le dessus)."""
    v = mesh.vertices.copy()
    if rot:
        c, s = np.cos(rot), np.sin(rot)
        v[:, :2] = v[:, :2] @ np.array([[c, -s], [s, c]]).T
    x0, y0 = v[:, 0].min() - marge, v[:, 1].min() - marge
    x1, y1 = v[:, 0].max() + marge, v[:, 1].max() + marge
    nx, ny = int(np.ceil((x1 - x0) / pas)) + 1, int(np.ceil((y1 - y0) / pas)) + 1
    H = np.full((ny, nx), -1.0)
    F = v[mesh.faces]                        # (n, 3, 3)
    for tri in F:
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = tri
        det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(det) < 1e-9:
            continue
        i0, i1 = int((min(ax, bx, cx) - x0) / pas), int((max(ax, bx, cx) - x0) / pas) + 1
        j0, j1 = int((min(ay, by, cy) - y0) / pas), int((max(ay, by, cy) - y0) / pas) + 1
        xs = x0 + np.arange(i0, min(i1 + 1, nx)) * pas
        ys = y0 + np.arange(j0, min(j1 + 1, ny)) * pas
        X, Y = np.meshgrid(xs, ys)
        l1 = ((bx - X) * (cy - Y) - (cx - X) * (by - Y)) / det
        l2 = ((cx - X) * (ay - Y) - (ax - X) * (cy - Y)) / det
        l3 = 1 - l1 - l2
        dedans = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        if not dedans.any():
            continue
        Z = l1 * az + l2 * bz + l3 * cz
        bloc = H[j0:j0 + len(ys), i0:i0 + len(xs)]
        np.maximum(bloc, np.where(dedans, Z, -1.0), out=bloc)
    return H, (x0, y0)


def ombrer(H, pas=PAS):
    """Image ombrée (relief éclairé du nord-ouest), hors modèle en gris clair."""
    from PIL import Image
    Hs = np.where(H < 0, 0, H)
    gy, gx = np.gradient(Hs, pas)
    lum = 0.55 + 0.45 * (-0.6 * gx + 0.6 * gy) / np.sqrt(1 + gx * gx + gy * gy)
    lum = np.clip(lum, 0.15, 1.0)
    teinte = 0.45 + 0.35 * np.clip(Hs / max(0.01, Hs.max()), 0, 1)
    img = (lum * teinte * 255).astype(np.uint8)
    rgb = np.stack([img, img, img], -1)
    rgb[H < 0] = (225, 228, 232)
    return Image.fromarray(rgb[::-1])       # y vers le haut → ligne 0 en haut


def fiches():
    from PIL import Image, ImageDraw, ImageFont
    os.makedirs(FICHES, exist_ok=True)
    noms = sorted(os.path.splitext(os.path.basename(f))[0] for f in glob.glob(os.path.join(SRC, '*.glb')))
    noms = [n for n in noms if not any(n.startswith(f'obj_{k}_') for k in range(20, 28))]
    cases = []
    for nom in noms:
        m = charger(nom)
        H, _ = raster(m)
        img = ombrer(H)
        img.save(os.path.join(FICHES, nom + '.png'))
        e = m.extents
        cases.append((img, nom.replace('_Fingerboard_obstacles', '').replace('_', ' '), f'{e[0]:.1f} × {e[1]:.1f} m, h {e[2]:.2f} m'))
        print(nom, [round(float(x), 2) for x in e])
    cols, T = 5, 280
    try:
        police, petite = ImageFont.truetype('arial.ttf', 17), ImageFont.truetype('arial.ttf', 14)
    except Exception:
        police = petite = ImageFont.load_default()
    rows = (len(cases) + cols - 1) // cols
    planche = Image.new('RGB', (cols * T, rows * (T + 44)), (240, 242, 245))
    d = ImageDraw.Draw(planche)
    for k, (img, court, dims) in enumerate(cases):
        w, h = img.size
        f = min((T - 16) / w, (T - 16) / h)
        im = img.resize((max(1, int(w * f)), max(1, int(h * f))))
        x, y = (k % cols) * T, (k // cols) * (T + 44)
        planche.paste(im, (x + (T - im.size[0]) // 2, y + (T - im.size[1]) // 2))
        d.text((x + 8, y + T + 2), court, fill=(20, 20, 20), font=police)
        d.text((x + 8, y + T + 22), dims, fill=(90, 90, 90), font=petite)
    out = os.path.join(RACINE, 'perso', 'skatepark-stl', 'planche-reliefs.png')
    planche.save(out)
    print(out)


def lire_plan():
    return json.load(open(PLAN, encoding='utf-8'))


def composer(plan, pas=PAS):
    """La grille du parc entier : hauteurs (m) au-dessus de la dalle, 0 ailleurs."""
    U, V = plan['demi_u'], plan['demi_v']
    nu, nv = int(round(2 * U / pas)) + 1, int(round(2 * V / pas)) + 1
    G = np.zeros((nv, nu))
    for p in plan['pieces']:
        m = charger(p['modele'], p.get('echelle'))
        rot = np.deg2rad(p.get('rot', 0))
        H, (x0, y0) = raster(m, pas, rot=rot)
        # u vers l'est = x du modèle ; v vers le sud = -y du modèle (le STL a y vers le nord)
        for j in range(H.shape[0]):
            for i in range(H.shape[1]):
                h = H[j, i]
                if h < 0:
                    continue
                # relief_max : une barre de rail à 2 m rastérisée devient un mur
                # invisible ; on plafonne le relief senti par les roues.
                if p.get('relief_max') is not None:
                    h = min(h, float(p['relief_max']))
                u = p['u'] + x0 + i * pas
                v = p['v'] - (y0 + j * pas)
                cu, cv = int(round((u + U) / pas)), int(round((v + V) / pas))
                if 0 <= cu < nu and 0 <= cv < nv and h > G[cv, cu]:
                    G[cv, cu] = h
    return G


def plan_image():
    from PIL import Image, ImageDraw
    plan = lire_plan()
    G = composer(plan)
    img = ombrer(np.where(G > 0.005, G, -1))
    img = img.transpose(Image.FLIP_TOP_BOTTOM)     # v (sud) vers le bas de l'image
    d = ImageDraw.Draw(img)
    U, V = plan['demi_u'], plan['demi_v']
    for p in plan['pieces']:
        x, y = (p['u'] + U) / PAS, (p['v'] + V) / PAS
        d.text((x - 20, y - 6), p.get('nom', p['modele'])[:14], fill=(180, 30, 30))
    img = img.resize((img.size[0] * 2, img.size[1] * 2))
    out = os.path.join(RACINE, 'perso', 'skatepark-stl', 'plan-skatepark.png')
    img.save(out)
    print(out, 'max', round(float(G.max()), 2), 'm')


def hauteurs():
    plan = lire_plan()
    G = composer(plan)
    out = os.path.join(RACINE, 'maps', 'poilhes', 'skatepark-hauteurs.bin')
    with open(out, 'wb') as f:
        f.write(struct.pack('<4sffii', b'SKP1', plan['demi_u'], plan['demi_v'], G.shape[1], G.shape[0]))
        f.write((np.clip(G, 0, 60) * 1000).astype(np.uint16).tobytes())
    print(out, G.shape, 'max', round(float(G.max()), 2))


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'fiches'
    {'fiches': fiches, 'plan': plan_image, 'hauteurs': hauteurs}[cmd]()

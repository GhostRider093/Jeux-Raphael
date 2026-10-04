"""Volant + mains de la vue intérieure : image générée sur fond vert → calque transparent.

    py scripts/interieur/preparer_volant.py <image fond vert> [--sortie assets/car/volant-berline.webp]
                                            [--apercu <photo d'habitacle>]

Le fond vert est retiré (clé + suppression du débord vert sur les bords), puis l'image
est recadrée en carré **centré sur le moyeu**, avec la jante qui fait `JANTE` du côté :
le jeu peut ainsi faire tourner le calque autour de son centre et le poser à la bonne
taille sans connaître l'image (`maps/vue-interieure.js`, VOLANT_U/V/D).

Le centre est trouvé sur la colonne du milieu : premier pixel opaque en partant du haut
(haut de jante) et en partant du bas (bas de jante — les bras sont sur les côtés).
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

JANTE = 0.5          # diamètre de la jante / côté de l'image produite (même valeur dans vue-interieure.js)
COTE = 1600          # côté de l'image produite, en px

ap = argparse.ArgumentParser()
ap.add_argument("image")
ap.add_argument("--sortie", default="assets/car/volant-berline.webp")
ap.add_argument("--apercu", default=None, help="photo d'habitacle sur laquelle poser le volant pour vérifier")
args = ap.parse_args()

im = np.asarray(Image.open(args.image).convert("RGB")).astype(float)
r, g, b = im[..., 0], im[..., 1], im[..., 2]

# clé : plus le vert domine les deux autres, plus c'est du fond
domine = g - np.maximum(r, b)
alpha = 1.0 - np.clip((domine - 25) / 55, 0, 1)
alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(3))) / 255.0
# débord vert sur les bords : le vert ne dépasse pas le max des deux autres
g2 = np.minimum(g, np.maximum(r, b) + 6)
rgb = np.dstack([r, g2, b])

H, W = alpha.shape
opaque = alpha > 0.5
col = opaque[:, W // 2 - 3:W // 2 + 4].any(axis=1)
ys = np.nonzero(col)[0]
haut, bas = ys.min(), ys.max()
cy = (haut + bas) / 2
diam = bas - haut
ligne = opaque[int(haut + diam * 0.08)]
xs = np.nonzero(ligne)[0]
cx = (xs.min() + xs.max()) / 2 if len(xs) else W / 2

# carré centré sur le moyeu, jante = JANTE du côté
cote_src = diam / JANTE
rgba = Image.fromarray(np.dstack([rgb, alpha * 255]).clip(0, 255).astype(np.uint8), "RGBA")
x0, y0 = cx - cote_src / 2, cy - cote_src / 2
carre = Image.new("RGBA", (int(round(cote_src)),) * 2, (0, 0, 0, 0))
carre.paste(rgba, (int(round(-x0)), int(round(-y0))))
carre = carre.resize((COTE, COTE), Image.LANCZOS)

sortie = Path(args.sortie)
sortie.parent.mkdir(parents=True, exist_ok=True)
carre.save(sortie, "WEBP", quality=90, method=6)
print(f"{sortie} — moyeu ({cx:.0f}, {cy:.0f}), jante {diam:.0f} px dans la source")

if args.apercu:
    # même pose que le jeu sur un écran 16:9 (valeurs de vue-interieure.js)
    U, V, D, CADRAGE_Y = 0.245, 0.50, 0.36, 0.12
    fond = Image.open(args.apercu).convert("RGBA")
    S = fond.size[0]
    ciel = Image.new("RGBA", fond.size, (120, 165, 215, 255))
    ciel.alpha_composite(fond)
    taille = int(D * S / JANTE)
    v = carre.resize((taille, taille), Image.LANCZOS)
    calque = Image.new("RGBA", fond.size, (0, 0, 0, 0))
    calque.paste(v, (int(U * S - taille / 2), int(V * S - taille / 2)), v)
    ciel.alpha_composite(calque)
    h = int(S * 9 / 16)
    haut_ecran = int((S - h) * CADRAGE_Y)
    ciel.crop((0, haut_ecran, S, haut_ecran + h)).convert("RGB").save(
        sortie.with_name(sortie.stem + "-apercu.jpg"), quality=86)

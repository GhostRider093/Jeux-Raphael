"""Prépare l'image d'habitacle de la vue intérieure de la berline (01/10/2026).

Entrée : une photo d'habitacle carrée fournie par Arnaud.
Sortie : assets/car/interieur-berline.webp — pare-brise et vitres transparents (on
voit le village à travers), agrandie ×2 (Lanczos, local : le GPU reste aux
moteurs de Jarvis), plus un aperçu sur fond bleu dans Downloads.

Deux façons de trouver les vitres :
  --vitres blanc  (défaut) : vitres d'un blanc uni (1re photo) ;
  --vitres clair  : vitres qui montrent un paysage (2e photo, « sous la pluie ») —
                    tout ce qui est clair dans le haut de l'image, montants et
                    plafond étant sombres ; la plus grande tache est le pare-brise,
                    ses trous (gouttes, reflets) sont bouchés, les essuie-glaces
                    au bord restent opaques.
  --retro x0,y0,x1,y1 : rectangle (en pixels de la source) à rendre transparent —
                    le rétroviseur de la 1re photo (« c'est un sauvage »).

    py scripts/interieur/preparer_interieur.py photo.jpg --vitres clair
"""
import argparse
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument("photo")
ap.add_argument("--vitres", choices=["blanc", "clair"], default="blanc")
ap.add_argument("--seuil", type=float, default=78, help="luminosité mini d'une vitre (mode clair)")
ap.add_argument("--haut", type=float, default=0.40, help="part haute de l'image où chercher les vitres (mode clair)")
ap.add_argument("--plafonnier", type=float, default=0.13, help="sous cette part de la hauteur, le pare-brise est plein d'un bord à l'autre (mode clair)")
ap.add_argument("--retro", default=None)
args = ap.parse_args()

src = Path(args.photo)
sortie = Path(__file__).resolve().parents[2] / "assets" / "car" / "interieur-berline.webp"
im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(np.float32)
H, W, _ = a.shape

if args.vitres == "blanc":
    blanc = a.min(axis=2) > 232
    lab, n = ndimage.label(blanc)
    tailles = ndimage.sum(blanc, lab, range(1, n + 1))
    garder = np.zeros(n + 1, bool)
    for i, t in enumerate(tailles, start=1):
        if t < 400:
            continue
        ys, xs = np.nonzero(lab == i)
        garder[i] = xs.min() <= 2 or xs.max() >= W - 3 or (ys.min() < H * 0.25 and t > 20000)
    vitre = garder[lab]
else:
    clair = a.mean(axis=2) > args.seuil
    clair[int(H * args.haut):] = False
    clair = ndimage.binary_opening(clair, iterations=2)          # les petits reflets du plafond s'en vont
    lab, n = ndimage.label(clair)
    tailles = ndimage.sum(clair, lab, range(1, n + 1))
    garder = np.zeros(n + 1, bool)
    garder[1 + int(np.argmax(tailles))] = True                    # le pare-brise
    for i, t in enumerate(tailles, start=1):                       # les vitres latérales, au bord
        ys, xs = np.nonzero(lab == i)
        if t > 300 and (xs.min() <= 2 or xs.max() >= W - 3):
            garder[i] = True
    vitre = ndimage.binary_fill_holes(garder[lab])
    # Rangée par rangée, sous le plafonnier : le pare-brise est plein entre son
    # bord gauche et son bord droit (les gouttes ne trouent plus rien), et ces
    # bords sont lissés sur neuf rangées (les montants ne sont plus dentelés).
    y0 = int(H * args.plafonnier)
    lignes = [y for y in range(y0, int(H * args.haut)) if vitre[y].any()]
    if lignes:
        g = np.array([np.nonzero(vitre[y])[0].min() for y in lignes], float)
        d = np.array([np.nonzero(vitre[y])[0].max() for y in lignes], float)
        g = ndimage.median_filter(g, size=9); d = ndimage.median_filter(d, size=9)
        for y, xg, xd in zip(lignes, g, d):
            vitre[y, int(xg):int(xd) + 1] = True

if args.retro:
    x0, y0, x1, y1 = (int(v) for v in args.retro.split(","))
    vitre[y0:y1, x0:x1] = True

# bord adouci : la vitre s'étend d'un pixel, puis on floute le masque
vitre = ndimage.binary_dilation(vitre, iterations=1)
alpha = 1.0 - np.asarray(Image.fromarray((vitre * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))) / 255.0
rgba = np.dstack([a, alpha * 255]).astype(np.uint8)

out = Image.fromarray(rgba, "RGBA").resize((W * 2, H * 2), Image.LANCZOS)
out = out.filter(ImageFilter.UnsharpMask(radius=1.5, percent=60, threshold=2))
sortie.parent.mkdir(parents=True, exist_ok=True)
out.save(sortie, "WEBP", quality=90, method=6)
ys = np.nonzero(vitre.any(axis=1))[0]
print(f"{sortie} — {out.size[0]}x{out.size[1]}, vitres {vitre.mean()*100:.1f} %, "
      f"pare-brise de {ys.min()/H:.3f} à {ys.max()/H:.3f} de la hauteur")
fond = Image.new("RGB", out.size, (90, 150, 220))
fond.paste(out, (0, 0), out)
fond.save(Path.home() / "Downloads" / "interieur-berline-apercu.jpg", quality=88)

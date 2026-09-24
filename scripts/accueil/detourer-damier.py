"""Retire le damier « fond transparent » qu'un générateur d'images a peint dans le PNG.

ChatGPT livre parfois un RGB avec le damier gris dessiné dedans, sans couche
alpha. Retirer « le gris » est impossible quand l'illustration elle-même est
grise ; on reconnaît donc le damier à sa **statistique locale** : dans une fenêtre de
deux carreaux, moitié de gris clair, moitié de gris sombre, presque rien entre
les deux et aucune couleur. Le dessin, même gris, a des valeurs continues. On ne garde ensuite que le damier
relié aux bords, et on lisse le bord d'un pixel.

    python scripts/accueil/detourer-damier.py entree.png sortie.png [--debug apercu.png] [--part 0.2] [--seuil 0.7] [--trou 120]
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

src, dst = sys.argv[1], sys.argv[2]
debug = sys.argv[sys.argv.index('--debug') + 1] if '--debug' in sys.argv else None
# Sensibilité : part minimale de chaque gris dans la fenêtre, et somme des deux.
# Baisser (0.15 / 0.6) quand un reste de damier se cache sous un reflet ou une ombre.
part = float(sys.argv[sys.argv.index('--part') + 1]) if '--part' in sys.argv else 0.2
seuil = float(sys.argv[sys.argv.index('--seuil') + 1]) if '--seuil' in sys.argv else 0.7

im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(np.int16)
h, w, _ = a.shape
lum = a.mean(axis=2)
sat = a.max(axis=2) - a.min(axis=2)

# Les deux gris du damier, mesurés sur la bande des bords : les deux modes.
bande = np.concatenate([lum[:12].ravel(), lum[-12:].ravel(), lum[:, :12].ravel(), lum[:, -12:].ravel()])
hist, edges = np.histogram(bande, bins=64, range=(0, 256))
modes = np.argsort(hist)[::-1]
clair = edges[modes[0]] + 2
sombre = next(edges[m] + 2 for m in modes[1:] if abs(edges[m] - clair) > 30)
clair, sombre = max(clair, sombre), min(clair, sombre)
print(f'gris du damier : clair ~{clair:.0f}, sombre ~{sombre:.0f}')

# Dans une fenêtre de deux carreaux, le damier = ~moitié clair, ~moitié sombre,
# presque rien entre les deux, et aucune couleur. Le dessin, même gris, a des
# valeurs continues et des contours foncés.
F = 22
L = (np.abs(lum - clair) <= 24).astype(float)
D = (np.abs(lum - sombre) <= 24).astype(float)
C = (sat > 12).astype(float)
fL = ndimage.uniform_filter(L, F); fD = ndimage.uniform_filter(D, F); fC = ndimage.uniform_filter(C, F)
brut = (fL > part) & (fD > part) & (fL + fD > seuil) & (fC < 0.04)
damier = ndimage.binary_closing(brut, structure=np.ones((7, 7), bool))
damier = ndimage.binary_opening(damier, structure=np.ones((5, 5), bool))
# La fenêtre déborde de F/2 sur le dessin : on rétrécit d'autant.
damier = ndimage.binary_erosion(damier, structure=np.ones((F // 2, F // 2), bool))
# … puis on regagne pixel par pixel ce qui ressemble vraiment au damier.
proche = ((np.abs(lum - clair) <= 22) | (np.abs(lum - sombre) <= 22) | ((lum > sombre) & (lum < clair))) & (sat <= 12)
for _ in range(F * 2):
    damier = ndimage.binary_dilation(damier, structure=np.ones((3, 3), bool)) & proche

# Le fond relié aux bords, plus les **trous** : l'intérieur d'un O, d'un P,
# d'une arche, où le damier est enfermé. Un dessin ne contient jamais de damier,
# donc toute plage de damier d'au moins `trou` pixels est du fond, reliée ou non.
trou = int(sys.argv[sys.argv.index('--trou') + 1]) if '--trou' in sys.argv else 120
etiq, n = ndimage.label(damier)
bords = set(np.unique(np.concatenate([etiq[0], etiq[-1], etiq[:, 0], etiq[:, -1]]))) - {0}
tailles = ndimage.sum(damier, etiq, range(1, n + 1))
grands = {i + 1 for i, t in enumerate(tailles) if t >= trou}
fond = np.isin(etiq, list(bords | grands))
# Le damier passe aussi *sous* les pixels de bordure du dessin : on grignote
# d'un pixel pour ne pas laisser de liseré gris, puis on adoucit.
fond = ndimage.binary_dilation(fond, structure=np.ones((3, 3), bool))

# Le voile blanc qu'un générateur peint parfois au-dessus du sujet n'est pas
# traité : deux tentatives (plages claires touchant le fond ; tout ce qui est
# au-dessus du premier pixel sombre) mangeaient les faces claires des lettres.
# Demander plutôt au générateur un fond uni magenta ou vert, sans halo.

alpha = Image.fromarray(np.where(fond, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
out = Image.fromarray(a.astype(np.uint8)).convert('RGBA'); out.putalpha(alpha)
bbox = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
out.crop(bbox).save(dst, optimize=True)
print('fond effacé :', int(fond.sum()), 'px sur', h * w, f'({100*fond.sum()/(h*w):.1f} %) -> {dst}')

if debug:
    # Aperçu : le fond retiré en magenta, pour juger d'un coup d'œil.
    ap = a.astype(np.uint8).copy(); ap[fond] = (255, 0, 255)
    Image.fromarray(ap).resize((w // 2, h // 2)).save(debug)
    print('aperçu ->', debug)

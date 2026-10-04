"""
Peint la berline bleue — une fois pour toutes, hors du jeu (04/10/2026).

Arnaud : « la couleur est quelconque, j'aimerais un bleu beaucoup plus profond,
et il y a des pixels un peu dans tous les sens ». Jusqu'ici le bleu était
calculé dans le navigateur (`repeindre()` de `maps/voiture-model.js`) : une
rotation de teinte de l'atlas rouge de Meshy. Trois défauts, mesurés sur l'atlas :

  1. Rouge (147, 9, 9) tourné de 205° = bleu acier, presque cyan. Pas profond.
  2. Le seuil était franc (écart de chroma 0,16) : 3,9 % de l'atlas — rouges
     sombres, bords anti-aliasés des îlots d'UV — restaient rouge-brun,
     éparpillés sur une voiture bleue.
  3. La valeur du rouge porte l'éclairage « cuit » par Meshy : plis, taches,
     froissures. La rotation les gardait tels quels.

Ici : un masque de peinture **progressif** (plus de pixels orphelins), une
valeur aplatie autour de la médiane (la lumière du jeu fait le modelé, pas la
texture), les fines coutures sombres entre îlots bouchées, puis un bleu
profond posé à la place du rouge. Blanc, noir, chromes : intacts.

    py scripts/peindre-berline.py          # écrit assets/car/berline-bleue.webp
"""
import json
import struct
import sys
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

RACINE = Path(__file__).resolve().parent.parent
GLB = RACINE / 'assets/car/crimson.glb'
SORTIE = RACINE / 'assets/car/berline-bleue.webp'

# Bleu profond (sRGB) à la valeur médiane de la peinture : un bleu roi sombre,
# teinte ≈ 209° dans la texture. Mesuré à l'écran : l'éclairage et l'ACES du jeu
# décalent la teinte d'environ +15° — un bleu à 226° dans la texture sortait à
# 236°, mauve. Celui-ci sort vers 222°, un bleu roi. Le rouge de Meshy vaut (147, 9, 9) à cette même médiane.
BLEU = np.array([4, 84, 168], np.float32) / 255
APLATIR = 0.22      # 1 = froissures intactes, 0 = aplat parfait
COUTURE = 7         # fenêtre (px) pour boucher les fines coutures sombres


def atlas_couleur(glb: Path) -> np.ndarray:
    """L'image de `baseColorTexture`, lue dans le GLB."""
    f = glb.read_bytes()
    n = struct.unpack('<I', f[12:16])[0]
    js = json.loads(f[20:20 + n])
    binaire = f[20 + n + 8:]
    tex = js['textures'][js['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']]
    src = tex.get('source', tex.get('extensions', {}).get('EXT_texture_webp', {}).get('source'))
    vue = js['bufferViews'][js['images'][src]['bufferView']]
    o = vue.get('byteOffset', 0)
    return np.asarray(Image.open(BytesIO(binaire[o:o + vue['byteLength']])).convert('RGB'), np.float32) / 255


def lisse(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def peindre(a: np.ndarray) -> np.ndarray:
    r, v, b = a[..., 0], a[..., 1], a[..., 2]
    chroma = r - np.maximum(v, b)                  # « combien c'est rouge »
    # Saturation plutôt que chroma seul : les plis sombres (57, 34, 33) sont du
    # rouge éteint à repeindre, les blancs rosés des bandes (255, 235, 234)
    # restent blancs. Le plancher de chroma écarte le bruit des noirs.
    sat = chroma / np.maximum(r, 1e-3)
    # Le chroma garde la main sur les transitions rouge → blanc au bord des
    # bandes : par la seule saturation, elles restaient à moitié roses.
    masque = np.maximum(lisse(chroma, 0.04, 0.20),
                        lisse(sat, 0.22, 0.55) * lisse(chroma, 0.015, 0.06))   # progressif : pas de pixel orphelin
    peint = masque > 0.5
    mediane = float(np.median(r[peint]))

    # Coutures : un pixel non peint, au milieu d'une zone majoritairement
    # peinte, est un trait de couture ou une poussière — pas une garniture
    # noire, qui occupe toujours une plage large.
    part = cv2.blur(peint.astype(np.float32), (COUTURE, COUTURE))
    couture = (~peint) & (part > 0.6)
    # valeur d'une couture : celle de la peinture voisine (moyenne normalisée)
    somme = cv2.blur(np.where(peint, r, 0).astype(np.float32), (COUTURE, COUTURE))
    voisine = somme / np.maximum(part, 1e-6)
    valeur = np.where(couture, voisine, r)
    masque = np.where(couture, 1.0, masque)

    # Aplatir les froissures cuites par Meshy, en gardant un soupçon de relief.
    rel = np.clip(valeur / mediane, 0.05, 1.6)
    rel = rel ** APLATIR
    bleu = BLEU[None, None, :] * rel[..., None]

    m = masque[..., None]
    return np.clip(a * (1 - m) + bleu * m, 0, 1)


def main():
    a = atlas_couleur(GLB)
    out = peindre(a)
    Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(SORTIE, 'WEBP', quality=92, method=6)
    print(f'{SORTIE.relative_to(RACINE)} : {SORTIE.stat().st_size / 1024:.0f} Ko')


if __name__ == '__main__':
    sys.exit(main())

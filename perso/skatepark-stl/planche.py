"""Planche-contact des vignettes : une case par modèle, son nom et ses dimensions à l'échelle proposée."""
import glob, os, json
from PIL import Image, ImageDraw, ImageFont
import trimesh

ici = os.path.dirname(os.path.abspath(__file__))
ECHELLE = 40 / 1000     # 1 tuile de 100 mm = 4 m (obstacles) ; les modules FreeCAD (120 mm) font 4,8 m
vign = sorted(glob.glob(os.path.join(ici, 'vignettes', '*.png')))
cases = []
for v in vign:
    nom = os.path.splitext(os.path.basename(v))[0]
    glb = os.path.join(ici, 'glb', nom + '.glb')
    m = trimesh.load(glb, force='mesh')
    e = [x * ECHELLE for x in m.extents]
    court = nom.replace('_Fingerboard_obstacles', '').replace('_', ' ')
    cases.append((v, court, f"{e[0]:.1f} × {e[1]:.1f} m, h {e[2]:.2f} m"))

cols = 5
taille = 300
rows = (len(cases) + cols - 1) // cols
planche = Image.new('RGB', (cols * taille, rows * (taille + 44)), (235, 238, 242))
d = ImageDraw.Draw(planche)
try:
    police = ImageFont.truetype('arial.ttf', 17)
    petite = ImageFont.truetype('arial.ttf', 15)
except Exception:
    police = petite = ImageFont.load_default()
for k, (v, court, dims) in enumerate(cases):
    im = Image.open(v).convert('RGB').resize((taille, taille))
    x, y = (k % cols) * taille, (k // cols) * (taille + 44)
    planche.paste(im, (x, y))
    d.text((x + 8, y + taille + 2), court, fill=(20, 20, 20), font=police)
    d.text((x + 8, y + taille + 22), dims, fill=(90, 90, 90), font=petite)
out = os.path.join(ici, 'planche-skatepark.png')
planche.save(out)
print(out, len(cases))

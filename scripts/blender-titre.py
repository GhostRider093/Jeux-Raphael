# ==========================================================================
#  TITRE 3D — « Poilhes City » en lettres extrudées, rendu PNG + GLB
# --------------------------------------------------------------------------
#  Usage (Blender 5.0, local et gratuit) :
#
#    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b \
#        --factory-startup --python scripts/blender-titre.py -- \
#        --police scripts/fonts/TitanOne-Regular.ttf --sortie assets/accueil/titre-titanone
#
#  Sorties : <sortie>.png (2400 × 1000, fond transparent) et <sortie>.glb (le
#  titre en maillage, pour l'afficher en 3D dans Three.js).
#
#  Deux mots, deux matières : « Poilhes » en or brossé, « CITY » en blanc
#  ivoire espacé dessous, les deux extrudés avec un biseau — c'est le biseau qui
#  accroche la lumière et fait lire le relief. Éclairage à trois sources (clé,
#  bouche, contre-jour) et rien d'autre : pas d'HDRI à embarquer.
# ==========================================================================
import argparse
import math
import pathlib
import sys

import bpy

# ─────────────────────────────────────────────── arguments après le « -- »
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--police", required=True, help="fichier .ttf / .otf")
ap.add_argument("--sortie", required=True, help="chemin de sortie sans extension")
ap.add_argument("--ligne1", default="Poilhes")
ap.add_argument("--ligne2", default="CITY")
ap.add_argument("--or", dest="couleur1", default="F2C33C", help="couleur hex de la ligne 1")
ap.add_argument("--blanc", dest="couleur2", default="F4EFE6", help="couleur hex de la ligne 2")
ap.add_argument("--largeur", type=int, default=2400)
ap.add_argument("--hauteur", type=int, default=1000)
args = ap.parse_args(argv)

RACINE = pathlib.Path(__file__).resolve().parent.parent
police = pathlib.Path(args.police)
if not police.is_absolute():
    police = RACINE / police
sortie = pathlib.Path(args.sortie)
if not sortie.is_absolute():
    sortie = RACINE / sortie
sortie.parent.mkdir(parents=True, exist_ok=True)


def hex_rgb(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    # sRGB → linéaire, comme Blender l'attend dans un Principled BSDF
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b), 1.0)


# ─────────────────────────────────────────────── scène vierge
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
font = bpy.data.fonts.load(str(police))


def materiau(nom, couleur, metal, rugosite):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = couleur
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rugosite
    return m


def texte(nom, contenu, taille, y, extrude, biseau, espacement, mat):
    """Un mot extrudé, centré en x, posé à la hauteur y (le plan XZ face à la caméra)."""
    courbe = bpy.data.curves.new(nom, type="FONT")
    courbe.body = contenu
    courbe.font = font
    courbe.size = taille
    courbe.space_character = espacement
    courbe.align_x = "CENTER"
    courbe.extrude = extrude
    courbe.bevel_depth = biseau
    courbe.bevel_resolution = 4
    courbe.resolution_u = 8
    obj = bpy.data.objects.new(nom, courbe)
    scene.collection.objects.link(obj)
    obj.rotation_euler = (math.pi / 2, 0, 0)          # debout, face à −Y
    obj.location = (0, 0, y)
    obj.data.materials.append(mat)
    # en maillage : le glTF n'exporte pas les courbes de texte telles quelles
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35)) if hasattr(bpy.ops.object, "shade_smooth_by_angle") else None
    return obj


or_ = materiau("Or", hex_rgb(args.couleur1), 1.0, 0.28)
ivoire = materiau("Ivoire", hex_rgb(args.couleur2), 0.0, 0.35)
mot1 = texte("Poilhes", args.ligne1, 1.0, 0.16, 0.14, 0.022, 1.0, or_)
mot2 = texte("City", args.ligne2, 0.48, -0.42, 0.10, 0.016, 1.28, ivoire)

# ─────────────────────────────────────────────── cadrage
# L'emprise réelle des deux mots, pour cadrer sans deviner.
xs, zs = [], []
for o in (mot1, mot2):
    for v in o.bound_box:
        p = o.matrix_world @ __import__("mathutils").Vector(v)
        xs.append(p.x)
        zs.append(p.z)
largeur = max(xs) - min(xs)
centre_z = (max(zs) + min(zs)) / 2
cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 55
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
# distance pour que le titre tienne dans 82 % du cadre, en largeur ET en
# hauteur (capteur 36 mm) : une police condensée est étroite mais haute, et
# cadrée sur sa seule largeur elle sortait du cadre par le haut et le bas.
hauteur_txt = max(zs) - min(zs)
capteur_h = cam_data.sensor_width * args.hauteur / args.largeur
dist = max((largeur / 0.82) * cam_data.lens / cam_data.sensor_width,
           (hauteur_txt / 0.78) * cam_data.lens / capteur_h)
cam.location = (0, -dist, centre_z + dist * 0.10)
cam.rotation_euler = (math.pi / 2 - math.atan2(dist * 0.10, dist), 0, 0)

# ─────────────────────────────────────────────── lumières
def lampe(nom, type_, energie, position, taille=None, couleur=(1, 1, 1)):
    d = bpy.data.lights.new(nom, type_)
    d.energy = energie
    d.color = couleur
    if taille is not None:
        d.size = taille
    o = bpy.data.objects.new(nom, d)
    scene.collection.objects.link(o)
    o.location = position
    # la lampe regarde le centre du titre
    direction = __import__("mathutils").Vector((0, 0, centre_z)) - o.location
    o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return o


lampe("Cle", "AREA", 1600, (-3.2, -4.0, 3.4), taille=3.0, couleur=(1.0, 0.96, 0.90))
lampe("Bouche", "AREA", 500, (3.6, -4.2, 0.8), taille=4.0, couleur=(0.85, 0.92, 1.0))
lampe("Contre", "AREA", 900, (1.5, 2.6, 2.4), taille=2.0, couleur=(0.75, 0.85, 1.0))
scene.world = bpy.data.worlds.new("Monde")
scene.world.use_nodes = True
fond = scene.world.node_tree.nodes["Background"]
fond.inputs["Color"].default_value = (0.05, 0.06, 0.08, 1)
fond.inputs["Strength"].default_value = 0.6

# ─────────────────────────────────────────────── rendu
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = args.largeur
scene.render.resolution_y = args.hauteur
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.eevee.taa_render_samples = 64
scene.render.filepath = str(sortie.with_suffix(".png"))
bpy.ops.render.render(write_still=True)

# ─────────────────────────────────────────────── GLB
for o in scene.objects:
    o.select_set(o in (mot1, mot2))
bpy.ops.export_scene.gltf(filepath=str(sortie.with_suffix(".glb")), use_selection=True, export_apply=True,
                          export_yup=True)
print(f"TITRE OK : {sortie.with_suffix('.png')} et .glb — largeur {largeur:.2f} m")

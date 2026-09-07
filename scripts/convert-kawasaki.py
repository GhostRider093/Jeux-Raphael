# ==========================================================================
#  CONVERSION DU CHASSEUR ENNEMI  -  Kawasaki Ki-61
# --------------------------------------------------------------------------
#  Source : data/objet3d/RETOPO_TEXTURED.zip + data/objet3d/TEXTURES.zip
#  Sortie : assets/enemies/kawasaki-ki61/kawasaki-fighter.glb
#
#  A lancer dans cet ordre, depuis la racine du projet :
#
#    python scripts/prepare-kawasaki-textures.py <dossier_travail>
#    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b #        --factory-startup --python scripts/convert-kawasaki.py -- #        "<dossier_travail>/RETOPO_TEXTURED/Retopologized Model FINAL.obj" #        "<dossier_travail>/tex" #        "assets/enemies/kawasaki-ki61/kawasaki-fighter.glb" 0.12
#
#  Le dernier argument est le taux de decimation. 0.12 ramene 198 000 faces a
#  46 000 et le GLB a 4,3 Mo. Monter cette valeur redonne du detail au prix du
#  poids ; la carte de normales, elle, garde le detail de surface quoi qu'il
#  arrive.
#
#  Les chemins de textures du .mtl pointent vers le D: de l'auteur du modele :
#  ils sont ignores, chaque materiau est reconstruit a partir du dossier
#  prepare par prepare-kawasaki-textures.py.
# ==========================================================================

import bpy, os, sys, math
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, TEXDIR, OUT = ARGS[0], ARGS[1], ARGS[2]
RATIO = float(ARGS[3]) if len(ARGS) > 3 else 1.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=SRC)
print('[conv] objets importes:', len(bpy.context.scene.objects))

SETS = {
    'Basic_Plane_Shape_1001': 'plane1001',
    'Basic_Plane_Shape_1002': 'plane1002',
    'HOOD': 'hood',
    'RETOPO_FITTINGS': 'fittings',
    'Propellor_Fittings_ETC': 'prop',
}
PLAIN = {
    # nom : (couleur, metallic, roughness)
    'Metal_GOLD': ((0.55, 0.44, 0.09, 1), 1.0, 0.28),
    'Unnamed_Material': ((0.62, 0.72, 0.78, 1), 0.15, 0.06),
}

def image(path, non_color):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    return img

for mat in bpy.data.materials:
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); out.location = (600, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (260, 0)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    key = SETS.get(mat.name)
    if key:
        base = nt.nodes.new('ShaderNodeTexImage'); base.location = (-350, 260)
        base.image = image(os.path.join(TEXDIR, f'{key}_basecolor.jpg'), False)
        nt.links.new(base.outputs['Color'], bsdf.inputs['Base Color'])

        orm = nt.nodes.new('ShaderNodeTexImage'); orm.location = (-350, -20)
        orm.image = image(os.path.join(TEXDIR, f'{key}_orm.jpg'), True)
        sep = nt.nodes.new('ShaderNodeSeparateColor'); sep.location = (-60, -20)
        nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])

        nrm = nt.nodes.new('ShaderNodeTexImage'); nrm.location = (-350, -320)
        nrm.image = image(os.path.join(TEXDIR, f'{key}_normal.jpg'), True)
        nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.location = (-60, -320)
        nt.links.new(nrm.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        print(f'[conv] materiau texture : {mat.name} -> {key}')
    else:
        color, metal, rough = PLAIN.get(mat.name, ((0.55, 0.55, 0.58, 1), 0.6, 0.4))
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        print(f'[conv] materiau uni    : {mat.name}')

# ── HELICE : ISOLER LES PALES ─────────────────────────────────────────────
# L'objet « Plane.007_Plane.008 » ne contient pas que l'helice : les deux roues
# principales y sont aussi. Sans cette separation elles echappent au tri du
# train ci-dessous, et pire, elles se mettraient a tourner avec les pales.
# La decoupe en morceaux non connexes rend chaque piece independante ; le tri
# du train s'applique ensuite a toutes, roues comprises.
PROPELLER_SOURCE = 'Plane.007_Plane.008'
source = bpy.context.scene.objects.get(PROPELLER_SOURCE)
assert source is not None, 'objet helice introuvable'
bpy.ops.object.select_all(action='DESELECT')
source.select_set(True)
bpy.context.view_layer.objects.active = source
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='LOOSE')
bpy.ops.object.mode_set(mode='OBJECT')
# On retient les noms et non les objets : ceux que le tri du train supprimera
# laisseraient des references mortes.
morceaux = [o.name for o in bpy.context.selected_objects if o.type == 'MESH']
print('[conv] helice decoupee en', len(morceaux), 'morceaux')

# ── TRAIN D'ATTERRISSAGE ──────────────────────────────────────────────────
# Le modele est livre train sorti : sur un chasseur en vol c'est faux, et le
# train represente 142 000 des 198 000 sommets — il est modelise plus finement
# que la cellule. Le supprimer corrige l'appareil ET rend l'essentiel du
# budget geometrique.
#
# Les 53 objets s'appellent tous « Cylinder.0xx » : aucun nom n'aide, la
# selection se fait donc sur la position. Chaque objet contient la paire
# gauche+droite, sa boite englobante traverse donc l'axe.
#   - train principal : tout ce qui passe SOUS l'aile a la station du train
#     (jambes, roues, compas, mais aussi trappes et carenages de puits, qui
#     pendent sous l'aile une fois le train sorti)
#   - roulette de queue : a l'arriere, au-dela de z = 1,2
# Le dessous d'aile lui-meme est au-dessus du seuil et reste en place : la
# suppression ne perce aucun trou, verifie au rendu en vue de dessous.
# Les jambes sont deux courbes de Bezier, une par cote, d'ou le cas separe.
def est_train(obj):
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    y0, y1 = min(c.y for c in corners), max(c.y for c in corners)
    z0, z1 = min(c.z for c in corners), max(c.z for c in corners)
    # L'import OBJ passe de Y-haut a Z-haut : la hauteur du modele devient Z,
    # et son axe longitudinal devient -Y (le nez pointe vers -Y).
    if y0 > .66 and y1 < .95 and z1 < .66:
        return True
    if obj.name.startswith('BezierCurve.00') and z1 < .62 and y0 > 0:
        return True
    if y1 < -1.2 and z1 < .70:
        return True
    return False

train = [o for o in bpy.context.scene.objects if o.type == 'MESH' and est_train(o)]
print('[conv] train supprime :', len(train), 'objets')
bpy.ops.object.select_all(action='DESELECT')
for o in train:
    o.select_set(True)
if train:
    bpy.ops.object.delete()

# L'helice reste un objet a part : c'est le seul morceau qui doit tourner.
# Ce qui survit au tri du train parmi les morceaux decoupes plus haut, ce sont
# les pales et le cone : on les recolle en un seul objet.
pales = [bpy.context.scene.objects[n] for n in morceaux if n in bpy.context.scene.objects]
assert pales, 'toutes les pales ont ete prises pour du train'
bpy.ops.object.select_all(action='DESELECT')
for o in pales:
    o.select_set(True)
bpy.context.view_layer.objects.active = pales[0]
if len(pales) > 1:
    bpy.ops.object.join()
propeller = bpy.context.view_layer.objects.active
propeller.name = 'propeller'
print('[conv] helice reconstituee a partir de', len(pales), 'morceaux')

# Un seul objet pour le reste : les dizaines d'objets restants feraient autant
# d'appels de rendu par ennemi, et il y en a dix a l'ecran.
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o is not propeller]
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
joined = bpy.context.view_layer.objects.active
joined.name = 'body'

# Origine de l'helice sur son axe de rotation : sans cela elle tournerait
# autour du centre de l'appareil et decrirait un cercle au lieu de pivoter.
corners = [propeller.matrix_world @ Vector(c) for c in propeller.bound_box]
hub = Vector((
    0.0,
    (min(c.y for c in corners) + max(c.y for c in corners)) / 2,
    (min(c.z for c in corners) + max(c.z for c in corners)) / 2
))
print('[conv] moyeu helice (repere Blender):', tuple(round(v, 3) for v in hub))
bpy.context.scene.cursor.location = hub
bpy.ops.object.select_all(action='DESELECT')
propeller.select_set(True)
bpy.context.view_layer.objects.active = propeller
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')

bpy.ops.object.select_all(action='DESELECT')
for o in (joined, propeller):
    o.select_set(True)
bpy.context.view_layer.objects.active = joined
bpy.ops.object.shade_smooth()
print('[conv] faces apres fusion:', len(joined.data.polygons))

# Allegement : 10 ennemis a l'ecran, le maillage de concours est hors budget.
# La carte de normales garde le detail de surface que la decimation enleve.
if RATIO < 1.0:
    bpy.context.view_layer.objects.active = joined
    mod = joined.modifiers.new('alleger', 'DECIMATE')
    mod.ratio = RATIO
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    print('[conv] faces apres decimation:', len(joined.data.polygons), 'materiaux:', len(joined.data.materials))

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_image_format='AUTO',
    export_apply=True,
    export_yup=True,
    use_selection=False
)
print('[conv] ecrit', OUT, os.path.getsize(OUT) / 1e6, 'Mo')

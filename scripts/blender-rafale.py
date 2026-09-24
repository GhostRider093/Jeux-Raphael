# ==========================================================================
#  CHASSEUR ENNEMI  -  Dassault Rafale, etape 2 : allegement et livree
# --------------------------------------------------------------------------
#  Entree : assets/enemies/rafale/rafale-brut.stl (ecrit par convert-rafale.py)
#  Sortie : assets/enemies/rafale/rafale.glb
#
#    python scripts/convert-rafale.py
#    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b \
#        --factory-startup --python scripts/blender-rafale.py
#
#  Quatre choses, et rien d'autre :
#
#  1. DECIMATION. 279 000 triangles pour dix appareils a l'ecran, c'est le
#     meme piege que le Kawasaki (voir convert-kawasaki.py). RATIO les ramene
#     a 28 000 — la silhouette d'un delta-canard tient largement dans ce
#     budget, c'est une forme faite de grands panneaux plats.
#
#  2. DECOUPE DES PANNEAUX. Un plan de coupe a +/- X_PANNEAU avant de peindre.
#     Sans lui, la limite de la livree suit les aretes des triangles et le
#     bord de peinture part en dents de scie — c'etait le defaut de la
#     premiere version.
#
#  3. LIVREE PEINTE AUX SOMMETS. Le modele vient d'un STL d'impression : ni
#     UV, ni texture, et un depliage automatique poserait une image au hasard
#     sur un fuselage. On peint donc la couleur DANS le maillage, sur le
#     domaine COIN (une couleur par coin de face, pas par sommet) : c'est ce
#     qui autorise une limite NETTE entre deux teintes — un sommet ne porte
#     qu'une couleur et melangerait les deux. Le GLB sort avec un COLOR_0 que
#     Three.js applique tout seul, sans une seule image a telecharger.
#
#     La livree : camouflage deux tons de gris de l'armee de l'air, ventre
#     plus clair, radome et verriere sombres, et les panneaux d'aile
#     exterieurs bleu et rouge — la plaque AMS d'Arnaud. C'est aussi ce qui
#     rend l'ennemi lisible a 400 m contre un ciel clair.
#
#  4. LISSAGE PAR ANGLE, au-dela de 30 degres : le fuselage s'arrondit, les
#     bords de fuite et l'arete de derive restent nets.
#
#  ORIENTATION. Le STL est deja dans le repere du JEU (nez -Z, haut +Y). Or
#  l'exportateur glTF convertit du repere Blender (Z haut) vers Y haut :
#  (x, y, z) -> (x, z, -y). On pre-tourne donc de +90 degres autour de X pour
#  que cette conversion RENDE le repere du jeu au lieu de le casser.
# ==========================================================================

import bpy
import bmesh
import pathlib
from math import radians, sin, cos

RACINE = pathlib.Path(bpy.path.abspath('//')) if bpy.data.filepath else pathlib.Path.cwd()
SRC = RACINE / 'assets' / 'enemies' / 'rafale' / 'rafale-brut.stl'
OUT = RACINE / 'assets' / 'enemies' / 'rafale' / 'rafale.glb'
RATIO = 0.10
ANGLE_LISSAGE = 30
TRICOLORE = True

#  Toutes les cotes sont en millimetres du modele : envergure 122,9,
#  hauteur 43,6, longueur 175,8, boite centree sur l'origine.
X_PANNEAU = 46.0        # au-dela : le bout d'aile, jamais le fuselage ni les entrees d'air
Z_RADOME = -72.0        # devant : le radome, noir sur tous les Rafale
VERRIERE = dict(z0=-54.0, z1=-26.0, x=7.5, y=4.0)

GRIS_CLAIR = (0.54, 0.58, 0.62, 1.0)
GRIS_FONCE = (0.25, 0.29, 0.34, 1.0)
VENTRE = (0.62, 0.66, 0.70, 1.0)
SOMBRE = (0.09, 0.10, 0.13, 1.0)
VITRE = (0.07, 0.10, 0.17, 1.0)
BLEU = (0.05, 0.12, 0.45, 1.0)
ROUGE = (0.52, 0.04, 0.06, 1.0)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.stl_import(filepath=str(SRC))
avion = bpy.context.selected_objects[0]
avion.name = 'rafale'
bpy.context.view_layer.objects.active = avion
print(f'[rafale] importe : {len(avion.data.polygons)} triangles')

modificateur = avion.modifiers.new('decimation', 'DECIMATE')
modificateur.ratio = RATIO
bpy.ops.object.modifier_apply(modifier=modificateur.name)
print(f'[rafale] apres decimation : {len(avion.data.polygons)} triangles')

#  -- 2. DECOUPE DES PANNEAUX ----------------------------------------------
if TRICOLORE:
    maillage = bmesh.new()
    maillage.from_mesh(avion.data)
    coupes = [
        ((-X_PANNEAU, 0, 0), (1, 0, 0)),
        ((X_PANNEAU, 0, 0), (1, 0, 0)),
        ((-VERRIERE['x'], 0, 0), (1, 0, 0)),
        ((VERRIERE['x'], 0, 0), (1, 0, 0)),
        ((0, 0, VERRIERE['z0']), (0, 0, 1)),
        ((0, 0, VERRIERE['z1']), (0, 0, 1)),
    ]
    for origine, normale in coupes:
        bmesh.ops.bisect_plane(
            maillage,
            geom=list(maillage.verts) + list(maillage.edges) + list(maillage.faces),
            plane_co=origine, plane_no=normale, clear_inner=False, clear_outer=False
        )
    maillage.to_mesh(avion.data)
    maillage.free()
    print(f'[rafale] apres decoupe des panneaux : {len(avion.data.polygons)} triangles')


def teinte(face):
    """La couleur d'une face, decidee par sa position et son orientation."""
    x, y, z = face.center
    if z < Z_RADOME:
        return SOMBRE
    v = VERRIERE
    if v['z0'] < z < v['z1'] and abs(x) < v['x'] and y > v['y']:
        return VITRE
    if TRICOLORE and x < -X_PANNEAU:
        return BLEU
    if TRICOLORE and x > X_PANNEAU:
        return ROUGE
    #  ATTENTION AUX AXES : a cet instant le maillage est encore dans le
    #  repere du JEU — X l'envergure, Y la hauteur, Z la longueur. La rotation
    #  vers le repere Blender n'est appliquee qu'a l'export. La premiere
    #  version peignait son camouflage sur la HAUTEUR : l'appareil sortait
    #  d'un gris uniforme, rayures invisibles.
    if face.normal.y < -0.35:
        return VENTRE
    #  Camouflage : deux ondes croisees, pas un bruit aleatoire — le motif
    #  doit etre le meme a chaque conversion, sinon deux exports ne donnent
    #  pas le meme avion et plus rien n'est comparable.
    onde = sin(0.055 * x + 0.9 * sin(0.030 * z)) + sin(0.026 * z + 0.7 * cos(0.048 * x))
    return GRIS_FONCE if onde > 0.15 else GRIS_CLAIR


couleurs = avion.data.color_attributes.new(name='livree', type='FLOAT_COLOR', domain='CORNER')
compte = {}
for face in avion.data.polygons:
    valeur = teinte(face)
    compte[valeur] = compte.get(valeur, 0) + 1
    for coin in face.loop_indices:
        couleurs.data[coin].color = valeur
print(f'[rafale] livree peinte sur {len(couleurs.data)} coins de face')
noms = {GRIS_CLAIR: 'gris clair', GRIS_FONCE: 'gris fonce', VENTRE: 'ventre',
        SOMBRE: 'radome', VITRE: 'verriere', BLEU: 'bleu', ROUGE: 'rouge'}
for valeur, nombre in sorted(compte.items(), key=lambda item: -item[1]):
    print(f'[rafale]   {noms.get(valeur, valeur):12s} {nombre:6d} faces')

#  Un seul materiau : toute la variation est dans le COLOR_0.
materiau = bpy.data.materials.new('rafale')
materiau.use_nodes = True
noeuds = materiau.node_tree.nodes
bsdf = noeuds['Principled BSDF']
#  Un avion PEINT n'est pas une piece de metal : a 0,45 de metallique la
#  couleur de base ne teinte plus que les reflets et le camouflage
#  disparaissait dans un blanc uniforme. 0,12 rend la peinture visible, la
#  rugosite garde un reflet doux sur le fuselage.
bsdf.inputs['Metallic'].default_value = 0.12
bsdf.inputs['Roughness'].default_value = 0.5
attribut = noeuds.new('ShaderNodeVertexColor')
attribut.layer_name = 'livree'
materiau.node_tree.links.new(attribut.outputs['Color'], bsdf.inputs['Base Color'])
avion.data.materials.clear()
avion.data.materials.append(materiau)

bpy.ops.object.shade_smooth()
try:
    bpy.ops.object.shade_smooth_by_angle(angle=radians(ANGLE_LISSAGE))
except Exception as erreur:  # Blender < 4.1 : l'ancien auto-smooth
    print('[rafale] lissage par angle indisponible, repli auto_smooth :', erreur)
    avion.data.use_auto_smooth = True
    avion.data.auto_smooth_angle = radians(ANGLE_LISSAGE)

avion.rotation_euler = (radians(90), 0, 0)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

bpy.ops.export_scene.gltf(filepath=str(OUT), export_format='GLB', use_selection=False)
print(f'[rafale] ecrit : {OUT} ({OUT.stat().st_size/1e6:.2f} Mo)')

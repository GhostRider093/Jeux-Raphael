# ==========================================================================
#  ROBOT  -  Mech « ISO » (Retro_UnderWaterAssets_Freebees), vers un GLB unique
# --------------------------------------------------------------------------
#  Source : assets/Retro_UnderWaterAssets_Freebees/Mech/ (FBX de 104 Mo, dont
#  l'essentiel est fait de textures embarquées, + 7 FBX d'animation).
#  Sortie : assets/mech/mech-brut.glb, à compresser ensuite :
#
#    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b \
#        --factory-startup --python scripts/blender-mech.py
#    gltf-transform optimize assets/mech/mech-brut.glb assets/mech/mech.glb \
#        --compress meshopt --texture-compress webp --texture-size 2048
#
#  1. Seul le niveau de détail LOD0 est gardé (≈ 26 000 triangles) : les LOD1
#     ne servent à rien dans Three.js et doubleraient le poids.
#  2. Matériau PBR reconstruit avec les textures T_Mech_* du dossier Textures
#     (les chemins embarqués dans le FBX pointent vers des .fbm absents).
#  3. Les 7 animations sont importées une à une ; leur action est greffée sur le
#     squelette du modèle (mêmes noms d'os), puis exportée sous un nom court :
#     Idle, WalkForward, WalkBackward, WalkLeft, WalkRight, Landing, Death.
# ==========================================================================
import pathlib

import bpy

RACINE = pathlib.Path(bpy.path.abspath("//")).parent if bpy.data.filepath else pathlib.Path(__file__).resolve().parent.parent
SRC = RACINE / "assets" / "Retro_UnderWaterAssets_Freebees" / "Mech"
OUT = RACINE / "assets" / "mech" / "mech-brut.glb"
ANIMS = {
    "Idle": "A_ISO_Mech_Idle_01.fbx",
    "WalkForward": "A_ISO_Mech_WalkForward_01.fbx",
    "WalkBackward": "A_ISO_Mech_WalkBackward_01.fbx",
    "WalkLeft": "A_ISO_Mech_Walk_L_01.fbx",
    "WalkRight": "A_ISO_Mech_Walk_R_01.fbx",
    "Landing": "A_ISO_Mech_Landing_01.fbx",
    "Death": "A_ISO_Mech_Death_01.fbx",
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(SRC / "Model" / "SK_ISO_Mech.fbx"))

armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.type == "MESH" and "LOD1" in o.name:
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == "EMPTY" and "LOD1" in o.name:
        bpy.data.objects.remove(o, do_unlink=True)

# --- matériau PBR -----------------------------------------------------------
mat = bpy.data.materials.new("M_Mech")
mat.use_nodes = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
bsdf = nodes["Principled BSDF"]


def tex(name, non_color):
    img = bpy.data.images.load(str(SRC / "Textures" / name))
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    node = nodes.new("ShaderNodeTexImage")
    node.image = img
    return node


links.new(tex("T_Mech_Base_Color.png", False).outputs["Color"], bsdf.inputs["Base Color"])
links.new(tex("T_Mech_Metallic.png", True).outputs["Color"], bsdf.inputs["Metallic"])
links.new(tex("T_Mech_Roughness.png", True).outputs["Color"], bsdf.inputs["Roughness"])
nmap = nodes.new("ShaderNodeNormalMap")
links.new(tex("T_Mech_Normal.png", True).outputs["Color"], nmap.inputs["Color"])
links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
links.new(tex("T_Mech_Emissive.png", False).outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 1.0

for o in bpy.data.objects:
    if o.type == "MESH":
        o.data.materials.clear()
        o.data.materials.append(mat)

# --- animations ---------------------------------------------------------------
armature.animation_data_create()
for short, fname in ANIMS.items():
    before = set(bpy.data.objects)
    actions_before = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=str(SRC / "Animations" / fname))
    new_actions = [a for a in bpy.data.actions if a not in actions_before]
    if not new_actions:
        print(f"[mech] aucune action dans {fname}")
    else:
        action = max(new_actions, key=lambda a: a.frame_range[1] - a.frame_range[0])
        action.name = short
        action.use_fake_user = True
        track = armature.animation_data.nla_tracks.new()
        track.name = short
        strip = track.strips.new(short, int(action.frame_range[0]), action)
        track.mute = True
        for a in new_actions:
            if a is not action:
                bpy.data.actions.remove(a)
    for o in set(bpy.data.objects) - before:
        bpy.data.objects.remove(o, do_unlink=True)
    print(f"[mech] {short} importée")

armature.animation_data.action = None
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT), export_format="GLB", export_animations=True,
    export_animation_mode="NLA_TRACKS", export_skins=True, export_yup=True,
    export_image_format="AUTO",
)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
print(f"[mech] export {OUT} — {tris} triangles, actions {[a.name for a in bpy.data.actions]}")

"""Une carrosserie de voiture imprimable (3MF) → une voiture du trafic de Poilhes City (GLB).

Arnaud, 27/09/2026 : « voilà des modèles, tu peux les texturer et les mettre en
voiture simple dans la ville ». Un 3MF d'impression n'a ni couleur ni texture :
on peint la carrosserie **par zones** (peinture, habitacle vitré sombre, bas de
caisse et passages de roue noirs, phares, feux arrière) d'après la position de
chaque triangle, et l'on range chaque zone dans son propre maillage nommé — le
jeu repeint `peinture` de la couleur qu'il veut. Les roues ne viennent pas du
fichier (celles d'un kit RC ne sont pas à l'échelle) : le jeu les dessine aux
centres mesurés ici.

Ne marche que pour une carrosserie **d'un seul bloc** (LaFerrari). Un kit en
dizaines de pièces posées à plat sur des plateaux (Mustang GTD, Aventador RC)
n'a plus sa position d'assemblage : rien à en tirer automatiquement.

    py scripts/poilhes/voiture_3mf.py "C:/Users/icc34/Downloads/LaFerrari+Wheels+4.1.3mf"

Réglages de la LaFerrari dans `VOITURES` (repère du fichier : x largeur, y
longueur avec le nez vers −y, z hauteur), mesurés sur ses vues de profil, de
dessus et de face. Sortie : `assets/fun/<nom>.glb` (en mètres, nez vers −z,
sol à zéro), compressé par gltf-transform (¼ des triangles).
"""
import pathlib
import re
import subprocess
import sys
import tempfile
import zipfile

import numpy as np
import trimesh

RACINE = pathlib.Path(__file__).resolve().parent.parent.parent
VOITURES = {
    'laferrari': {
        'fichier': 'LaFerrari', 'modele': '3D/Objects/object_29.model', 'objet': '7',
        'longueur': 4.5, 'roues': {'z': -1.0, 'rayon': 1.25, 'y': (-3.9, 5.2)},
        'habitacle': {'z': 0.45, 'y': (-2.8, 1.8), 'x': 2.85}, 'bas': -1.35,
        'feux_av': {'y': -7.2, 'z': (-0.75, 0.1), 'x': 1.2}, 'feux_ar': {'y': 7.5, 'z': 0.1},
    },
}
COULEURS = {'peinture': [200, 20, 25, 255], 'vitre': [18, 20, 26, 255], 'noir': [22, 22, 22, 255],
            'feux-av': [240, 240, 230, 255], 'feux-ar': [200, 10, 10, 255]}


def lire_objet(chemin, modele, objet):
    t = zipfile.ZipFile(chemin).read(modele).decode()
    bloc = re.search(r'<object id="%s"[^>]*>(.*?)</object>' % objet, t, re.S).group(1)
    v = np.array(re.findall(r'<vertex x="([-\d.e]+)" y="([-\d.e]+)" z="([-\d.e]+)"', bloc), float)
    f = np.array(re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"', bloc), int)
    return v, f


def main():
    chemin = pathlib.Path(sys.argv[1])
    nom, R = next((k, r) for k, r in VOITURES.items() if r['fichier'].lower() in chemin.name.lower())
    v, f = lire_objet(chemin, R['modele'], R['objet'])
    S = R['longueur'] / (v[:, 1].max() - v[:, 1].min())
    sol = R['roues']['z'] - R['roues']['rayon']
    # repère du jeu : X = x, Y = z (haut), Z = y (nez vers −Z) ; l'échange d'axes
    # retourne l'orientation des faces : on inverse l'ordre des sommets
    m = trimesh.Trimesh(np.c_[v[:, 0], v[:, 2] - sol, v[:, 1]] * S, f[:, ::-1], process=False)
    c = m.triangles_center / S
    x, z, y = c[:, 0], c[:, 1] + sol, c[:, 2]
    n = m.face_normals
    cls = np.full(len(f), 'peinture', dtype=object)
    h = R['habitacle']
    cls[(z > h['z']) & (y > h['y'][0]) & (y < h['y'][1]) & (np.abs(x) < h['x'])] = 'vitre'
    cls[z < R['bas']] = 'noir'
    for yc in R['roues']['y']:
        cls[(np.hypot(y - yc, z - R['roues']['z']) < R['roues']['rayon'] * 1.2) & (np.abs(x) > 1.7) & (n[:, 1] < 0.6)] = 'noir'
    fa, fr = R['feux_av'], R['feux_ar']
    cls[(y < fa['y']) & (z > fa['z'][0]) & (z < fa['z'][1]) & (np.abs(x) > fa['x'])] = 'feux-av'
    cls[(y > fr['y']) & (z > fr['z'])] = 'feux-ar'
    scene = trimesh.Scene()
    for k, col in COULEURS.items():
        idx = np.nonzero(cls == k)[0]
        if not len(idx):
            continue
        sub = m.submesh([idx], append=True)
        sub.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
            name=k, baseColorFactor=col, metallicFactor=0.3 if k == 'vitre' else 0.1,
            roughnessFactor=0.35 if k in ('peinture', 'vitre') else 0.7))
        scene.add_geometry(sub, node_name=k, geom_name=k)
        print(f'{k:9s} {len(idx):7d} triangles')
    brut = pathlib.Path(tempfile.gettempdir()) / f'{nom}-brut.glb'
    scene.export(brut)
    sortie = RACINE / 'assets' / 'fun' / f'{nom}.glb'
    subprocess.run(['gltf-transform', 'optimize', str(brut), str(sortie), '--compress', 'meshopt',
                    '--simplify-ratio', '0.25', '--simplify-error', '0.001'], check=True, shell=True)
    print(f'→ {sortie} ; roues : rayon {R["roues"]["rayon"] * S:.3f} m, '
          f'essieux à z = {R["roues"]["y"][0] * S:.3f} et {R["roues"]["y"][1] * S:.3f} m')


if __name__ == '__main__':
    main()

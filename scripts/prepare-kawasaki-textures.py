# ==========================================================================
#  TEXTURES DU CHASSEUR ENNEMI  -  Kawasaki Ki-61
# --------------------------------------------------------------------------
#  Extrait data/objet3d/RETOPO_TEXTURED.zip et data/objet3d/TEXTURES.zip dans
#  un dossier de travail, puis ramene les textures 4K a 1024 et empaquette
#  rugosite et metal dans une seule image ORM (vert = rugosite, bleu = metal),
#  telle que l'attend le format glTF.
#
#  120 Mo de PNG deviennent 3 Mo de JPEG. A 1024 le detail de surface reste
#  porte par la carte de normales : sur un appareil qui traverse l'ecran, la
#  difference avec la 4K n'est pas visible, le temps de chargement si.
#
#  Usage : python scripts/prepare-kawasaki-textures.py <dossier_travail>
#  Ensuite : voir l'entete de scripts/convert-kawasaki.py
# ==========================================================================

import os
import sys
import zipfile

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OBJET3D = os.path.join(RACINE, 'data', 'objet3d')
TAILLE = 1024

# Chaque materiau du .mtl porte son propre jeu de textures. Le nom court sert
# de prefixe aux fichiers produits et fait le lien avec convert-kawasaki.py.
JEUX = {
    'plane1001': 'Model Kawasaki Low Poly_Base Shape Plane_%s.1001.png',
    'plane1002': 'Model Kawasaki Low Poly_Base Shape Plane_%s.1002.png',
    'hood': 'Model Kawasaki Low Poly_Hood Shape_%s.1001.png',
    'fittings': 'Model Kawasaki Low Poly_RETOPO_FITTINGS_%s.1001.png',
    'prop': 'Propellor V2_Propellor_Fittings_ETC_%s.1001.png',
}


def main(travail):
    os.makedirs(travail, exist_ok=True)
    for archive in ('RETOPO_TEXTURED.zip', 'TEXTURES.zip'):
        chemin = os.path.join(OBJET3D, archive)
        cible = travail if archive.startswith('RETOPO') else os.path.join(travail, 'raw')
        zipfile.ZipFile(chemin).extractall(cible)
        print(f'[textures] extrait {archive} -> {cible}')

    brut = os.path.join(travail, 'raw', 'TEXTURES')
    sortie = os.path.join(travail, 'tex')
    os.makedirs(sortie, exist_ok=True)

    def ouvrir(motif, canal):
        chemin = os.path.join(brut, motif % canal)
        return Image.open(chemin) if os.path.exists(chemin) else None

    for nom, motif in JEUX.items():
        base = ouvrir(motif, 'BaseColor')
        if base:
            (base.convert('RGB').resize((TAILLE, TAILLE), Image.LANCZOS)
                 .save(os.path.join(sortie, f'{nom}_basecolor.jpg'), quality=88, optimize=True))
        normale = ouvrir(motif, 'Normal')
        if normale:
            # Une normale supporte mal la compression : qualite plus haute que
            # la couleur, sinon les panneaux se marbrent.
            (normale.convert('RGB').resize((TAILLE, TAILLE), Image.LANCZOS)
                    .save(os.path.join(sortie, f'{nom}_normal.jpg'), quality=93, optimize=True))
        rugosite = ouvrir(motif, 'Roughness')
        metal = ouvrir(motif, 'Metallic')
        if rugosite and metal:
            r = rugosite.convert('L').resize((TAILLE, TAILLE), Image.LANCZOS)
            m = metal.convert('L').resize((TAILLE, TAILLE), Image.LANCZOS)
            noir = Image.new('L', (TAILLE, TAILLE), 0)
            (Image.merge('RGB', (noir, r, m))
                  .save(os.path.join(sortie, f'{nom}_orm.jpg'), quality=90, optimize=True))
        print(f'[textures] {nom} : prepare')

    total = sum(os.path.getsize(os.path.join(sortie, f)) for f in os.listdir(sortie))
    print(f'[textures] {len(os.listdir(sortie))} fichiers, {total / 1e6:.2f} Mo dans {sortie}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('usage : python scripts/prepare-kawasaki-textures.py <dossier_travail>')
    main(sys.argv[1])

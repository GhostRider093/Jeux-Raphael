"""Fusionne un lot d'animations Meshy en un seul GLB.

Meshy livre un fichier par animation, et chacun embarque une copie complète du
personnage et de ses textures : quatre animations du chevalier = 94 Mo pour un
maillage qui n'en pèse qu'un. On garde donc un fichier comme base et on y greffe
les pistes des autres.

C'est légitime parce que les fichiers d'un même lot sortent du même export : même
squelette, mêmes noeuds, dans le même ordre — le script le vérifie et refuse sinon.
Seuls les accesseurs des échantillons d'animation sont recopiés.

    python scripts/meshy-fusion.py perso/Meshy_AI_Inferno_Knight_biped assets/knight/knight-brut.glb

Puis compresser (maillage meshopt, textures WebP) :

    npx gltf-transform optimize assets/knight/knight-brut.glb assets/knight/knight.glb \
        --compress meshopt --texture-compress webp --texture-size 1024
"""
import json
import pathlib
import struct
import sys

ENTETE = 12
ALIGNE = 4


def lire_glb(chemin):
    """-> (json, octets binaires)."""
    brut = chemin.read_bytes()
    magic, _, _ = struct.unpack("<III", brut[:ENTETE])
    if magic != 0x46546C67:
        raise ValueError(f"{chemin.name} n'est pas un GLB")
    taille, kind = struct.unpack("<II", brut[ENTETE:ENTETE + 8])
    doc = json.loads(brut[ENTETE + 8:ENTETE + 8 + taille])
    reste = ENTETE + 8 + taille
    bin_ = b""
    if reste < len(brut):
        btaille, _ = struct.unpack("<II", brut[reste:reste + 8])
        bin_ = brut[reste + 8:reste + 8 + btaille]
    return doc, bin_


def ecrire_glb(chemin, doc, bin_):
    js = json.dumps(doc, separators=(",", ":")).encode("utf8")
    js += b" " * (-len(js) % ALIGNE)
    bn = bin_ + b"\0" * (-len(bin_) % ALIGNE)
    total = ENTETE + 8 + len(js) + (8 + len(bn) if bn else 0)
    chemin.parent.mkdir(parents=True, exist_ok=True)
    with open(chemin, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        if bn:
            f.write(struct.pack("<II", len(bn), 0x004E4942))
            f.write(bn)


def nom_propre(nom):
    """Meshy double chaque animation ('Walking' et 'Walking.001')."""
    return nom.split(".")[0]


def greffer(base, bbin, autre, abin, nom):
    """Recopie l'animation `nom` de `autre` dans `base`. Renvoie le binaire agrandi."""
    anim = next(a for a in autre["animations"] if nom_propre(a["name"]) == nom)
    sortie = bytearray(bbin)
    copies = {}

    def copier_accesseur(i):
        if i in copies:
            return copies[i]
        acc = dict(autre["accessors"][i])
        vue = autre["bufferViews"][acc["bufferView"]]
        debut = vue.get("byteOffset", 0)
        donnees = abin[debut:debut + vue["byteLength"]]
        sortie.extend(b"\0" * (-len(sortie) % ALIGNE))
        acc["bufferView"] = len(base["bufferViews"])
        base["bufferViews"].append({
            "buffer": 0, "byteOffset": len(sortie), "byteLength": len(donnees),
        })
        sortie.extend(donnees)
        copies[i] = len(base["accessors"])
        base["accessors"].append(acc)
        return copies[i]

    neuve = {
        "name": nom,
        "samplers": [{
            "input": copier_accesseur(s["input"]),
            "output": copier_accesseur(s["output"]),
            "interpolation": s.get("interpolation", "LINEAR"),
        } for s in anim["samplers"]],
        "channels": [dict(c) for c in anim["channels"]],
    }
    base.setdefault("animations", []).append(neuve)
    return bytes(sortie)


def fusionner(dossier, sortie):
    fichiers = sorted(pathlib.Path(dossier).glob("*.glb"))
    if len(fichiers) < 2:
        raise SystemExit(f"{dossier} : il faut au moins deux GLB")

    base, bbin = lire_glb(fichiers[0])
    noeuds = [n.get("name") for n in base["nodes"]]
    garde = nom_propre(base["animations"][0]["name"])
    base["animations"] = [a for a in base["animations"] if nom_propre(a["name"]) == garde][:1]
    base["animations"][0]["name"] = garde
    print(f"base   {fichiers[0].name[:52]:54s} {garde}")

    for f in fichiers[1:]:
        autre, abin = lire_glb(f)
        if [n.get("name") for n in autre["nodes"]] != noeuds:
            raise SystemExit(f"{f.name} : squelette différent, fusion refusée")
        nom = nom_propre(autre["animations"][0]["name"])
        bbin = greffer(base, bbin, autre, abin, nom)
        print(f"greffe {f.name[:52]:54s} {nom}")

    base["buffers"] = [{"byteLength": len(bbin)}]
    ecrire_glb(pathlib.Path(sortie), base, bbin)
    print(f"-> {sortie}  {pathlib.Path(sortie).stat().st_size / 1e6:.1f} Mo  "
          f"animations : {[a['name'] for a in base['animations']]}")


if __name__ == "__main__":
    fusionner(sys.argv[1], sys.argv[2])
